// バックエンド：REST API + SSE + 3つのフロント（フロントエンド / サイドフロント / サブフロント）の配信。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, HttpError, ageGroup, SESSION_DAYS } from './store.js';
import { createSimulation } from './simulation.js';
import { publishedIssues, findPoll, pollTalk } from '../shared/news.js';
import { lanAddresses } from './net.js';
import { REPORT_REASONS, STAGES, findReason, stageOf } from '../shared/report.js';
import { ARCADE_APPS, arcadeStatus } from '../shared/arcade.js';
import { LEAVE_MS, GUARDIAN_LEAVE_MS } from '../shared/leave.js';
import { reporterFor, suggestionTalk, TALK_SHOW } from '../shared/suggest.js';
import { createLibraryApi, MAX_PAGE_BYTES, removeLibraryFiles } from './library.js';
import { shelfAllows, SAMPLE_BOOKS } from '../shared/library.js';
import { MAX_QUERY, LIMITS, normalizeText, tagsOf } from '../shared/search.js';
import { MAX_VIDEO_BYTES, removeVideo, saveVideo, serveVideo } from './letters.js';
import { createKokotomoClient } from './kokotomo.js';
import { createGameLink, GHOST_URL, MISETOMO_URL, KOROTOMO_URL, SORATOMO_URL, HAATOMO_URL, TOMORU_URL, VTOMO_URL, METAVERSE_URL, UTATOMO_URL } from './gamelink.js';
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
  return {
    id, kind, name, handle, emoji, avatar: avatar ?? null, color: color ?? null, roleLabel: roleLabel ?? null,
    ...(kind === 'agent' ? { place: u.place ?? 'house' } : {}), // キャラの持ち場（家・カフェなど）。名前のリンク先を決めるのに使う
  };
}

function postView(post, usersById) {
  return {
    ...post,
    author: publicUser(usersById[post.authorId]),
    likeCount: post.likes.length,
  };
}

// 通報された本人に声をかけるキャラ。やさしい段階は、投稿ごとにシバかウサギ
function guideFor(stage, postId) {
  if (stage !== 'gentle') return STAGES[stage];
  const n = [...String(postId)].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return STAGES.gentle[n % STAGES.gentle.length];
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
    leaving: leavingView(u),
    practice: u.kind === 'human' && ageGroup(u.birthdate) === 'child' && !(u.guardianIds?.length), // 練習モード（おうちの人とつながる前の子ども）
    termsVersion: u.termsAgreed?.version ?? null, // 同意した利用規約の版（新しい版とちがえば、もう一度同意してもらう）
  };
}

// 退会の手続き。until：本人が入れなくなる（消える）日時。
// guarded：おうちの人とつながっている子ども。guardianUntil：おうちの人が取り消せる日時（そのあと消える）
function leavingView(u) {
  if (!u.leaving) return null;
  const at = Date.parse(u.leaving.at);
  return {
    requestedAt: u.leaving.requestedAt, until: new Date(at + LEAVE_MS).toISOString(), guarded: Boolean(u.leaving.guarded),
    guardianUntil: u.leaving.guarded ? new Date(at + GUARDIAN_LEAVE_MS).toISOString() : null,
  };
}

