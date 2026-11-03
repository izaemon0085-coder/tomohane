// バックエンド：REST API + SSE + 3つのフロント（フロントエンド / サイドフロント / サブフロント）の配信。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, HttpError, ageGroup, SESSION_DAYS } from './store.js';
import { createSimulation } from './simulation.js';
import { lanAddresses } from './net.js';
import { MAX_VIDEO_BYTES, removeVideo, saveVideo, serveVideo } from './letters.js';
import { createKokotomoClient } from './kokotomo.js';
import { createGameLink, GHOST_URL, MISETOMO_URL, KOROTOMO_URL, SORATOMO_URL } from './gamelink.js';
import {
  BUILTIN_GAMES, SLUG, visibleFor, recommendFor, gamesFor, hashSecret, newGameSecret, secretMatches,
} from './games.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// URL の接頭辞 → 配信するディレクトリ（長いものから順に判定）
const STATIC_MOUNTS = [
  ['/side/', 'sidefront'],   // エージェントたちの家
  ['/sub/', 'subfront'],     // エージェントたちの会議室
  ['/shared/', 'shared'],    // 共通 CSS / JS
  ['/open/', 'open'],        // 手紙の受け取りページ（QR から開く。登録なしで見られる）
  ['/kit/', 'kit'],          // ゲームを作っている人へ：ともはねとつなぐキット（ダウンロード）
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
  '.md': 'text/markdown; charset=utf-8',
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

// ログインしている本人に返す情報（パスワードのハッシュや回復コードは返さない）
function meView(u) {
  return {
    ...publicUser(u), loginId: u.loginId, role: u.role ?? 'user', ageGroup: ageGroup(u.birthdate), birthdate: u.birthdate,
    game: u.game ?? null,
    ghost: u.ghost ?? null,
    korotomo: u.korotomo ?? null,
    soratomo: u.soratomo ?? null,
  };
}

// おうちの人が見る、つながった子どものようす（広場の投稿は誰でも見えるもの。手紙・推しページ・パスワードなどは出さない）
function childView(c, posts, usersById) {
  return {
    ...publicUser(c), ageGroup: ageGroup(c.birthdate),
    game: c.game ?? null, ghost: c.ghost ?? null, korotomo: c.korotomo ?? null, soratomo: c.soratomo ?? null,
    recentPosts: posts.filter((p) => p.authorId === c.id).slice(0, 5).map((p) => postView(p, usersById)),
  };
}

// ---- ゲーム一覧 ----
const AGE_KEYS = ['child', 'teen', 'adult'];
const cleanStr = (v, max, label) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) throw new HttpError(400, `${label}を入れてください`);
  if ([...t].length > max) throw new HttpError(400, `${label}は${max}文字以内にしてください`);
  return t;
};
// インディーズ・個人のゲームの申しこみ。アドレスは http(s) だけ
function cleanGameApply(body) {
  const id = String(body.id ?? '').trim().toLowerCase();
  if (!SLUG.test(id)) throw new HttpError(400, 'ゲームのIDは、半角の英小文字・数字・- で3〜24文字にしてください');
  if (BUILTIN_GAMES.some((g) => g.id === id)) throw new HttpError(409, 'そのゲームのIDは使われています');
  let u;
  try { u = new URL(String(body.url ?? '')); } catch { throw new HttpError(400, 'ゲームのアドレスが正しくありません'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new HttpError(400, 'ゲームのアドレスは http:// か https:// で始めてください');
  const tags = (Array.isArray(body.tags) ? body.tags : String(body.tags ?? '').split(/[、,\s]+/))
    .map((t) => String(t).trim()).filter(Boolean).slice(0, 4).map((t) => [...t].slice(0, 10).join(''));
  return {
    id,
    name: cleanStr(body.name, 30, 'ゲームの名前'),
    maker: cleanStr(body.maker, 30, '作った人・会社の名前'),
    url: u.origin,
    description: cleanStr(body.description, 80, 'ゲームの説明'),
    tags,
    minAge: AGE_KEYS.includes(body.minAge) ? body.minAge : 'child',
    ads: body.ads === true,
    purchases: body.purchases === true,
  };
}

// ログインのしるしは、JavaScript からは読めないクッキーに入れる
const SESSION_COOKIE = 'tomohane_session';
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function sessionCookie(req, token, maxAge) {
  // https のとき（AWS 版など）だけ Secure を付ける。家の Wi-Fi（http）でも使えるように
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
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

// ログインしていなければ 401。本人以外のページなら 403
function needLogin(me) {
  if (!me) throw new HttpError(401, 'ログインしてください');
  return me;
}
function needAdmin(me) {
  if (needLogin(me).role !== 'admin') throw new HttpError(403, '運営（管理者）だけができます');
  return me;
}
// 申しこんだ人・運営が見るゲームの情報（合言葉のハッシュと、申しこんだ人の ID は出さない）
function extGameView(g) {
  const { secretHash: _s, ownerId: _o, ...rest } = g;
  return rest;
}
function self(me, userId) {
  if (needLogin(me).id !== userId) throw new HttpError(403, '自分のページだけ見られます');
  return userId;
}

export function createApp({
  store, sim, port = Number(process.env.PORT) || 3000,
  videoDir = join(ROOT, 'data', 'letters', 'videos'), maxVideoBytes = MAX_VIDEO_BYTES,
  kokotomo = createKokotomoClient(),
  gameLink = createGameLink(),
  ghostLink = createGameLink({ app: 'ghost', gameUrl: GHOST_URL }),
  misetomoLink = createGameLink({ app: 'misetomo', gameUrl: MISETOMO_URL }),
  korotomoLink = createGameLink({ app: 'korotomo', gameUrl: KOROTOMO_URL }),
  soratomoLink = createGameLink({ app: 'soratomo', gameUrl: SORATOMO_URL }),
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
    // 前の「名前だけで入る」は使わない（なりすましができてしまうため）
    ['POST', /^\/api\/users$/, () => { throw new HttpError(410, 'ログインしてください（/login.html）'); }],

    // ---- 推しの情報（わたしの推しページ）：本人だけが見られる・変えられる ----
    ['GET', /^\/api\/users\/([\w-]+)\/oshi$/, ({ params, me }) => store.getOshi(self(me, params[0]))],
    ['PUT', /^\/api\/users\/([\w-]+)\/oshi$/, ({ params, body, me }) => store.updateOshi(self(me, params[0]), body)],
    ['POST', /^\/api\/users\/([\w-]+)\/oshi\/goods$/, ({ params, body, me }) => [201, store.addGoods(self(me, params[0]), body.name)]],
    ['DELETE', /^\/api\/users\/([\w-]+)\/oshi\/goods\/([\w-]+)$/, ({ params, me }) => store.removeGoods(self(me, params[0]), params[1])],
    ['GET', /^\/api\/users\/([\w-]+)\/oshi\/friends$/, ({ params, me }) => {
      const users = store.usersById();
      return store.oshiFriendsPosts(self(me, params[0])).map((p) => postView(p, users));
    }],

    // ---- 保護者とつなぐ（子ども） ----
    ['GET', /^\/api\/guardian$/, ({ me }) => {
      const u = needLogin(me);
      const users = store.usersById();
      return {
        guardians: store.guardiansOf(u.id).map(publicUser),
        children: store.childrenOf(u.id).map((c) => childView(c, store.listPosts(), users)),
      };
    }],
    ['POST', /^\/api\/guardian\/code$/, ({ me }) => [201, store.issueGuardianCode(needLogin(me).id)]],
    ['POST', /^\/api\/guardian\/join$/, ({ body, me }) => publicUser(store.acceptGuardianCode(needLogin(me).id, body.code))],
    ['DELETE', /^\/api\/guardian\/children\/([\w-]+)$/, ({ params, me }) => store.unlinkChild(needLogin(me).id, params[0])],

    // ---- ゲーム一覧（もとからある4つ＋一覧に出たインディーズ・個人のゲーム）・おすすめ ----
    ['GET', /^\/api\/games$/, ({ me }) => {
      const users = store.usersById();
      const recs = store.listGameRecs();
      return visibleGames(me).map((g) => {
        const mine = me && recs.find((r) => r.gameId === g.id && r.userId === me.id);
        const voices = recs.filter((r) => r.gameId === g.id && r.comment).slice(-5).reverse().map((r) => ({
          name: users[r.userId]?.name ?? '？', oshi: users[r.userId]?.oshi?.name || null, comment: r.comment, at: r.createdAt,
        }));
        return {
          id: g.id, name: g.name, maker: g.maker, description: g.description, tags: g.tags, minAge: g.minAge,
          ads: g.ads, purchases: g.purchases, builtin: Boolean(g.builtin), play: g.start,
          recCount: recs.filter((r) => r.gameId === g.id).length, myRec: mine ? { comment: mine.comment } : null, voices,
          myRecord: me?.extGames?.[g.id] ?? null,
        };
      });
    }],
    ['GET', /^\/api\/games\/recommend$/, ({ me }) => {
      const rec = recommendFor({ games: visibleGames(me), recs: store.listGameRecs(), usersById: store.usersById(), user: me });
      return rec && { id: rec.game.id, name: rec.game.name, play: rec.game.start, reason: rec.reason, comment: rec.comment };
    }],
    ['PUT', /^\/api\/games\/([\w-]+)\/recommend$/, ({ params, body, me }) => {
      const u = needLogin(me);
      if (!visibleGames(u).some((g) => g.id === params[0])) throw new HttpError(404, 'ゲームが見つかりません');
      return store.setGameRec(u.id, params[0], body.comment ?? '');
    }],
    ['DELETE', /^\/api\/games\/([\w-]+)\/recommend$/, ({ params, me }) => {
      store.setGameRec(needLogin(me).id, params[0], null);
      return { ok: true };
    }],

    // ---- ゲームを作っている人へ：申しこみ（合言葉はこのときだけ見せる）→ 運営が見て一覧に出す ----
    ['POST', /^\/api\/games\/apply$/, ({ body, me }) => {
      const u = needLogin(me);
      if (ageGroup(u.birthdate) !== 'adult') throw new HttpError(403, 'ゲームの申しこみは、大人（18歳から）だけです');
      const secret = newGameSecret();
      const game = store.applyExtGame(u.id, { ...cleanGameApply(body), secretHash: hashSecret(secret) });
      return [201, { game: extGameView(game), secret }];
    }],
    ['GET', /^\/api\/games\/mine$/, ({ me }) => store.listExtGames().filter((g) => g.ownerId === needLogin(me).id).map(extGameView)],
    ['GET', /^\/api\/games\/review$/, ({ me }) => {
      needAdmin(me);
      const users = store.usersById();
      return store.listExtGames().map((g) => ({ ...extGameView(g), owner: users[g.ownerId]?.name ?? '？' }));
    }],
    ['POST', /^\/api\/games\/([\w-]+)\/status$/, ({ params, body, me }) => {
      needAdmin(me);
      if (!['listed', 'rejected', 'pending'].includes(body.status)) throw new HttpError(400, '状態が正しくありません');
      return extGameView(store.setExtGameStatus(params[0], body.status));
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
    ['POST', /^\/api\/posts$/, ({ body, me }) => {
      const post = store.createPost({ authorId: needLogin(me).id, text: body.text, replyTo: body.replyTo });
      sim.onHumanPost(post);
      return [201, postView(post, store.usersById())];
    }],
    ['POST', /^\/api\/posts\/([\w-]+)\/like$/, ({ params, me }) =>
      postView(store.toggleLike(params[0], needLogin(me).id), store.usersById())],

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
    ['POST', /^\/api\/meetings$/, ({ body, me }) =>
      [201, meetingView(sim.startMeeting({ topic: body.topic, createdBy: needLogin(me).id }), store.usersById())]],
    ['GET', /^\/api\/meetings\/([\w-]+)$/, ({ params }) =>
      meetingView(store.getMeeting(params[0]), store.usersById())],
    ['POST', /^\/api\/meetings\/([\w-]+)\/messages$/, ({ params, body, me }) => {
      store.addMeetingMessage(params[0], { authorId: needLogin(me).id, text: body.text });
      return [201, meetingView(store.getMeeting(params[0]), store.usersById())];
    }],
    ['POST', /^\/api\/meetings\/([\w-]+)\/step$/, ({ params }) =>
      meetingView(sim.stepMeeting(params[0]), store.usersById())],

    // ---- 手紙キット（作る人）：合言葉はヘッダー X-Letter-Key で送る ----
    ['POST', /^\/api\/letters$/, ({ body, me }) => {
      const { letter, key } = store.createLetter({ ...body, authorId: needLogin(me).id });
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

  // ---- ログイン（クッキーを書くので、ふつうのルートとは別に扱う） ----
  async function handleAuth(req, res, pathname, me) {
    if (!pathname.startsWith('/api/auth/')) return false;
    const action = pathname.slice('/api/auth/'.length);
    if (action === 'me' && req.method === 'GET') {
      sendJson(res, 200, me ? meView(me) : null);
      return true;
    }
    if (req.method !== 'POST') throw new HttpError(404, 'API が見つかりません');
    const body = await readJson(req);
    const login = (user, extra = {}) => {
      const token = store.startSession(user.id);
      res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
      sendJson(res, 200, { me: meView(user), ...extra });
    };
    if (action === 'register') {
      const { user, recoveryCodes } = await store.register(body);
      login(user, { recoveryCodes });
    } else if (action === 'login') {
      login(await store.login(body));
    } else if (action === 'recover') {
      const { user, codesLeft } = await store.recover(body);
      login(user, { codesLeft });
    } else if (action === 'logout' || action === 'logout-all') {
      const token = readCookie(req, SESSION_COOKIE);
      if (action === 'logout-all' && me) store.endAllSessions(me.id);
      else if (token) store.endSession(token);
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
      sendJson(res, 200, { ok: true });
    } else {
      throw new HttpError(404, 'API が見つかりません');
    }
    return true;
  }

  // 見る人に合わせたゲーム一覧
  const visibleGames = (me) => gamesFor(store.listExtGames(), me ? ageGroup(me.birthdate) : 'child');

  // ---- インディーズ・個人のゲームとの連結（キットを使う）----
  // /api/link/x/<ゲームのID>/start ・ /ticket/:通行証 ・ /results
  // 通行証やアプリ用の番号のしくみは、もとからのゲームと同じ。合言葉はゲームごとにちがう
  const extLinks = new Map();
  const extLinkOf = (slug) => {
    if (!extLinks.has(slug)) extLinks.set(slug, createGameLink({ app: `x-${slug}` }));
    return extLinks.get(slug);
  };
  async function handleExtLink(req, res, pathname, me) {
    const m = pathname.match(/^\/api\/link\/x\/([a-z0-9-]{3,24})\/(start|ticket|results)(?:\/([\w-]+))?$/);
    if (!m) return false;
    const [, slug, action, ticketId] = m;
    const game = store.extGame(slug);
    if (!game || game.status !== 'listed') throw new HttpError(404, 'ゲームが見つかりません（運営が見てから使えます）');
    const link = extLinkOf(slug);
    if (action === 'start' && req.method === 'GET' && !ticketId) {
      if (!me) {
        res.writeHead(302, { Location: `/login.html?next=${encodeURIComponent(pathname)}` });
        return res.end() || true;
      }
      if (!visibleFor(game, ageGroup(me.birthdate))) throw new HttpError(403, 'このゲームは、年齢の区分に合わないので遊べません');
      const ticket = link.issue(me.id);
      res.writeHead(302, { Location: `${game.url}/auth/callback?ticket=${ticket}`, 'Cache-Control': 'no-store' });
      return res.end() || true;
    }
    const isTicket = action === 'ticket' && ticketId && req.method === 'GET';
    const isResults = action === 'results' && !ticketId && req.method === 'POST';
    if (!isTicket && !isResults) return false;
    if (!secretMatches(req.headers['x-link-secret'], game.secretHash)) throw new HttpError(403, '合言葉がちがいます');
    if (isTicket) {
      const userId = link.redeem(ticketId);
      const user = userId && store.getUser(userId);
      if (!user) throw new HttpError(404, '通行証が使えません（1分すぎたか、もう使われています）');
      const group = ageGroup(user.birthdate);
      if (!group) throw new HttpError(403, '生年月日の登録が必要です');
      const playerId = link.gameIdOf(user.id);
      store.setExtGameId(user.id, slug, playerId);
      sendJson(res, 200, { gameId: playerId, name: user.name, ageGroup: group });
      return true;
    }
    const body = await readJson(req);
    sendJson(res, 200, store.setExtGameResults(slug, String(body.gameId ?? ''), body));
    return true;
  }

  // ---- つながるアプリ（ともじゃん・ゴーストエージェント・みせとも・ころとも・そらとも）との連結 ----
  // /api/link/<名前>-start ・ -ticket/:通行証 ・ -results
  const LINKS = {
    game: { link: gameLink, setId: (u, id) => store.setGameId(u, id), results: (id, body) => store.setGameResults(id, body) },
    ghost: { link: ghostLink, setId: (u, id) => store.setGhostId(u, id), results: (id, body) => store.setGhostResults(id, body) },
    // みせとも（お店のアプリ）：ログインだけ。お店の在庫やお客さんのことは、ともはねに来ない
    misetomo: { link: misetomoLink, setId: () => {}, results: null },
    // ころとも（ラジコンの小さなロボット）：ともはねのゲームとして。ゴールした回数と遊んだ回数だけ
    korotomo: { link: korotomoLink, setId: (u, id) => store.setKorotomoId(u, id), results: (id, body) => store.setKorotomoResults(id, body) },
    // そらとも（人工衛星の運用ゲーム）：ミッション達成の数と遊んだ回数だけ
    soratomo: { link: soratomoLink, setId: (u, id) => store.setSoratomoId(u, id), results: (id, body) => store.setSoratomoResults(id, body) },
  };
  // アプリのアドレス。このパソコン（localhost）のアドレスのとき、スマホから開いても届くように、いま開いているアドレスに合わせる
  function gameUrlFor(req, link) {
    const u = new URL(link.gameUrl);
    const host = String(req.headers.host || '').split(':')[0];
    if (['localhost', '127.0.0.1'].includes(u.hostname) && host && !['localhost', '127.0.0.1'].includes(host)) u.hostname = host;
    return u.origin;
  }
  async function handleGameLink(req, res, pathname, me) {
    const m = pathname.match(/^\/api\/link\/(game|ghost|misetomo|korotomo|soratomo)-(start|ticket|results)(?:\/([\w-]+))?$/);
    if (!m) return false;
    const [, name, action, ticketId] = m;
    const { link, setId, results } = LINKS[name];
    // アプリの「ともはねでログイン」から来る。ログインしていなければ、ログインしてからもどってくる
    if (action === 'start' && req.method === 'GET' && !ticketId) {
      if (!me) {
        res.writeHead(302, { Location: `/login.html?next=${encodeURIComponent(pathname)}` });
        return res.end() || true;
      }
      const ticket = link.issue(me.id);
      res.writeHead(302, { Location: `${gameUrlFor(req, link)}/auth/callback?ticket=${ticket}`, 'Cache-Control': 'no-store' });
      return res.end() || true;
    }
    // ここから下は、アプリのサーバーからだけ（合言葉で確かめる）
    const isTicket = action === 'ticket' && ticketId && req.method === 'GET';
    const isResults = action === 'results' && !ticketId && req.method === 'POST' && Boolean(results);
    if (!isTicket && !isResults) return false;
    if (!link.checkSecret(req.headers['x-link-secret'])) throw new HttpError(403, '合言葉がちがいます');
    if (isTicket) {
      const userId = link.redeem(ticketId);
      const user = userId && store.getUser(userId);
      if (!user) throw new HttpError(404, '通行証が使えません（1分すぎたか、もう使われています）');
      const group = ageGroup(user.birthdate);
      if (!group) throw new HttpError(403, '生年月日の登録が必要です');
      const appId = link.gameIdOf(user.id);
      setId(user.id, appId);
      sendJson(res, 200, { gameId: appId, name: user.name, ageGroup: group });
      return true;
    }
    const body = await readJson(req);
    sendJson(res, 200, results(String(body.gameId ?? ''), body));
    return true;
  }

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
        // よそのページからの書きこみは受けつけない（Origin が来ていれば、このサーバーのものか確かめる）
        const origin = req.headers.origin;
        if (req.method !== 'GET' && origin && origin !== 'null') {
          let host = null;
          try { host = new URL(origin).host; } catch { /* こわれた Origin */ }
          if (host !== req.headers.host) throw new HttpError(403, 'ほかのページからは操作できません');
        }
        const me = store.sessionUser(readCookie(req, SESSION_COOKIE));
        if (await handleAuth(req, res, pathname, me)) return;
        if (await handleGameLink(req, res, pathname, me)) return;
        if (await handleExtLink(req, res, pathname, me)) return;
        if (await handleVideo(req, res, pathname)) return;
        for (const [method, pattern, fn] of routes) {
          const m = pathname.match(pattern);
          if (!m || method !== req.method) continue;
          const body = method === 'POST' || method === 'PUT' ? await readJson(req) : {};
          const result = await fn({ params: m.slice(1), body, query: url.searchParams, headers: req.headers, me });
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
