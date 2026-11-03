// ともはね連結キットの見本：「ボタンを押した回数」を競う、いちばん小さなゲーム
//   TOMOHANE_URL=http://localhost:3000 TOMOHANE_GAME_ID=my-game TOMOHANE_SECRET=tg_... node example-server.js
// 外部パッケージなし（Node 20 から）。そのままコピーして、あなたのゲームに作りかえてください
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createTomohaneLink } from './tomohane-link.js';

const tomohane = createTomohaneLink({
  baseUrl: process.env.TOMOHANE_URL || 'http://localhost:3000',
  gameId: process.env.TOMOHANE_GAME_ID || 'my-game',
  secret: process.env.TOMOHANE_SECRET || '',
});
const players = new Map(); // ゲーム用の番号 → { name, ageGroup, plays, best }
const sessions = new Map(); // クッキー → ゲーム用の番号

const page = (p) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>見本のゲーム</title><body style="font-family:system-ui;max-width:520px;margin:2em auto;padding:0 16px">
<h1>見本のゲーム</h1>
${p ? `<p>${p.name.replace(/[<>&"]/g, '')} さん（遊んだ回数 ${p.plays}・いちばん ${p.best}）</p>
<form method="post" action="/play"><button style="font-size:1.4em">10回ぶん押した！</button></form>`
    : `<p><a href="${tomohane.startUrl}">ともはねでログイン</a></p>`}`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const sid = /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
  const me = players.get(sessions.get(sid));
  try {
    // ① ともはねから、通行証をもってもどってくる
    if (url.pathname === '/auth/callback') {
      const p = await tomohane.redeem(url.searchParams.get('ticket'));
      players.set(p.gameId, players.get(p.gameId) ?? { ...p, plays: 0, best: 0 });
      const token = randomBytes(24).toString('base64url');
      sessions.set(token, p.gameId);
      res.writeHead(302, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/`, Location: '/' });
      return res.end();
    }
    // ② 遊んだら、数だけ ともはね に知らせる
    if (url.pathname === '/play' && req.method === 'POST' && me) {
      me.plays += 1;
      me.best = Math.max(me.best, 10);
      tomohane.report(me.gameId, { plays: me.plays, best: me.best }).catch((e) => console.warn(e.message));
      res.writeHead(303, { Location: '/' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(me));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(e.message);
  }
}).listen(Number(process.env.PORT) || 4000, () => console.log('見本のゲーム: http://localhost:4000/'));
