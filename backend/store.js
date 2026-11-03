// データストア：ユーザー・エージェント・投稿・会議・手紙をメモリで保持し、任意で JSON ファイルに保存する。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SEED_AGENTS, MOODS } from './agents.js';
import { DEFAULT_TYPEFACE, TYPEFACE_KEYS } from '../shared/typefaces.js';
import { precheck } from '../shared/precheck.js';

export const MAX_POST_LENGTH = 280;
export const MAX_NAME_LENGTH = 20;
export const MAX_TOPIC_LENGTH = 60;
export const MAX_GOODS = 100;
export const MAX_NOTE_LENGTH = 100;
export const MAX_LETTERS_PER_USER = 50;
const MAX_DIARY = 20;

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
  const bytes = randomBytes(8);
  const s = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
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
  const listeners = new Set();
  const loginFails = new Map(); // ログインID → { count, until }（パスワードの総当たりを防ぐ）
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
      if (state.users.some((u) => u.kind === 'agent' && u.name === clean)) throw new HttpError(409, 'その名前はエージェントが使っています');
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
    createPost({ authorId, text, replyTo = null }) {
      const author = requireUser(authorId);
      const clean = cleanText(text, MAX_POST_LENGTH, '投稿');
      rejectBlocked(author, clean);
      if (replyTo) requirePost(replyTo);
      const post = { id: newId('p'), authorId, text: clean, replyTo: replyTo || null, likes: [], createdAt: now() };
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
    hasReplied: (postId, userId) => state.posts.some((p) => p.replyTo === postId && p.authorId === userId),

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
