// データストア：ユーザー・エージェント・投稿・会議・手紙をメモリで保持し、任意で JSON ファイルに保存する。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomInt, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SEED_AGENTS, MOODS } from './agents.js';
import { DEFAULT_TYPEFACE, TYPEFACE_KEYS } from '../shared/typefaces.js';
import { precheck } from '../shared/precheck.js';
import { MAX_VOTE_COMMENT, OFFICIAL_ACCOUNTS } from '../shared/news.js';
import { findReason, stageOf, MAX_APOLOGY } from '../shared/report.js';

export const MAX_POST_LENGTH = 280;
export const MAX_NAME_LENGTH = 20;
export const MAX_TOPIC_LENGTH = 60;
export const MAX_GOODS = 100;
export const MAX_NOTE_LENGTH = 100;
export const MAX_LETTERS_PER_USER = 50;
const MAX_DIARY = 20;
export const MAX_REC_LENGTH = 60;
export const MAX_BLOCK_REASON = 100;
export const MAX_BLOCKS = 500;
export const BLOCK_KINDS = ['mute', 'block'];
export const MAX_FAREWELL = 50;

// 手紙の合言葉。サーバーには「ハッシュ」だけを残し、合言葉そのものは作った人のブラウザだけが持つ
const randomToken = () => randomBytes(18).toString('base64url');
const hashKey = (key) => createHash('sha256').update(String(key)).digest();

