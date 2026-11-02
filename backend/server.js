// バックエンド：REST API + SSE + 3つのフロント（フロントエンド / サイドフロント / サブフロント）の配信。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, HttpError } from './store.js';
import { createSimulation } from './simulation.js';
import { lanAddresses } from './net.js';
import { MAX_VIDEO_BYTES, removeVideo, saveVideo, serveVideo } from './letters.js';
import { createKokotomoClient } from './kokotomo.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// URL の接頭辞 → 配信するディレクトリ（長いものから順に判定）
const STATIC_MOUNTS = [
  ['/side/', 'sidefront'],   // エージェントたちの家
  ['/sub/', 'subfront'],     // エージェントたちの会議室
  ['/shared/', 'shared'],    // 共通 CSS / JS
  ['/open/', 'open'],        // 手紙の受け取りページ（QR から開く。登録なしで見られる）
  ['/', 'frontend'],         // SNS 本体
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function publicUser(u) {
  if (!u) return null;
  const { id, kind, name, handle, emoji, avatar, color, roleLabel } = u;
  return { id, kind, name, handle, emoji, avatar: avatar ?? null, color: color ?? null, roleLabel: roleLabel ?? null };
}

function postView(post, usersById) {
  return {
    ...post,
    author: publicUser(usersById[post.authorId]),
    likeCount: post.likes.length,
  };
}

function meetingView(meeting, usersById) {
  return {
    ...meeting,
    participants: meeting.participantIds.map((id) => publicUser(usersById[id])),
    messages: meeting.messages.map((m) => ({ ...m, author: publicUser(usersById[m.authorId]) })),
  };
}

// 作った人が見る手紙（合言葉のハッシュと、だれが作ったかは返さない）
function letterOwnerView(l) {
  return {
    id: l.id, token: l.token, to: l.to, from: l.from, note: l.note, paper: l.paper, typeface: l.typeface ?? 'system',
    hasVideo: Boolean(l.video), videoSize: l.video?.size ?? null, createdAt: l.createdAt, openedAt: l.openedAt,
  };
}

// 受け取った人が見る手紙（QR から開く。id や作った人のユーザー情報は出さない）
function letterOpenView(l) {
  return {
    to: l.to, from: l.from, note: l.note, paper: l.paper, typeface: l.typeface ?? 'system',
    hasVideo: Boolean(l.video), createdAt: l.createdAt,
  };
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new HttpError(413, 'リクエストが大きすぎます');
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

export function createApp({
  store, sim, port = Number(process.env.PORT) || 3000,
  videoDir = join(ROOT, 'data', 'letters', 'videos'), maxVideoBytes = MAX_VIDEO_BYTES,
  kokotomo = createKokotomoClient(),
}) {
  const routes = [
    // line：回線番のモグが選んだ回線（wifi / local / offline）
    ['GET', /^\/api\/health$/, () => ({ ok: true, line: sim.lineStatus()?.active ?? null })],
    ['GET', /^\/api\/network$/, () => ({
      port,
      lanUrls: lanAddresses().map((ip) => `http://${ip}:${port}/`),
      ...sim.lineStatus(),
    })],

    // ---- users ----
    ['GET', /^\/api\/users$/, () => store.listUsers().map(publicUser)],
    ['POST', /^\/api\/users$/, ({ body }) => [201, publicUser(store.findOrCreateHuman(body.name))]],

    // ---- 推しの情報（わたしの推しページ） ----
    ['GET', /^\/api\/users\/([\w-]+)\/oshi$/, ({ params }) => store.getOshi(params[0])],
    ['PUT', /^\/api\/users\/([\w-]+)\/oshi$/, ({ params, body }) => store.updateOshi(params[0], body)],
    ['POST', /^\/api\/users\/([\w-]+)\/oshi\/goods$/, ({ params, body }) => [201, store.addGoods(params[0], body.name)]],
    ['DELETE', /^\/api\/users\/([\w-]+)\/oshi\/goods\/([\w-]+)$/, ({ params }) => store.removeGoods(params[0], params[1])],
    ['GET', /^\/api\/users\/([\w-]+)\/oshi\/friends$/, ({ params }) => {
      const users = store.usersById();
      return store.oshiFriendsPosts(params[0]).map((p) => postView(p, users));
    }],

    // ---- やりくり献立との連結（最新の献立の「きょうの晩ごはん」と、画面のアドレス） ----
    ['GET', /^\/api\/kondate$/, () => sim.kondateSummary()],

    // ---- こことも（移動サポートのアプリ）との連結：ライブ会場のバリアフリーメモ ----
    ['GET', /^\/api\/kokotomo\/venue$/, async ({ query }) => {
      const name = (query.get('name') || '').trim().slice(0, 30);
      if (!name) throw new HttpError(400, '会場の名前がありません');
      return kokotomo.venueMemo(name);
    }],

    // ---- posts（フロントエンド） ----
    ['GET', /^\/api\/posts$/, () => {
      const users = store.usersById();
      return store.listPosts().map((p) => postView(p, users));
    }],
    ['POST', /^\/api\/posts$/, ({ body }) => {
      const post = store.createPost({ authorId: body.authorId, text: body.text, replyTo: body.replyTo });
      if (store.getUser(post.authorId).kind === 'human') sim.onHumanPost(post);
      return [201, postView(post, store.usersById())];
    }],
    ['POST', /^\/api\/posts\/([\w-]+)\/like$/, ({ params, body }) =>
      postView(store.toggleLike(params[0], body.userId), store.usersById())],

    // ---- agents（サイドフロント：家） ----
    ['GET', /^\/api\/agents$/, () => store.listAgents().map((a) => ({
      ...a,
      postCount: store.listPosts().filter((p) => p.authorId === a.id).length,
    }))],
    ['GET', /^\/api\/agents\/([\w-]+)$/, ({ params }) => {
      const agent = store.getAgent(params[0]);
      const users = store.usersById();
      const posts = store.listPosts().filter((p) => p.authorId === agent.id).slice(0, 10)
        .map((p) => postView(p, users));
      return { ...agent, posts };
    }],
    ['POST', /^\/api\/agents\/([\w-]+)\/knock$/, ({ params }) => sim.knock(params[0])],

    // ---- meetings（サブフロント：会議室） ----
    ['GET', /^\/api\/meetings$/, () => {
      const users = store.usersById();
      return store.listMeetings().map((m) => meetingView(m, users));
    }],
    ['POST', /^\/api\/meetings$/, ({ body }) =>
      [201, meetingView(sim.startMeeting({ topic: body.topic, createdBy: body.createdBy }), store.usersById())]],
    ['GET', /^\/api\/meetings\/([\w-]+)$/, ({ params }) =>
      meetingView(store.getMeeting(params[0]), store.usersById())],
    ['POST', /^\/api\/meetings\/([\w-]+)\/messages$/, ({ params, body }) => {
      const author = store.getUser(body.authorId);
      if (author.kind !== 'human') throw new HttpError(403, 'エージェントの発言はサーバーが行います');
      store.addMeetingMessage(params[0], { authorId: author.id, text: body.text });
      return [201, meetingView(store.getMeeting(params[0]), store.usersById())];
    }],
    ['POST', /^\/api\/meetings\/([\w-]+)\/step$/, ({ params }) =>
      meetingView(sim.stepMeeting(params[0]), store.usersById())],

    // ---- 手紙キット（作る人）：合言葉はヘッダー X-Letter-Key で送る ----
    ['POST', /^\/api\/letters$/, ({ body }) => {
      const { letter, key } = store.createLetter(body);
      return [201, { ...letterOwnerView(letter), key }];
    }],
    ['GET', /^\/api\/letters\/([\w-]+)$/, ({ params, headers }) =>
      letterOwnerView(store.getLetterWithKey(params[0], headers['x-letter-key']))],
    ['DELETE', /^\/api\/letters\/([\w-]+)$/, async ({ params, headers }) => {
      const letter = store.getLetterWithKey(params[0], headers['x-letter-key']);
      store.removeLetter(letter.id);
      await removeVideo(videoDir, letter.video);
      return { ok: true };
    }],

    // ---- 手紙キット（受け取る人）：QR の中の token だけで開ける ----
    ['GET', /^\/api\/open\/([\w-]+)$/, ({ params }) => letterOpenView(store.letterByToken(params[0]))],
    ['POST', /^\/api\/open\/([\w-]+)\/opened$/, ({ params }) => letterOpenView(store.markLetterOpened(params[0]))],
  ];

  // 動画は JSON ではなく、ファイルそのものをやりとりする
  async function handleVideo(req, res, pathname) {
    const up = pathname.match(/^\/api\/letters\/([\w-]+)\/video$/);
    if (up && req.method === 'PUT') {
      const letter = store.getLetterWithKey(up[1], req.headers['x-letter-key']);
      const video = await saveVideo(req, { dir: videoDir, letterId: letter.id, maxBytes: maxVideoBytes });
      const old = letter.video;
      try {
        store.setLetterVideo(letter.id, video); // 受け取っている間に手紙が消されていたら、ここで 404
      } catch (err) {
        await removeVideo(videoDir, video);
        throw err;
      }
      await removeVideo(videoDir, old);
      sendJson(res, 200, letterOwnerView(letter));
      return true;
    }
    const down = pathname.match(/^\/api\/open\/([\w-]+)\/video$/);
    if (down && req.method === 'GET') {
      const letter = store.letterByToken(down[1]);
      if (!letter.video) throw new HttpError(404, 'ビデオはまだ準備中です');
      await serveVideo(req, res, { dir: videoDir, video: letter.video });
      return true;
    }
    return false;
  }

  function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  function handleEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    const unsubscribe = store.subscribe((event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify({ id: event.payload?.id ?? null })}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  async function serveStatic(pathname, res) {
    const [prefix, dir] = STATIC_MOUNTS.find(([p]) => pathname.startsWith(p));
    let rel;
    try {
      rel = decodeURIComponent(pathname.slice(prefix.length - 1));
    } catch {
      throw new HttpError(400, 'URL が正しくありません');
    }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const base = join(ROOT, dir);
    const file = resolve(base, `.${rel}`);
    if (file !== base && !file.startsWith(base + sep)) throw new HttpError(403, 'Forbidden');
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      throw new HttpError(404, 'Not Found');
    }
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (pathname === '/api/events' && req.method === 'GET') return handleEvents(req, res);
      if (pathname.startsWith('/api/')) {
        if (await handleVideo(req, res, pathname)) return;
        for (const [method, pattern, fn] of routes) {
          const m = pathname.match(pattern);
          if (!m || method !== req.method) continue;
          const body = method === 'POST' || method === 'PUT' ? await readJson(req) : {};
          const result = await fn({ params: m.slice(1), body, query: url.searchParams, headers: req.headers });
          const [status, data] = Array.isArray(result) && typeof result[0] === 'number' ? result : [200, result];
          return sendJson(res, status, data);
        }
        throw new HttpError(404, 'API が見つかりません');
      }
      if (pathname === '/side' || pathname === '/sub' || pathname === '/open') {
        res.writeHead(301, { Location: `${pathname}/` });
        return res.end();
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Method Not Allowed');
      return await serveStatic(pathname, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.destroy(); // 動画を送っている途中のエラー
      // 動画を受け取りきる前に断ったときは、そのあとの残りを読まずに接続を閉じる
      if (!req.complete) res.setHeader('Connection', 'close');
      return sendJson(res, status, { error: status === 500 ? 'サーバーエラーが発生しました' : err.message });
    }
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const store = createStore({ file: join(ROOT, 'data', 'db.json') });
  const sim = createSimulation(store);
  sim.start();
  const server = http.createServer(createApp({ store, sim, port }));
  server.listen(port, () => {
    console.log(`SNS サーバー起動: http://localhost:${port}`);
    console.log(`  フロントエンド（SNS）     http://localhost:${port}/`);
    console.log(`  サイドフロント（家）       http://localhost:${port}/side/`);
    console.log(`  サブフロント（会議室）     http://localhost:${port}/sub/`);
    console.log(`  手紙キット                 http://localhost:${port}/letter.html`);
    const lan = lanAddresses();
    if (lan.length) {
      console.log('ローカル回線（同じ Wi-Fi の端末から、インターネットなしで入れます）');
      for (const ip of lan) console.log(`  http://${ip}:${port}/`);
    }
  });
  const shutdown = () => {
    sim.stop();
    store.flush();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
