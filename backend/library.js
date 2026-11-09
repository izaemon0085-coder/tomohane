// 図書館の API：棚・読む・本を書く（小説の本文は長いので、ふつうの API より大きく受け取る）・漫画のページの画像・運営
// 漫画の画像は data/library/pages/ に置く（data/ は git に入らない）。本の情報は store（db.json）が持つ
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError, ageGroup } from './store.js';
import { AGE_SHELVES, LIBRARY_GENRES, SAMPLE_BOOKS, bookCard, findBook, kameLine, novelLength, shelfAllows } from '../shared/library.js';

export const PAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_BOOK_JSON = 512 * 1024; // 小説6万字が入る大きさ
const PAGE_FILE = /^[\w-]+\.(png|jpg|webp)$/;

// ファイルの頭の数バイトで、ほんとうに画像かをたしかめる（名前や種類だけを信じない）
const MAGIC = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

async function readBigJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BOOK_JSON) throw new HttpError(413, '本文が大きすぎます');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'JSON の形式が正しくありません');
  }
}

async function savePage(req, { dir, bookId, maxBytes }) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = PAGE_TYPES[type];
  if (!ext) throw new HttpError(415, 'ページの画像は PNG・JPEG・WebP のどれかにしてください');
  const tooBig = () => new HttpError(413, `ページの画像は1枚${Math.floor(maxBytes / 1024 / 1024)}MBまでにしてください`);
  if (Number(req.headers['content-length']) > maxBytes) throw tooBig();
  await mkdir(dir, { recursive: true });
  const file = `${bookId}-${randomUUID().slice(0, 8)}${ext}`;
  const part = join(dir, `${file}.part`);
  let size = 0;
  const counter = new Transform({
    transform(chunk, _e, done) {
      size += chunk.length;
      if (size > maxBytes) done(tooBig()); else done(null, chunk);
    },
  });
  try {
    await pipeline(req, counter, createWriteStream(part));
    const head = Buffer.alloc(12);
    const fh = await open(part, 'r');
    try { await fh.read(head, 0, 12, 0); } finally { await fh.close(); }
    if (!size || !MAGIC[type](head)) throw new HttpError(415, 'この画像は読めませんでした。PNG・JPEG・WebP の画像にしてください');
  } catch (err) {
    await rm(part, { force: true });
    throw err instanceof HttpError ? err : new HttpError(400, 'ページを受け取れませんでした。もう一度ためしてください');
  }
  await rename(part, join(dir, file));
  let name = '';
  try { name = decodeURIComponent(String(req.headers['x-file-name'] ?? '')).slice(0, 80); } catch { /* 名前なし */ }
  return { file, type, size, name };
}
const removePage = (dir, page) => (page && PAGE_FILE.test(page.file) ? rm(join(dir, page.file), { force: true }) : null);

