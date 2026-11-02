// バックエンド：REST API + SSE + 3つのフロント（フロントエンド / サイドフロント / サブフロント）の配信。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, HttpError } from './store.js';
import { createSimulation } from './simulation.js';
import { lanAddresses } from './net.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// URL の接頭辞 → 配信するディレクトリ（長いものから順に判定）
const STATIC_MOUNTS = [
  ['/side/', 'sidefront'],   // エージェントたちの家
  ['/sub/', 'subfront'],     // エージェントたちの会議室
  ['/shared/', 'shared'],    // 共通 CSS / JS
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

export function createApp({ store, sim, port = Number(process.env.PORT) || 3000 }) {
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
  ];

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
        for (const [method, pattern, fn] of routes) {
          const m = pathname.match(pattern);
          if (!m || method !== req.method) continue;
          const body = method === 'POST' ? await readJson(req) : {};
          const result = await fn({ params: m.slice(1), body, query: url.searchParams });
          const [status, data] = Array.isArray(result) && typeof result[0] === 'number' ? result : [200, result];
          return sendJson(res, status, data);
        }
        throw new HttpError(404, 'API が見つかりません');
      }
      if (pathname === '/side' || pathname === '/sub') {
        res.writeHead(301, { Location: `${pathname}/` });
        return res.end();
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Method Not Allowed');
      return await serveStatic(pathname, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
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
