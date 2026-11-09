// 図書館の本（ユーザーが書いた小説・漫画）を store の中で持つ。db.json の books に保存される
// ・下書き → （ネズミのまとめた案・運営の手伝い）→ 同意して出す → 棚に並ぶ
// ・お話や文章を変えるのは、作者だけ。ネズミと運営は「案」を出すだけ
import { HttpError } from './store.js';
import { GENRE_IDS } from '../shared/cafe.js';
import { shelfAllows } from '../shared/library.js';
import { applyRuby, nezumiSuggestion } from '../shared/library-tidy.js';

export const MAX_BOOK_TITLE = 40;
export const MAX_BOOK_BLURB = 100;
export const MAX_NOVEL_LENGTH = 60000;
export const MAX_MANGA_PAGES = 40;
export const MAX_BOOKS_PER_USER = 30;
export const MAX_HELP_NOTE = 200;
export const MAX_HIDE_REASON = 100;
export const BOOK_KINDS = ['novel', 'manga'];
// 挿し絵・表紙の募集
export const CALL_KINDS = ['cover', 'illust'];
export const MAX_CALL_NOTE = 200;
export const MAX_ENTRY_COMMENT = 60;
export const MAX_OPEN_CALLS = 3;
export const MAX_ENTRIES_PER_CALL = 30;
export const MAX_ENTRIES_PER_USER = 3;
export const MAX_ILLUST_SLOT = 20;
const AGE_IDS = ['child', 'teen', 'adult'];
const COLOR = /^#[0-9a-f]{6}$/i;
export const DEFAULT_COVER = { novel: { emoji: '📖', color: '#5e8c4a' }, manga: { emoji: '🖼️', color: '#7e5bb5' } };

const chars = (s) => [...String(s ?? '')].length;

// isPractice：練習モード（おうちの人とつながる前の子ども）。下書きとネズミの案は使えるが、
// 棚に出す・募集を出す・応募する（ほかの人に見えること）は、つながってから
export const PRACTICE_LIBRARY_MSG = 'おうちの人とつながったら、図書館に出せるようになるっす！（アカウントのページの「おうちの人とつなぐ」から）';