export function createLibraryApi({ store, dir, sendJson, maxPageBytes = MAX_PAGE_BYTES }) {
  const groupOf = (me) => (me?.birthdate ? ageGroup(me.birthdate) : 'child');
  const isAdmin = (me) => me?.role === 'admin';
  const needLogin = (me) => { if (!me) throw new HttpError(401, 'ログインしてください'); return me; };
  const needAdmin = (me) => { if (!isAdmin(needLogin(me))) throw new HttpError(403, '運営（管理者）だけができます'); return me; };
  const authorName = (b) => { try { return store.getUser(b.authorId).name; } catch { return '？'; } };

  // 棚に並べる情報（本文・ページは入れない）
  const card = (b) => ({
    id: b.id, kind: b.kind, title: b.title, genre: b.genre, minAge: b.minAge, blurb: b.blurb, cover: b.cover,
    coverImage: b.kind === 'manga' && b.coverPage != null ? `/api/library/books/${b.id}/pages/${b.coverPage}` : null,
    author: authorName(b), sample: false, publishedAt: b.publishedAt,
    length: b.kind === 'novel' ? novelLength(b.text) : b.pages.length,
  });
  // 作者が見る情報（下書き・ネズミの案・運営の返事）
  const ownerView = (b) => ({
    ...card(b), status: b.status, hiddenReason: b.hiddenReason, text: b.text, consentAt: b.consentAt,
    pages: b.pages.map((p, i) => ({ n: i, name: p.name, size: p.size, url: `/api/library/books/${b.id}/pages/${i}` })),
    coverPage: b.coverPage, tidy: b.tidy, createdAt: b.createdAt, updatedAt: b.updatedAt,
  });
  // 読める人：出ていて年齢が合う人・作者・運営
  function canRead(b, me) {
    if (me && (b.authorId === me.id || isAdmin(me))) return true;
    return b.status === 'published' && shelfAllows(b.minAge, groupOf(me));
  }

  const routes = [
    ['GET', /^\/api\/library$/, ({ me }) => {
      const group = groupOf(me);
      const mine = store.listPublishedBooks().filter((b) => shelfAllows(b.minAge, group)).map(card);
      return {
        ageGroup: group, kame: kameLine(group), genres: LIBRARY_GENRES,
        shelves: AGE_SHELVES.filter((s) => shelfAllows(s.id, group)),
        books: [...mine.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))),
          ...SAMPLE_BOOKS.filter((b) => shelfAllows(b.minAge, group)).map(bookCard)],
      };
    }],
    ['GET', /^\/api\/library\/books\/([\w-]+)$/, ({ params, me }) => {
      const sample = findBook(params[0]);
      if (sample) {
        if (!shelfAllows(sample.minAge, groupOf(me))) throw new HttpError(403, 'この本は、年齢の棚が合わないので読めません');
        return { ...bookCard(sample), text: sample.text, pages: sample.pages };
      }
      let b;
      try { b = store.getBook(params[0]); } catch { throw new HttpError(404, 'その本は見つかりません'); }
      if (!canRead(b, me)) {
        if (b.status !== 'published') throw new HttpError(404, 'その本は見つかりません');
        throw new HttpError(403, 'この本は、年齢の棚が合わないので読めません');
      }
      return { ...card(b), text: b.kind === 'novel' ? b.text : undefined, pageCount: b.pages.length };
    }],

    // ---- 作者 ----
    ['GET', /^\/api\/library\/mine$/, ({ me }) => store.listBooksBy(needLogin(me).id).map(ownerView)],
    ['POST', /^\/api\/library\/books$/, ({ me, body }) => ownerView(store.createBook(needLogin(me).id, body))],
    ['PUT', /^\/api\/library\/books\/([\w-]+)$/, ({ me, params, body }) => ownerView(store.updateBook(needLogin(me).id, params[0], body))],
    ['DELETE', /^\/api\/library\/books\/([\w-]+)$/, async ({ me, params }) => {
      const book = isAdmin(me) && store.getBook(params[0]).authorId !== me.id
        ? store.removeBook(params[0])
        : store.removeBook(params[0], { authorId: needLogin(me).id });
      await Promise.all(book.pages.map((p) => removePage(dir, p)));
      return { ok: true };
    }],
    ['PUT', /^\/api\/library\/books\/([\w-]+)\/order$/, ({ me, params, body }) => ownerView(store.setPageOrder(needLogin(me).id, params[0], body.order))],
    ['DELETE', /^\/api\/library\/books\/([\w-]+)\/pages\/(\d+)$/, async ({ me, params }) => {
      const page = store.removeBookPage(needLogin(me).id, params[0], Number(params[1]));
      await removePage(dir, page);
      return ownerView(store.getBook(params[0]));
    }],
    ['POST', /^\/api\/library\/books\/([\w-]+)\/tidy$/, ({ me, params, body }) => ownerView(store.applyTidy(needLogin(me).id, params[0], body))],
    ['POST', /^\/api\/library\/books\/([\w-]+)\/help$/, ({ me, params, body }) => ownerView(store.askHelp(needLogin(me).id, params[0], body.note))],
    ['DELETE', /^\/api\/library\/books\/([\w-]+)\/help$/, ({ me, params }) => ownerView(store.cancelHelp(needLogin(me).id, params[0]))],
    ['POST', /^\/api\/library\/books\/([\w-]+)\/publish$/, ({ me, params, body }) => ownerView(store.publishBook(needLogin(me).id, params[0], body.consent))],
    ['POST', /^\/api\/library\/books\/([\w-]+)\/unpublish$/, ({ me, params }) => ownerView(store.unpublishBook(needLogin(me).id, params[0]))],

    // ---- 運営 ----
    ['GET', /^\/api\/library\/admin$/, ({ me }) => {
      needAdmin(me);
      return {
        help: store.listHelpRequests().map((b) => ({ ...ownerView(b), authorId: b.authorId })),
        books: store.listPublishedBooks().map(card),
        hidden: store.listHiddenBooks().map((b) => ({ ...card(b), hiddenReason: b.hiddenReason })),
      };
    }],
    ['POST', /^\/api\/library\/books\/([\w-]+)\/help-reply$/, ({ me, params, body }) => { needAdmin(me); return ownerView(store.answerHelp(params[0], body)); }],
    ['POST', /^\/api\/library\/books\/([\w-]+)\/hide$/, ({ me, params, body }) => { needAdmin(me); return ownerView(store.hideBook(params[0], body.reason)); }],
    ['POST', /^\/api\/library\/books\/([\w-]+)\/restore$/, ({ me, params }) => { needAdmin(me); return ownerView(store.restoreBook(params[0])); }],
  ];

  // server.js から呼ぶ。図書館の API なら答えて true
  return async function handleLibrary(req, res, pathname, me) {
    if (!pathname.startsWith('/api/library')) return false;

    // 漫画のページ：足す（画像そのものを受け取る）・見る
    const pageUp = pathname.match(/^\/api\/library\/books\/([\w-]+)\/pages$/);
    if (pageUp && req.method === 'POST') {
      const book = store.getBook(pageUp[1]);
      if (!me || book.authorId !== me.id) throw new HttpError(403, '自分の本だけ変えられます');
      if (book.kind !== 'manga') throw new HttpError(400, 'ページを足せるのは漫画だけです');
      const page = await savePage(req, { dir, bookId: book.id, maxBytes: maxPageBytes });
      try {
        store.addBookPage(me.id, book.id, page);
      } catch (err) {
        await removePage(dir, page);
        throw err;
      }
      sendJson(res, 200, ownerView(store.getBook(book.id)));
      return true;
    }
    const pageDown = pathname.match(/^\/api\/library\/books\/([\w-]+)\/pages\/(\d+)$/);
    if (pageDown && req.method === 'GET') {
      let book;
      try { book = store.getBook(pageDown[1]); } catch { throw new HttpError(404, 'ページが見つかりません'); }
      const page = book.pages[Number(pageDown[2])];
      if (!page || !canRead(book, me) || !PAGE_FILE.test(page.file)) throw new HttpError(404, 'ページが見つかりません');
      const path = join(dir, page.file);
      try { await stat(path); } catch { throw new HttpError(404, 'ページが見つかりません'); }
      res.writeHead(200, { 'Content-Type': page.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      await pipeline(createReadStream(path), res).catch(() => {});
      return true;
    }

    for (const [method, pattern, fn] of routes) {
      const m = pathname.match(pattern);
      if (!m || method !== req.method) continue;
      const body = method === 'POST' || method === 'PUT' ? await readBigJson(req) : {};
      sendJson(res, 200, await fn({ params: m.slice(1), body, me }));
      return true;
    }
    return false;
  };
}