// おうちの人が見る、つながった子どものようす（広場の投稿は誰でも見えるもの。手紙・推しページ・パスワードなどは出さない）
function childView(c, posts, usersById) {
  return {
    ...publicUser(c), ageGroup: ageGroup(c.birthdate),
    game: c.game ?? null, ghost: c.ghost ?? null, korotomo: c.korotomo ?? null, soratomo: c.soratomo ?? null,
    recentPosts: posts.filter((p) => p.authorId === c.id).slice(0, 5).map((p) => postView(p, usersById)),
    leaving: leavingView(c),
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
// ともはね のゲームセンターには、広告・課金のあるゲームは置けない
function noAdsNoPurchases(body) {
  if (body.ads === true || body.purchases === true) {
    throw new HttpError(400, 'ともはね のゲームセンターには、広告や課金のあるゲームは置けません（広告・課金のない版で申しこんでください）');
  }
  return { ads: false, purchases: false };
}
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
    ...noAdsNoPurchases(body),
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
  libraryDir = join(ROOT, 'data', 'library', 'pages'), maxPageBytes = MAX_PAGE_BYTES,
  kokotomo = createKokotomoClient(),
  gameLink = createGameLink(),
  ghostLink = createGameLink({ app: 'ghost', gameUrl: GHOST_URL }),
  misetomoLink = createGameLink({ app: 'misetomo', gameUrl: MISETOMO_URL }),
  korotomoLink = createGameLink({ app: 'korotomo', gameUrl: KOROTOMO_URL }),
  soratomoLink = createGameLink({ app: 'soratomo', gameUrl: SORATOMO_URL }),
  haatomoLink = createGameLink({ app: 'haatomo', gameUrl: HAATOMO_URL }),
  tomoruLink = createGameLink({ app: 'tomoru', gameUrl: TOMORU_URL }),
  vtomoLink = createGameLink({ app: 'vtomo', gameUrl: VTOMO_URL }),
  metaverseLink = createGameLink({ app: 'metaverse', gameUrl: METAVERSE_URL }),
  utatomoLink = createGameLink({ app: 'utatomo', gameUrl: UTATOMO_URL }),
  clock = () => new Date(), // ゲームセンターの営業時間に使う（テストでは時刻を決められる）
}) {
  // ゲームセンターが閉まっていたら、ゲームセンターの画面にもどす（キツネが「閉店！」と言う）
  const handleLibrary = createLibraryApi({ store, dir: libraryDir, sendJson, maxPageBytes });
  const arcadeFor = (me) => arcadeStatus(me ? ageGroup(me.birthdate) : 'child', clock());
  function closedRedirect(res) {
    res.writeHead(302, { Location: '/games.html?closed=1', 'Cache-Control': 'no-store' });
    return res.end() || true;
  }
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
    ['PUT', /^\/api\/users\/([\w-]+)\/oshi$/, ({ params, body, me }) => {
      const oshi = store.updateOshi(self(me, params[0]), body);
      sim.openOshiTables?.(); // 同じ推しの人がそろったら、マスターのタヌキがカフェにテーブルを開く
      return oshi;
    }],
    ['POST', /^\/api\/users\/([\w-]+)\/oshi\/goods$/, ({ params, body, me }) => [201, store.addGoods(self(me, params[0]), body.name)]],
    ['DELETE', /^\/api\/users\/([\w-]+)\/oshi\/goods\/([\w-]+)$/, ({ params, me }) => store.removeGoods(self(me, params[0]), params[1])],
    ['GET', /^\/api\/users\/([\w-]+)\/oshi\/friends$/, ({ params, me }) => {
      const blocked = new Set(store.blocksOf(self(me, params[0])).map((b) => b.targetId));
      const users = store.usersById();
      return store.oshiFriendsPosts(me.id, 5 + blocked.size).filter((p) => !blocked.has(p.authorId) && store.canSee(p, me.id))
        .slice(0, 5).map((p) => postView(p, users));
    }],

    // ---- 保護者とつなぐ（子ども） ----
    ['GET', /^\/api\/guardian$/, ({ me }) => {
      const u = needLogin(me);
      const users = store.usersById();
      return {
        guardians: store.guardiansOf(u.id).map(publicUser),
        children: store.childrenOf(u.id).map((c) => childView(c, store.listPosts(), users)),
        diary: store.familyDiaryFor(u.id).map((d) => ({ id: d.id, text: d.text, at: d.at })),
      };
    }],
    ['POST', /^\/api\/guardian\/code$/, ({ me }) => [201, store.issueGuardianCode(needLogin(me).id)]],
    ['POST', /^\/api\/guardian\/join$/, ({ body, me }) => publicUser(store.acceptGuardianCode(needLogin(me).id, body.code))],
    ['DELETE', /^\/api\/guardian\/children\/([\w-]+)$/, ({ params, me }) => store.unlinkChild(needLogin(me).id, params[0])],
    // 子どもの退会を、おうちの人が取り消す（機種変更などのまちがい。14日まで）
    ['POST', /^\/api\/guardian\/children\/([\w-]+)\/leave-cancel$/, ({ params, me }) => store.guardianCancelLeave(needLogin(me).id, params[0])],

    // ---- ゲームセンターの営業時間（見る人の年齢で、閉店の時間がちがう） ----
    ['GET', /^\/api\/arcade$/, ({ me }) => arcadeFor(me)],

    // ---- ✉️ 招待状（クローズドβ）：招待コード＋人数の上限 ----
    ['GET', /^\/api\/invites\/status$/, () => store.inviteStatus()], // 登録の画面用（ログインしていなくても見られる）
    ['GET', /^\/api\/invites$/, ({ me }) => store.inviteSummary(needLogin(me).id)],
    ['POST', /^\/api\/invites$/, ({ me }) => store.issueInvite(needLogin(me).id)],
    ['DELETE', /^\/api\/invites\/([\w-]+)$/, ({ me, params }) => store.cancelInvite(needLogin(me).id, params[0])],
    ['PUT', /^\/api\/invites\/settings$/, ({ me, body }) => store.setInviteSettings(needLogin(me).id, body)],
    // 💝 応援（寄付）：振込先は大人だけ・確かめは運営だけ・領収書は本人と運営だけ
    ['GET', /^\/api\/donations$/, ({ me }) => store.donationInfo(me?.id ?? null)],
    ['POST', /^\/api\/donations$/, ({ me, body }) => store.reportDonation(needLogin(me).id, body)],
    ['DELETE', /^\/api\/donations\/([\w-]+)$/, ({ me, params }) => store.withdrawDonation(needLogin(me).id, params[0])],
    ['GET', /^\/api\/donations\/([\w-]+)\/receipt$/, ({ me, params }) => store.donationReceipt(needLogin(me).id, params[0])],
    ['GET', /^\/api\/donations\/admin$/, ({ me }) => store.donationAdmin(needLogin(me).id)],
    ['PUT', /^\/api\/donations\/settings$/, ({ me, body }) => store.setDonationSettings(needLogin(me).id, body)],
    ['POST', /^\/api\/donations\/([\w-]+)\/confirm$/, ({ me, params }) => store.confirmDonation(needLogin(me).id, params[0])],
    ['POST', /^\/api\/donations\/([\w-]+)\/cancel$/, ({ me, params }) => store.cancelDonation(needLogin(me).id, params[0])],

    // ---- 🔍 さがす：投稿・図書館の本・人・#タグ。見てよいものだけ ----
    // ・投稿は store.canSee（練習モード・止めた投稿・ブロックなど）を通ったものだけ
    // ・本は見る人の年齢の棚に合うものだけ。人は子ども（12歳まで）と退会中の人を出さない
    ['GET', /^\/api\/search$/, ({ me, query }) => {
      const raw = String(query.get('q') ?? '').trim();
      if (!raw) return { q: '', tag: null, posts: [], books: [], people: [] };
      if ([...raw].length > MAX_QUERY) throw new HttpError(400, `さがすことばは${MAX_QUERY}文字までにしてください`);
      const tagMatch = /^[#＃](.+)$/.exec(raw);
      const tag = tagMatch ? normalizeText(tagMatch[1]) : null;
      const q = normalizeText(raw);
      const viewer = me?.id ?? null;
      const users = store.usersById();
      const posts = store.listPosts()
        .filter((p) => (tag ? tagsOf(p.text).includes(tag) : normalizeText(p.text).includes(q)) && store.canSee(p, viewer))
        .slice(0, LIMITS.posts)
        .map((p) => ({ ...postView(p, users), threadId: store.threadRootOf(p)?.id ?? null }));
      if (tag) return { q: raw, tag, posts, books: [], people: [] };
      const group = me ? ageGroup(me.birthdate) : 'child';
      const hit = (...xs) => xs.some((x) => normalizeText(x).includes(q));
      const books = [
        ...store.listPublishedBooks().filter((b) => shelfAllows(b.minAge, group) && hit(b.title, b.blurb, users[b.authorId]?.name ?? ''))
          .map((b) => ({ id: b.id, title: b.title, kind: b.kind, genre: b.genre, cover: b.cover, author: users[b.authorId]?.name ?? '？', sample: false })),
        ...SAMPLE_BOOKS.filter((b) => shelfAllows(b.minAge, group) && hit(b.title, b.blurb))
          .map((b) => ({ id: b.id, title: b.title, kind: b.kind, genre: b.genre, cover: b.cover, author: b.author, sample: true })),
      ].slice(0, LIMITS.books);
      const people = Object.values(users)
        .filter((u) => u.kind === 'human' && u.id !== viewer && ageGroup(u.birthdate) !== 'child'
          && !store.isLeavingUser(u.id) && !store.isBlockedBy(viewer, u.id) && hit(u.name))
        .slice(0, LIMITS.people).map((u) => ({ id: u.id, name: u.name, bio: u.bio ?? '' }));
      return { q: raw, tag: null, posts, books, people };
    }],

    // ---- プロフィール（その人のページ）。生年月日・年齢は出さない ----
    // ・子ども（12歳まで）は、本人とおうちの人のほかには名前だけ
    // ・相手にブロックされている人・退会の手続き中の人のページは見せない
    ['GET', /^\/api\/users\/([\w-]+)\/profile$/, ({ me, params }) => {
      let u;
      try { u = store.getUser(params[0]); } catch { throw new HttpError(404, 'その人は見つかりません'); }
      if (u.kind !== 'human') throw new HttpError(404, 'その人は見つかりません');
      const self = me?.id === u.id;
      if (!self && (store.isLeavingUser(u.id) || store.isBlockedBy(me?.id, u.id))) throw new HttpError(404, 'その人は見つかりません');
      const base = { id: u.id, name: u.name, self };
      const family = self || Boolean(me && u.guardianIds?.includes(me.id));
      if (ageGroup(u.birthdate) === 'child' && !family) return { ...base, limited: true };
      const group = me ? ageGroup(me.birthdate) : 'child';
      const oshi = u.oshi?.name ? { name: u.oshi.name, genre: u.oshi.genre || null } : null;
      const posts = store.listPosts().filter((p) => p.authorId === u.id && store.canSee(p, me?.id ?? null)).slice(0, 10)
        .map((p) => ({ id: p.id, text: p.text, createdAt: p.createdAt, table: p.table ?? null, thread: store.threadRootOf(p)?.id ?? null, likeCount: p.likes.length }));
      const books = store.listPublishedBooks().filter((b) => b.authorId === u.id && shelfAllows(b.minAge, group))
        .map((b) => ({ id: b.id, title: b.title, kind: b.kind, genre: b.genre, cover: b.cover }));
      return { ...base, limited: false, bio: u.bio ?? '', oshi, posts, books };
    }],
    ['POST', /^\/api\/profile\/bio$/, ({ me, body }) => ({ bio: store.setBio(needLogin(me).id, body.bio).bio })],

    // ---- 🔔 お知らせ（ハトの郵便屋さん）：図書館・おうちの人・目安箱のこと。本人だけが見る ----
    ['GET', /^\/api\/notices$/, ({ me }) => {
      const id = needLogin(me).id;
      return { unread: store.unreadNotices(id), items: store.listNotices(id) };
    }],
    ['POST', /^\/api\/notices\/read$/, ({ me, body }) => store.markNoticesRead(needLogin(me).id, body.ids ?? null)],

    // ---- 図書館は backend/library.js（小説の本文が長いので、受け取れる大きさがちがう） ----

    // ---- ゲーム一覧（もとからある4つ＋一覧に出たインディーズ・個人のゲーム）・おすすめ ----
    ['GET', /^\/api\/games$/, ({ me }) => {
      const users = store.usersById();
      const recs = store.listGameRecs();
      return visibleGames(me).map((g) => {
        const mine = me && recs.find((r) => r.gameId === g.id && r.userId === me.id);
        const voices = recs.filter((r) => r.gameId === g.id && r.comment && !store.isLeaving(users[r.userId])).slice(-5).reverse().map((r) => ({
          name: users[r.userId]?.name ?? '？', oshi: users[r.userId]?.oshi?.name || null, comment: r.comment, at: r.createdAt,
        }));
        return {
          id: g.id, name: g.name, maker: g.maker, description: g.description, tags: g.tags, minAge: g.minAge,
          ads: g.ads, purchases: g.purchases, builtin: Boolean(g.builtin), play: g.soon ? null : g.start, soon: Boolean(g.soon),
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
      const game = visibleGames(u).find((g) => g.id === params[0]);
      if (!game) throw new HttpError(404, 'ゲームが見つかりません');
      if (game.soon) throw new HttpError(409, 'アップデート予定のゲームは、まだおすすめできません');
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

    // ---- ともはね新聞・アンケート（結果はキャラの座談会で伝える。正確な数とひとことは運営だけ） ----
    ['GET', /^\/api\/news$/, ({ me }) => {
      const votes = store.listNewsVotes();
      const admin = me?.role === 'admin';
      const threads = Object.fromEntries(store.listPosts().filter((p) => p.thread).map((p) => [p.newsIssueId, p.id]));
      return publishedIssues().map(({ plaza: _p, ...rest }) => {
        const issue = { ...rest, threadPostId: threads[rest.id] ?? null };
        if (!issue.poll) return issue;
        const mine = votes.filter((v) => v.newsId === issue.poll.id);
        const counts = Object.fromEntries(issue.poll.choices.map((c) => [c.id, mine.filter((v) => v.choice === c.id).length]));
        const my = me && mine.find((v) => v.userId === me.id);
        const choices = issue.poll.choices.map(({ talk: _t, ...c }) => c);
        return {
          ...issue,
          poll: {
            ...issue.poll, choices, talk: pollTalk(issue.poll, counts),
            myVote: my ? { choice: my.choice, comment: my.comment } : null,
            ...(admin ? { counts, total: mine.length } : {}),
          },
        };
      });
    }],
    ['PUT', /^\/api\/news\/([\w-]+)\/vote$/, ({ params, body, me }) => {
      const u = needLogin(me);
      const poll = findPoll(params[0]);
      if (!poll) throw new HttpError(404, 'アンケートが見つかりません');
      if (!poll.choices.some((c) => c.id === body.choice)) throw new HttpError(400, '答えを選んでください');
      return store.setNewsVote(u.id, poll.id, body.choice, body.comment ?? '');
    }],
    ['DELETE', /^\/api\/news\/([\w-]+)\/vote$/, ({ params, me }) => {
      store.setNewsVote(needLogin(me).id, params[0], null);
      return { ok: true };
    }],
    ['GET', /^\/api\/news\/([\w-]+)\/voices$/, ({ params, me }) => {
      needAdmin(me);
      const users = store.usersById();
      return store.listNewsVotes().filter((v) => v.newsId === params[0] && v.comment).reverse().map((v) => ({
        name: users[v.userId]?.name ?? '？', age: users[v.userId] ? ageGroup(users[v.userId].birthdate) : null,
        choice: v.choice, comment: v.comment, at: v.createdAt,
      }));
    }],

    // ---- 📮 目安箱：記者が受け取る。だれが書いたかは運営にも見せない ----
    ['POST', /^\/api\/suggestions$/, ({ body, me }) => {
      store.addSuggestion(needLogin(me).id, { topic: body.topic, text: body.text });
      return [201, { reply: reporterFor(clock()) }];
    }],
    // 新聞の座談会「目安箱から」（とりあげた声の要約と運営の答え）。書いた本人にだけ mine
    ['GET', /^\/api\/suggestions\/talk$/, ({ me }) => store.listSuggestions()
      .filter((x) => x.status === 'picked')
      .sort((a, b) => b.picked.at.localeCompare(a.picked.at))
      .slice(0, TALK_SHOW)
      .map((x, i) => ({ id: x.id, topic: x.topic, at: x.picked.at, lines: suggestionTalk({ topic: x.topic, ...x.picked }, i), mine: Boolean(me && x.userId === me.id) }))],
    ['GET', /^\/api\/suggestions$/, ({ me }) => {
      needAdmin(me);
      const users = store.usersById();
      // 「個人情報」（見せて・消して など）だけは、本人と分からないと答えられないので、名前とログインIDを出す
      return store.listSuggestions().map((x) => ({
        id: x.id, age: x.age, topic: x.topic, text: x.text, status: x.status, picked: x.picked, at: x.createdAt,
        ...(x.topic === 'privacy' ? { from: users[x.userId] ? { name: users[x.userId].name, loginId: users[x.userId].loginId } : null } : {}),
      }));
    }],
    ['POST', /^\/api\/suggestions\/([\w-]+)\/pick$/, ({ params, body, me }) => {
      needAdmin(me);
      const x = store.pickSuggestion(params[0], { summary: body.summary, answer: body.answer });
      return { id: x.id, status: x.status, picked: x.picked };
    }],
    ['POST', /^\/api\/suggestions\/([\w-]+)\/close$/, ({ params, me }) => {
      needAdmin(me);
      return { id: store.closeSuggestion(params[0]).id, status: 'done' };
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
    // threadId：新聞のスレッドの中の投稿なら、そのはじまりの投稿。はじまりの投稿には replyCount（スレッドの返信の数）
    // ブロックした人の投稿などは、その人の画面には出さない（store.canSee）
    // ?table=ID でカフェのそのテーブルだけ。つけなければ広場（カフェの投稿は入れない）
    ['GET', /^\/api\/posts$/, ({ me, query }) => {
      const users = store.usersById();
      const table = query.get('table');
      if (table) store.getTable(table);
      const posts = store.listPosts()
        .filter((p) => (table ? p.table === table : !p.table) && store.canSee(p, me?.id ?? null));
      const replyCount = {};
      const views = posts.map((p) => {
        const root = store.threadRootOf(p);
        if (root && root.id !== p.id) replyCount[root.id] = (replyCount[root.id] ?? 0) + 1;
        return { ...postView(p, users), threadId: root?.id ?? null };
      });
      return views.map((v) => (v.thread ? { ...v, replyCount: replyCount[v.id] ?? 0 } : v));
    }],
    // 新聞のスレッドをまるごと（はじまり＋返信、古い順）
    ['GET', /^\/api\/threads\/([\w-]+)$/, ({ params, me }) => {
      const root = store.getPost(params[0]);
      if (!root.thread) throw new HttpError(404, 'スレッドが見つかりません');
      const users = store.usersById();
      // 同じ時刻の投稿は、先に書かれたほうを上に（listPosts は新しい順で、同じ時刻は書いた順のまま）
      const posts = store.listPosts().map((p, i) => [p, i]).filter(([p]) => store.threadRootOf(p)?.id === root.id && store.canSee(p, me?.id ?? null))
        .sort(([a, i], [b, j]) => a.createdAt.localeCompare(b.createdAt) || i - j).map(([p]) => p);
      return { root: { ...postView(root, users), threadId: root.id, replyCount: posts.length - 1 }, posts: posts.map((p) => ({ ...postView(p, users), threadId: root.id })) };
    }],
    ['POST', /^\/api\/posts$/, ({ body, me }) => {
      const post = store.createPost({ authorId: needLogin(me).id, text: body.text, replyTo: body.replyTo, table: body.table || null });
      sim.onHumanPost(post);
      return [201, postView(post, store.usersById())];
    }],
    // ---- ミュート・ブロック（kind で本人が選ぶ）：相手には知らせない。理由はキャラだけが読むので、ここでも返さない ----
    ['GET', /^\/api\/blocks$/, ({ me }) => {
      const users = store.usersById();
      return store.blocksOf(needLogin(me).id).map((b) => ({ user: publicUser(users[b.targetId]), kind: b.kind ?? 'block', createdAt: b.createdAt, hasReason: Boolean(b.reason) }));
    }],
    ['PUT', /^\/api\/blocks\/([\w-]+)$/, ({ params, body, me }) => {
      const b = store.blockUser(needLogin(me).id, params[0], body.reason ?? '', body.kind ?? 'block', { keepReason: body.keepReason === true });
      return { user: publicUser(store.usersById()[b.targetId]), kind: b.kind ?? 'block', createdAt: b.createdAt, hasReason: Boolean(b.reason) };
    }],
    ['DELETE', /^\/api\/blocks\/([\w-]+)$/, ({ params, me }) => store.unblockUser(needLogin(me).id, params[0])],

    // ---- カフェのテーブル（決まった並び）と、それぞれの投稿の数 ----
    ['GET', /^\/api\/cafe\/tables$/, () => store.listTables().map((t) => ({
      id: t.id, kind: t.kind, name: t.name, emoji: t.emoji, note: t.note ?? '', parent: t.parent ?? null,
      postCount: store.listPosts().filter((p) => p.table === t.id && !p.hidden && !p.orphaned && !p.practiceOwner).length,
    }))],
    // ユーザーの声：ほしいジャンルのリクエスト（ペンギンが受け取る）→ 運営が見て、テーブルを足す
    ['POST', /^\/api\/cafe\/requests$/, ({ body, me }) => {
      store.requestTable(needLogin(me).id, body.text);
      return [201, { ok: true }];
    }],
    ['GET', /^\/api\/cafe\/requests$/, ({ me }) => {
      needAdmin(me);
      return store.listTableRequests().map((r) => ({ id: r.id, text: r.text, at: r.createdAt })); // だれが出したかは出さない
    }],
    ['DELETE', /^\/api\/cafe\/requests\/([\w-]+)$/, ({ params, me }) => {
      needAdmin(me);
      return store.dismissTableRequest(params[0]);
    }],
    // 運営だけ：推しのテーブルを閉じる（タヌキは開け直さない）
    ['DELETE', /^\/api\/cafe\/tables\/([\w-]+)$/, ({ params, me }) => {
      needAdmin(me);
      store.closeTable(params[0]);
      return { ok: true };
    }],
    ['POST', /^\/api\/cafe\/tables$/, ({ body, me }) => {
      needAdmin(me);
      const t = store.addGenreTable({ name: body.name, emoji: body.emoji });
      return [201, { id: t.id, kind: t.kind, name: t.name, emoji: t.emoji, note: t.note }];
    }],

    // ---- 投稿を消す（自分の投稿だけ）。返信した人がいれば、ひとこと（farewell）が要る ----
    ['POST', /^\/api\/posts\/([\w-]+)\/delete$/, ({ params, body, me }) => store.deletePost(params[0], needLogin(me).id, body.farewell ?? '')],
    ['POST', /^\/api\/farewells\/([\w-]+)\/seen$/, ({ params, me }) => store.dismissFarewell(needLogin(me).id, params[0])],

    // ---- 通報：通報した人はだれにも出さない。止める・警察に知らせる、を決めるのは運営（人） ----
    ['POST', /^\/api\/posts\/([\w-]+)\/report$/, ({ params, body, me }) => {
      const r = store.reportPost(params[0], needLogin(me).id, body.reason);
      return [201, { ok: true, level: r.level, held: Boolean(findReason(r.reason)?.hold) }];
    }],
    // 自分へのお知らせ：通報された投稿へのキャラの声（本人だけ）と、届いたあやまり（読むかは本人が決める）
    ['GET', /^\/api\/reports\/mine$/, ({ me }) => {
      const u = needLogin(me);
      return {
        notices: store.reportNoticesFor(u.id).map((n) => ({
          postId: n.post.id, text: n.post.text, stage: n.stage, guide: guideFor(n.stage, n.post.id),
          held: Boolean(n.post.hidden), apologized: n.apologized,
        })),
        farewells: store.farewellsFor(u.id).map((x) => ({
          id: x.id, from: x.fromName ?? store.usersById()[x.fromId]?.name ?? '？', text: x.text, at: x.at,
        })),
        apologies: store.apologiesFor(u.id).map((r) => ({
          id: r.id, from: publicUser(store.usersById()[r.authorId])?.name ?? '？', at: r.apology.at,
        })),
      };
    }],
    ['POST', /^\/api\/reports\/notices\/([\w-]+)\/seen$/, ({ params, me }) => store.markReportNoticeSeen(needLogin(me).id, params[0])],
    ['POST', /^\/api\/posts\/([\w-]+)\/apology$/, ({ params, body, me }) => store.apologize(needLogin(me).id, params[0], body.text)],
    ['POST', /^\/api\/reports\/([\w-]+)\/apology$/, ({ params, body, me }) => store.answerApology(needLogin(me).id, params[0], body.read === true)],
    // 運営だけ：通報の一覧（通報した人の名前は出さず、人数だけ）と、止める・出す
    ['GET', /^\/api\/reports$/, ({ me }) => {
      needAdmin(me);
      const users = store.usersById();
      const byPost = new Map();
      for (const r of store.listReports()) {
        if (!byPost.has(r.postId)) byPost.set(r.postId, []);
        byPost.get(r.postId).push(r);
      }
      return [...byPost].map(([postId, rs]) => {
        let post = null;
        try { post = store.getPost(postId); } catch { /* 消えた投稿 */ }
        const reasons = Object.fromEntries(REPORT_REASONS.map((x) => [x.id, rs.filter((r) => r.reason === x.id).length]).filter(([, n]) => n));
        return {
          postId, text: post?.text ?? '（消えた投稿）', author: users[rs[0].authorId]?.name ?? '？',
          reporters: new Set(rs.map((r) => r.reporterId)).size, reasons,
          stage: stageOf(rs.map((r) => r.reason), new Set(rs.map((r) => r.reporterId)).size),
          hidden: post?.hidden ?? null, status: rs.some((r) => r.status === 'open') ? 'open' : rs[0].status,
          latest: rs.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), ''),
        };
      }).sort((a, b) => (b.status === 'open') - (a.status === 'open') || b.latest.localeCompare(a.latest));
    }],
    ['POST', /^\/api\/reports\/([\w-]+)\/decision$/, ({ params, body, me }) => {
      needAdmin(me);
      const post = store.decideReport(params[0], body.action);
      return { postId: post.id, hidden: post.hidden ?? null };
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
    } else if (action === 'password') {
      // ログイン中にパスワードを変える（ほかの端末のログインは切れる。この端末はそのまま使える）
      login(await store.changePassword(needLogin(me).id, { current: body.current, next: body.next }));
    } else if (action === 'agree') {
      // 利用規約・プライバシーに同意する
      store.agreeTerms(needLogin(me).id, body.version);
      sendJson(res, 200, { me: meView(store.getUser(me.id)) });
    } else if (action === 'leave') {
      // 退会の申しこみ（7日たってから消える）
      await store.requestLeave(needLogin(me).id, { password: body.password, farewell: body.farewell });
      sendJson(res, 200, { me: meView(store.getUser(me.id)) });
    } else if (action === 'leave-cancel') {
      store.cancelLeave(needLogin(me).id);
      sendJson(res, 200, { me: meView(store.getUser(me.id)) });
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
      if (!arcadeFor(me).open) return closedRedirect(res);
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

  // ---- つながるアプリ（ともじゃん・ゴーストエージェント・みせとも・ころとも・そらとも・はーとも美術館・ともーるアリーナ）との連結 ----
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
    // はーとも美術館（イラストの展示）・ともーるアリーナ（イベント）：ログインだけ。運営かどうかも渡す（作品の確認・イベント作りに使う）
    haatomo: { link: haatomoLink, setId: () => {}, results: null, admin: true },
    tomoru: { link: tomoruLink, setId: () => {}, results: null, admin: true },
    // Vとも（2D のキャラ作り・🦫ビーバーの工作係）：ログインだけ。作ったキャラは Vとも の中にあって、ともはねには来ない
    vtomo: { link: vtomoLink, setId: () => {}, results: null },
    // 2Dメタバース（仮）：ログインだけ。年齢の区分で町を分けるのに使う。歩いた場所やあいさつは、ともはねに来ない
    metaverse: { link: metaverseLink, setId: () => {}, results: null },
    // うたとも（仮）（タップで曲作り）：ログインだけ。作った曲は うたとも の中にあって、ともはねには来ない（広場に知らせるのは本人が下書きから送る）
    utatomo: { link: utatomoLink, setId: () => {}, results: null },
  };
  // アプリのアドレス。このパソコン（localhost）のアドレスのとき、スマホから開いても届くように、いま開いているアドレスに合わせる
  function gameUrlFor(req, link) {
    const u = new URL(link.gameUrl);
    const host = String(req.headers.host || '').split(':')[0];
    if (['localhost', '127.0.0.1'].includes(u.hostname) && host && !['localhost', '127.0.0.1'].includes(host)) u.hostname = host;
    return u.origin;
  }
  async function handleGameLink(req, res, pathname, me) {
    const m = pathname.match(/^\/api\/link\/(game|ghost|misetomo|korotomo|soratomo|haatomo|tomoru|vtomo|metaverse|utatomo)-(start|ticket|results)(?:\/([\w-]+))?$/);
    if (!m) return false;
    const [, name, action, ticketId] = m;
    const { link, setId, results, admin } = LINKS[name];
    // アプリの「ともはねでログイン」から来る。ログインしていなければ、ログインしてからもどってくる
    if (action === 'start' && req.method === 'GET' && !ticketId) {
      if (!me) {
        res.writeHead(302, { Location: `/login.html?next=${encodeURIComponent(pathname)}` });
        return res.end() || true;
      }
      if (ARCADE_APPS.includes(name) && !arcadeFor(me).open) return closedRedirect(res);
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
      sendJson(res, 200, { gameId: appId, name: user.name, ageGroup: group, ...(admin ? { admin: user.role === 'admin' } : {}) });
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

  // 退会して7日たった人を消す（手紙のビデオのファイルも）
  async function purgeLeavers(atMs) {
    const { erased, videos, images = [] } = store.purgeLeaving(atMs);
    for (const v of videos) await removeVideo(videoDir, v);
    await removeLibraryFiles(libraryDir, images); // 図書館の漫画のページ・絵
    return erased;
  }

  async function handler(req, res) {
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
        if (await handleLibrary(req, res, pathname, me)) return;
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
  }
  handler.purgeLeavers = purgeLeavers;
  return handler;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const store = createStore({ file: join(ROOT, 'data', 'db.json') });
  const sim = createSimulation(store);
  sim.start();
  const app = createApp({ store, sim, port });
  const server = http.createServer(app);
  // 退会して7日たった人を、起動したときと1時間ごとに消す
  const purge = () => app.purgeLeavers().catch((e) => console.error('退会の片づけに失敗', e));
  purge();
  setInterval(purge, 3600000).unref();
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