export function createLibraryStore({ state, now, emit, newId, userById, ageGroupOf, rejectBlocked, isPractice = () => false }) {
  const notPractice = (user) => { if (isPractice(user)) throw new HttpError(403, PRACTICE_LIBRARY_MSG); };
  state.books ??= [];
  state.calls ??= []; // 挿し絵・表紙の募集 { id, bookId, authorId, kind, slot, note, status, entries: [{ id, userId, image, comment, consentAt, at }], adoptedEntryId }

  const requireBook = (id) => {
    const book = state.books.find((b) => b.id === id);
    if (!book) throw new HttpError(404, 'その本は見つかりません');
    return book;
  };
  const ownBook = (authorId, id) => {
    const book = requireBook(id);
    if (book.authorId !== authorId) throw new HttpError(403, '自分の本だけ変えられます');
    return book;
  };
  const requireCall = (id) => {
    const call = state.calls.find((c) => c.id === id);
    if (!call) throw new HttpError(404, 'その募集は見つかりません');
    return call;
  };
  const touch = (book) => { book.updatedAt = now(); emit('book', book); return book; };

  // 本の情報をたしかめる（作り直すときも同じ）
  function clean(author, fields, book = null) {
    const out = {};
    const kind = book?.kind ?? fields.kind;
    if (!BOOK_KINDS.includes(kind)) throw new HttpError(400, '小説か漫画かを選んでください');
    out.kind = kind;
    if (!book || 'title' in fields) {
      const title = String(fields.title ?? '').trim();
      if (!title) throw new HttpError(400, '本の題名を入力してください');
      if (chars(title) > MAX_BOOK_TITLE) throw new HttpError(400, `題名は${MAX_BOOK_TITLE}文字以内にしてください`);
      rejectBlocked(author, title);
      out.title = title;
    }
    if (!book || 'genre' in fields) {
      if (!GENRE_IDS.includes(fields.genre)) throw new HttpError(400, 'ジャンルを選んでください');
      out.genre = fields.genre;
    }
    if (!book || 'minAge' in fields) {
      if (!AGE_IDS.includes(fields.minAge)) throw new HttpError(400, '年齢の棚を選んでください');
      if (!shelfAllows(fields.minAge, ageGroupOf(author))) throw new HttpError(403, '自分の年齢で読めない棚には、本を出せません');
      out.minAge = fields.minAge;
    }
    if (!book || 'blurb' in fields) {
      const blurb = String(fields.blurb ?? '').trim();
      if (chars(blurb) > MAX_BOOK_BLURB) throw new HttpError(400, `あらすじは${MAX_BOOK_BLURB}文字以内にしてください`);
      if (blurb) rejectBlocked(author, blurb);
      out.blurb = blurb;
    }
    if (!book || 'cover' in fields) {
      const c = fields.cover ?? {};
      const emoji = String(c.emoji ?? '').trim();
      out.cover = {
        emoji: emoji && chars(emoji) <= 8 ? emoji : DEFAULT_COVER[kind].emoji,
        color: COLOR.test(c.color ?? '') ? c.color : DEFAULT_COVER[kind].color,
      };
    }
    if (kind === 'novel' && (!book || 'text' in fields)) {
      const text = String(fields.text ?? '').replace(/\r\n?/g, '\n');
      if (chars(text) > MAX_NOVEL_LENGTH) throw new HttpError(400, `小説は${MAX_NOVEL_LENGTH.toLocaleString()}文字までにしてください`);
      if (text.trim()) rejectBlocked(author, text);
      out.text = text;
    }
    if (!book || 'tidyWanted' in fields) out.tidyWanted = Boolean(fields.tidyWanted);
    return out;
  }

  // 中身が変わったら、ネズミの案を作りなおす（頼まれているときだけ）
  function refreshNezumi(book) {
    book.tidy.nezumi = book.tidy.wanted && (book.kind === 'novel' ? book.text.trim() : book.pages.length)
      ? { ...nezumiSuggestion(book), at: now() }
      : null;
  }

  const library = {
    listPublishedBooks: () => state.books.filter((b) => b.status === 'published'),
    listBooksBy: (authorId) => state.books.filter((b) => b.authorId === authorId),
    listHelpRequests: () => state.books.filter((b) => b.tidy.help),
    listHiddenBooks: () => state.books.filter((b) => b.status === 'hidden'),
    getBook: requireBook,

    createBook(authorId, fields) {
      const author = userById(authorId);
      if (!author || author.kind !== 'human') throw new HttpError(403, '本を出せるのは、ともはねのユーザーだけです');
      if (state.books.filter((b) => b.authorId === authorId).length >= MAX_BOOKS_PER_USER) {
        throw new HttpError(400, `本は1人${MAX_BOOKS_PER_USER}冊までです`);
      }
      const f = clean(author, fields);
      const book = {
        id: newId('b'), authorId, kind: f.kind, title: f.title, genre: f.genre, minAge: f.minAge, blurb: f.blurb, cover: f.cover,
        text: f.kind === 'novel' ? f.text : '', pages: [], coverPage: null,
        status: 'draft', hiddenReason: null, consentAt: null,
        tidy: { wanted: f.tidyWanted, nezumi: null, help: null },
        art: { cover: null, illust: {} }, // 募集で選んだ表紙・挿し絵 { file, type, size, by（描いた人）, callId, entryId }
        createdAt: now(), updatedAt: now(), publishedAt: null,
      };
      refreshNezumi(book);
      state.books.push(book);
      return touch(book);
    },

    updateBook(authorId, id, fields) {
      const book = ownBook(authorId, id);
      const f = clean(userById(authorId), fields, book);
      const contentChanged = 'text' in f && f.text !== book.text;
      for (const k of ['title', 'genre', 'minAge', 'blurb', 'cover', 'text']) if (k in f) book[k] = f[k];
      if ('tidyWanted' in f) book.tidy.wanted = f.tidyWanted;
      if (contentChanged || 'tidyWanted' in f) refreshNezumi(book);
      if (book.status === 'published' && book.kind === 'novel' && !book.text.trim()) book.status = 'draft';
      return touch(book);
    },

    // ---- 漫画のページ ----
    addBookPage(authorId, id, page) {
      const book = ownBook(authorId, id);
      if (book.kind !== 'manga') throw new HttpError(400, 'ページを足せるのは漫画だけです');
      if (book.pages.length >= MAX_MANGA_PAGES) throw new HttpError(400, `漫画は${MAX_MANGA_PAGES}ページまでです`);
      book.pages.push(page);
      refreshNezumi(book);
      return touch(book);
    },
    removeBookPage(authorId, id, index) {
      const book = ownBook(authorId, id);
      const [page] = book.pages.splice(index, 1);
      if (!page) throw new HttpError(404, 'そのページは見つかりません');
      if (book.coverPage === index) book.coverPage = null;
      else if (book.coverPage > index) book.coverPage -= 1;
      if (book.status === 'published' && !book.pages.length) book.status = 'draft';
      refreshNezumi(book);
      touch(book);
      return page;
    },
    setPageOrder(authorId, id, order) {
      const book = ownBook(authorId, id);
      reorder(book, order);
      refreshNezumi(book);
      return touch(book);
    },

    // ---- きれいにまとめる ----
    // 作者がネズミ（または運営）の案を使う。ruby は使うルビの漢字（小説だけ）
    applyTidy(authorId, id, { from = 'nezumi', ruby = [] } = {}) {
      const book = ownBook(authorId, id);
      const s = from === 'admin' ? book.tidy.help?.reply : book.tidy.nezumi;
      if (!s) throw new HttpError(404, 'まとめた案は、まだありません');
      if (book.kind === 'novel') {
        const base = s.text ?? book.text;
        book.text = applyRuby(base, Array.isArray(ruby) ? ruby.map(String) : []);
      } else {
        if (s.order) reorder(book, s.order);
        if (s.cover != null) book.coverPage = s.cover;
      }
      if (from === 'admin') book.tidy.help.used = now();
      refreshNezumi(book);
      return touch(book);
    },
    // ネズミではむずかしいとき：運営に手伝ってもらう
    askHelp(authorId, id, note) {
      const book = ownBook(authorId, id);
      const text = String(note ?? '').trim();
      if (!text) throw new HttpError(400, '手伝ってほしいことを書いてください');
      if (chars(text) > MAX_HELP_NOTE) throw new HttpError(400, `${MAX_HELP_NOTE}文字以内にしてください`);
      book.tidy.help = { note: text, at: now(), reply: null, used: null };
      return touch(book);
    },
    cancelHelp(authorId, id) {
      const book = ownBook(authorId, id);
      book.tidy.help = null;
      return touch(book);
    },
    // 運営の手伝い（案）：小説は直した本文、漫画はページの順番と表紙。作者が使うかを決める
    answerHelp(id, { text, order, cover, note }) {
      const book = requireBook(id);
      if (!book.tidy.help) throw new HttpError(400, 'この本は、手伝いを頼まれていません');
      const reply = { note: String(note ?? '').trim().slice(0, MAX_HELP_NOTE), at: now() };
      if (book.kind === 'novel' && typeof text === 'string' && text.trim()) {
        if (chars(text) > MAX_NOVEL_LENGTH) throw new HttpError(400, '本文が長すぎます');
        reply.text = text.replace(/\r\n?/g, '\n');
      }
      if (book.kind === 'manga' && Array.isArray(order)) {
        checkOrder(book, order);
        reply.order = order.map(Number);
      }
      if (book.kind === 'manga' && Number.isInteger(cover) && cover >= 0 && cover < book.pages.length) reply.cover = cover;
      if (!reply.note && !reply.text && !reply.order) throw new HttpError(400, 'ひとことか、直した案を入れてください');
      book.tidy.help.reply = reply;
      return touch(book);
    },

    // ---- 出す・しまう ----
    publishBook(authorId, id, consent) {
      const book = ownBook(authorId, id);
      if (consent !== true) throw new HttpError(400, '図書館の約束に同意してください');
      notPractice(userById(authorId));
      if (book.status === 'hidden') throw new HttpError(403, `運営が取り下げた本です（${book.hiddenReason ?? '理由なし'}）。運営に相談してください`);
      if (book.kind === 'novel' && !book.text.trim()) throw new HttpError(400, '本文を書いてください');
      if (book.kind === 'manga' && !book.pages.length) throw new HttpError(400, 'ページを1枚以上入れてください');
      if (!shelfAllows(book.minAge, ageGroupOf(userById(authorId)))) throw new HttpError(403, '自分の年齢で読めない棚には、本を出せません');
      book.status = 'published';
      book.consentAt = now();
      book.publishedAt ??= now();
      return touch(book);
    },
    unpublishBook(authorId, id) {
      const book = ownBook(authorId, id);
      if (book.status === 'published') book.status = 'draft';
      return touch(book);
    },
    removeBook(id, { authorId = null } = {}) {
      const book = authorId ? ownBook(authorId, id) : requireBook(id);
      state.books.splice(state.books.indexOf(book), 1);
      emit('book', book);
      return book;
    },
    // 運営の取り下げ・もどす
    hideBook(id, reason) {
      const book = requireBook(id);
      const r = String(reason ?? '').trim();
      if (!r) throw new HttpError(400, '取り下げる理由を書いてください（作者に見せます）');
      book.status = 'hidden';
      book.hiddenReason = r.slice(0, MAX_HIDE_REASON);
      return touch(book);
    },
    restoreBook(id) {
      const book = requireBook(id);
      if (book.status !== 'hidden') throw new HttpError(400, '取り下げていない本です');
      book.status = 'draft';
      book.hiddenReason = null;
      return touch(book);
    },

    // ---- 挿し絵・表紙の募集スレッド ----
    // 作者が募集 → 描いた人が「選ばれたら載せてもいい」に同意して応募 → 作者が1枚選ぶ（採用）→ 本に名前が出る
    listCalls: () => state.calls,
    getCall: requireCall,
    callsOf: (bookId) => state.calls.filter((c) => c.bookId === bookId),
    openCall(authorId, bookId, { kind, slot, note }) {
      const book = ownBook(authorId, bookId);
      notPractice(userById(authorId));
      if (!CALL_KINDS.includes(kind)) throw new HttpError(400, '表紙か挿し絵かを選んでください');
      if (kind === 'illust' && book.kind !== 'novel') throw new HttpError(400, '挿し絵の募集は、小説だけです');
      const s = kind === 'illust' ? Number(slot) : null;
      if (kind === 'illust' && !(Number.isInteger(s) && s >= 1 && s <= MAX_ILLUST_SLOT)) throw new HttpError(400, `挿し絵の番号は1〜${MAX_ILLUST_SLOT}にしてください`);
      const text = String(note ?? '').trim();
      if (!text) throw new HttpError(400, 'どんな絵がほしいか、ひとこと書いてください');
      if (chars(text) > MAX_CALL_NOTE) throw new HttpError(400, `${MAX_CALL_NOTE}文字以内にしてください`);
      rejectBlocked(userById(authorId), text);
      if (state.calls.filter((c) => c.bookId === bookId && c.status === 'open').length >= MAX_OPEN_CALLS) {
        throw new HttpError(400, `ひとつの本で、同時に出せる募集は${MAX_OPEN_CALLS}つまでです`);
      }
      if (state.calls.some((c) => c.bookId === bookId && c.status === 'open' && c.kind === kind && c.slot === s)) {
        throw new HttpError(400, 'おなじ募集が、もう出ています');
      }
      const call = { id: newId('c'), bookId, authorId, kind, slot: s, note: text, status: 'open', entries: [], adoptedEntryId: null, createdAt: now() };
      state.calls.push(call);
      emit('call', call);
      return call;
    },
    closeCall(authorId, callId) {
      const call = requireCall(callId);
      if (call.authorId !== authorId) throw new HttpError(403, '自分の募集だけ閉じられます');
      if (call.status === 'open') call.status = 'closed';
      emit('call', call);
      return call;
    },
    // 募集を消す（作者・運営）。消したあとで、使われていないファイルを返す（呼んだ側が消す）
    removeCall(callId, { authorId = null } = {}) {
      const call = requireCall(callId);
      if (authorId && call.authorId !== authorId) throw new HttpError(403, '自分の募集だけ消せます');
      state.calls.splice(state.calls.indexOf(call), 1);
      emit('call', call);
      return call.entries.map((e) => e.image).filter((img) => !fileUsed(img.file));
    },
    addEntry(userId, callId, { image, comment, consent }) {
      const call = requireCall(callId);
      const user = userById(userId);
      if (!user || user.kind !== 'human') throw new HttpError(403, '応募できるのは、ともはねのユーザーだけです');
      notPractice(user);
      if (call.status !== 'open') throw new HttpError(400, 'この募集は、もう閉まっています');
      if (consent !== true) throw new HttpError(400, '「選ばれたら、この本に載せてもいい」に同意してください');
      const book = requireBook(call.bookId);
      if (!shelfAllows(book.minAge, ageGroupOf(user))) throw new HttpError(403, 'この本の年齢の棚に合わないので、応募できません');
      const text = String(comment ?? '').trim();
      if (chars(text) > MAX_ENTRY_COMMENT) throw new HttpError(400, `ひとことは${MAX_ENTRY_COMMENT}文字以内にしてください`);
      if (text) rejectBlocked(user, text);
      if (call.entries.length >= MAX_ENTRIES_PER_CALL) throw new HttpError(400, 'この募集は、応募がいっぱいです');
      if (call.entries.filter((e) => e.userId === userId).length >= MAX_ENTRIES_PER_USER) {
        throw new HttpError(400, `ひとつの募集に、1人${MAX_ENTRIES_PER_USER}枚までです`);
      }
      const entry = { id: newId('e'), userId, image, comment: text, consentAt: now(), at: now() };
      call.entries.push(entry);
      emit('call', call);
      return entry;
    },
    // 応募を取り下げる（描いた人・運営）。採用された絵は、本から外さないと消せない
    removeEntry(callId, entryId, { userId = null } = {}) {
      const call = requireCall(callId);
      const entry = call.entries.find((e) => e.id === entryId);
      if (!entry) throw new HttpError(404, 'その応募は見つかりません');
      if (userId && entry.userId !== userId) throw new HttpError(403, '自分の応募だけ取り下げられます');
      if (call.adoptedEntryId === entryId) throw new HttpError(400, '採用された絵です。作者に相談してください');
      call.entries.splice(call.entries.indexOf(entry), 1);
      emit('call', call);
      return fileUsed(entry.image.file) ? null : entry.image;
    },
    // 作者が1枚選ぶ。表紙・挿し絵になり、描いた人の名前が本に出る。前の絵は返す（使われていなければ消す）
    adoptEntry(authorId, callId, entryId) {
      const call = requireCall(callId);
      if (call.authorId !== authorId) throw new HttpError(403, '自分の募集だけ選べます');
      const entry = call.entries.find((e) => e.id === entryId);
      if (!entry) throw new HttpError(404, 'その応募は見つかりません');
      const book = requireBook(call.bookId);
      book.art ??= { cover: null, illust: {} };
      const art = { ...entry.image, by: entry.userId, callId, entryId };
      let old;
      if (call.kind === 'cover') { old = book.art.cover; book.art.cover = art; } else { old = book.art.illust[call.slot]; book.art.illust[call.slot] = art; }
      call.status = 'adopted';
      call.adoptedEntryId = entryId;
      touch(book);
      emit('call', call);
      return { book, freed: old && !fileUsed(old.file) ? old : null };
    },
    // 作者が本から絵を外す
    removeArt(authorId, bookId, { kind, slot }) {
      const book = ownBook(authorId, bookId);
      const art = book.art ?? { cover: null, illust: {} };
      let old;
      if (kind === 'cover') { old = art.cover; art.cover = null; } else { old = art.illust[Number(slot)]; delete art.illust[Number(slot)]; }
      if (!old) throw new HttpError(404, 'その絵は、本に入っていません');
      book.art = art;
      const call = state.calls.find((c) => c.id === old.callId);
      if (call && call.adoptedEntryId === old.entryId) { call.adoptedEntryId = null; call.status = 'closed'; }
      touch(book);
      return fileUsed(old.file) ? null : old;
    },
    // 本を消したとき：その本の募集もいっしょに消す。使われなくなったファイルを返す
    removeCallsOf(bookId) {
      const files = [];
      for (const call of state.calls.filter((c) => c.bookId === bookId)) {
        state.calls.splice(state.calls.indexOf(call), 1);
        files.push(...call.entries.map((e) => e.image));
      }
      return files.filter((img) => !fileUsed(img.file));
    },
  };

  // 退会した人の図書館のもの（書いた本・その本の募集・応募した絵・ほかの本に載った絵）を消す。
  // 消したあとで、どこにも使われていないファイルを返す（サーバーが消す）
  function eraseUserLibrary(userId) {
    const files = [];
    for (const book of state.books.filter((b) => b.authorId === userId)) {
      const a = book.art ?? { cover: null, illust: {} };
      files.push(...book.pages, a.cover, ...Object.values(a.illust));
      for (const call of state.calls.filter((c) => c.bookId === book.id)) {
        state.calls.splice(state.calls.indexOf(call), 1);
        files.push(...call.entries.map((e) => e.image));
      }
      state.books.splice(state.books.indexOf(book), 1);
    }
    for (const call of state.calls) {
      for (const e of call.entries.filter((x) => x.userId === userId)) {
        call.entries.splice(call.entries.indexOf(e), 1);
        files.push(e.image);
        if (call.adoptedEntryId === e.id) { call.adoptedEntryId = null; call.status = 'closed'; }
      }
    }
    for (const book of state.books) {
      const a = book.art;
      if (!a) continue;
      if (a.cover?.by === userId) { files.push(a.cover); a.cover = null; }
      for (const [slot, art] of Object.entries(a.illust)) if (art.by === userId) { files.push(art); delete a.illust[slot]; }
    }
    const seen = new Set();
    return files.filter((f) => f && !seen.has(f.file) && seen.add(f.file) && !fileUsed(f.file));
  }
  library.eraseUserLibrary = eraseUserLibrary;
  return library;

  // そのファイルを、どこか（応募・本の絵）がまだ使っているか
  function fileUsed(file) {
    if (state.calls.some((c) => c.entries.some((e) => e.image.file === file))) return true;
    return state.books.some((b) => b.art && (b.art.cover?.file === file || Object.values(b.art.illust).some((a) => a.file === file)));
  }
}

function checkOrder(book, order) {
  const n = book.pages.length;
  const ok = Array.isArray(order) && order.length === n && new Set(order.map(Number)).size === n
    && order.every((v) => Number.isInteger(Number(v)) && v >= 0 && v < n);
  if (!ok) throw new HttpError(400, 'ページの順番が正しくありません');
}
function reorder(book, order) {
  checkOrder(book, order);
  const coverFile = book.coverPage != null ? book.pages[book.coverPage]?.file : null;
  book.pages = order.map((i) => book.pages[Number(i)]);
  if (coverFile) book.coverPage = book.pages.findIndex((p) => p.file === coverFile);
}