// ---- ログイン ----
// パスワードは scrypt（わざと時間のかかる計算）で、元にもどせない形にしてから保存する
const scrypt = promisify(scryptCb);
export const SESSION_DAYS = 30;
const RECOVERY_CODES = 8;
const LOCK_AFTER_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;
const LOGIN_ID = /^[a-z0-9_]{3,20}$/;
const GUARDIAN_CODE_MS = 30 * 60 * 1000;
const MAX_GUARDIANS = 2;
const MAX_CHILDREN = 10;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password).normalize('NFKC'), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
async function checkPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const got = await scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(got, Buffer.from(hash, 'hex'));
}
// 回復コード（パスワードを忘れたときの予備のカギ）。読みまちがえにくい文字だけで作る
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
function newRecoveryCode() {
  // randomInt は、どの文字も同じ確率で出る（バイトを文字数で割った余りだと、少しかたよる）
  const s = Array.from({ length: 8 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const hashCode = (code) => createHash('sha256').update(String(code).trim().toLowerCase()).digest('hex');
const hashSession = (token) => createHash('sha256').update(String(token)).digest('hex');

// 生年月日から年齢の区分を出す。子ども（12歳まで）・中高生（13〜17歳）・大人（18歳から）
export function ageOf(birthdate, today = new Date()) {
  const [y, m, d] = birthdate.split('-').map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}
export function ageGroup(birthdate, today = new Date()) {
  if (!birthdate) return null;
  const age = ageOf(birthdate, today);
  return age < 13 ? 'child' : age < 18 ? 'teen' : 'adult';
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const newId = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;

function seedState(now) {
  const agents = SEED_AGENTS.map((a) => ({
    ...a,
    kind: 'agent',
    status: 'home',
    mood: MOODS[a.role][0],
    activity: 'くつろいでいる',
    diary: [{ at: now(), text: `${a.house}に引っ越してきた` }],
  }));
  const posts = [
    { authorId: 'agent-yamaneko', text: 'サーバーは起動済み。わたしたちは「家」で暮らし、「会議室」で相談している。気軽に話しかけてくれ。' },
    { authorId: 'agent-usagi', text: 'ようこそ、ともはね（ベータ版）へ！ ここは「好き」を語れるやさしい居場所だよ ♪' },
  ].map((p) => ({ id: newId('p'), replyTo: null, likes: [], createdAt: now(), ...p }));
  return { users: agents, posts, meetings: [] };
}

// 保存データを読み込んだあと、キャラの設定（名前・役割・家など）を最新にし、新しく増えたキャラを引っ越しさせる
function syncSeedAgents(state, now) {
  // 公式アカウント（ともはね新聞社）。キャラではないので、家・会議・遊び場には出ない
  for (const official of OFFICIAL_ACCOUNTS) {
    const existing = state.users.find((u) => u.id === official.id);
    if (existing) Object.assign(existing, official);
    else state.users.push({ ...official });
  }
  for (const seed of SEED_AGENTS) {
    const existing = state.users.find((u) => u.id === seed.id);
    if (existing) {
      Object.assign(existing, seed);
    } else {
      state.users.push({
        ...seed, kind: 'agent', status: 'home', mood: MOODS[seed.role][0], activity: 'くつろいでいる',
        diary: [{ at: now(), text: `${seed.house}に引っ越してきた` }],
      });
    }
  }
}

// 人間の文面に、はっきりした犯罪（闇バイトの募集・殺害予告・チケットの不正転売・詐欺）がないか
function rejectBlocked(user, text) {
  if (user.kind !== 'human') return;
  const check = precheck(text);
  if (check.level === 'block') throw new HttpError(422, `この内容は送れません（${check.reason}）`);
}

function cleanText(value, max, label) {
  if (typeof value !== 'string') throw new HttpError(400, `${label}を入力してください`);
  const text = value.trim();
  if (!text) throw new HttpError(400, `${label}を入力してください`);
  if ([...text].length > max) throw new HttpError(400, `${label}は${max}文字以内にしてください`);
  return text;
}

export function createStore({ file = null, now = () => new Date().toISOString() } = {}) {
  const state = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : seedState(now);
  syncSeedAgents(state, now);
  state.meta ??= {};
  state.letters ??= [];
  state.sessions ??= [];
  state.extGames ??= []; // インディーズ・個人のゲーム（申しこみ → 運営が見て一覧に出す）
  state.gameRecs ??= []; // ゲームのおすすめ { gameId, userId, comment, createdAt }
  state.newsVotes ??= []; // 新聞のアンケート { newsId（アンケートの id）, userId, choice, comment, createdAt }
  state.blocks ??= []; // ミュート・ブロック { userId（した人）, targetId（された人）, kind（'mute' | 'block'）, reason（キャラだけが読む）, createdAt }
  state.reports ??= []; // 通報 { id, postId, reporterId, authorId, reason, level, status, createdAt, apology }
  // カフェのテーブル。いまはフリーテーブルだけ（ジャンル・推しのテーブルはあとで足す）
  state.tables ??= [];
  if (!state.tables.some((t) => t.id === 'free')) {
    state.tables.unshift({ id: 'free', kind: 'free', name: 'フリーテーブル', emoji: '☕', note: 'なんでも話せる席', createdAt: now() });
  }
  state.farewells ??= []; // 投稿を消した人から、返信した人へのひとこと { id, toId, fromId, text, at }
  state.reportSeen ??= []; // 通報された本人が、お知らせを読んだしるし { postId, authorId, at }
  const listeners = new Set();
  const loginFails = new Map(); // ログインID → { count, until }（パスワードの総当たりを防ぐ）
  const guardianCodes = new Map(); // つなぐコードのハッシュ → { guardianId, expiresAt }（保存しない。30分で消える）
  const clockMs = () => Date.parse(now());
  let saveTimer = null;

  function save() {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(state, null, 2));
    }, 200);
  }

  function emit(type, payload) {
    save();
    for (const fn of listeners) fn({ type, payload });
  }

  const userById = (id) => state.users.find((u) => u.id === id);
  const requireUser = (id) => {
    const user = userById(id);
    if (!user) throw new HttpError(404, 'ユーザーが見つかりません');
    return user;
  };
  const requireAgent = (id) => {
    const user = userById(id);
    if (!user || user.kind !== 'agent') throw new HttpError(404, 'エージェントが見つかりません');
    return user;
  };
  const requirePost = (id) => {
    const post = state.posts.find((p) => p.id === id);
    if (!post) throw new HttpError(404, '投稿が見つかりません');
    return post;
  };
  const requireMeeting = (id) => {
    const meeting = state.meetings.find((m) => m.id === id);
    if (!meeting) throw new HttpError(404, '会議が見つかりません');
    return meeting;
  };
  const requireLetter = (id) => {
    const letter = state.letters.find((l) => l.id === id);
    if (!letter) throw new HttpError(404, '手紙が見つかりません');
    return letter;
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    flush() {
      if (!file) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(state, null, 2));
    },

    // ---- ちょっとした記録（やりくり献立の、もう話題にした献立 など） ----
    getMeta: (key) => state.meta[key],
    setMeta(key, value) {
      state.meta[key] = value;
      save();
    },

    // ---- users ----
    listUsers: () => state.users,
    usersById: () => Object.fromEntries(state.users.map((u) => [u.id, u])),
    getUser: requireUser,
    findOrCreateHuman(name) {
      const clean = cleanText(name, MAX_NAME_LENGTH, '名前');
      const existing = state.users.find((u) => u.kind === 'human' && u.name === clean);
      if (existing) return existing;
      if (state.users.some((u) => u.kind === 'agent' && u.name === clean)) {
        throw new HttpError(409, 'その名前はエージェントが使っています');
      }
      const user = { id: newId('u'), kind: 'human', name: clean, handle: clean, emoji: null, createdAt: now() };
      state.users.push(user);
      emit('user', user);
      return user;
    },

    // ---- ログイン ----
    // 登録。今いる「名前だけのユーザー」と同じ名前なら、そのユーザーを引きつぐ（β版の引っ越し）
    async register({ loginId, password, name, birthdate }) {
      const id = String(loginId ?? '').trim().toLowerCase();
      if (!LOGIN_ID.test(id)) throw new HttpError(400, 'ログインIDは、半角の英小文字・数字・_ で3〜20文字にしてください');
      if (state.users.some((u) => u.loginId === id)) throw new HttpError(409, 'そのログインIDは使われています');
      const pw = String(password ?? '');
      if ([...pw].length < 8 || [...pw].length > 64) throw new HttpError(400, 'パスワードは8〜64文字にしてください');
      if (pw.toLowerCase().includes(id)) throw new HttpError(400, 'パスワードに、ログインIDを入れないでください');
      const clean = cleanText(name, MAX_NAME_LENGTH, '表示名');
      if (state.users.some((u) => u.kind !== 'human' && u.name === clean)) throw new HttpError(409, 'その名前はエージェントか公式アカウントが使っています');
      if (typeof birthdate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || Number.isNaN(Date.parse(birthdate))) {
        throw new HttpError(400, '生年月日を入れてください');
      }
      const age = ageOf(birthdate, new Date(clockMs()));
      if (age < 0 || age > 120) throw new HttpError(400, '生年月日が正しくありません');

      let user = state.users.find((u) => u.kind === 'human' && u.name === clean);
      if (user?.passHash) throw new HttpError(409, 'その表示名は使われています');
      if (!user) {
        user = { id: newId('u'), kind: 'human', name: clean, handle: clean, emoji: null, createdAt: now() };
        state.users.push(user);
      }
      const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
      Object.assign(user, {
        loginId: id,
        passHash: await hashPassword(pw),
        recovery: codes.map(hashCode),
        birthdate,
        // いちばん最初に登録した人が運営（管理者）。β版を家で動かす人がそのまま管理者になる
        role: state.users.some((u) => u.role === 'admin') ? 'user' : 'admin',
      });
      emit('user', user);
      return { user, recoveryCodes: codes };
    },
    async login({ loginId, password }) {
      const id = String(loginId ?? '').trim().toLowerCase();
      const fail = loginFails.get(id);
      if (fail?.until > clockMs()) throw new HttpError(429, 'まちがいが続いたので、5分ほど待ってからもう一度どうぞ');
      const user = state.users.find((u) => u.loginId === id);
      const ok = user ? await checkPassword(password, user.passHash) : false;
      if (!ok) {
        const count = (fail?.count ?? 0) + 1;
        loginFails.set(id, { count, until: count >= LOCK_AFTER_FAILS ? clockMs() + LOCK_MS : 0 });
        throw new HttpError(401, 'ログインIDかパスワードがちがいます');
      }
      loginFails.delete(id);
      return user;
    },
    // 回復コードを1つ使って、新しいパスワードにする（コードは1回だけ）
    async recover({ loginId, code, newPassword }) {
      const id = String(loginId ?? '').trim().toLowerCase();
      const fail = loginFails.get(`recover:${id}`);
      if (fail?.until > clockMs()) throw new HttpError(429, 'まちがいが続いたので、5分ほど待ってからもう一度どうぞ');
      const user = state.users.find((u) => u.loginId === id);
      const h = hashCode(code);
      if (!user || !user.recovery?.includes(h)) {
        const count = (fail?.count ?? 0) + 1;
        loginFails.set(`recover:${id}`, { count, until: count >= LOCK_AFTER_FAILS ? clockMs() + LOCK_MS : 0 });
        throw new HttpError(401, 'ログインIDか回復コードがちがいます');
      }
      const pw = String(newPassword ?? '');
      if ([...pw].length < 8 || [...pw].length > 64) throw new HttpError(400, 'パスワードは8〜64文字にしてください');
      user.recovery = user.recovery.filter((x) => x !== h);
      user.passHash = await hashPassword(pw);
      this.endAllSessions(user.id); // 前のログインは全部切る
      save();
      return { user, codesLeft: user.recovery.length };
    },
    // ログインのしるし（セッション）。トークンそのものは保存せず、ハッシュだけを持つ
    startSession(userId) {
      requireUser(userId);
      const token = randomBytes(32).toString('base64url');
      const t = clockMs();
      state.sessions = state.sessions.filter((s) => s.expiresAt > t);
      state.sessions.push({ hash: hashSession(token), userId, createdAt: t, expiresAt: t + SESSION_DAYS * 86400000 });
      save();
      return token;
    },
    sessionUser(token) {
      if (!token) return null;
      const h = hashSession(token);
      const s = state.sessions.find((x) => x.hash === h && x.expiresAt > clockMs());
      return s ? userById(s.userId) || null : null;
    },
    endSession(token) {
      const h = hashSession(token);
      state.sessions = state.sessions.filter((s) => s.hash !== h);
      save();
    },
    endAllSessions(userId) {
      state.sessions = state.sessions.filter((s) => s.userId !== userId);
      save();
    },

    // ---- ゲーム一覧：おすすめ ----
    listGameRecs: () => state.gameRecs,
    // おすすめする（一言つき）。同じ人がもう一度すると、一言を書きかえる。comment が null なら取り消す
    setGameRec(userId, gameId, comment) {
      const user = requireUser(userId);
      state.gameRecs = state.gameRecs.filter((r) => !(r.userId === userId && r.gameId === gameId));
      if (comment === null) {
        emit('game', { gameId });
        return null;
      }
      const text = typeof comment === 'string' ? comment.trim() : '';
      if ([...text].length > MAX_REC_LENGTH) throw new HttpError(400, `一言は${MAX_REC_LENGTH}文字以内にしてください`);
      if (text) rejectBlocked(user, text);
      const rec = { gameId, userId, comment: text, createdAt: now() };
      state.gameRecs.push(rec);
      emit('game', { gameId });
      return rec;
    },

    // ---- 新聞のアンケート（1人1票。もう一度答えると書きかえる。choice が null なら取り消す） ----
    listNewsVotes: () => state.newsVotes,
    setNewsVote(userId, newsId, choice, comment = '') {
      const user = requireUser(userId);
      state.newsVotes = state.newsVotes.filter((v) => !(v.userId === userId && v.newsId === newsId));
      if (choice === null) {
        emit('news', { newsId });
        return null;
      }
      const text = typeof comment === 'string' ? comment.trim() : '';
      if ([...text].length > MAX_VOTE_COMMENT) throw new HttpError(400, `ひとことは${MAX_VOTE_COMMENT}文字以内にしてください`);
      if (text) rejectBlocked(user, text);
      const vote = { newsId, userId, choice, comment: text, createdAt: now() };
      state.newsVotes.push(vote);
      emit('news', { newsId });
      return vote;
    },

    // ---- ゲーム一覧：インディーズ・個人のゲーム ----
    listExtGames: () => state.extGames,
    extGame: (id) => state.extGames.find((g) => g.id === id) ?? null,
    applyExtGame(userId, game) {
      requireUser(userId);
      if (state.extGames.some((g) => g.id === game.id)) throw new HttpError(409, 'そのゲームのIDは使われています');
      if (state.extGames.filter((g) => g.ownerId === userId && g.status === 'pending').length >= 3) {
        throw new HttpError(429, '見てもらっている申しこみが3つあります。運営が見るまで待ってください');
      }
      const entry = { ...game, ownerId: userId, status: 'pending', createdAt: now() };
      state.extGames.push(entry);
      emit('game', { gameId: entry.id });
      return entry;
    },
    setExtGameStatus(id, status) {
      const g = state.extGames.find((x) => x.id === id);
      if (!g) throw new HttpError(404, 'ゲームが見つかりません');
      g.status = status;
      emit('game', { gameId: id });
      return g;
    },
    setExtGameResults(gameSlug, playerId, { plays, best }) {
      const user = state.users.find((u) => u.extGameIds?.[gameSlug] === playerId);
      if (!user) throw new HttpError(404, 'ユーザーが見つかりません');
      const n = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e9 ? v : null);
      if (n(plays) === null || (best != null && n(best) === null)) throw new HttpError(400, '記録の数が正しくありません');
      user.extGames ??= {};
      user.extGames[gameSlug] = { plays, best: best ?? null, updatedAt: now() };
      emit('user', user);
      return user.extGames[gameSlug];
    },
    setExtGameId(userId, gameSlug, playerId) {
      const user = requireUser(userId);
      user.extGameIds ??= {};
      if (user.extGameIds[gameSlug] !== playerId) {
        user.extGameIds[gameSlug] = playerId;
        save();
      }
    },

    // ---- 保護者とつなぐ（子ども） ----
    // おうちの人（大人）が「つなぐコード」を出す → 子どもが自分の画面で入れる → つながる。
    // コードは30分・1回だけ。はずせるのはおうちの人だけ（子どもが一人ではずせないように）
    issueGuardianCode(guardianId) {
      const g = requireUser(guardianId);
      if (ageGroup(g.birthdate, new Date(clockMs())) !== 'adult') throw new HttpError(403, 'つなぐコードを出せるのは、大人（18歳から）だけです');
      const kids = state.users.filter((u) => u.guardianIds?.includes(g.id));
      if (kids.length >= MAX_CHILDREN) throw new HttpError(409, `つなげる子どもは${MAX_CHILDREN}人までです`);
      for (const [h, v] of guardianCodes) if (v.guardianId === g.id || v.expiresAt <= clockMs()) guardianCodes.delete(h);
      const code = newRecoveryCode();
      const expiresAt = clockMs() + GUARDIAN_CODE_MS;
      guardianCodes.set(hashCode(code), { guardianId: g.id, expiresAt });
      return { code, expiresAt: new Date(expiresAt).toISOString() };
    },
    acceptGuardianCode(childId, code) {
      const child = requireUser(childId);
      if (ageGroup(child.birthdate, new Date(clockMs())) !== 'child') throw new HttpError(403, 'つなぐコードを入れられるのは、子ども（12歳まで）だけです');
      const failKey = `guardian:${child.id}`;
      const fail = loginFails.get(failKey);
      if (fail?.until > clockMs()) throw new HttpError(429, 'まちがいが続いたので、5分ほど待ってからもう一度どうぞ');
      const h = hashCode(code);
      const entry = guardianCodes.get(h);
      if (!entry || entry.expiresAt <= clockMs()) {
        const count = (fail?.count ?? 0) + 1;
        loginFails.set(failKey, { count, until: count >= LOCK_AFTER_FAILS ? clockMs() + LOCK_MS : 0 });
        throw new HttpError(401, 'つなぐコードがちがうか、30分すぎています');
      }
      if (entry.guardianId === child.id) throw new HttpError(400, '自分とはつなげません');
      child.guardianIds ??= [];
      if (child.guardianIds.includes(entry.guardianId)) throw new HttpError(409, 'もうつながっています');
      if (child.guardianIds.length >= MAX_GUARDIANS) throw new HttpError(409, `おうちの人は${MAX_GUARDIANS}人までです`);
      guardianCodes.delete(h);
      loginFails.delete(failKey);
      child.guardianIds.push(entry.guardianId);
      save();
      return requireUser(entry.guardianId);
    },
    unlinkChild(guardianId, childId) {
      const child = requireUser(childId);
      if (!child.guardianIds?.includes(guardianId)) throw new HttpError(404, 'つながっていません');
      child.guardianIds = child.guardianIds.filter((id) => id !== guardianId);
      save();
      return { ok: true };
    },
    childrenOf: (guardianId) => state.users.filter((u) => u.guardianIds?.includes(guardianId)),
    guardiansOf: (childId) => (userById(childId)?.guardianIds ?? []).map(userById).filter(Boolean),

    // ---- ゲームのアプリとの連結 ----
    setGameId(userId, gameId) {
      const user = requireUser(userId);
      if (user.gameId !== gameId) {
        user.gameId = gameId;
        save();
      }
    },
    setGameResults(gameId, { wins, plays }) {
      const user = state.users.find((u) => u.gameId === gameId);
      if (!user) throw new HttpError(404, 'ユーザーが見つかりません');
      const n = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : null);
      if (n(wins) === null || n(plays) === null || wins > plays) throw new HttpError(400, '勝ち数が正しくありません');
      user.game = { wins, plays, updatedAt: now() };
      emit('user', user);
      return user.game;
    },

    // ゴーストエージェント：自己ベストを更新した回数と、続けた日数だけ（ラップの記録そのものは来ない）
    // そらとも：ミッション達成の数と遊んだ回数だけ
    setSoratomoId(userId, soratomoId) {
      const user = requireUser(userId);
      if (user.soratomoId !== soratomoId) {
        user.soratomoId = soratomoId;
        save();
      }
    },
    setSoratomoResults(soratomoId, { missions, plays }) {
      const user = state.users.find((u) => u.soratomoId === soratomoId);
      if (!user) throw new HttpError(404, 'ユーザーが見つかりません');
      const n = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : null);
      if (n(missions) === null || n(plays) === null || missions > plays) throw new HttpError(400, '記録の数が正しくありません');
      user.soratomo = { missions, plays, updatedAt: now() };
      emit('user', user);
      return user.soratomo;
    },
    // ころとも：ゴールした回数と遊んだ回数だけ
    setKorotomoId(userId, korotomoId) {
      const user = requireUser(userId);
      if (user.korotomoId !== korotomoId) {
        user.korotomoId = korotomoId;
        save();
      }
    },
    setKorotomoResults(korotomoId, { goals, plays }) {
      const user = state.users.find((u) => u.korotomoId === korotomoId);
      if (!user) throw new HttpError(404, 'ユーザーが見つかりません');
      const n = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : null);
      if (n(goals) === null || n(plays) === null || goals > plays) throw new HttpError(400, '記録の数が正しくありません');
      user.korotomo = { goals, plays, updatedAt: now() };
      emit('user', user);
      return user.korotomo;
    },
    setGhostId(userId, ghostId) {
      const user = requireUser(userId);
      if (user.ghostId !== ghostId) {
        user.ghostId = ghostId;
        save();
      }
    },
    setGhostResults(ghostId, { bests, days }) {
      const user = state.users.find((u) => u.ghostId === ghostId);
      if (!user) throw new HttpError(404, 'ユーザーが見つかりません');
      const n = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : null);
      if (n(bests) === null || n(days) === null) throw new HttpError(400, '記録の数が正しくありません');
      user.ghost = { bests, days, updatedAt: now() };
      emit('user', user);
      return user.ghost;
    },

    // ---- 推しの情報（わたしの推しページ） ----
    getOshi(userId) {
      const user = requireUser(userId);
      if (user.kind !== 'human') throw new HttpError(400, '推しを登録できるのは人間のユーザーだけです');
      return user.oshi ?? { name: '', liveDate: '', liveVenue: '', birthday: '', goods: [] };
    },
    updateOshi(userId, { name = '', liveDate = '', liveVenue = '', birthday = '' }) {
      const user = requireUser(userId);
      if (user.kind !== 'human') throw new HttpError(400, '推しを登録できるのは人間のユーザーだけです');
      const optText = (v, max, label) => (v === '' || v == null ? '' : cleanText(v, max, label));
      const optDate = (v, label) => {
        if (v === '' || v == null) return '';
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
          throw new HttpError(400, `${label}の日付が正しくありません`);
        }
        return v;
      };
      const prev = user.oshi ?? { goods: [] };
      user.oshi = {
        name: optText(name, MAX_NAME_LENGTH, '推しの名前'),
        liveDate: optDate(liveDate, 'ライブ'),
        liveVenue: optText(liveVenue, 30, '会場の名前'),
        birthday: optDate(birthday, '誕生日'),
        goods: prev.goods ?? [],
      };
      emit('user', user);
      return user.oshi;
    },
    addGoods(userId, name) {
      const oshi = this.getOshi(userId);
      if (oshi.goods.length >= MAX_GOODS) throw new HttpError(400, `グッズは${MAX_GOODS}個まで記録できます`);
      const item = { id: newId('g'), name: cleanText(name, 30, 'グッズの名前'), addedAt: now() };
      const user = requireUser(userId);
      user.oshi = { ...oshi, goods: [item, ...oshi.goods] };
      emit('user', user);
      return user.oshi;
    },
    removeGoods(userId, goodsId) {
      const oshi = this.getOshi(userId);
      if (!oshi.goods.some((g) => g.id === goodsId)) throw new HttpError(404, 'グッズが見つかりません');
      const user = requireUser(userId);
      user.oshi = { ...oshi, goods: oshi.goods.filter((g) => g.id !== goodsId) };
      emit('user', user);
      return user.oshi;
    },
    // 同じ推しの仲間（自分以外の人間）の最近の投稿
    oshiFriendsPosts(userId, limit = 5) {
      const name = this.getOshi(userId).name;
      if (!name) return [];
      const friends = new Set(state.users
        .filter((u) => u.kind === 'human' && u.id !== userId && u.oshi?.name === name)
        .map((u) => u.id));
      return [...state.posts]
        .filter((p) => friends.has(p.authorId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },

    // ---- agents (サイドフロント：家) ----
    listAgents: () => state.users.filter((u) => u.kind === 'agent'),
    getAgent: requireAgent,
    updateAgent(id, patch) {
      const agent = requireAgent(id);
      for (const key of ['status', 'mood', 'activity', 'lines']) {
        if (patch[key] !== undefined) agent[key] = patch[key];
      }
      emit('agent', agent);
      return agent;
    },
    addDiary(id, text) {
      const agent = requireAgent(id);
      agent.diary.unshift({ at: now(), text });
      agent.diary.length = Math.min(agent.diary.length, MAX_DIARY);
      emit('agent', agent);
      return agent;
    },

    // ---- posts (フロントエンド：SNS) ----
    listPosts: () => [...state.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    getPost: requirePost,
    // ---- カフェのテーブル ----
    listTables: () => [...state.tables],
    getTable(id) {
      const t = state.tables.find((x) => x.id === id);
      if (!t) throw new HttpError(404, 'テーブルが見つかりません');
      return t;
    },
    // thread：新聞の号ごとのスレッドのはじまり（newsIssueId はその号）。人間の投稿では使わない
    // table：カフェのテーブル（なければ広場）。返信は、元の投稿と同じ場所になる
    createPost({ authorId, text, replyTo = null, thread = false, newsIssueId = null, table = null }) {
      const author = requireUser(authorId);
      const clean = cleanText(text, MAX_POST_LENGTH, '投稿');
      rejectBlocked(author, clean);
      const parent = replyTo ? requirePost(replyTo) : null;
      const where = parent ? parent.table ?? null : table ? this.getTable(table).id : null;
      const post = { id: newId('p'), authorId, text: clean, replyTo: replyTo || null, likes: [], createdAt: now() };
      if (where) post.table = where;
      if (thread && author.kind === 'official') Object.assign(post, { thread: true, newsIssueId });
      state.posts.push(post);
      emit('post', post);
      return post;
    },
    toggleLike(postId, userId) {
      const post = requirePost(postId);
      requireUser(userId);
      const i = post.likes.indexOf(userId);
      if (i === -1) post.likes.push(userId);
      else post.likes.splice(i, 1);
      emit('like', post);
      return post;
    },
    // スレッドのはじまり（thread の付いた投稿）。返信をたどって探す。スレッドの中でなければ null
    threadRootOf(post) {
      let p = post;
      for (let i = 0; p && i < 1000; i++) {
        if (p.thread) return p;
        p = p.replyTo ? state.posts.find((x) => x.id === p.replyTo) : null;
      }
      return null;
    },
    hasReplied: (postId, userId) => state.posts.some((p) => p.replyTo === postId && p.authorId === userId),

    // ---- ミュート・ブロック（どちらにするかは本人が選ぶ） ----
    // どちらも相手には知らせない（お知らせも、サーバーからの合図も出さない）。理由は書いても書かなくてもよく、
    // キャラだけが読むもので、どの画面・API にも返さない。
    // ミュート：した人の画面から、相手の投稿が見えなくなる
    // ブロック：ミュート＋相手がした人の投稿にした返信が、ほかの人にも見えなくなる（書いた本人には見える）
    blockUser(userId, targetId, reason = '', kind = 'block', { keepReason = false } = {}) {
      if (!BLOCK_KINDS.includes(kind)) throw new HttpError(400, 'ミュートかブロックかを選んでください');
      const user = requireUser(userId);
      const target = requireUser(targetId);
      if (user.kind !== 'human') throw new HttpError(400, 'ブロックできるのは人間のユーザーだけです');
      if (target.id === user.id) throw new HttpError(400, '自分はブロックできません');
      if (target.kind !== 'human') throw new HttpError(400, 'ブロックできるのは人間のユーザーだけです');
      const clean = typeof reason === 'string' && reason.trim() ? cleanText(reason, MAX_BLOCK_REASON, 'ブロックの理由') : '';
      const mine = state.blocks.filter((b) => b.userId === userId);
      const found = mine.find((b) => b.targetId === targetId);
      if (!found && mine.length >= MAX_BLOCKS) throw new HttpError(400, `ブロックは${MAX_BLOCKS}人までです`);
      if (found) Object.assign(found, { kind }, keepReason ? {} : { reason: clean });
      else state.blocks.push({ userId, targetId, kind, reason: clean, createdAt: now() });
      save();
      return found ?? state.blocks.at(-1);
    },
    unblockUser(userId, targetId) {
      const i = state.blocks.findIndex((b) => b.userId === userId && b.targetId === targetId);
      if (i === -1) throw new HttpError(404, 'ブロックしていません');
      state.blocks.splice(i, 1);
      save();
      return { ok: true };
    },
    blocksOf: (userId) => state.blocks.filter((b) => b.userId === userId),
    // ---- 投稿を消す ----
    // 消した投稿は残さない（あとで倉庫にも入れない）。ついていた返信は、元の投稿と一緒に見えなくする
    // （書いた人は自分の返信を見られる）。返信した人には、消した人がえらんだひとことが届く
    deletePost(postId, userId, farewell = '') {
      const post = requirePost(postId);
      const user = requireUser(userId);
      if (post.authorId !== user.id || user.kind !== 'human') throw new HttpError(403, '自分の投稿だけ消せます');
      const replies = [];
      const walk = (id) => {
        for (const p of state.posts) if (p.replyTo === id && !replies.includes(p)) { replies.push(p); walk(p.id); }
      };
      walk(post.id);
      const to = [...new Set(replies.map((p) => p.authorId))]
        .filter((id) => id !== user.id && userById(id)?.kind === 'human');
      let text = '';
      if (to.length) {
        text = cleanText(farewell, MAX_FAREWELL, '返信した人へのひとこと');
        rejectBlocked(user, text);
      }
      for (const p of replies) p.orphaned = true;
      state.posts.splice(state.posts.indexOf(post), 1);
      for (const id of to) state.farewells.push({ id: newId('f'), toId: id, fromId: user.id, text, at: now() });
      emit('post', { id: post.id });
      return { ok: true, told: to.length };
    },
    farewellsFor: (userId) => state.farewells.filter((f) => f.toId === userId),
    dismissFarewell(userId, id) {
      const i = state.farewells.findIndex((f) => f.id === id && f.toId === userId);
      if (i === -1) throw new HttpError(404, 'お知らせが見つかりません');
      state.farewells.splice(i, 1);
      save();
      return { ok: true };
    },

    // ---- 通報 ----
    // 通報した人はだれにも出さない。重いもの（hold）は運営が見るまでほかの人に見えなくする。
    // 止めるかどうかは運営（人）が決める
    reportPost(postId, reporterId, reasonId) {
      const post = requirePost(postId);
      const reporter = requireUser(reporterId);
      const author = requireUser(post.authorId);
      const reason = findReason(reasonId);
      if (!reason) throw new HttpError(400, '通報の理由をえらんでください');
      if (reporter.kind !== 'human') throw new HttpError(400, '通報できるのは人間のユーザーだけです');
      if (author.id === reporter.id) throw new HttpError(400, '自分の投稿は通報できません');
      if (author.kind !== 'human') throw new HttpError(400, 'キャラや公式の投稿は通報できません');
      if (state.reports.some((r) => r.postId === postId && r.reporterId === reporterId)) {
        throw new HttpError(409, 'この投稿はもう通報しています');
      }
      const report = {
        id: newId('r'), postId, reporterId, authorId: author.id, reason: reason.id, level: reason.level,
        status: 'open', createdAt: now(), apology: null,
      };
      state.reports.push(report);
      if (reason.hold && !post.hidden) post.hidden = 'report';
      save();
      return report;
    },
    reportsOn: (postId) => state.reports.filter((r) => r.postId === postId),
    listReports: () => [...state.reports],
    // 本人（通報された人）に見せる、投稿ごとのお知らせ
    reportNoticesFor(authorId) {
      const byPost = new Map();
      for (const r of state.reports) {
        if (r.authorId !== authorId) continue;
        if (!byPost.has(r.postId)) byPost.set(r.postId, []);
        byPost.get(r.postId).push(r);
      }
      const out = [];
      for (const [postId, reports] of byPost) {
        const post = state.posts.find((p) => p.id === postId);
        if (!post) continue;
        const seen = state.reportSeen.find((s) => s.postId === postId && s.authorId === authorId);
        const latest = reports.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), '');
        const stoppedAt = post.hidden === 'admin' ? post.hiddenAt ?? latest : null;
        const changedAt = stoppedAt && stoppedAt > latest ? stoppedAt : latest;
        if (seen && seen.at >= changedAt) continue;
        out.push({
          post,
          stage: post.hidden === 'admin' ? 'stopped' : stageOf(reports.map((r) => r.reason), new Set(reports.map((r) => r.reporterId)).size),
          apologized: reports.some((r) => r.apology),
          changedAt,
        });
      }
      return out.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
    },
    markReportNoticeSeen(authorId, postId) {
      const s = state.reportSeen.find((x) => x.postId === postId && x.authorId === authorId);
      if (s) s.at = now();
      else state.reportSeen.push({ postId, authorId, at: now() });
      save();
      return { ok: true };
    },
    // 本人があやまる：その投稿を通報した人みんなに届く（だれが通報したかは本人に知らせない）
    apologize(authorId, postId, text) {
      const post = requirePost(postId);
      if (post.authorId !== authorId) throw new HttpError(403, '自分の投稿だけです');
      const reports = state.reports.filter((r) => r.postId === postId);
      if (!reports.length) throw new HttpError(404, 'この投稿への通報はありません');
      if (reports.some((r) => r.apology)) throw new HttpError(409, 'あやまりはもう届けています');
      const clean = cleanText(text, MAX_APOLOGY, 'あやまりのことば');
      rejectBlocked(requireUser(authorId), clean);
      for (const r of reports) r.apology = { text: clean, at: now(), state: 'waiting' };
      save();
      return { ok: true };
    },
    // 通報した人へ：「あやまりが届いています。読みますか？」（読むか読まないかは本人が決める）
    apologiesFor: (reporterId) => state.reports.filter((r) => r.reporterId === reporterId && r.apology?.state === 'waiting'),
    answerApology(reporterId, reportId, read) {
      const r = state.reports.find((x) => x.id === reportId && x.reporterId === reporterId);
      if (!r?.apology) throw new HttpError(404, 'あやまりが見つかりません');
      r.apology.state = read ? 'read' : 'declined';
      save();
      return read ? { text: r.apology.text } : { ok: true };
    },
    // 運営が決める：hide（止める）/ show（出す）
    decideReport(postId, action) {
      const post = requirePost(postId);
      if (!['hide', 'show'].includes(action)) throw new HttpError(400, '止めるか、出すかをえらんでください');
      post.hidden = action === 'hide' ? 'admin' : null;
      post.hiddenAt = action === 'hide' ? now() : null;
      for (const r of state.reports) if (r.postId === postId) r.status = action === 'hide' ? 'stopped' : 'kept';
      emit('post', post);
      return post;
    },

    // viewerId の人に見せてよい投稿か（ログインしていなければ viewerId は null）
    canSee(post, viewerId) {
      // 通報で止まっている投稿は、書いた本人にだけ見える。通報した人には、その投稿はもう出さない
      if (post.hidden && post.authorId !== viewerId) return false;
      // 元の投稿が消された返信は、書いた本人にだけ見える
      if (post.orphaned && post.authorId !== viewerId) return false;
      if (viewerId && state.reports.some((r) => r.postId === post.id && r.reporterId === viewerId)) return false;
      if (viewerId && post.authorId !== viewerId) {
        if (state.blocks.some((b) => b.userId === viewerId && b.targetId === post.authorId)) return false;
      }
      const parent = post.replyTo && state.posts.find((p) => p.id === post.replyTo);
      if (parent && post.authorId !== viewerId
        && state.blocks.some((b) => b.userId === parent.authorId && b.targetId === post.authorId && (b.kind ?? 'block') === 'block')) return false;
      return true;
    },

    // ---- meetings (サブフロント：会議室) ----
    listMeetings: () => [...state.meetings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    getMeeting: requireMeeting,
    openMeeting: () => state.meetings.find((m) => m.status === 'open') || null,
    createMeeting({ topic, createdBy, participantIds }) {
      const clean = cleanText(topic, MAX_TOPIC_LENGTH, '議題');
      if (createdBy) requireUser(createdBy);
      const meeting = {
        id: newId('m'), topic: clean, createdBy: createdBy || null, participantIds,
        status: 'open', turn: 0, pendingHumanId: null, speakerId: null,
        messages: [], summary: null, summaryPostId: null, createdAt: now(), closedAt: null,
      };
      state.meetings.push(meeting);
      emit('meeting', meeting);
      return meeting;
    },
    addMeetingMessage(meetingId, { authorId, text }) {
      const meeting = requireMeeting(meetingId);
      if (meeting.status !== 'open') throw new HttpError(409, 'この会議はすでに終了しています');
      const author = requireUser(authorId);
      const msg = { id: newId('mm'), authorId, text: cleanText(text, MAX_POST_LENGTH, '発言'), createdAt: now() };
      rejectBlocked(author, msg.text);
      meeting.messages.push(msg);
      meeting.speakerId = authorId;
      if (author.kind === 'human') meeting.pendingHumanId = msg.id;
      emit('meeting', meeting);
      return msg;
    },
    updateMeeting(meetingId, patch) {
      const meeting = requireMeeting(meetingId);
      Object.assign(meeting, patch);
      emit('meeting', meeting);
      return meeting;
    },

    // ---- 手紙キット ----
    // ともはねのほかのユーザーには送らない。届け方は「紙の手紙＋QR」だけで、
    // QR の中の token を知っている人だけが受け取りページを開ける。
    // 一覧・ビデオの入れ替え・削除は、作ったときに一度だけ返す合言葉（key）がないとできない
    createLetter({ authorId, to, from, note = '', typeface = DEFAULT_TYPEFACE }) {
      const author = requireUser(authorId);
      if (author.kind !== 'human') throw new HttpError(400, '手紙を書けるのは人間のユーザーだけです');
      if (state.letters.filter((l) => l.authorId === authorId).length >= MAX_LETTERS_PER_USER) {
        throw new HttpError(400, `手紙は${MAX_LETTERS_PER_USER}通までです。古い手紙を消してからつくってください`);
      }
      if (!TYPEFACE_KEYS.includes(typeface)) throw new HttpError(400, '字体が正しくありません');
      const key = randomToken();
      const letter = {
        id: newId('l'),
        authorId,
        token: randomToken(),
        keyHash: hashKey(key).toString('hex'),
        to: cleanText(to, MAX_NAME_LENGTH, '宛名'),
        from: cleanText(from, MAX_NAME_LENGTH, '差出人の名前'),
        note: note === '' || note == null ? '' : cleanText(note, MAX_NOTE_LENGTH, 'ひとこと'),
        paper: 'cream', // β版の便箋は1種類
        typeface, // 便箋の画像と受け取りページの字体
        video: null,
        createdAt: now(),
        openedAt: null,
      };
      state.letters.push(letter);
      emit('letter', letter);
      return { letter, key };
    },
    getLetterWithKey(id, key) {
      const letter = requireLetter(id);
      const ok = typeof key === 'string' && key.length > 0
        && timingSafeEqual(hashKey(key), Buffer.from(letter.keyHash, 'hex'));
      if (!ok) throw new HttpError(403, '手紙の合言葉がちがいます');
      return letter;
    },
    letterByToken(token) {
      const letter = state.letters.find((l) => l.token === token);
      if (!letter) throw new HttpError(404, 'この手紙は見つかりません');
      return letter;
    },
    setLetterVideo(id, video) {
      const letter = requireLetter(id);
      letter.video = video;
      emit('letter', letter);
      return letter;
    },
    // 受け取った人が封筒をひらいた（はじめての1回だけ記録する）
    markLetterOpened(token) {
      const letter = this.letterByToken(token);
      if (!letter.openedAt) {
        letter.openedAt = now();
        emit('letter', letter);
      }
      return letter;
    },
    removeLetter(id) {
      const letter = requireLetter(id);
      state.letters.splice(state.letters.indexOf(letter), 1);
      emit('letter', letter);
      return letter;
    },
  };
}
