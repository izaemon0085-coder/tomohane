import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { createStore } from '../store.js';
import { createSimulation } from '../simulation.js';
import { MEETING_SCRIPT } from '../agents.js';
import { qrMatrix } from '../../shared/qrcode.js';
import { precheck, isHarsh } from '../../shared/precheck.js';
import { createKokotomoClient } from '../kokotomo.js';

let server;
let app;
// ゲームセンターの営業時間のための時刻（ふだんはお昼の12時・日本時間。テストで変える）
const NOON_JST = new Date("2026-11-08T03:00:00Z");
let arcadeNow = NOON_JST;
let base;
let store;
let sim;
let videoDir;
let libraryDir;
const MAX_TEST_PAGE = 2048;
const MAX_TEST_VIDEO = 1024;

// こことも の代わり（テストでは本物を起動しない）
const kokotomoReplies = new Map();
const fakeKokotomoFetch = async (url) => {
  const name = new URL(url).searchParams.get('name');
  if (name === 'こわれた') throw new Error('つながらない');
  const body = kokotomoReplies.get(name) ?? { found: false, searchUrl: 'http://localhost:3100/venues.html#q=x' };
  return { ok: true, json: async () => body };
};

before(async () => {
  store = createStore();
  sim = createSimulation(store, {
    random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'],
  });
  videoDir = mkdtempSync(join(tmpdir(), 'letters-'));
  libraryDir = mkdtempSync(join(tmpdir(), 'library-'));
  const kokotomo = createKokotomoClient({ baseUrl: 'http://localhost:3100', fetchImpl: fakeKokotomoFetch });
  app = createApp({ store, sim, videoDir, maxVideoBytes: MAX_TEST_VIDEO, libraryDir, maxPageBytes: MAX_TEST_PAGE, kokotomo, clock: () => arcadeNow });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(videoDir, { recursive: true, force: true });
  rmSync(libraryDir, { recursive: true, force: true });
});

async function call(path, { method = 'GET', body, as, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(as ? { Cookie: as.cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), res };
}

// 登録してログインした人をつくる（同じ名前なら、前につくった人をそのまま使う）
const people = new Map();
let seq = 0;
async function signup(name, { birthdate = '1990-01-01' } = {}) {
  if (people.has(name)) return people.get(name);
  seq += 1;
  const r = await call('/api/auth/register', { method: 'POST', body: { loginId: `user${seq}`, password: `pass-word-${seq}`, name, birthdate, agreeTerms: true } });
  assert.equal(r.status, 200, `${name} の登録: ${r.data.error ?? ''}`);
  const cookie = r.res.headers.get('set-cookie').split(';')[0];
  const person = { ...r.data.me, cookie, loginId: `user${seq}`, password: `pass-word-${seq}`, recoveryCodes: r.data.recoveryCodes };
  people.set(name, person);
  return person;
}

test('3つのフロントが配信される', async () => {
  for (const [path, marker] of [['/', '町の地図'], ['/plaza.html', '広場'], ['/oshi.html', 'わたしの推し'], ['/side/', 'エージェントの家'], ['/sub/', '会議室']]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), new RegExp(marker));
  }
  assert.equal((await fetch(`${base}/shared/api.js`)).status, 200);
});

test('ディレクトリ外のファイルは配信しない', async () => {
  const res = await fetch(`${base}/side/..%2F..%2Fpackage.json`);
  assert.notEqual(res.status, 200);
});

test('ユーザー登録・投稿・いいね・返信', async () => {
  const me = await signup('テスター');
  assert.equal((await call('/api/users', { method: 'POST', body: { name: 'テスター' } })).status, 410, '名前だけでは入れない');
  assert.equal((await call('/api/posts', { method: 'POST', body: { authorId: me.id, text: 'なりすまし' } })).status, 401, 'ログインしていないと投稿できない');

  const created = await call('/api/posts', { method: 'POST', as: me, body: { text: 'おはよう！' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.author.name, 'テスター');

  const liked = await call(`/api/posts/${created.data.id}/like`, { method: 'POST', as: me });
  assert.equal(liked.data.likeCount, 1);
  const unliked = await call(`/api/posts/${created.data.id}/like`, { method: 'POST', as: me });
  assert.equal(unliked.data.likeCount, 0);

  const reply = await call('/api/posts', { method: 'POST', as: me, body: { text: '返信です', replyTo: created.data.id } });
  assert.equal(reply.data.replyTo, created.data.id);

  const { data: posts } = await call('/api/posts');
  assert.ok(posts.some((p) => p.id === created.data.id));
});

test('入力チェック', async () => {
  const me = await signup('チェック');
  assert.equal((await call('/api/posts', { method: 'POST', as: me, body: { text: '   ' } })).status, 400);
  assert.equal((await call('/api/posts', { method: 'POST', as: me, body: { text: 'あ'.repeat(281) } })).status, 400);
  assert.equal((await call('/api/auth/register', { method: 'POST', body: { loginId: 'neko1', password: 'password-123', name: 'ヤマネコ', birthdate: '2000-01-01', agreeTerms: true } })).status, 409, 'キャラの名前は使えない');
  assert.equal((await call('/api/nothing')).status, 404);
});

test('サイドフロント：エージェントの家とノック', async () => {
  const { data: agents } = await call('/api/agents');
  assert.equal(agents.length, 13);
  assert.deepEqual(agents.map((a) => a.name), ['ヤマネコ', 'ウサギ', 'フクロウ', 'シバ', 'クルマ', 'モグ', 'タヌキ', 'ペンギン', 'キツネ', 'カエル', 'カメ', 'ネズミ', 'ハト']);
  const id = agents[0].id;
  store.updateAgent(id, { status: 'sleeping' });
  const { data } = await call(`/api/agents/${id}/knock`, { method: 'POST' });
  assert.equal(data.agent.status, 'home', 'ノックで起きる');
  assert.match(data.message, /起こし|起きた/);
  const { data: detail } = await call(`/api/agents/${id}`);
  assert.ok(detail.diary.length >= 2);
  assert.ok(Array.isArray(detail.posts));
});

test('サブフロント：会議の招集→人間の発言→結論がタイムラインへ', async () => {
  const me = await signup('議長');
  const { status, data: meeting } = await call('/api/meetings', { method: 'POST', as: me, body: { topic: '新機能' } });
  assert.equal(status, 201);
  assert.equal((await call('/api/meetings', { method: 'POST', as: me, body: { topic: '別の議題' } })).status, 409, '同時に1つまで');

  const { data: agents } = await call('/api/agents');
  assert.ok(agents.filter((a) => a.place === 'house').every((a) => a.status === 'meeting'), '家のキャラ全員が会議室へ移動');
  assert.ok(!meeting.participantIds.includes('agent-mogu'), 'モグは金庫で回線の見張りを続ける');
  assert.notEqual(agents.find((a) => a.role === 'car').status, 'meeting', '車はガレージで留守番');
  assert.ok(!meeting.participantIds.includes('agent-kuruma'));

  await call(`/api/meetings/${meeting.id}/step`, { method: 'POST' });
  await call(`/api/meetings/${meeting.id}/messages`, { method: 'POST', as: me, body: { text: 'スマホ対応を優先したい' } });
  const answered = await call(`/api/meetings/${meeting.id}/step`, { method: 'POST' });
  assert.match(answered.data.messages.at(-1).text, /議長さん/, 'エージェントが人間の発言に応答');

  let current = answered.data;
  while (current.status === 'open') {
    current = (await call(`/api/meetings/${meeting.id}/step`, { method: 'POST' })).data;
  }
  assert.equal(current.turn, MEETING_SCRIPT.length);
  assert.match(current.summary, /会議まとめ/);
  assert.match(current.summary, /議長さん/);

  const { data: posts } = await call('/api/posts');
  assert.ok(posts.some((p) => p.id === current.summaryPostId), 'まとめがタイムラインに投稿された');
  const { data: after } = await call('/api/agents');
  assert.ok(after.every((a) => a.status === 'home'), '全員帰宅');
  assert.equal((await call(`/api/meetings/${meeting.id}/step`, { method: 'POST' })).status, 409);
});

test('エージェントの暮らしが進む', () => {
  const before = store.listPosts().length;
  const s = createSimulation(store, { random: () => 0, replyDelayMs: null });
  s.lifeTick(); // random=0 → 投稿する
  assert.equal(store.listPosts().length, before + 1);
});

test('はじめての投稿にはシバ、トゲのある言葉にはフクロウが返事をする', async () => {
  const me = await signup('しんじん');
  const { data: first } = await call('/api/posts', { method: 'POST', as: me, body: { text: 'よろしくお願いします' } });
  const r1 = sim.respondToHumanPost(store.getPost(first.id));
  assert.equal(r1.authorId, 'agent-shiba');
  assert.match(r1.text, /はじめまして/);

  store.updateAgent('agent-fukurou', { status: 'sleeping' });
  const { data: harsh } = await call('/api/posts', { method: 'POST', as: me, body: { text: 'あいつほんとうざい' } });
  const r2 = sim.respondToHumanPost(store.getPost(harsh.id));
  assert.equal(r2.authorId, 'agent-fukurou', '寝ていても見守り番が起きて返事をする');
  assert.match(r2.text, /トゲ/);

  const { data: lonely } = await call('/api/posts', { method: 'POST', as: me, body: { text: '今日はちょっとさみしい' } });
  assert.equal(sim.respondToHumanPost(store.getPost(lonely.id)).authorId, 'agent-shiba');
});

test('保存データに新しいキャラが自動で引っ越してくる', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'sns-'));
  const file = join(dir, 'db.json');
  const old = createStore();
  const state = { users: old.listAgents().slice(0, 2), posts: [], meetings: [] };
  writeFileSync(file, JSON.stringify(state));
  const loaded = createStore({ file });
  assert.equal(loaded.listAgents().length, 13);
  assert.deepEqual(loaded.listTables().map((t) => t.id), ['free', 'idol', 'anime', 'game', 'vtuber', 'sports', 'other'], 'カフェのテーブルも用意される');
  rmSync(dir, { recursive: true, force: true });
});

test('車のエージェントはガレージで暮らすだけで、投稿・返事はしない', () => {
  const before = store.listPosts().filter((p) => p.authorId === 'agent-kuruma').length;
  const s = createSimulation(store, { random: () => 0.999, replyDelayMs: null });
  for (let i = 0; i < 20; i++) s.lifeTick(); // random≈1 → 最後のキャラ（車）が選ばれる
  assert.equal(store.listPosts().filter((p) => p.authorId === 'agent-kuruma').length, before);
  assert.equal(store.getAgent('agent-kuruma').house, '家のガレージ');
});

test('ローカル回線：同じ Wi-Fi から入るアドレスと、オフライン用のファイル', async () => {
  const { data } = await call('/api/network');
  assert.equal(typeof data.port, 'number');
  assert.ok(Array.isArray(data.lanUrls));
  for (const u of data.lanUrls) assert.match(u, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/$/);

  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  for (const path of ['/shared/outbox.js', '/shared/network.js', '/shared/network.css']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
});

test('回線番のモグが Wi-Fi とローカル回線を切り替える', async () => {
  let internet = true;
  let lan = ['192.168.0.10'];
  const s = createSimulation(store, { replyDelayMs: null, checkInternet: async () => internet, lanAddresses: () => lan });

  assert.equal((await s.netTick()).active, 'wifi');
  assert.equal((await call('/api/health')).data.line ?? 'wifi', 'wifi');

  internet = false; // インターネットが切れた → 同じ Wi-Fi の中のローカル回線へ
  assert.equal((await s.netTick()).active, 'local');
  assert.match(store.getAgent('agent-mogu').diary[0].text, /ローカル回線に切り替えた/);

  lan = []; // Wi-Fi もない → この端末だけ
  assert.equal((await s.netTick()).active, 'offline');

  internet = true; lan = ['192.168.0.10'];
  assert.equal((await s.netTick()).active, 'wifi');
  assert.match(store.getAgent('agent-mogu').diary[0].text, /Wi-Fi に切り替えた/);

  const { data } = await call('/api/network');
  assert.equal(data.active, 'wifi');
  assert.equal(store.getAgent('agent-mogu').place, 'vault');
});

test('わたしの推しページ：推しの登録・グッズの記録・同じ推しの仲間', async () => {
  const a = await signup('推し活A');
  const b = await signup('推し活B');

  const empty = await call(`/api/users/${a.id}/oshi`, { as: a });
  assert.equal(empty.data.name, '');

  const saved = await call(`/api/users/${a.id}/oshi`, {
    as: a, method: 'PUT', body: { name: 'ほしの', liveDate: '2026-12-24', liveVenue: '〇〇ホール', birthday: '2000-07-07' },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.name, 'ほしの');
  assert.equal((await call(`/api/users/${a.id}/oshi`, { as: a, method: 'PUT', body: { liveDate: '12/24' } })).status, 400, '日付の形が違う');

  const g = await call(`/api/users/${a.id}/oshi/goods`, { as: a, method: 'POST', body: { name: 'アクスタ' } });
  assert.equal(g.status, 201);
  assert.equal(g.data.goods.length, 1);
  const removed = await call(`/api/users/${a.id}/oshi/goods/${g.data.goods[0].id}`, { as: a, method: 'DELETE' });
  assert.equal(removed.data.goods.length, 0);

  // 同じ推しの B さんの投稿が、A さんの「仲間」に出る
  await call(`/api/users/${b.id}/oshi`, { as: b, method: 'PUT', body: { name: 'ほしの' } });
  await call('/api/posts', { method: 'POST', as: b, body: { text: 'ほしの最高！' } });
  const { data: friends } = await call(`/api/users/${a.id}/oshi/friends`, { as: a });
  assert.ok(friends.some((p) => p.text === 'ほしの最高！'));

  assert.equal((await call(`/api/users/${b.id}/oshi`, { as: a })).status, 403, 'ほかの人の推しページは見られない');
  assert.equal((await call(`/api/users/${a.id}/oshi`)).status, 401);
});

test('やりくり献立と連結：新しい献立ができたら、キャラが広場で話題にする（1回だけ）', async () => {
  let menu = null;
  const s = createSimulation(store, {
    replyDelayMs: null,
    readLatestMenu: async () => menu,
    clock: () => new Date('2026-11-03T10:00:00'),
  });
  assert.equal(await s.kondateTick(), null, '献立がまだないときは何もしない');
  assert.equal(s.kondateSummary().linked, false);

  // 会議中のキャラがいると話せないので、全員を家に帰しておく
  for (const a of store.listAgents()) store.updateAgent(a.id, { status: 'home' });

  menu = {
    createdAt: '2026-11-03T09:00:00', period: '1週間分',
    days: [
      { date: '2026-11-02', breakfast: 'パン', lunch: 'うどん', dinner: 'カレー（豚こま）', cost: 600 },
      { date: '2026-11-03', breakfast: 'ごはん', lunch: 'そば', dinner: '肉じゃが（じゃがいも・豚こま）', cost: 700 },
    ],
  };
  const post = await s.kondateTick();
  assert.equal(post.authorId, 'agent-usagi');
  assert.match(post.text, /肉じゃが/, 'きょうの晩ごはん（材料のかっこは取る）');
  assert.doesNotMatch(post.text, /じゃがいも・豚こま/);
  const replies = store.listPosts().filter((p) => p.replyTo === post.id);
  assert.ok(replies.some((r) => r.authorId === 'agent-yamaneko' && /1,300円/.test(r.text)), 'ヤマネコが食費の合計を言う');

  assert.equal(await s.kondateTick(), null, '同じ献立は2回話題にしない');
  const summary = s.kondateSummary();
  assert.equal(summary.linked, true);
  assert.equal(summary.todayDinner, '肉じゃが');
});

test('やりくり献立：料理がいくつも並ぶときは、主な料理だけにする', async () => {
  const { mainDish } = await import('../kondate.js');
  assert.equal(mainDish('鶏むね肉の照り焼きとキャベツの千切り、玉ねぎと卵のスープ、ご飯（鶏むね肉・キャベツ）'), '鶏むね肉の照り焼きとキャベツの千切り など');
  assert.equal(mainDish('カレー（豚こま）'), 'カレー');
});

// ---- 手紙キット ----
async function makeLetter(name = '手紙の人', extra = {}) {
  const me = await signup(name);
  const res = await call('/api/letters', { method: 'POST', as: me, body: { to: 'おばあちゃん', from: 'ゆうた', note: '元気？', ...extra } });
  return { me, ...res };
}
const putVideo = (letter, bytes, { key = letter.key, type = 'video/mp4' } = {}) => fetch(`${base}/api/letters/${letter.id}/video`, {
  method: 'PUT', headers: { 'Content-Type': type, 'X-Letter-Key': key }, body: bytes,
});

test('手紙キット：つくる → 合言葉がないと見られない → 受け取りページには必要なことだけ出る', async () => {
  const { status, data: letter } = await makeLetter();
  assert.equal(status, 201);
  assert.ok(letter.key && letter.token, '合言葉と受け取り用の token が返る');
  assert.equal(letter.hasVideo, false);
  assert.equal(letter.keyHash, undefined, '合言葉のハッシュは返さない');

  const owner = await fetch(`${base}/api/letters/${letter.id}`, { headers: { 'X-Letter-Key': letter.key } });
  assert.equal(owner.status, 200);
  assert.equal((await fetch(`${base}/api/letters/${letter.id}`)).status, 403, '合言葉なし');
  assert.equal((await fetch(`${base}/api/letters/${letter.id}`, { headers: { 'X-Letter-Key': 'wrong-key' } })).status, 403);

  const { status: s2, data: view } = await call(`/api/open/${letter.token}`);
  assert.equal(s2, 200);
  assert.deepEqual(Object.keys(view).sort(), ['createdAt', 'from', 'hasVideo', 'note', 'paper', 'to', 'typeface']);
  assert.equal(view.typeface, 'system', '字体を選ばなければ、ふつうの字体');
  assert.equal(view.to, 'おばあちゃん');
  assert.equal((await call('/api/open/nonexistent-token-123456')).status, 404);

  const page = await fetch(`${base}/open/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /ビデオレター/);
  assert.equal((await fetch(`${base}/letter.html`)).status, 200);
});

test('手紙キット：入力チェック', async () => {
  assert.equal((await makeLetter('チェック2', { to: '  ' })).status, 400);
  assert.equal((await makeLetter('チェック2', { note: 'あ'.repeat(101) })).status, 400);
  assert.equal((await call('/api/letters', { method: 'POST', body: { to: 'a', from: 'b' } })).status, 401, 'ログインしていないと手紙は書けない');
});

test('手紙キット：ビデオを入れる → 少しずつ取り出せる（Range）→ 入れ替えると古いファイルは消える', async () => {
  const { data: letter } = await makeLetter('ビデオの人');
  const bytes = new Uint8Array(500).map((_, i) => i % 256);

  assert.equal((await putVideo(letter, bytes, { key: 'wrong-key' })).status, 403);
  assert.equal((await putVideo(letter, bytes, { type: 'text/html' })).status, 415, '動画以外は受け取らない');
  const tooBig = await putVideo(letter, new Uint8Array(MAX_TEST_VIDEO + 1));
  assert.equal(tooBig.status, 413);
  assert.equal(readdirSync(videoDir).filter((f) => f.startsWith(letter.id)).length, 0, '大きすぎた動画は残らない');

  const up = await putVideo(letter, bytes);
  assert.equal(up.status, 200);
  assert.equal((await up.json()).hasVideo, true);

  const full = await fetch(`${base}/api/open/${letter.token}/video`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(new Uint8Array(await full.arrayBuffer()), bytes);

  const part = await fetch(`${base}/api/open/${letter.token}/video`, { headers: { Range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/500');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  const tail = await fetch(`${base}/api/open/${letter.token}/video`, { headers: { Range: 'bytes=-5' } });
  assert.equal(tail.headers.get('content-range'), 'bytes 495-499/500');
  await tail.arrayBuffer();
  const bad = await fetch(`${base}/api/open/${letter.token}/video`, { headers: { Range: 'bytes=900-' } });
  assert.equal(bad.status, 416);
  await bad.arrayBuffer();

  await (await putVideo(letter, new Uint8Array(50), { type: 'video/webm' })).arrayBuffer();
  const files = readdirSync(videoDir).filter((f) => f.startsWith(letter.id));
  assert.equal(files.length, 1, '入れ替えたら古い動画は消える');
  assert.match(files[0], /\.webm$/);
});

test('手紙キット：ひらいたら1回だけ記録 → 消すと動画も受け取りページも消える', async () => {
  const { data: letter } = await makeLetter('ひらく人');
  assert.equal((await call(`/api/open/${letter.token}/video`)).status, 404, 'ビデオがまだない');
  await (await putVideo(letter, new Uint8Array(20))).arrayBuffer();

  const events = [];
  const unsubscribe = store.subscribe((e) => events.push(e.type));
  await call(`/api/open/${letter.token}/opened`, { method: 'POST' });
  const first = store.getLetterWithKey(letter.id, letter.key).openedAt;
  assert.ok(first);
  await call(`/api/open/${letter.token}/opened`, { method: 'POST' });
  assert.equal(store.getLetterWithKey(letter.id, letter.key).openedAt, first, '2回目以降は変わらない');
  assert.deepEqual(events, ['letter'], '作った人の画面へのお知らせは1回');
  unsubscribe();

  assert.equal((await call(`/api/letters/${letter.id}`, { method: 'DELETE' })).status, 403, '合言葉なしでは消せない');
  const del = await fetch(`${base}/api/letters/${letter.id}`, { method: 'DELETE', headers: { 'X-Letter-Key': letter.key } });
  assert.equal(del.status, 200);
  assert.equal((await call(`/api/open/${letter.token}`)).status, 404);
  assert.equal(readdirSync(videoDir).filter((f) => f.startsWith(letter.id)).length, 0);
});

test('手紙キット：手紙はタイムラインに出ない', async () => {
  const before = store.listPosts().length;
  await makeLetter('ひみつの人');
  assert.equal(store.listPosts().length, before);
});

test('QR コード：URL の長さに合わせて大きさが決まり、3つの角に目印がある', () => {
  const short = qrMatrix('http://192.168.0.10:3000/open/#abcdefghijklmnopqrstuvwx');
  assert.equal(short.length, 33, '型番4（33マス）に収まる');
  const finder = (m, r0, c0) => [0, 6].every((d) => m[r0 + d].slice(c0, c0 + 7).every(Boolean));
  assert.ok(finder(short, 0, 0) && finder(short, 0, short.length - 7) && finder(short, short.length - 7, 0));
  assert.equal(qrMatrix('a'.repeat(200)).length, 57, '型番10');
  assert.throws(() => qrMatrix('a'.repeat(300)), /長すぎ/);
});

test('字体：手紙に選んだ字体が受け取りページに伝わり、字体のファイルが配信される', async () => {
  const { data: letter } = await makeLetter('字体の人', { typeface: 'klee' });
  assert.equal(letter.typeface, 'klee');
  assert.equal((await call(`/api/open/${letter.token}`)).data.typeface, 'klee');
  assert.equal((await makeLetter('字体の人', { typeface: 'comic-sans' })).status, 400, '一覧にない字体は使えない');

  for (const file of ['ZenMaruGothic-Regular.woff2', 'KleeOne-Regular.woff2', 'KiwiMaru-Regular.woff2']) {
    const res = await fetch(`${base}/shared/fonts/${file}`);
    assert.equal(res.status, 200, file);
    assert.equal(res.headers.get('content-type'), 'font/woff2');
    await res.arrayBuffer();
  }
  const css = await (await fetch(`${base}/shared/fonts.css`)).text();
  assert.match(css, /Klee One/);
  assert.equal((await fetch(`${base}/shared/fonts/OFL-KleeOne.txt`)).status, 200, 'ライセンス文も一緒に置く');
});

test('送る前のチェック：キャラが警告・質問・意見・寄り添いを言う（2人まで）', () => {
  const who = (text) => precheck(text).lines.map((l) => `${l.agentId}:${l.kind}`);
  assert.deepEqual(who('あいつほんとうざい'), ['agent-fukurou:warning', 'agent-usagi:opinion']);
  assert.deepEqual(who('090-1234-5678 に電話して'), ['agent-fukurou:warning']);
  assert.deepEqual(who('新曲が出るらしいよ、拡散希望'), ['agent-yamaneko:question']);
  assert.deepEqual(who('今日のライブ最悪だった'), ['agent-usagi:opinion']);
  assert.deepEqual(who('ほんとムカつく'), ['agent-shiba:comfort']);
  assert.ok(precheck('最悪、ほんとムカつく、どうせみんな嫌い、拡散して').lines.length <= 2, 'うるさくしない');
  assert.equal(precheck('今日も推しがかわいい！').level, 'ok', '何もなければ何も言わない');
});

test('送る前のチェック：推し活の言い方はトゲあつかいしない', () => {
  for (const text of ['推しね、今日もかわいい', '推しのことばかり考えてる', '尊くて死ねる', 'かわいすぎて殺す気か', 'うちわをカスタムした', '闇バイトに気をつけてね']) {
    assert.equal(precheck(text).level, 'ok', text);
  }
  assert.ok(isHarsh('しね') && isHarsh('バカじゃないの'));
});

test('送る前のチェック：はっきりした犯罪は、画面を通さなくてもサーバーが止める', async () => {
  for (const [text, reason] of [
    ['闇バイト募集してます、DMください', '闇バイトの募集'],
    ['あいつ殺してやる', '人をおびやかす言葉'],
    ['チケット定価以上で譲ります', 'チケットの不正転売'],
    ['必ず儲かる投資、教えます', '詐欺のおそれ'],
  ]) {
    assert.equal(precheck(text).level, 'block', text);
    assert.equal(precheck(text).reason, reason);
  }
  const me = await signup('チェックの人');
  const res = await call('/api/posts', { method: 'POST', as: me, body: { text: '闇バイト募集してます、DMください' } });
  assert.equal(res.status, 422);
  assert.match(res.data.error, /闇バイト/);
  const ok = await call('/api/posts', { method: 'POST', as: me, body: { text: 'あいつほんとうざい' } });
  assert.equal(ok.status, 201, '声をかけるだけのものは、本人が選べば送れる');
});

test('こことも と連結：ライブ会場のバリアフリーメモを読む（送るのは会場の名前だけ）', async () => {
  kokotomoReplies.set('さくらホール', {
    found: true,
    venue: { id: 'v_1', name: 'さくらホール', updatedAt: '2026-11-03T10:00:00Z' },
    summary: [{ topic: 'elevator', label: 'エレベーター・スロープ', text: '東口を入って右', createdAt: '2026-11-03T10:00:00Z', count: 1 }],
    url: 'http://localhost:3100/venues.html#v_1',
  });
  const { data } = await call(`/api/kokotomo/venue?name=${encodeURIComponent('さくらホール')}`);
  assert.equal(data.linked, true);
  assert.equal(data.found, true);
  assert.equal(data.summary[0].text, '東口を入って右');
  assert.equal(data.url, 'http://localhost:3100/venues.html#v_1');

  const none = (await call(`/api/kokotomo/venue?name=${encodeURIComponent('まだない会場')}`)).data;
  assert.deepEqual([none.linked, none.found], [true, false]);

  const down = (await call(`/api/kokotomo/venue?name=${encodeURIComponent('こわれた')}`)).data;
  assert.equal(down.linked, false, 'こことも が起動していなくても、ともはねは止まらない');
  assert.match(down.url, /^http:\/\/localhost:3100\/venues\.html#q=/);

  kokotomoReplies.set('あやしい', { found: true, venue: { name: 'x' }, summary: [], url: 'javascript:alert(1)' });
  assert.match((await call(`/api/kokotomo/venue?name=${encodeURIComponent('あやしい')}`)).data.url, /^http:/, 'http 以外のリンクは使わない');

  assert.equal((await call('/api/kokotomo/venue')).status, 400);
});

// ---- ログイン ----
test('ログイン：登録 → 本人の情報（パスワードは返さない）→ ログアウト → ログイン', async () => {
  const me = await signup('ログインの人');
  const { data: self } = await call('/api/auth/me', { as: me });
  assert.equal(self.name, 'ログインの人');
  assert.equal(self.ageGroup, 'adult');
  for (const secret of ['passHash', 'recovery']) assert.equal(self[secret], undefined, `${secret} は返さない`);
  assert.equal(me.recoveryCodes.length, 8, '回復コードは8つ');

  const reg = await call('/api/auth/register', { method: 'POST', body: { loginId: 'cookie_check', password: 'long-password', name: 'クッキー', birthdate: '1990-01-01', agreeTerms: true } });
  assert.match(reg.res.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/, 'JavaScript から読めないクッキー');

  await call('/api/auth/logout', { method: 'POST', as: me });
  assert.equal((await call('/api/auth/me', { as: me })).data, null, 'ログアウトしたら、そのしるしは使えない');
  const again = await call('/api/auth/login', { method: 'POST', body: { loginId: me.loginId, password: me.password } });
  assert.equal(again.status, 200);
  assert.equal(again.data.me.id, me.id);
});

test('ログイン：入力チェック', async () => {
  const reg = (body) => call('/api/auth/register', { method: 'POST', body: { loginId: 'check_user', password: 'password-ok', name: 'チェック登録', birthdate: '1990-01-01', agreeTerms: true, ...body } });
  assert.equal((await reg({ loginId: 'あ' })).status, 400, 'ログインIDは半角英数字');
  assert.equal((await reg({ password: 'short' })).status, 400, 'パスワードは8文字から');
  assert.equal((await reg({ password: 'check_user-123' })).status, 400, 'パスワードにログインIDを入れない');
  assert.equal((await reg({ birthdate: '' })).status, 400);
  assert.equal((await reg({ birthdate: '2999-01-01' })).status, 400, '未来の生年月日');
  const me = await signup('名前かぶり');
  assert.equal((await reg({ name: '名前かぶり' })).status, 409, '表示名は使われている');
  assert.equal((await reg({ loginId: me.loginId })).status, 409, 'ログインIDは使われている');
});

test('ログイン：5回まちがえると、しばらく待たせる', async () => {
  const me = await signup('まちがえる人');
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { loginId: me.loginId, password: 'wrong-password' } })).status, 401);
  }
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { loginId: me.loginId, password: me.password } })).status, 429, '正しくても、しばらくは入れない');
});

test('ログイン：回復コードで新しいパスワードに（コードは1回だけ・前のログインは切れる）', async () => {
  const me = await signup('わすれた人');
  const [code] = me.recoveryCodes;
  const r = await call('/api/auth/recover', { method: 'POST', body: { loginId: me.loginId, code: code.toUpperCase(), newPassword: 'brand-new-pass' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.codesLeft, 7);
  assert.equal((await call('/api/auth/me', { as: me })).data, null, '前のログインは切れる');
  assert.equal((await call('/api/auth/recover', { method: 'POST', body: { loginId: me.loginId, code, newPassword: 'another-pass-1' } })).status, 401, '同じコードは2回使えない');
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { loginId: me.loginId, password: 'brand-new-pass' } })).status, 200);
});

test('ログイン：年齢の区分・最初の人は管理者・名前だけのユーザーの引っ越し', async () => {
  const kid = await signup('こども', { birthdate: `${new Date().getFullYear() - 10}-01-01` });
  const teen = await signup('ちゅうがくせい', { birthdate: `${new Date().getFullYear() - 15}-01-01` });
  assert.equal(kid.ageGroup, 'child');
  assert.equal(teen.ageGroup, 'teen');
  const admins = store.listUsers().filter((u) => u.role === 'admin');
  assert.equal(admins.length, 1, '管理者は最初に登録した1人だけ');

  const old = store.findOrCreateHuman('むかしの人');
  const moved = await signup('むかしの人');
  assert.equal(moved.id, old.id, '名前だけのユーザーを引きつぐ');
});

test('ログイン：よそのページからの書きこみは受けつけない', async () => {
  const me = await signup('よその人');
  const r = await call('/api/posts', { method: 'POST', as: me, body: { text: 'こんにちは' }, headers: { Origin: 'http://evil.example' } });
  assert.equal(r.status, 403);
  const ok = await call('/api/posts', { method: 'POST', as: me, body: { text: 'こんにちは' }, headers: { Origin: base } });
  assert.equal(ok.status, 201);
});

// ---- ゲームのアプリとの連結 ----
test('ゲーム：ともはねでログイン → 通行証（1回だけ）→ ゲームに渡すのは番号・表示名・年齢の区分だけ', async () => {
  const noLogin = await fetch(`${base}/api/link/game-start`, { redirect: 'manual' });
  assert.equal(noLogin.status, 302);
  assert.match(noLogin.headers.get('location'), /^\/login\.html\?next=/, 'ログインしていなければ、ログインの画面へ');

  const me = await signup('じゃんけんの人');
  const start = await fetch(`${base}/api/link/game-start`, { redirect: 'manual', headers: { Cookie: me.cookie } });
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.origin, 'http://localhost:3300');
  assert.equal(loc.pathname, '/auth/callback');
  const ticket = loc.searchParams.get('ticket');

  assert.equal((await call(`/api/link/game-ticket/${ticket}`, { headers: { 'X-Link-Secret': 'wrong' } })).status, 403, '合言葉がちがう');
  const ok = await call(`/api/link/game-ticket/${ticket}`, { headers: { 'X-Link-Secret': 'tomohane-dev-link-secret' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.data).sort(), ['ageGroup', 'gameId', 'name']);
  assert.notEqual(ok.data.gameId, me.id, 'ともはねの ID そのものは渡さない');
  assert.equal(ok.data.ageGroup, 'adult');
  assert.equal((await call(`/api/link/game-ticket/${ticket}`, { headers: { 'X-Link-Secret': 'tomohane-dev-link-secret' } })).status, 404, '通行証は1回だけ');

  // 勝ち数がとどく
  const res = await call('/api/link/game-results', { method: 'POST', headers: { 'X-Link-Secret': 'tomohane-dev-link-secret' }, body: { gameId: ok.data.gameId, wins: 3, plays: 5 } });
  assert.equal(res.status, 200);
  assert.deepEqual((await call('/api/auth/me', { as: me })).data.game.wins, 3);
  assert.equal((await call('/api/link/game-results', { method: 'POST', body: { gameId: ok.data.gameId, wins: 99, plays: 99 } })).status, 403, '合言葉がなければ書きかえられない');
  assert.equal((await call('/api/link/game-results', { method: 'POST', headers: { 'X-Link-Secret': 'tomohane-dev-link-secret' }, body: { gameId: ok.data.gameId, wins: 9, plays: 5 } })).status, 400);
});

test('ゴーストエージェント：ともはねでログイン（アプリごとに別の番号）→ 自己ベストの回数だけ受けとる', async () => {
  const me = await signup('ゴーストの人');
  const S = { 'X-Link-Secret': 'tomohane-dev-link-secret' };
  const ticketOf = async (name) => {
    const r = await fetch(`${base}/api/link/${name}-start`, { redirect: 'manual', headers: { Cookie: me.cookie } });
    return new URL(r.headers.get('location'));
  };
  const loc = await ticketOf('ghost');
  assert.equal(loc.origin, 'http://localhost:3500');
  const ghost = (await call(`/api/link/ghost-ticket/${loc.searchParams.get('ticket')}`, { headers: S })).data;
  const game = (await call(`/api/link/game-ticket/${(await ticketOf('game')).searchParams.get('ticket')}`, { headers: S })).data;
  assert.notEqual(ghost.gameId, game.gameId, 'ともじゃんとゴーストで番号がちがう（見比べても同じ人と分からない）');
  assert.equal(ghost.name, 'ゴーストの人');

  assert.equal((await call('/api/link/ghost-results', { method: 'POST', body: { gameId: ghost.gameId, bests: 2, days: 3 } })).status, 403, '合言葉なしはだめ');
  assert.equal((await call('/api/link/ghost-results', { method: 'POST', headers: S, body: { gameId: ghost.gameId, bests: -1, days: 3 } })).status, 400);
  assert.equal((await call('/api/link/ghost-results', { method: 'POST', headers: S, body: { gameId: ghost.gameId, bests: 2, days: 3 } })).status, 200);
  assert.deepEqual((await call('/api/auth/me', { as: me })).data.ghost.bests, 2);
  assert.equal((await call('/api/link/ghost-results', { method: 'POST', headers: S, body: { gameId: game.gameId, bests: 1, days: 1 } })).status, 404, 'ともじゃんの番号ではゴーストの記録は書けない');
});

test('みせとも：ともはねでログインだけ（別の番号）。結果の受けとり口はない', async () => {
  const me = await signup('お店の人');
  const S = { 'X-Link-Secret': 'tomohane-dev-link-secret' };
  const r = await fetch(`${base}/api/link/misetomo-start`, { redirect: 'manual', headers: { Cookie: me.cookie } });
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin, 'http://localhost:3600');
  const info = (await call(`/api/link/misetomo-ticket/${loc.searchParams.get('ticket')}`, { headers: S })).data;
  assert.match(info.gameId, /^m_/);
  assert.equal(info.name, 'お店の人');
  assert.equal((await call('/api/link/misetomo-results', { method: 'POST', headers: S, body: { gameId: info.gameId } })).status, 404);
});

test('ころとも：ともはねのゲームとして、ゴールの回数と遊んだ回数だけ受けとる', async () => {
  const me = await signup('ころともの人');
  const S = { 'X-Link-Secret': 'tomohane-dev-link-secret' };
  const r = await fetch(`${base}/api/link/korotomo-start`, { redirect: 'manual', headers: { Cookie: me.cookie } });
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin, 'http://localhost:3700');
  const info = (await call(`/api/link/korotomo-ticket/${loc.searchParams.get('ticket')}`, { headers: S })).data;
  assert.match(info.gameId, /^k_/);
  assert.equal((await call('/api/link/korotomo-results', { method: 'POST', headers: S, body: { gameId: info.gameId, goals: 3, plays: 2 } })).status, 400, 'ゴールが遊んだ回数より多いのはおかしい');
  assert.equal((await call('/api/link/korotomo-results', { method: 'POST', headers: S, body: { gameId: info.gameId, goals: 2, plays: 3 } })).status, 200);
  assert.deepEqual((await call('/api/auth/me', { as: me })).data.korotomo.goals, 2);
});

test('そらとも：ともはねのゲームとして、ミッション達成の数と遊んだ回数だけ受けとる', async () => {
  const me = await signup('そらともの人');
  const S = { 'X-Link-Secret': 'tomohane-dev-link-secret' };
  const r = await fetch(`${base}/api/link/soratomo-start`, { redirect: 'manual', headers: { Cookie: me.cookie } });
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin, 'http://localhost:3800');
  const info = (await call(`/api/link/soratomo-ticket/${loc.searchParams.get('ticket')}`, { headers: S })).data;
  assert.match(info.gameId, /^s_/);
  assert.equal((await call('/api/link/soratomo-results', { method: 'POST', headers: S, body: { gameId: info.gameId, missions: 2, plays: 1 } })).status, 400);
  assert.equal((await call('/api/link/soratomo-results', { method: 'POST', headers: S, body: { gameId: info.gameId, missions: 1, plays: 2 } })).status, 200);
  assert.equal((await call('/api/auth/me', { as: me })).data.soratomo.missions, 1);
});

test('保護者とつなぐ：大人がコードを出し、子どもが入れる。はずせるのはおうちの人だけ', async () => {
  const mom = await signup('おかあさん');
  const kid = await signup('こども', { birthdate: '2018-04-01' });
  const teen = await signup('ちゅうがくせい', { birthdate: '2012-01-01' });
  const other = await signup('ほかの大人');

  // 子どもはコードを出せない。大人はコードを入れられない
  assert.equal((await call('/api/guardian/code', { method: 'POST', as: kid })).status, 403);
  const { code } = (await call('/api/guardian/code', { method: 'POST', as: mom })).data;
  assert.match(code, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.equal((await call('/api/guardian/join', { method: 'POST', as: other, body: { code } })).status, 403);
  assert.equal((await call('/api/guardian/join', { method: 'POST', as: teen, body: { code } })).status, 403);
  assert.equal((await call('/api/guardian/join', { method: 'POST', as: kid, body: { code: 'zzzz-zzzz' } })).status, 401);

  // 子どもが入れると、つながる。同じコードは2回使えない
  const joined = await call('/api/guardian/join', { method: 'POST', as: kid, body: { code: code.toUpperCase() } });
  assert.equal(joined.status, 200);
  assert.equal(joined.data.name, 'おかあさん');
  assert.equal((await call('/api/guardian/join', { method: 'POST', as: kid, body: { code } })).status, 401);

  // おうちの人には、子どもの広場の投稿とゲームの数が見える（ほかの大人には見えない）
  await call('/api/posts', { method: 'POST', as: kid, body: { text: 'きょうはライブのDVDを見た' } });
  const view = (await call('/api/guardian', { as: mom })).data;
  assert.equal(view.children.length, 1);
  assert.equal(view.children[0].name, 'こども');
  assert.equal(view.children[0].recentPosts[0].text, 'きょうはライブのDVDを見た');
  assert.equal(view.children[0].birthdate, undefined);
  assert.equal((await call('/api/guardian', { as: other })).data.children.length, 0);
  assert.deepEqual((await call('/api/guardian', { as: kid })).data.guardians.map((g) => g.name), ['おかあさん']);

  // 子どもからは、はずせない。おうちの人ははずせる
  assert.equal((await call(`/api/guardian/children/${mom.id}`, { method: 'DELETE', as: kid })).status, 404);
  assert.equal((await call(`/api/guardian/children/${kid.id}`, { method: 'DELETE', as: other })).status, 404);
  assert.equal((await call(`/api/guardian/children/${kid.id}`, { method: 'DELETE', as: mom })).status, 200);
  assert.equal((await call('/api/guardian', { as: kid })).data.guardians.length, 0);
  assert.equal((await call('/api/guardian')).status, 401);
});

test('ゲーム一覧：4つのゲーム・おすすめ（一言つき）・同じ推しの人のおすすめをシバが広場で答える', async () => {
  const a = await signup('ゲーム好きA');
  const b = await signup('ゲーム好きB');
  await call(`/api/users/${a.id}/oshi`, { method: 'PUT', as: a, body: { name: 'ほしぞらユニット' } });
  await call(`/api/users/${b.id}/oshi`, { method: 'PUT', as: b, body: { name: 'ほしぞらユニット' } });

  const list = (await call('/api/games')).data;
  assert.deepEqual(list.map((g) => g.id), ['tomojan', 'ghost', 'korotomo', 'soratomo']);
  // ころとも・そらともはアップデート予定：一覧には出るが、遊べない・おすすめできない
  assert.deepEqual(list.filter((g) => g.soon).map((g) => g.id), ['korotomo', 'soratomo']);
  assert.ok(list.filter((g) => g.soon).every((g) => g.play === null));
  assert.equal((await call('/api/games/soratomo/recommend', { method: 'PUT', as: a, body: { comment: 'x' } })).status, 409);
  assert.ok(!list.some((g) => g.id === 'tomoai'));

  // おすすめはログインが必要。一言は60文字まで
  assert.equal((await call('/api/games/ghost/recommend', { method: 'PUT', body: { comment: 'x' } })).status, 401);
  assert.equal((await call('/api/games/ghost/recommend', { method: 'PUT', as: a, body: { comment: 'あ'.repeat(61) } })).status, 400);
  assert.equal((await call('/api/games/ghost/recommend', { method: 'PUT', as: a, body: { comment: '推しの曲を聞きながら走ると最高' } })).status, 200);
  const sora = (await call('/api/games', { as: a })).data.find((g) => g.id === 'ghost');
  assert.equal(sora.recCount, 1);
  assert.deepEqual(sora.myRec, { comment: '推しの曲を聞きながら走ると最高' });
  assert.equal(sora.voices[0].oshi, 'ほしぞらユニット');

  // 同じ推しの B さんへのおすすめ
  const pick = (await call('/api/games/recommend', { as: b })).data;
  assert.equal(pick.id, 'ghost');
  assert.match(pick.reason, /ほしぞらユニット推し/);

  // 広場で「おすすめのゲームある？」→ シバが答える
  const posted = await call('/api/posts', { method: 'POST', as: b, body: { text: 'なにかおすすめのゲームある？' } });
  const reply = sim.respondToHumanPost(store.listPosts().find((p) => p.id === posted.data.id));
  assert.equal(reply.authorId, 'agent-shiba');
  assert.match(reply.text, /ゴーストエージェント/);
  assert.match(reply.text, /ほしぞらユニット推し/);

  // 取り消し
  await call('/api/games/ghost/recommend', { method: 'DELETE', as: a });
  assert.equal((await call('/api/games')).data.find((g) => g.id === 'ghost').recCount, 0);
});

test('ゲームを作っている人へ：キットをダウンロード → 申しこみ（合言葉は1回だけ）→ 運営が一覧に出す → ともはねでログインと記録', async () => {
  for (const f of ['README.md', 'tomohane-link.js', 'example-server.js']) assert.equal((await fetch(`${base}/kit/${f}`)).status, 200, f);

  const maker = await signup('インディーの人');
  const kid = await signup('ゲームする子', { birthdate: '2017-05-05' });
  const admin = await signup('運営の人');
  store.getUser(admin.id).role = 'admin';

  assert.equal((await call('/api/games/apply', { method: 'POST', as: kid, body: {} })).status, 403);
  const bad = await call('/api/games/apply', { method: 'POST', as: maker, body: { id: 'my-game', name: 'x', maker: 'x', url: 'javascript:alert(1)', description: 'x' } });
  assert.equal(bad.status, 400);
  // 広告・課金のあるゲームは申しこめない
  const withAds = { id: 'ad-game', name: 'こうこく', maker: 'x', url: 'http://localhost:4101', description: 'x' };
  assert.equal((await call('/api/games/apply', { method: 'POST', as: maker, body: { ...withAds, ads: true } })).status, 400);
  assert.equal((await call('/api/games/apply', { method: 'POST', as: maker, body: { ...withAds, purchases: true } })).status, 400);
  // 年齢はゲームの内容で分ける（このゲームは中高生から）
  const body = { id: 'pixel-cat', name: 'ピクセルねこ', maker: 'ねこ工房', url: 'http://localhost:4100/path', description: 'ねこを集めるパズル', tags: 'パズル、ひとり', minAge: 'teen' };
  const applied = await call('/api/games/apply', { method: 'POST', as: maker, body });
  assert.equal(applied.status, 201);
  const { secret } = applied.data;
  assert.match(secret, /^tg_/);
  assert.equal(applied.data.game.url, 'http://localhost:4100');
  assert.equal(applied.data.game.secretHash, undefined);
  assert.equal((await call('/api/games/apply', { method: 'POST', as: maker, body })).status, 409);

  // 運営が見るまでは、一覧にも出ないし、つなげない
  assert.ok(!(await call('/api/games', { as: maker })).data.some((g) => g.id === 'pixel-cat'));
  assert.equal((await fetch(`${base}/api/link/x/pixel-cat/start`, { redirect: 'manual', headers: { Cookie: maker.cookie } })).status, 404);
  assert.equal((await call('/api/games/review', { as: maker })).status, 403);
  assert.equal((await call('/api/games/review', { as: admin })).data.find((g) => g.id === 'pixel-cat').owner, 'インディーの人');
  assert.equal((await call('/api/games/pixel-cat/status', { method: 'POST', as: admin, body: { status: 'listed' } })).status, 200);

  // 中高生からの内容なので、子どもとログインしていない人には出ない。大人には出る
  assert.ok((await call('/api/games', { as: maker })).data.some((g) => g.id === 'pixel-cat'));
  assert.ok(!(await call('/api/games', { as: kid })).data.some((g) => g.id === 'pixel-cat'));
  assert.ok(!(await call('/api/games')).data.some((g) => g.id === 'pixel-cat'));
  assert.equal((await fetch(`${base}/api/link/x/pixel-cat/start`, { redirect: 'manual', headers: { Cookie: kid.cookie } })).status, 403);
  // 前に広告ありで登録されたゲームは、大人にも出さない
  store.extGame('pixel-cat').ads = true;
  assert.ok(!(await call('/api/games', { as: maker })).data.some((g) => g.id === 'pixel-cat'), '広告のあるゲームは、だれにも出さない');
  store.extGame('pixel-cat').ads = false;

  // ともはねでログイン（キットの部品を使う）
  const { createTomohaneLink } = await import('../../kit/tomohane-link.js');
  const r = await fetch(`${base}/api/link/x/pixel-cat/start`, { redirect: 'manual', headers: { Cookie: maker.cookie } });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin, 'http://localhost:4100');
  const wrong = createTomohaneLink({ baseUrl: base, gameId: 'pixel-cat', secret: 'tg_wrong' });
  await assert.rejects(wrong.redeem(loc.searchParams.get('ticket')), /合言葉/);
  const kit = createTomohaneLink({ baseUrl: base, gameId: 'pixel-cat', secret });
  const player = await kit.redeem(loc.searchParams.get('ticket'));
  assert.equal(player.name, 'インディーの人');
  assert.equal(player.ageGroup, 'adult');
  assert.ok(!player.gameId.includes(maker.id));
  await assert.rejects(kit.redeem(loc.searchParams.get('ticket')), /通行証/);
  await kit.report(player.gameId, { plays: 3, best: 120 });
  await assert.rejects(kit.report(player.gameId, { plays: -1 }), /記録/);
  assert.deepEqual((await call('/api/games', { as: maker })).data.find((g) => g.id === 'pixel-cat').myRecord.plays, 3);
});

test('ともはね新聞：アンケートは1人1票。数は運営だけ、みんなには座談会で伝える', async () => {
  const id = 'guide-chara';
  const pollOf = (data) => data.find((i) => i.poll?.id === id).poll;
  const anon = await call('/api/news');
  assert.equal(anon.status, 200);
  assert.equal(anon.data[0].plaza, undefined, '広場の告知文は返さない');
  const first = pollOf(anon.data);
  assert.equal(first.counts, undefined, '数は返さない');
  assert.equal(first.total, undefined);
  assert.ok(first.choices.every((c) => c.talk === undefined));
  assert.ok(first.talk.length >= 1);
  assert.equal(first.myVote, null);

  assert.equal((await call(`/api/news/${id}/vote`, { method: 'PUT', body: { choice: 'draw' } })).status, 401, 'ログインしていないと答えられない');
  const fan = await signup('新聞に答える人');
  const admin = await signup('新聞を見る運営');
  store.getUser(admin.id).role = 'admin';
  assert.equal((await call(`/api/news/${id}/vote`, { method: 'PUT', as: fan, body: { choice: 'ちがう' } })).status, 400);
  assert.equal((await call('/api/news/no-such/vote', { method: 'PUT', as: fan, body: { choice: 'draw' } })).status, 404);
  assert.equal((await call(`/api/news/${id}/vote`, { method: 'PUT', as: fan, body: { choice: 'draw', comment: 'x'.repeat(101) } })).status, 400);

  assert.equal((await call(`/api/news/${id}/vote`, { method: 'PUT', as: fan, body: { choice: 'draw', comment: 'ネコのキャラを描きたい' } })).status, 200);
  assert.equal((await call(`/api/news/${id}/vote`, { method: 'PUT', as: fan, body: { choice: 'see', comment: 'やっぱり見るだけ' } })).status, 200);
  const mine = pollOf((await call('/api/news', { as: fan })).data);
  assert.deepEqual(mine.myVote, { choice: 'see', comment: 'やっぱり見るだけ' });
  assert.equal(mine.counts, undefined, '答えた人にも数は見せない');
  assert.ok(!JSON.stringify(mine.talk).match(/\d/), '座談会に数字は出ない');

  const forAdmin = pollOf((await call('/api/news', { as: admin })).data);
  assert.equal(forAdmin.total, 1, '同じ人は1票だけ');
  assert.equal(forAdmin.counts.see, 1);
  assert.equal(forAdmin.counts.draw, 0);

  assert.equal((await call(`/api/news/${id}/voices`, { as: fan })).status, 403, 'ひとことは運営だけ');
  const voices = await call(`/api/news/${id}/voices`, { as: admin });
  assert.deepEqual(voices.data.map((v) => [v.name, v.choice, v.comment, v.age]), [['新聞に答える人', 'see', 'やっぱり見るだけ', 'adult']]);

  assert.equal((await call(`/api/news/${id}/vote`, { method: 'DELETE', as: fan })).status, 200);
  assert.equal(pollOf((await call('/api/news', { as: admin })).data).total, 0);
});

test('ともはね新聞：出た号ごとに、新聞社が広場にスレッドを立てる（1回だけ）。返信はスレッドにまとまる', async () => {
  const posted = sim.announceNews();
  const [root, first] = posted;
  assert.equal(root.authorId, 'official-shinbunsha');
  assert.equal(root.thread, true);
  assert.equal(root.newsIssueId, '2026-11-07-no1');
  assert.match(root.text, /第1号/);
  assert.equal(first.authorId, 'agent-shiba', '記者のシバが最初に返事をする');
  assert.equal(first.replyTo, root.id);
  assert.deepEqual(sim.announceNews(), [], '2回目は立てない');

  // 人がスレッドの中の返信に返信しても、同じスレッドにまとまる
  const reader = await signup('スレッドで話す人');
  const r = await call('/api/posts', { method: 'POST', as: reader, body: { text: '創刊おめでとう！', replyTo: first.id } });
  assert.equal(r.status, 201);
  const list = (await call('/api/posts')).data;
  assert.equal(list.find((p) => p.id === r.data.id).threadId, root.id);
  assert.equal(list.find((p) => p.id === root.id).replyCount, 2);
  assert.equal(list.find((p) => p.id === root.id).author.name, 'ともはね新聞社');
  const thread = (await call(`/api/threads/${root.id}`)).data;
  assert.deepEqual(thread.posts.map((p) => p.id).slice(0, 3), [root.id, first.id, r.data.id], '古い順');
  assert.equal((await call(`/api/threads/${r.data.id}`)).status, 404, 'はじまりの投稿でなければスレッドではない');
  const news = (await call('/api/news')).data.find((i) => i.id === '2026-11-07-no1');
  assert.equal(news.threadPostId, root.id, '新聞から、その号のスレッドへ行ける');

  // 人は新聞社の名前を使えない。人の投稿はスレッドのはじまりにならない
  const fake = await call('/api/auth/register', { method: 'POST', body: { loginId: 'fake_paper', password: 'long-password', name: 'ともはね新聞社', birthdate: '1990-01-01', agreeTerms: true } });
  assert.equal(fake.status, 409);
  const sneaky = await call('/api/posts', { method: 'POST', as: reader, body: { text: 'スレッドにしたい', thread: true } });
  assert.equal(sneaky.data.thread, undefined);
  assert.ok(!store.listAgents().some((a) => a.id === 'official-shinbunsha'), '新聞社はキャラではない');
});

test('ミュート・ブロック：相手には知らせない・理由は返さない・相手の投稿が見えなくなる・返信はほかの人にも見えない・いつでも外せる', async () => {
  const a = await signup('ブロックする人');
  const b = await signup('ブロックされる人');
  const c = await signup('見ている人');
  const events = [];
  const unsub = store.subscribe((e) => events.push(e.type));

  const mine = (await call('/api/posts', { method: 'POST', as: a, body: { text: 'Aの投稿' } })).data;
  const bPost = (await call('/api/posts', { method: 'POST', as: b, body: { text: 'Bの投稿' } })).data;
  const bReply = (await call('/api/posts', { method: 'POST', as: b, body: { text: 'Aへの返信', replyTo: mine.id } })).data;

  assert.equal((await call(`/api/blocks/${b.id}`, { method: 'PUT', body: {} })).status, 401, 'ログインが要る');
  assert.equal((await call(`/api/blocks/${a.id}`, { method: 'PUT', as: a, body: {} })).status, 400, '自分はブロックできない');
  assert.equal((await call('/api/blocks/agent-shiba', { method: 'PUT', as: a, body: {} })).status, 400, 'キャラはブロックできない');
  assert.equal((await call(`/api/blocks/${b.id}`, { method: 'PUT', as: a, body: { reason: 'あ'.repeat(101) } })).status, 400);

  events.length = 0;
  const blocked = await call(`/api/blocks/${b.id}`, { method: 'PUT', as: a, body: { reason: 'しつこいから' } });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.data.hasReason, true);
  assert.equal(JSON.stringify(blocked.data).includes('しつこい'), false, '理由は返さない');
  assert.deepEqual(events, [], '合図（お知らせ）を出さない');

  const ids = async (as) => (await call('/api/posts', { as })).data.map((p) => p.id);
  const seenByA = await ids(a);
  assert.ok(!seenByA.includes(bPost.id) && !seenByA.includes(bReply.id), 'Aには Bの投稿が見えない');
  const seenByC = await ids(c);
  assert.ok(seenByC.includes(bPost.id), 'ほかの人には Bのふつうの投稿は見える');
  assert.ok(!seenByC.includes(bReply.id), 'Aの投稿への Bの返信は、ほかの人にも見えない');
  assert.ok(!(await ids(null)).includes(bReply.id), 'ログインしていない人にも見えない');
  const seenByB = await ids(b);
  assert.ok(seenByB.includes(bReply.id) && seenByB.includes(mine.id), 'B本人には全部ふつうに見える（知らせない）');
  assert.equal((await call('/api/blocks', { as: b })).data.length, 0, 'Bの一覧には何も出ない');

  const list = (await call('/api/blocks', { as: a })).data;
  assert.deepEqual(list.map((x) => x.user.name), ['ブロックされる人']);
  assert.equal(JSON.stringify(list).includes('しつこい'), false);

  // 理由なしでもブロックできる（理由を変えても1人は1回）
  await call(`/api/blocks/${b.id}`, { method: 'PUT', as: a, body: { reason: '   ' } });
  assert.equal((await call('/api/blocks', { as: a })).data[0].hasReason, false);
  assert.equal((await call('/api/blocks', { as: a })).data.length, 1);

  // ミュートに切りかえ：Aには見えないまま、Aの投稿への返信はほかの人にも見える。理由は残せる
  await call(`/api/blocks/${b.id}`, { method: 'PUT', as: a, body: { reason: 'まだいや' } });
  const muted = await call(`/api/blocks/${b.id}`, { method: 'PUT', as: a, body: { kind: 'mute', keepReason: true } });
  assert.equal(muted.data.kind, 'mute');
  assert.equal(muted.data.hasReason, true, '切りかえても理由は残る');
  assert.ok(!(await ids(a)).includes(bPost.id), 'ミュートでも Aには見えない');
  assert.ok((await ids(c)).includes(bReply.id), 'ミュートなら、返信はほかの人には見える');
  assert.equal((await call(`/api/blocks/${b.id}`, { method: 'PUT', as: a, body: { kind: 'kick' } })).status, 400);

  assert.equal((await call(`/api/blocks/${b.id}`, { method: 'DELETE', as: a })).status, 200);
  assert.equal((await call(`/api/blocks/${b.id}`, { method: 'DELETE', as: a })).status, 404);
  assert.ok((await ids(a)).includes(bPost.id), '外すとまた見える');
  assert.ok((await ids(c)).includes(bReply.id));
  unsub();
});

test('通報：通報した人は出さない・本人にだけキャラが声をかける・重いものは運営が見るまで見えない・あやまりは読むかを選べる・運営が決める', async () => {
  const admin = [...people.values()][0]; // いちばん最初に登録した人が運営
  const writer = await signup('通報される人');
  const r1 = await signup('通報する人1');
  const r2 = await signup('通報する人2');
  const r3 = await signup('通報する人3');
  const other = await signup('通報を見ている人');
  const post = (await call('/api/posts', { method: 'POST', as: writer, body: { text: 'ちょっときつい言い方' } })).data;
  const ids = async (as) => (await call('/api/posts', { as })).data.map((p) => p.id);

  assert.equal((await call(`/api/posts/${post.id}/report`, { method: 'POST', body: { reason: 'rude' } })).status, 401);
  assert.equal((await call(`/api/posts/${post.id}/report`, { method: 'POST', as: writer, body: { reason: 'rude' } })).status, 400, '自分の投稿は通報できない');
  assert.equal((await call(`/api/posts/${post.id}/report`, { method: 'POST', as: r1, body: { reason: 'なんとなく' } })).status, 400);

  // 軽い通報：通報した人には見えなくなる。ほかの人には見えたまま。本人にはやさしい声
  assert.equal((await call(`/api/posts/${post.id}/report`, { method: 'POST', as: r1, body: { reason: 'rude' } })).status, 201);
  assert.equal((await call(`/api/posts/${post.id}/report`, { method: 'POST', as: r1, body: { reason: 'rude' } })).status, 409, '同じ人は1回');
  assert.ok(!(await ids(r1)).includes(post.id));
  assert.ok((await ids(other)).includes(post.id));
  let mine = (await call('/api/reports/mine', { as: writer })).data;
  assert.equal(mine.notices.length, 1);
  assert.equal(mine.notices[0].stage, 'gentle');
  assert.ok(['シバ', 'ウサギ'].includes(mine.notices[0].guide.name));
  assert.equal(JSON.stringify(mine).includes('通報する人1'), false, '通報した人の名前は出さない');
  assert.equal((await call('/api/reports/mine', { as: other })).data.notices.length, 0, 'ほかの人には出ない');

  // ちがう人から3つ → お巡りさん（本物ではないと書く）
  await call(`/api/posts/${post.id}/report`, { method: 'POST', as: r2, body: { reason: 'pester' } });
  await call(`/api/posts/${post.id}/report`, { method: 'POST', as: r3, body: { reason: 'rude' } });
  mine = (await call('/api/reports/mine', { as: writer })).data;
  assert.equal(mine.notices[0].stage, 'police');
  assert.match(mine.notices[0].guide.note, /^本物の.+ではありません$/);

  // あやまる：通報した人には「読みますか？」だけ。読むと中身が出る。読まないも選べる
  assert.equal((await call(`/api/posts/${post.id}/apology`, { method: 'POST', as: other, body: { text: 'ごめん' } })).status, 403);
  assert.equal((await call(`/api/posts/${post.id}/apology`, { method: 'POST', as: writer, body: { text: 'あ'.repeat(51) } })).status, 400);
  assert.equal((await call(`/api/posts/${post.id}/apology`, { method: 'POST', as: writer, body: { text: 'ごめんなさい。言い方がよくなかったです' } })).status, 200);
  assert.equal((await call(`/api/posts/${post.id}/apology`, { method: 'POST', as: writer, body: { text: 'もう一回' } })).status, 409);
  const ask1 = (await call('/api/reports/mine', { as: r1 })).data.apologies;
  assert.equal(ask1.length, 1);
  assert.equal(ask1[0].from, '通報される人');
  assert.equal(JSON.stringify(ask1).includes('ごめんなさい'), false, '読むと決めるまで中身は出さない');
  const read = await call(`/api/reports/${ask1[0].id}/apology`, { method: 'POST', as: r1, body: { read: true } });
  assert.equal(read.data.text, 'ごめんなさい。言い方がよくなかったです');
  const ask2 = (await call('/api/reports/mine', { as: r2 })).data.apologies;
  assert.deepEqual((await call(`/api/reports/${ask2[0].id}/apology`, { method: 'POST', as: r2, body: { read: false } })).data, { ok: true });
  assert.equal((await call('/api/reports/mine', { as: r2 })).data.apologies.length, 0);
  assert.equal((await call(`/api/reports/${ask2[0].id}/apology`, { method: 'POST', as: r3, body: { read: true } })).status, 404, 'ほかの人の通報のあやまりは読めない');

  // わかった → お知らせは消える
  await call(`/api/reports/notices/${post.id}/seen`, { method: 'POST', as: writer });
  assert.equal((await call('/api/reports/mine', { as: writer })).data.notices.length, 0);

  // 重い通報（さらし）：運営が見るまで、本人以外に見えない。本人には弁護士フクロウ
  const bad = (await call('/api/posts', { method: 'POST', as: writer, body: { text: 'だれかの住所みたいなもの' } })).data;
  const heavy = await call(`/api/posts/${bad.id}/report`, { method: 'POST', as: r1, body: { reason: 'expose' } });
  assert.equal(heavy.data.held, true);
  assert.ok(!(await ids(other)).includes(bad.id), 'ほかの人には見えない');
  assert.ok(!(await ids(null)).includes(bad.id));
  const own = (await call('/api/posts', { as: writer })).data.find((p) => p.id === bad.id);
  assert.equal(own.hidden, 'report', '本人には見えて、止まっているとわかる');
  mine = (await call('/api/reports/mine', { as: writer })).data;
  assert.equal(mine.notices[0].stage, 'lawyer');

  // 運営：一覧（通報した人の名前は出さない）→ 出す／止める
  assert.equal((await call('/api/reports', { as: writer })).status, 403, '運営だけ');
  const list = (await call('/api/reports', { as: admin })).data;
  const row = list.find((x) => x.postId === bad.id);
  assert.equal(row.reporters, 1);
  assert.equal(JSON.stringify(list).includes('通報する人'), false);
  await call(`/api/reports/${bad.id}/decision`, { method: 'POST', as: admin, body: { action: 'show' } });
  assert.ok((await ids(other)).includes(bad.id), '運営が出すと、また見える');
  await call(`/api/reports/${bad.id}/decision`, { method: 'POST', as: admin, body: { action: 'hide' } });
  assert.ok(!(await ids(other)).includes(bad.id), '運営が止めると見えない');
  mine = (await call('/api/reports/mine', { as: writer })).data;
  assert.equal(mine.notices.find((n) => n.postId === bad.id).stage, 'stopped');

  // キャラの投稿は通報できない
  const agentPost = store.listPosts().find((p) => p.authorId.startsWith('agent-'));
  assert.equal((await call(`/api/posts/${agentPost.id}/report`, { method: 'POST', as: r1, body: { reason: 'rude' } })).status, 400);
});

test('投稿を消す：自分の投稿だけ・返信は一緒に見えなくなる（書いた人には見える）・返信した人にひとことが届く', async () => {
  const writer = await signup('消す人');
  const fan = await signup('返信した人');
  const fan2 = await signup('返信の返信をした人');
  const other = await signup('消すのを見ている人');
  const ids = async (as) => (await call('/api/posts', { as })).data.map((p) => p.id);

  const post = (await call('/api/posts', { method: 'POST', as: writer, body: { text: '消すかもしれない投稿' } })).data;
  const reply = (await call('/api/posts', { method: 'POST', as: fan, body: { text: 'いいね！', replyTo: post.id } })).data;
  const reply2 = (await call('/api/posts', { method: 'POST', as: fan2, body: { text: 'わかる', replyTo: reply.id } })).data;
  const own = (await call('/api/posts', { method: 'POST', as: writer, body: { text: '自分で返信', replyTo: post.id } })).data;

  assert.equal((await call(`/api/posts/${post.id}/delete`, { method: 'POST', body: { farewell: 'ありがとう' } })).status, 401);
  assert.equal((await call(`/api/posts/${post.id}/delete`, { method: 'POST', as: fan, body: { farewell: 'ありがとう' } })).status, 403, 'ほかの人の投稿は消せない');
  assert.equal((await call(`/api/posts/${post.id}/delete`, { method: 'POST', as: writer, body: {} })).status, 400, '返信した人がいれば、ひとことが要る');
  assert.equal((await call(`/api/posts/${post.id}/delete`, { method: 'POST', as: writer, body: { farewell: 'あ'.repeat(51) } })).status, 400);

  const del = await call(`/api/posts/${post.id}/delete`, { method: 'POST', as: writer, body: { farewell: 'ありがとう' } });
  assert.equal(del.status, 200);
  assert.equal(del.data.told, 2, '返信した2人に届く（自分とキャラには届かない）');
  assert.equal((await call(`/api/posts/${post.id}/delete`, { method: 'POST', as: writer, body: { farewell: 'ありがとう' } })).status, 404);

  for (const id of [post.id, reply.id, reply2.id, own.id]) assert.ok(!(await ids(other)).includes(id), 'ほかの人には全部見えない');
  assert.ok((await ids(fan)).includes(reply.id) && !(await ids(fan)).includes(reply2.id), '返信した人は自分の返信だけ見える');
  assert.equal((await call('/api/posts', { as: fan })).data.find((p) => p.id === reply.id).orphaned, true);
  assert.ok((await ids(fan2)).includes(reply2.id));
  assert.ok(!store.listPosts().some((p) => p.id === post.id), '消した投稿は残さない');

  const fw = (await call('/api/reports/mine', { as: fan })).data.farewells;
  assert.deepEqual(fw.map((x) => [x.from, x.text]), [['消す人', 'ありがとう']]);
  assert.equal((await call('/api/reports/mine', { as: other })).data.farewells.length, 0);
  assert.equal((await call(`/api/farewells/${fw[0].id}/seen`, { method: 'POST', as: fan2 })).status, 404, 'ほかの人のお知らせは消せない');
  await call(`/api/farewells/${fw[0].id}/seen`, { method: 'POST', as: fan });
  assert.equal((await call('/api/reports/mine', { as: fan })).data.farewells.length, 0);

  // 返信がなければ、ひとことなしで消せる。自分のことばは送る前のチェックを通す
  const lone = (await call('/api/posts', { method: 'POST', as: writer, body: { text: 'ひとりごと' } })).data;
  assert.deepEqual((await call(`/api/posts/${lone.id}/delete`, { method: 'POST', as: writer, body: {} })).data, { ok: true, told: 0 });
  const p2 = (await call('/api/posts', { method: 'POST', as: writer, body: { text: 'もうひとつ' } })).data;
  await call('/api/posts', { method: 'POST', as: fan, body: { text: '返信', replyTo: p2.id } });
  assert.equal((await call(`/api/posts/${p2.id}/delete`, { method: 'POST', as: writer, body: { farewell: '闇バイト募集、高収入' } })).status, 422);
  assert.equal((await call(`/api/posts/${p2.id}/delete`, { method: 'POST', as: writer, body: { farewell: 'またね、ありがとう！' } })).data.told, 1);

  // キャラや新聞社の投稿は消せない
  const agentPost = store.listPosts().find((p) => p.authorId.startsWith('agent-'));
  assert.equal((await call(`/api/posts/${agentPost.id}/delete`, { method: 'POST', as: writer, body: {} })).status, 403);
});

test('カフェ：フリーテーブル・広場とは分ける・返信は同じテーブル・はじめての人にはタヌキがあいさつ・カフェの2人は広場に出ない', async () => {
  const guest = await signup('カフェのお客さん');
  const tables = (await call('/api/cafe/tables')).data;
  assert.deepEqual(tables.map((t) => t.id), ['free', 'idol', 'anime', 'game', 'vtuber', 'sports', 'other']);
  assert.equal((await call('/api/posts?table=nothing')).status, 404);
  assert.equal((await call('/api/posts', { method: 'POST', as: guest, body: { text: 'x', table: 'nothing' } })).status, 404);

  const p = (await call('/api/posts', { method: 'POST', as: guest, body: { text: 'はじめてカフェに来ました', table: 'free' } })).data;
  assert.equal(p.table, 'free');
  const cafe = (await call('/api/posts?table=free')).data.map((x) => x.id);
  const plaza = (await call('/api/posts')).data.map((x) => x.id);
  assert.ok(cafe.includes(p.id) && !plaza.includes(p.id), 'カフェの投稿は広場に出ない');

  // はじめての人：マスターのタヌキがあいさつ（返事も同じテーブル）
  const hello = sim.respondToHumanPost(store.getPost(p.id));
  assert.equal(hello.authorId, 'agent-tanuki');
  assert.match(hello.text, /ゆっくりしていきなよ/);
  assert.equal(hello.table, 'free');

  // 人の返信も同じテーブル（table を送らなくても）
  const r = (await call('/api/posts', { method: 'POST', as: guest, body: { text: 'ありがとう！', replyTo: hello.id } })).data;
  assert.equal(r.table, 'free');
  // 2回目からは、起きているカフェの2人のどちらか
  const again = (await call('/api/posts', { method: 'POST', as: guest, body: { text: '推しの新曲がよかった', table: 'free' } })).data;
  const second = sim.respondToHumanPost(store.getPost(again.id));
  assert.ok(!second || ['agent-tanuki', 'agent-penguin'].includes(second.authorId));
  // トゲのある言葉には、カフェでもフクロウ
  const harsh = (await call('/api/posts', { method: 'POST', as: guest, body: { text: 'うざい', table: 'free' } })).data;
  assert.equal(sim.respondToHumanPost(store.getPost(harsh.id))?.authorId, 'agent-fukurou');

  // カフェの2人は広場・会議に出ない。持ち場は cafe
  const agents = (await call('/api/agents')).data;
  assert.deepEqual(agents.filter((a) => a.place === 'cafe').map((a) => a.name), ['タヌキ', 'ペンギン']);
  assert.equal((await call('/api/posts')).data.some((x) => ['agent-tanuki', 'agent-penguin'].includes(x.authorId)), false);
  assert.equal((await call('/api/cafe/tables')).data[0].postCount >= 4, true);

  const res = await fetch(`${base}/cafe.html`);
  assert.match(await res.text(), /カフェ/);
});

test('カフェ：ジャンルのテーブル・ジャンルのリクエスト（ユーザーの声）→ 運営がテーブルを足す', async () => {
  const admin = [...people.values()][0];
  const fan = await signup('ジャンルをリクエストする人');
  const idolPost = (await call('/api/posts', { method: 'POST', as: fan, body: { text: '推しのアイドルの新曲！', table: 'idol' } })).data;
  assert.equal(idolPost.table, 'idol');
  assert.ok(!(await call('/api/posts?table=free')).data.some((p) => p.id === idolPost.id), 'ほかのテーブルには出ない');
  assert.ok((await call('/api/posts?table=idol')).data.some((p) => p.id === idolPost.id));

  // リクエスト：ログインが要る・30文字まで・1人3つまで・だれが出したかは運営にも出さない
  assert.equal((await call('/api/cafe/requests', { method: 'POST', body: { text: '舞台' } })).status, 401);
  assert.equal((await call('/api/cafe/requests', { method: 'POST', as: fan, body: { text: 'あ'.repeat(31) } })).status, 400);
  for (const t of ['舞台・ミュージカル', 'バンド', '本・小説']) {
    assert.equal((await call('/api/cafe/requests', { method: 'POST', as: fan, body: { text: t } })).status, 201);
  }
  assert.equal((await call('/api/cafe/requests', { method: 'POST', as: fan, body: { text: '4つ目' } })).status, 429);
  assert.equal((await call('/api/cafe/requests', { as: fan })).status, 403, '一覧は運営だけ');
  const reqs = (await call('/api/cafe/requests', { as: admin })).data;
  assert.deepEqual(reqs.map((r) => r.text), ['舞台・ミュージカル', 'バンド', '本・小説']);
  assert.equal(JSON.stringify(reqs).includes('ジャンルをリクエストする人'), false);

  // 運営がテーブルを足す → カフェに出る。リクエストは片づける
  assert.equal((await call('/api/cafe/tables', { method: 'POST', as: fan, body: { name: '舞台' } })).status, 403);
  const added = await call('/api/cafe/tables', { method: 'POST', as: admin, body: { name: '舞台・ミュージカル', emoji: '🎭' } });
  assert.equal(added.status, 201);
  assert.equal((await call('/api/cafe/tables', { method: 'POST', as: admin, body: { name: '舞台・ミュージカル' } })).status, 409);
  assert.ok((await call('/api/cafe/tables')).data.some((t) => t.name === '舞台・ミュージカル' && t.emoji === '🎭'));
  await call(`/api/cafe/requests/${reqs[0].id}`, { method: 'DELETE', as: admin });
  assert.equal((await call('/api/cafe/requests', { as: admin })).data.length, 2);
});

test('カフェ：同じ推しの人が3人そろうと、タヌキが推しのテーブルを開く（似た書き方はペンギンがそろえる）・運営は閉じられる', async () => {
  const admin = [...people.values()][0];
  const set = async (name, oshi, genre) => {
    const u = await signup(name);
    assert.equal((await call(`/api/users/${u.id}/oshi`, { method: 'PUT', as: u, body: { name: oshi, genre } })).status, 200);
    return u;
  };
  const before = (await call('/api/cafe/tables')).data.length;
  await set('ほしぞら推し1', 'ルミナス リボン', 'idol');
  await set('ほしぞら推し2', 'るみなすリボン', 'idol');
  assert.equal((await call('/api/cafe/tables')).data.length, before, '2人ではまだ開かない');
  const third = await set('ほしぞら推し3', 'ﾙﾐﾅｽリボン', 'anime');

  const tables = (await call('/api/cafe/tables')).data;
  const t = tables.find((x) => x.kind === 'oshi' && /ルミナス|るみなす|ﾙﾐﾅｽ/.test(x.name));
  assert.ok(t, '3人そろうと開く');
  assert.equal(t.parent, 'idol', 'いちばん多いジャンルに置く');
  assert.match(t.name, /推し$/);
  const idol = (await call('/api/posts?table=idol')).data;
  assert.ok(idol.some((p) => p.authorId === 'agent-tanuki' && /開けといたよ/.test(p.text)), 'タヌキがジャンルの席で知らせる');
  assert.ok(idol.some((p) => p.authorId === 'agent-penguin' && /そろえてあります/.test(p.text)), 'ペンギンが似た書き方をそろえたと知らせる');

  // 同じ推しの仲間（わたしの推しページ）も、似た書き方をまとめて見つける
  const posted = (await call('/api/posts', { method: 'POST', as: third, body: { text: '新曲よかった！', table: t.id } })).data;
  assert.equal(posted.table, t.id);
  const first = people.get('ほしぞら推し1');
  assert.ok((await call(`/api/users/${first.id}/oshi/friends`, { as: first })).data.some((p) => p.id === posted.id));

  // もう一度保存しても、2つ目は開かない
  await call(`/api/users/${third.id}/oshi`, { method: 'PUT', as: third, body: { name: 'ルミナスリボン', genre: 'idol' } });
  assert.equal((await call('/api/cafe/tables')).data.filter((x) => x.kind === 'oshi' && x.name.startsWith('ルミナス')).length, 1);

  // 運営が閉じる → 一覧から消え、書けない。タヌキは開け直さない
  assert.equal((await call(`/api/cafe/tables/${t.id}`, { method: 'DELETE', as: third })).status, 403);
  assert.equal((await call('/api/cafe/tables/free', { method: 'DELETE', as: admin })).status, 400, 'ジャンル・フリーは閉じられない');
  assert.equal((await call(`/api/cafe/tables/${t.id}`, { method: 'DELETE', as: admin })).status, 200);
  assert.ok(!(await call('/api/cafe/tables')).data.some((x) => x.id === t.id));
  assert.equal((await call('/api/posts', { method: 'POST', as: third, body: { text: 'まだいる？', table: t.id } })).status, 404);
  await set('ほしぞら推し4', 'ルミナスリボン', 'idol');
  assert.equal(sim.openOshiTables().length, 0);
});

test('ゲームセンター：地図のゲームの入口をまとめる・店長のキツネと盛り上げ役のカエル', async () => {
  const index = await (await fetch(`${base}/`)).text();
  assert.ok(!/korotomo-spot|soratomo-spot/.test(index), 'ころとも・宇宙の入口は地図から消した');
  assert.ok(/ground-spot/.test(index), 'グラウンド（ゴースト）は地図に残す');
  const map = await (await fetch(`${base}/map.js`)).text();
  assert.match(map, /ゲームセンター/);
  assert.ok(!map.includes('/api/link/game-start'), 'じゃんけんの入口はゲームセンターの中だけ');
  const games = await (await fetch(`${base}/games.html`)).text();
  assert.match(games, /ゲームセンター/);
  const agents = (await call('/api/agents')).data;
  assert.deepEqual(agents.filter((a) => a.place === 'arcade').map((a) => [a.name, a.roleLabel]),
    [['キツネ', 'ゲームセンターの店長'], ['カエル', 'ゲームセンターの盛り上げ役']]);
  assert.equal((await call('/api/posts')).data.some((p) => ['agent-kitsune', 'agent-kaeru'].includes(p.authorId)), false, '広場には出ない');
});

test('ゲームセンター：年齢で閉店（こども21時・中高生22時・大人24時、朝6時に開店）。閉まっているとゲームに入れない', async () => {
  const kid = await signup('ゲーセンのこども', { birthdate: '2018-01-01' });
  const teen = await signup('ゲーセンの中高生', { birthdate: '2011-01-01' });
  const adult = await signup('ゲーセンの大人');
  const at = (h) => new Date(Date.UTC(2026, 10, 8, (h - 9 + 24) % 24, 30)); // 日本時間の h時30分
  const status = async (who) => (await call('/api/arcade', { as: who })).data.open;
  const start = async (who, path = '/api/link/game-start') =>
    (await fetch(base + path, { redirect: 'manual', headers: { Cookie: who.cookie } })).headers.get('location');

  try {
    arcadeNow = at(20);
    assert.deepEqual([await status(kid), await status(teen), await status(adult)], [true, true, true]);
    arcadeNow = at(21);
    assert.deepEqual([await status(kid), await status(teen), await status(adult)], [false, true, true], '21時：こどもは閉店');
    assert.equal(await start(kid), '/games.html?closed=1', 'こどもはじゃんけんに入れない');
    assert.match(await start(teen), /auth\/callback\?ticket=/);
    arcadeNow = at(22);
    assert.deepEqual([await status(teen), await status(adult)], [false, true], '22時：中高生も閉店');
    arcadeNow = at(0);
    assert.equal(await status(adult), false, '夜中の0時：大人も閉店');
    assert.equal(await start(adult, '/api/link/korotomo-start'), '/games.html?closed=1');
    assert.match(await start(adult, '/api/link/ghost-start'), /auth\/callback/, 'グラウンド（ゴースト）は運動なので、いつでも');
    arcadeNow = at(5);
    assert.equal(await status(adult), false);
    arcadeNow = at(6);
    assert.deepEqual([await status(kid), await status(teen), await status(adult)], [true, true, true], '朝6時に開店');
    arcadeNow = at(21);
    assert.equal((await call('/api/arcade')).data.open, false, 'ログインしていない人は、こどもと同じ');
  } finally {
    arcadeNow = NOON_JST;
  }
});

// ---- 退会（7日たってから消える） ----
const DAY = 86400000;
const visibleTo = async (who, postId) => (await call('/api/posts', { as: who })).data.some((p) => p.id === postId);

test('退会：パスワードで申しこむ → 7日のあいだは投稿が見えない・取り消せる → 7日たつと全部消える', async () => {
  const leaver = await signup('退会する人');
  const fan = await signup('返信した人');
  const post = (await call('/api/posts', { method: 'POST', as: leaver, body: { text: '推しのライブたのしかった' } })).data;
  const reply = (await call('/api/posts', { method: 'POST', as: fan, body: { text: 'わたしも行ったよ！', replyTo: post.id } })).data;
  await call(`/api/posts/${reply.id}/like`, { method: 'POST', as: leaver });
  const { data: letter } = await makeLetter('退会する人');

  // パスワードがちがう・返信した人へのひとことがない、は申しこめない
  assert.equal((await call('/api/auth/leave', { method: 'POST', as: leaver, body: { password: 'ちがう', farewell: 'ありがとう' } })).status, 401);
  assert.equal((await call('/api/auth/leave', { method: 'POST', as: leaver, body: { password: leaver.password } })).status, 400);
  assert.equal((await call('/api/auth/leave', { method: 'POST', body: { password: 'x' } })).status, 401, 'ログインしていないと申しこめない');

  const r = await call('/api/auth/leave', { method: 'POST', as: leaver, body: { password: leaver.password, farewell: 'ありがとう' } });
  assert.equal(r.status, 200);
  const until = Date.parse(r.data.me.leaving.until);
  assert.ok(Math.abs(until - (Date.now() + 7 * DAY)) < 60000, '7日後に消える');
  assert.equal((await call('/api/auth/leave', { method: 'POST', as: leaver, body: { password: leaver.password, farewell: 'ありがとう' } })).status, 409);

  // 7日のあいだ：投稿は本人にだけ見える。新しく投稿はできない
  assert.equal(await visibleTo(fan, post.id), false);
  assert.equal(await visibleTo(null, post.id), false);
  assert.equal(await visibleTo(leaver, post.id), true);
  assert.equal((await call('/api/posts', { method: 'POST', as: leaver, body: { text: 'まだいるよ' } })).status, 409);

  // 取り消すと、もとどおり
  const back = await call('/api/auth/leave-cancel', { method: 'POST', as: leaver });
  assert.equal(back.data.me.leaving, null);
  assert.equal(await visibleTo(fan, post.id), true);

  // もう一度申しこんで、7日たつ前は消えない
  await call('/api/auth/leave', { method: 'POST', as: leaver, body: { password: leaver.password, farewell: 'ありがとう' } });
  await app.purgeLeavers(Date.now() + 6 * DAY);
  assert.equal((await call('/api/auth/me', { as: leaver })).data.name, '退会する人');

  // 7日たつと消える：ログインできない・手紙は開けない・返信した人にひとことが届く
  await app.purgeLeavers(Date.now() + 7 * DAY + 1000);
  assert.equal((await call('/api/auth/me', { as: leaver })).data, null, 'ログインのしるしも消える');
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { loginId: leaver.loginId, password: leaver.password } })).status, 401);
  assert.equal((await call(`/api/open/${letter.token}`)).status, 404, '手紙も消える');
  assert.ok(!store.listUsers().some((u) => u.id === leaver.id));
  assert.ok(!store.listPosts().some((p) => p.authorId === leaver.id));
  assert.ok(!store.listPosts().some((p) => p.likes.includes(leaver.id)), 'いいねも消える');
  const fw = (await call('/api/reports/mine', { as: fan })).data.farewells;
  assert.ok(fw.some((f) => f.from === '退会する人' && f.text === 'ありがとう'), '返信した人へひとことが届く');
  // 返信は、書いた本人にだけ見える
  assert.equal(await visibleTo(fan, reply.id), true);
  assert.equal(await visibleTo(null, reply.id), false);
  people.delete('退会する人');
});

test('退会：運営は退会できない。子どもは一人で退会でき、おうちの人には日記で伝わる・14日まで取り消せる', async () => {
  const admin = [...people.values()].find((p) => p.role === 'admin');
  assert.ok(admin, '最初に登録した人は運営');
  assert.equal((await call('/api/auth/leave', { method: 'POST', as: admin, body: { password: admin.password } })).status, 409);

  const dad = await signup('退会のおとうさん');
  const kid = await signup('退会のこども', { birthdate: '2018-05-05' });
  const { code } = (await call('/api/guardian/code', { method: 'POST', as: dad })).data;
  await call('/api/guardian/join', { method: 'POST', as: kid, body: { code } });
  const kidPost = (await call('/api/posts', { method: 'POST', as: kid, body: { text: 'きょうもたのしかった' } })).data;

  // 子どもは一人で申しこめる。7日で入れなくなり、14日で消える
  const r = await call('/api/auth/leave', { method: 'POST', as: kid, body: { password: kid.password } });
  assert.equal(r.status, 200);
  const l = r.data.me.leaving;
  assert.equal(l.guarded, true);
  assert.ok(Math.abs(Date.parse(l.guardianUntil) - Date.parse(l.until) - 7 * DAY) < 1000, 'おうちの人は、さらに7日（14日まで）');
  assert.equal(await visibleTo(null, kidPost.id), false);

  // おうちの人に、シバの日記で伝わる（ほかの大人には見えない）
  let view = (await call('/api/guardian', { as: dad })).data;
  assert.match(view.diary[0].text, /退会のこどもさんが ともはね からの旅立ちを決めた/);
  assert.ok(view.children.find((c) => c.id === kid.id).leaving.guardianUntil);
  const other = await signup('退会のほかの大人');
  assert.equal((await call('/api/guardian', { as: other })).data.diary.length, 0);
  assert.equal((await call(`/api/guardian/children/${kid.id}/leave-cancel`, { method: 'POST', as: other })).status, 404);

  // 本人が7日のうちに取り消すと、日記に「もどってきた」
  await call('/api/auth/leave-cancel', { method: 'POST', as: kid });
  view = (await call('/api/guardian', { as: dad })).data;
  assert.match(view.diary[0].text, /もどってきてくれた/);

  // もう一度申しこんで、8日たった（本人は入れない・取り消せない、まだ消えていない）
  await call('/api/auth/leave', { method: 'POST', as: kid, body: { password: kid.password } });
  store.getUser(kid.id).leaving.at = new Date(Date.now() - 8 * DAY).toISOString();
  assert.equal((await call('/api/auth/me', { as: kid })).data, null, '7日すぎると本人は入れない');
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { loginId: kid.loginId, password: kid.password } })).status, 403);
  await app.purgeLeavers();
  assert.ok(store.listUsers().some((u) => u.id === kid.id), '14日まではデータを残す');

  // おうちの人が取り消すと、もとどおり（機種変更などのまちがい）
  assert.equal((await call(`/api/guardian/children/${kid.id}/leave-cancel`, { method: 'POST', as: dad })).status, 200);
  assert.equal((await call('/api/auth/me', { as: kid })).data.leaving, null);
  assert.equal(await visibleTo(null, kidPost.id), true);
  assert.match((await call('/api/guardian', { as: dad })).data.diary[0].text, /おうちの人が、退会のこどもさんの退会を取り消した/);

  // 14日たつと消える。日記に「旅立った」
  await call('/api/auth/leave', { method: 'POST', as: kid, body: { password: kid.password } });
  await app.purgeLeavers(Date.now() + 13 * DAY);
  assert.ok(store.listUsers().some((u) => u.id === kid.id));
  await app.purgeLeavers(Date.now() + 14 * DAY + 1000);
  view = (await call('/api/guardian', { as: dad })).data;
  assert.equal(view.children.some((c) => c.id === kid.id), false);
  assert.match(view.diary[0].text, /旅立ったっす/);
  people.delete('退会のこども');
});

// ---- 📮 目安箱 ----
test('目安箱：だれが書いたかは運営にも見せない・運営が要約と答えを書いて新聞の座談会にのせる・本人にだけ「あなたの声」', async () => {
  const writer = await signup('目安箱に書く人');
  const reader = await signup('目安箱を読む人');
  const admin = [...people.values()].find((p) => p.role === 'admin');

  assert.equal((await call('/api/suggestions', { method: 'POST', body: { topic: 'cafe', text: 'x' } })).status, 401);
  assert.equal((await call('/api/suggestions', { method: 'POST', as: writer, body: { topic: 'なし', text: 'テーブルを増やして' } })).status, 400);
  const r = await call('/api/suggestions', { method: 'POST', as: writer, body: { topic: 'cafe', text: 'カフェにアニメのテーブルがもっとほしいです' } });
  assert.equal(r.status, 201);
  assert.ok(r.data.reply.by.startsWith('agent-') && r.data.reply.text, '記者がお礼を言う');
  assert.equal((await call('/api/suggestions', { method: 'POST', as: writer, body: { topic: 'other', text: '闇バイト募集、即日10万' } })).status, 422, '送る前のチェックを通る');

  // 運営だけが一覧を見られる。名前や ID は出さない
  assert.equal((await call('/api/suggestions', { as: reader })).status, 403);
  const list = (await call('/api/suggestions', { as: admin })).data;
  const item = list.find((x) => x.text.includes('アニメのテーブル'));
  assert.equal(item.age, 'adult');
  assert.ok(!JSON.stringify(list).includes(writer.id) && !JSON.stringify(list).includes('目安箱に書く人'), '書いた人は出さない');

  // とりあげる前は座談会に出ない
  assert.ok(!(await call('/api/suggestions/talk')).data.some((t) => t.id === item.id));
  assert.equal((await call(`/api/suggestions/${item.id}/pick`, { method: 'POST', as: reader, body: { summary: 'a', answer: 'b' } })).status, 403);
  await call(`/api/suggestions/${item.id}/pick`, { method: 'POST', as: admin, body: { summary: 'カフェのテーブルをもっと増やしてほしい', answer: '来月、ジャンルのテーブルを見直します' } });
  const talkFor = async (who) => (await call('/api/suggestions/talk', { as: who })).data.find((t) => t.id === item.id);
  const shown = await talkFor(reader);
  assert.match(shown.lines[0].text, /カフェのテーブルをもっと増やしてほしい/);
  assert.match(shown.lines[1].text, /来月、ジャンルのテーブルを見直します/);
  assert.ok(!JSON.stringify(shown).includes('アニメのテーブル'), '書いた人の言い回しはのせない');
  assert.equal(shown.mine, false);
  assert.equal((await talkFor(writer)).mine, true, '書いた本人にだけ「あなたの声」');
  assert.equal((await talkFor(null)).mine, false);

  // 片づけると新聞から外れる
  await call(`/api/suggestions/${item.id}/close`, { method: 'POST', as: admin });
  assert.equal(await talkFor(reader), undefined);

  // 1日3通まで
  await call('/api/suggestions', { method: 'POST', as: writer, body: { topic: 'news', text: '新聞たのしい' } });
  await call('/api/suggestions', { method: 'POST', as: writer, body: { topic: 'chara', text: 'キャラかわいい' } });
  assert.equal((await call('/api/suggestions', { method: 'POST', as: writer, body: { topic: 'other', text: 'もう一通' } })).status, 429);
});

// ---- 📜 ともはね の約束（利用規約・プライバシー） ----
test('約束：登録には同意が要る・いまいる人は新しい版に同意する・目安箱の「個人情報」だけ運営に名前が分かる', async () => {
  const { TERMS_VERSION } = await import('../../shared/terms.js');
  const no = await call('/api/auth/register', { method: 'POST', body: { loginId: 'no_agree', password: 'long-password', name: '同意しない人', birthdate: '1990-01-01' } });
  assert.equal(no.status, 400, '同意しないと登録できない');

  const p = await signup('約束を読む人');
  assert.equal((await call('/api/auth/me', { as: p })).data.termsVersion, TERMS_VERSION, '登録したときに同意した版');
  // 前からいる人（同意の記録がない）→ 同意すると記録される
  delete store.getUser(p.id).termsAgreed;
  assert.equal((await call('/api/auth/me', { as: p })).data.termsVersion, null);
  assert.equal((await call('/api/auth/agree', { method: 'POST', as: p, body: { version: '1999-01-01' } })).status, 409, '古い版には同意できない');
  assert.equal((await call('/api/auth/agree', { method: 'POST', body: { version: TERMS_VERSION } })).status, 401);
  const ok = await call('/api/auth/agree', { method: 'POST', as: p, body: { version: TERMS_VERSION } });
  assert.equal(ok.data.me.termsVersion, TERMS_VERSION);

  // 目安箱の「個人情報」：運営に名前とログインIDが分かる。新聞にはのせられない
  const admin = [...people.values()].find((x) => x.role === 'admin');
  await call('/api/suggestions', { method: 'POST', as: p, body: { topic: 'privacy', text: '推しページの記録を見せてください' } });
  const item = (await call('/api/suggestions', { as: admin })).data.find((x) => x.topic === 'privacy');
  assert.deepEqual(item.from, { name: '約束を読む人', loginId: p.loginId });
  assert.equal((await call(`/api/suggestions/${item.id}/pick`, { method: 'POST', as: admin, body: { summary: 'a', answer: 'b' } })).status, 400);
  assert.ok((await call('/api/suggestions', { as: admin })).data.filter((x) => x.topic !== 'privacy').every((x) => !('from' in x)), 'ほかのテーマは名前を出さない');

  // 約束のページが配信される
  const page = await fetch(`${base}/terms.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /運営の誓い/);
});

// ---- 🐾 練習モード（おうちの人とつながる前の子ども） ----
test('練習モード：つながる前の子どもの投稿は本人とキャラにだけ見える・つながると、新しい投稿はみんなに見える', async () => {
  const kid = await signup('れんしゅうのこ', { birthdate: '2017-07-07' });
  const adult = await signup('れんしゅうを見ない大人');
  assert.equal((await call('/api/auth/me', { as: kid })).data.practice, true);
  assert.equal((await call('/api/auth/me', { as: adult })).data.practice, false);

  const p = (await call('/api/posts', { method: 'POST', as: kid, body: { text: 'はじめまして！ 推しのうたがすき' } })).data;
  assert.equal(p.practiceOwner, kid.id);
  assert.equal(await visibleTo(kid, p.id), true, '本人には見える');
  assert.equal(await visibleTo(adult, p.id), false, 'ほかの人には見えない');
  assert.equal(await visibleTo(null, p.id), false);

  // キャラの返事は、その子にだけ見える。家の日記に名前は書かない
  const reply = sim.respondToHumanPost(store.getPost(p.id));
  assert.ok(reply, 'キャラが返事をする');
  assert.equal(reply.practiceOwner, kid.id);
  assert.equal(await visibleTo(kid, reply.id), true);
  assert.equal(await visibleTo(adult, reply.id), false);
  assert.ok(!JSON.stringify(store.getAgent(reply.authorId).diary ?? []).includes('れんしゅうのこ'), '家の日記に名前を書かない');

  // ほかの人は返信・いいねできない。カフェでも同じ
  assert.equal((await call('/api/posts', { method: 'POST', as: adult, body: { text: 'よろしくね', replyTo: p.id } })).status, 404);
  assert.equal((await call(`/api/posts/${p.id}/like`, { method: 'POST', as: adult })).status, 404);
  const c = (await call('/api/posts', { method: 'POST', as: kid, body: { text: 'カフェきたよ', table: 'free' } })).data;
  assert.equal((await call('/api/posts?table=free', { as: adult })).data.some((x) => x.id === c.id), false);

  // みんなに見える場所（会議室・おすすめのひとこと）は、つながってから
  assert.equal((await call('/api/meetings', { method: 'POST', as: kid, body: { topic: 'あそびたい' } })).status, 403);
  assert.equal((await call('/api/games/tomojan/recommend', { method: 'PUT', as: kid, body: { comment: 'たのしい！' } })).status, 403);
  assert.equal((await call('/api/games/tomojan/recommend', { method: 'PUT', as: kid, body: { comment: '' } })).status, 200, 'おすすめだけならできる');

  // おうちの人とつながると、新しい投稿はみんなに見える（練習の投稿は、その子だけのまま）
  const mom = await signup('れんしゅうのおかあさん');
  const { code } = (await call('/api/guardian/code', { method: 'POST', as: mom })).data;
  await call('/api/guardian/join', { method: 'POST', as: kid, body: { code } });
  assert.equal((await call('/api/auth/me', { as: kid })).data.practice, false);
  const q = (await call('/api/posts', { method: 'POST', as: kid, body: { text: 'つながったよ！' } })).data;
  assert.equal(await visibleTo(adult, q.id), true);
  assert.equal(await visibleTo(adult, p.id), false, '練習の投稿は、つながったあとも本人だけ');
});

test('図書館：地図に建物・館長のカメと司書のネズミ・サンプルの小説3冊と漫画3冊', async () => {
  const index = await (await fetch(`${base}/`)).text();
  assert.match(index, /library-spot/);
  const page = await (await fetch(`${base}/library.html`)).text();
  assert.match(page, /data-quiet/, '図書館の中は、しずかに（キャラが話さない）');
  assert.ok(!/<textarea|<form/.test(page), '本のページに、おしゃべりの場所は置かない（感想はカフェで）');
  const agents = (await call('/api/agents')).data;
  assert.deepEqual(agents.filter((a) => a.place === 'library').map((a) => [a.name, a.roleLabel]),
    [['カメ', '図書館の館長'], ['ネズミ', '図書館の司書']]);
  assert.equal((await call('/api/posts')).data.some((p) => ['agent-kame', 'agent-nezumi'].includes(p.authorId)), false, '広場には出ない');

  const adult = await signup('図書館の大人');
  const lib = (await call('/api/library', { as: adult })).data;
  const count = (kind) => lib.books.filter((b) => b.kind === kind).length;
  assert.deepEqual([count('novel'), count('manga')], [3, 3]);
  assert.ok(lib.books.every((b) => b.sample && !('text' in b) && !('pages' in b)), '棚には本文を入れない');
  assert.ok(lib.books.every((b) => lib.genres.some((g) => g.id === b.genre)), 'ジャンルはカフェのテーブルと同じ');
  const novel = (await call('/api/library/books/sample-penlight', { as: adult })).data;
  assert.match(novel.text, /◆/);
  const manga = (await call('/api/library/books/sample-rainy-cafe', { as: adult })).data;
  assert.equal(manga.pages[0].panels.length, 4, '4コマ');
  assert.equal((await call('/api/library/books/nai-hon')).status, 404);
});

test('図書館：年齢の棚（だれでも／中高生から／大人だけ）。合わない本は棚にも出さず、読めない', async () => {
  const kid = await signup('図書館のこども', { birthdate: '2018-01-01' });
  const teen = await signup('図書館の中高生', { birthdate: '2011-01-01' });
  const shelf = async (who) => (await call('/api/library', who ? { as: who } : {})).data;
  const kidLib = await shelf(kid);
  assert.deepEqual(kidLib.shelves.map((s) => s.id), ['child']);
  assert.ok(kidLib.books.every((b) => b.minAge === 'child'));
  assert.deepEqual((await shelf(teen)).shelves.map((s) => s.id), ['child', 'teen']);
  assert.ok((await shelf(teen)).books.some((b) => b.minAge === 'teen'));
  assert.deepEqual((await shelf()).shelves.map((s) => s.id), ['child'], 'ログインしていない人は、こどもと同じ');
  assert.equal((await call('/api/library/books/sample-savepoint', { as: kid })).status, 403);
  assert.equal((await call('/api/library/books/sample-savepoint')).status, 403);
  assert.equal((await call('/api/library/books/sample-savepoint', { as: teen })).status, 200);
});

test('図書館：小説をきれいにまとめる（見出し・字下げ・会話・場面の間・ルビ）。HTML は入れられない', async () => {
  const { formatNovel } = await import('../../shared/library.js');
  const html = formatNovel(['◆ 一 はじまり', '朝が来た。', '「おはよう」', '', '|推《お》しの名前と、親指《おやゆび》。', '<script>alert(1)</script>'].join('\n'));
  assert.ok(html.includes('<h3>一 はじまり</h3>'));
  assert.ok(html.includes('<p>朝が来た。</p>'));
  assert.ok(html.includes('<p class="talk">「おはよう」</p>'));
  assert.ok(html.includes('<p class="scene"><ruby>推<rt>お</rt></ruby>しの名前と、<ruby>親指<rt>おやゆび</rt></ruby>。</p>'));
  assert.ok(!html.includes('<script>'), '書いた文字はそのまま文字として出す');
});

// ---- 図書館（2段目）：ユーザーが本を出す・ネズミのまとめた案・運営の手伝い ----
const PNG = (n = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, n)]);
async function putPage(who, bookId, body, { type = 'image/png', name = 'p.png' } = {}) {
  const res = await fetch(`${base}/api/library/books/${bookId}/pages`, {
    method: 'POST', headers: { Cookie: who.cookie, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) }, body,
  });
  return { status: res.status, data: await res.json() };
}

test('図書館：小説を書いて、同意して出すと棚に並ぶ。下書きは作者だけ', async () => {
  const author = await signup('図書館の作家');
  const reader = await signup('図書館の読者');
  const text = Array.from({ length: 3000 }, (_, i) => `${i}行め。とても長い小説。`).join('\n'); // 16KB をこえる長さ
  const made = await call('/api/library/books', { method: 'POST', as: author, body: {
    kind: 'novel', title: 'ながいお話', genre: 'anime', minAge: 'child', blurb: 'あらすじ', text,
  } });
  assert.equal(made.status, 200, made.data.error);
  const id = made.data.id;
  assert.equal(made.data.status, 'draft');
  assert.equal(made.data.tidy.nezumi, null, '頼んでいなければ、ネズミは案を出さない');
  assert.equal((await call(`/api/library/books/${id}`, { as: reader })).status, 404, '下書きは、ほかの人には見えない');
  assert.equal((await call(`/api/library/books/${id}`, { as: author })).status, 200, '作者は読める');

  assert.equal((await call(`/api/library/books/${id}/publish`, { method: 'POST', as: author, body: {} })).status, 400, '同意がないと出せない');
  const pub = await call(`/api/library/books/${id}/publish`, { method: 'POST', as: author, body: { consent: true } });
  assert.equal(pub.data.status, 'published');
  const shelf = (await call('/api/library', { as: reader })).data.books;
  const card = shelf.find((b) => b.id === id);
  assert.equal(card.author, '図書館の作家');
  assert.equal(card.sample, false);
  assert.ok(!('text' in card));
  assert.equal((await call(`/api/library/books/${id}`, { as: reader })).data.text, text);

  assert.equal((await call(`/api/library/books/${id}`, { method: 'PUT', as: reader, body: { title: 'のっとり' } })).status, 403, 'ほかの人は変えられない');
  await call(`/api/library/books/${id}/unpublish`, { method: 'POST', as: author });
  assert.ok(!(await call('/api/library', { as: reader })).data.books.some((b) => b.id === id), 'しまうと棚から消える');
  assert.equal((await call(`/api/library/books/${id}`, { method: 'DELETE', as: author })).data.ok, true);
});

test('図書館：自分の年齢で読めない棚には出せない。はっきりした犯罪の文は出せない', async () => {
  const kid = await signup('図書館のこども作家', { birthdate: '2018-01-01' });
  const base = { kind: 'novel', title: 'こどもの本', genre: 'other', text: 'むかしむかし。' };
  assert.equal((await call('/api/library/books', { method: 'POST', as: kid, body: { ...base, minAge: 'teen' } })).status, 403);
  assert.equal((await call('/api/library/books', { method: 'POST', as: kid, body: { ...base, minAge: 'child' } })).status, 200);
  const adult = await signup('図書館の作家');
  const bad = await call('/api/library/books', { method: 'POST', as: adult, body: { ...base, minAge: 'adult', text: '闇バイト募集、高収入、即日現金' } });
  assert.equal(bad.status, 422);
  assert.equal((await call('/api/library/books', { method: 'POST', body: { ...base, minAge: 'child' } })).status, 401, 'ログインが必要');
});

test('図書館：きれいにまとめる。ネズミの案（見た目・ルビ・誤字の印）を、作者が選んで使う', async () => {
  const author = await signup('図書館の作家');
  const made = (await call('/api/library/books', { method: 'POST', as: author, body: {
    kind: 'novel', title: 'まとめてほしい', genre: 'idol', minAge: 'child', tidyWanted: true,
    text: '第1章　はじまり\n　彼女は囁いた。「ほんとに!?うそ...」\n\n\n「ありがとう。」\nこんにちわ。綺麗な薔薇。',
  } })).data;
  const s = made.tidy.nezumi;
  assert.ok(s, 'ネズミがすぐに案を出す');
  assert.ok(s.text.startsWith('◆ 第1章　はじまり'));
  assert.ok(s.text.includes('「ほんとに！？　うそ……」'));
  assert.ok(s.text.includes('「ありがとう」'));
  assert.deepEqual(s.ruby.map((r) => r.kanji), ['囁', '綺麗', '薔薇']);
  assert.ok(s.typos.some((t) => t.snippet === 'こんにちわ'), '誤字は印だけ');
  assert.ok(made.text.includes('こんにちわ'), '作者が使うまで、本文はそのまま');

  const used = (await call(`/api/library/books/${made.id}/tidy`, { method: 'POST', as: author, body: { from: 'nezumi', ruby: ['囁'] } })).data;
  assert.ok(used.text.includes('|囁《ささや》いた'));
  assert.ok(!used.text.includes('|綺麗'), '選ばなかったルビはつけない');
  assert.ok(used.text.includes('こんにちわ'), '誤字は直さない（決めるのは作者）');
});

test('図書館：漫画のページ（画像だけ受け取る）・ネズミがページの順番をそろえる・年齢が合わない人には見せない', async () => {
  const author = await signup('図書館の漫画家', { birthdate: '2010-01-01' });
  const made = (await call('/api/library/books', { method: 'POST', as: author, body: {
    kind: 'manga', title: '中高生の漫画', genre: 'game', minAge: 'teen', tidyWanted: true,
  } })).data;
  for (const name of ['p10.png', 'p2.png', 'p1.png']) assert.equal((await putPage(author, made.id, PNG(name.length), { name })).status, 200);
  assert.equal((await putPage(author, made.id, Buffer.from('<html>'), { name: 'x.png' })).status, 415, 'PNG のふりをした文字は受け取らない');
  assert.equal((await putPage(author, made.id, Buffer.from('GIF89a'), { type: 'image/gif' })).status, 415);
  assert.equal((await putPage(author, made.id, Buffer.concat([PNG(), Buffer.alloc(MAX_TEST_PAGE)]))).status, 413, '大きすぎる画像');
  assert.equal(readdirSync(libraryDir).filter((f) => f.endsWith('.part')).length, 0, '途中のファイルは残さない');

  let mine = (await call('/api/library/mine', { as: author })).data.find((b) => b.id === made.id);
  assert.deepEqual(mine.pages.map((p) => p.name), ['p10.png', 'p2.png', 'p1.png']);
  assert.deepEqual(mine.tidy.nezumi.order, [2, 1, 0]);
  mine = (await call(`/api/library/books/${made.id}/tidy`, { method: 'POST', as: author, body: { from: 'nezumi' } })).data;
  assert.deepEqual(mine.pages.map((p) => p.name), ['p1.png', 'p2.png', 'p10.png']);
  assert.equal(mine.coverPage, 0);

  await call(`/api/library/books/${made.id}/publish`, { method: 'POST', as: author, body: { consent: true } });
  const img = await fetch(`${base}/api/library/books/${made.id}/pages/0`, { headers: { Cookie: (await signup('図書館の中高生', { birthdate: '2011-01-01' })).cookie } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  const kidGroup = await signup('図書館のこども', { birthdate: '2018-01-01' });
  assert.equal((await fetch(`${base}/api/library/books/${made.id}/pages/0`, { headers: { Cookie: kidGroup.cookie } })).status, 404, '年齢が合わない人には、画像も見せない');
  assert.equal((await call(`/api/library/books/${made.id}`, { as: kidGroup })).status, 403);
});

test('図書館：ネズミでむずかしいときは運営が手伝う（案だけ）。運営は取り下げられる', async () => {
  const author = await signup('図書館の作家');
  const admin = await signup('図書館の運営');
  store.getUser(admin.id).role = 'admin';
  const made = (await call('/api/library/books', { method: 'POST', as: author, body: {
    kind: 'novel', title: '手伝ってほしい', genre: 'sports', minAge: 'child', text: 'もとの本文。',
  } })).data;
  assert.equal((await call('/api/library/admin', { as: author })).status, 403);
  await call(`/api/library/books/${made.id}/help`, { method: 'POST', as: author, body: { note: '章の分け方を見てほしい' } });
  const list = (await call('/api/library/admin', { as: admin })).data.help;
  assert.ok(list.some((b) => b.id === made.id && b.tidy.help.note === '章の分け方を見てほしい'));
  await call(`/api/library/books/${made.id}/help-reply`, { method: 'POST', as: admin, body: { text: '◆ 一\nもとの本文。', note: '見出しをつけました' } });
  let mine = (await call('/api/library/mine', { as: author })).data.find((b) => b.id === made.id);
  assert.equal(mine.text, 'もとの本文。', '運営は本文を直接は変えない');
  assert.equal(mine.tidy.help.reply.note, '見出しをつけました');
  mine = (await call(`/api/library/books/${made.id}/tidy`, { method: 'POST', as: author, body: { from: 'admin' } })).data;
  assert.equal(mine.text, '◆ 一\nもとの本文。', '作者が使うと決めたら入る');

  await call(`/api/library/books/${made.id}/publish`, { method: 'POST', as: author, body: { consent: true } });
  assert.equal((await call(`/api/library/books/${made.id}/hide`, { method: 'POST', as: admin, body: {} })).status, 400, '理由が必要');
  await call(`/api/library/books/${made.id}/hide`, { method: 'POST', as: admin, body: { reason: '約束に合わない内容' } });
  assert.ok(!(await call('/api/library')).data.books.some((b) => b.id === made.id), '取り下げた本は棚から消える');
  const again = await call(`/api/library/books/${made.id}/publish`, { method: 'POST', as: author, body: { consent: true } });
  assert.equal(again.status, 403);
  assert.match(again.data.error, /約束に合わない内容/);
});

// ---- 図書館（3段目）：挿し絵・表紙の募集スレッド ----
async function putEntry(who, callId, body, { comment = '', consent = true, type = 'image/png' } = {}) {
  const res = await fetch(`${base}/api/library/calls/${callId}/entries`, {
    method: 'POST', body,
    headers: { Cookie: who.cookie, 'Content-Type': type, 'X-Comment': encodeURIComponent(comment), 'X-Consent': consent ? 'yes' : 'no' },
  });
  return { status: res.status, data: await res.json() };
}

test('図書館：表紙・挿し絵の募集 → 同意して応募 → 作者が選ぶと本に載り、描いた人の名前が出る', async () => {
  const author = await signup('募集する作家');
  const artist = await signup('絵を描く人');
  const other = await signup('もうひとりの絵描き');
  const book = (await call('/api/library/books', { method: 'POST', as: author, body: {
    kind: 'novel', title: '絵がほしい小説', genre: 'idol', minAge: 'child', text: '◆ 一\nはじまり。\n［挿絵1］\nおわり。',
  } })).data;

  assert.equal((await call(`/api/library/books/${book.id}/calls`, { method: 'POST', as: artist, body: { kind: 'cover', note: 'のっとり' } })).status, 403, '作者だけが募集できる');
  assert.equal((await call(`/api/library/books/${book.id}/calls`, { method: 'POST', as: author, body: { kind: 'cover', note: '' } })).status, 400, 'どんな絵がほしいかが必要');
  const cover = (await call(`/api/library/books/${book.id}/calls`, { method: 'POST', as: author, body: { kind: 'cover', note: '夜空の表紙' } })).data;
  const illust = (await call(`/api/library/books/${book.id}/calls`, { method: 'POST', as: author, body: { kind: 'illust', slot: 1, note: 'はじまりの場面' } })).data;
  assert.equal((await call(`/api/library/books/${book.id}/calls`, { method: 'POST', as: author, body: { kind: 'cover', note: 'もう一回' } })).status, 400, '同じ募集は2つ出せない');

  const board = (await call('/api/library/calls', { as: artist })).data;
  assert.ok(board.some((c) => c.id === cover.id && c.book.title === '絵がほしい小説'), '下書きの本の募集も掲示板に出る');

  assert.equal((await putEntry(artist, cover.id, PNG(1), { consent: false })).status, 400, '同意がないと応募できない');
  assert.equal((await putEntry(artist, cover.id, Buffer.from('<svg>'))).status, 415);
  const after = (await putEntry(artist, cover.id, PNG(1), { comment: '星をたくさん描きました' })).data;
  assert.equal(after.entries[0].name, '絵を描く人');
  assert.equal(after.entries[0].comment, '星をたくさん描きました');
  for (let i = 0; i < 3; i += 1) await putEntry(other, cover.id, PNG(2 + i));
  assert.equal((await putEntry(other, cover.id, PNG(9))).status, 400, '1人3枚まで');
  const ill = (await putEntry(artist, illust.id, PNG(7))).data;

  const entryId = after.entries[0].id;
  assert.equal((await call(`/api/library/calls/${cover.id}/adopt`, { method: 'POST', as: artist, body: { entryId } })).status, 403, '選ぶのは作者だけ');
  let mine = (await call(`/api/library/calls/${cover.id}/adopt`, { method: 'POST', as: author, body: { entryId } })).data;
  mine = (await call(`/api/library/calls/${illust.id}/adopt`, { method: 'POST', as: author, body: { entryId: ill.entries[0].id } })).data;
  assert.deepEqual(mine.credits, [{ role: '表紙', name: '絵を描く人' }, { role: '挿絵1', name: '絵を描く人' }]);
  assert.match(mine.coverImage, /\/art\/cover$/);
  assert.equal((await putEntry(other, cover.id, PNG(3))).status, 400, '選んだあとの募集には応募できない');
  assert.equal((await call(`/api/library/calls/${cover.id}/entries/${entryId}`, { method: 'DELETE', as: artist })).status, 400, '選ばれた絵は、描いた人だけでは取り下げられない');

  await call(`/api/library/books/${book.id}/publish`, { method: 'POST', as: author, body: { consent: true } });
  const read = (await call(`/api/library/books/${book.id}`, { as: other })).data;
  assert.equal(read.illust['1'], `/api/library/books/${book.id}/art/illust/1`);
  const img = await fetch(`${base}${read.coverImage}`, { headers: { Cookie: other.cookie } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  // 本を消すと、募集と絵もいっしょに消える
  await call(`/api/library/books/${book.id}`, { method: 'DELETE', as: author });
  assert.equal((await call(`/api/library/calls/${cover.id}`, { as: author })).status, 404);
  assert.equal(readdirSync(libraryDir).filter((f) => f.startsWith(cover.id) || f.startsWith(illust.id)).length, 0, '絵のファイルも残さない');
});

test('図書館：募集は年齢の棚が合う人にだけ見せる。小説の［挿絵1］に絵が入る', async () => {
  const teenAuthor = await signup('中高生の作家', { birthdate: '2010-01-01' });
  const kid = await signup('図書館のこども', { birthdate: '2018-01-01' });
  const book = (await call('/api/library/books', { method: 'POST', as: teenAuthor, body: { kind: 'manga', title: '中高生の募集', genre: 'game', minAge: 'teen' } })).data;
  assert.equal((await call(`/api/library/books/${book.id}/calls`, { method: 'POST', as: teenAuthor, body: { kind: 'illust', slot: 1, note: 'x' } })).status, 400, '挿し絵の募集は小説だけ');
  const c = (await call(`/api/library/books/${book.id}/calls`, { method: 'POST', as: teenAuthor, body: { kind: 'cover', note: '表紙をお願いします' } })).data;
  assert.ok(!(await call('/api/library/calls', { as: kid })).data.some((x) => x.id === c.id), 'こどもには中高生の本の募集を見せない');
  assert.equal((await putEntry(kid, c.id, PNG())).status, 404);

  const { formatNovel } = await import('../../shared/library.js');
  const html = formatNovel('はじめ。\n［挿絵１］\n[挿絵2]', { illust: { 1: '/api/library/books/b_x/art/illust/1' } });
  assert.ok(html.includes('<figure class="illust"><img src="/api/library/books/b_x/art/illust/1" alt="挿絵1"'));
  assert.ok(!html.includes('挿絵2'), 'まだ絵のない挿し絵は、読む人には出さない');
  assert.ok(formatNovel('[挿絵2]', { showEmpty: true }).includes('まだ絵がありません'), '作者には、まだ絵がないことを見せる');
  assert.ok(!formatNovel('［挿絵1］', { illust: { 1: 'javascript:alert(1)' } }).includes('javascript'), 'へんなアドレスは入れない');
});

// ---- 図書館 × ベータ版の準備（練習モード・退会） ----
test('図書館：練習モードの子どもは、下書きとネズミの案は使えるが、棚に出す・募集・応募はおうちの人とつながってから', async () => {
  const kid = await signup('図書館の練習の子', { birthdate: '2018-04-01' });
  const made = await call('/api/library/books', { method: 'POST', as: kid, body: {
    kind: 'novel', title: 'はじめてのお話', genre: 'other', minAge: 'child', tidyWanted: true, text: 'こんにちわ。ねこがいた...',
  } });
  assert.equal(made.status, 200, '下書きは書ける');
  assert.ok(made.data.tidy.nezumi, 'ネズミの案も出る');
  const pub = await call(`/api/library/books/${made.data.id}/publish`, { method: 'POST', as: kid, body: { consent: true } });
  assert.equal(pub.status, 403);
  assert.match(pub.data.error, /おうちの人とつながったら/);
  assert.equal((await call(`/api/library/books/${made.data.id}/calls`, { method: 'POST', as: kid, body: { kind: 'cover', note: '表紙がほしい' } })).status, 403);

  const author = await signup('図書館の作家');
  const book = (await call('/api/library/books', { method: 'POST', as: author, body: { kind: 'novel', title: 'こども向けの募集', genre: 'other', minAge: 'child', text: 'はじまり' } })).data;
  const c = (await call(`/api/library/books/${book.id}/calls`, { method: 'POST', as: author, body: { kind: 'cover', note: 'だれでも描いてね' } })).data;
  assert.equal((await putEntry(kid, c.id, PNG())).status, 403, '練習モードでは応募できない');
});

test('図書館：退会して7日たつと、その人の本・募集・応募した絵・ほかの本に載った絵も消える', async () => {
  const leaver = await signup('図書館から退会する人');
  const author = await signup('図書館に残る作家');
  const mine = (await call('/api/library/books', { method: 'POST', as: leaver, body: { kind: 'manga', title: '消える漫画', genre: 'game', minAge: 'child' } })).data;
  await putPage(leaver, mine.id, PNG(5), { name: 'p1.png' });
  await call(`/api/library/books/${mine.id}/publish`, { method: 'POST', as: leaver, body: { consent: true } });
  const book = (await call('/api/library/books', { method: 'POST', as: author, body: { kind: 'novel', title: '残る小説', genre: 'idol', minAge: 'child', text: 'はじまり' } })).data;
  const c = (await call(`/api/library/books/${book.id}/calls`, { method: 'POST', as: author, body: { kind: 'cover', note: '表紙をお願い' } })).data;
  const entry = (await putEntry(leaver, c.id, PNG(6))).data.entries[0];
  await call(`/api/library/calls/${c.id}/adopt`, { method: 'POST', as: author, body: { entryId: entry.id } });
  const before = readdirSync(libraryDir).length;

  await call('/api/auth/leave', { method: 'POST', as: leaver, body: { password: leaver.password, farewell: 'ありがとう' } });
  await app.purgeLeavers(Date.now() + 7 * DAY + 1000);

  assert.ok(!(await call('/api/library')).data.books.some((b) => b.id === mine.id), '書いた本は消える');
  const kept = (await call('/api/library/mine', { as: author })).data.find((b) => b.id === book.id);
  assert.ok(kept, 'ほかの人の本は残る');
  assert.equal(kept.art.cover, null, 'ほかの本に載った絵も外れる');
  assert.deepEqual(kept.credits, []);
  assert.equal(kept.calls[0].entries.length, 0, '応募した絵も消える');
  assert.equal(readdirSync(libraryDir).length, before - 2, '漫画のページと応募の絵のファイルも消える');
});

// ---- 🔔 お知らせ（ハトの郵便屋さん）：図書館・おうちの人・目安箱 ----
test('お知らせ：図書館の応募・絵が選ばれた・運営の返事・取り下げが、本人に届く。読んだしるしをつけられる', async () => {
  const author = await signup('お知らせを受ける作家');
  const artist = await signup('お知らせを受ける絵描き');
  const admin = await signup('お知らせの運営');
  store.getUser(admin.id).role = 'admin';
  const notices = async (who) => (await call('/api/notices', { as: who })).data;
  assert.equal((await call('/api/notices')).status, 401, 'ログインが必要');
  const start = (await notices(author)).items.length;

  const book = (await call('/api/library/books', { method: 'POST', as: author, body: { kind: 'novel', title: 'ハトの本', genre: 'other', minAge: 'child', text: 'はじまり' } })).data;
  const c = (await call(`/api/library/books/${book.id}/calls`, { method: 'POST', as: author, body: { kind: 'cover', note: '表紙をお願い' } })).data;
  const entry = (await putEntry(artist, c.id, PNG(3))).data.entries[0];
  let a = await notices(author);
  assert.equal(a.items.length, start + 1);
  assert.match(a.items[0].text, /「ハトの本」の表紙の募集に、お知らせを受ける絵描きさんが応募してくれたよ/);
  assert.equal(a.items[0].link, `/library-write.html?book=${book.id}`);
  assert.ok(a.unread >= 1);

  await call(`/api/library/calls/${c.id}/adopt`, { method: 'POST', as: author, body: { entryId: entry.id } });
  assert.match((await notices(artist)).items[0].text, /あなたの絵が「ハトの本」の表紙に選ばれたよ/);

  await call(`/api/library/books/${book.id}/help`, { method: 'POST', as: author, body: { note: '見てほしい' } });
  await call(`/api/library/books/${book.id}/help-reply`, { method: 'POST', as: admin, body: { note: 'いいと思います' } });
  await call(`/api/library/books/${book.id}/publish`, { method: 'POST', as: author, body: { consent: true } });
  await call(`/api/library/books/${book.id}/hide`, { method: 'POST', as: admin, body: { reason: 'ためしの取り下げ' } });
  a = await notices(author);
  assert.match(a.items[0].text, /運営が棚から取り下げたよ（理由：ためしの取り下げ）/);
  assert.match(a.items[1].text, /運営から返事がきたよ/);

  // 読んだしるし：1つだけ → ぜんぶ
  const before = a.unread;
  await call('/api/notices/read', { method: 'POST', as: author, body: { ids: [a.items[0].id] } });
  assert.equal((await notices(author)).unread, before - 1);
  await call('/api/notices/read', { method: 'POST', as: author, body: {} });
  assert.equal((await notices(author)).unread, 0);
  assert.equal((await notices(artist)).items.some((n) => n.text.includes('取り下げ')), false, 'ほかの人のお知らせは見えない');
});

test('お知らせ：おうちの人とつながった・目安箱の声が新聞にのった。ハトはお知らせのページにだけいる', async () => {
  const guardian = await signup('お知らせのおうちの人');
  const kid = await signup('お知らせの子', { birthdate: '2018-06-01' });
  const { code } = (await call('/api/guardian/code', { method: 'POST', as: guardian })).data;
  assert.equal((await call('/api/guardian/join', { method: 'POST', as: kid, body: { code } })).status, 200);
  assert.match((await call('/api/notices', { as: kid })).data.items[0].text, /お知らせのおうちの人さんと、おうちの人としてつながったよ/);
  assert.match((await call('/api/notices', { as: guardian })).data.items[0].text, /お知らせの子さんと、おうちの人としてつながったよ/);

  const writer = await signup('目安箱に書いた人');
  const admin = await signup('お知らせの運営');
  store.getUser(admin.id).role = 'admin';
  const s = store.addSuggestion(writer.id, { topic: 'cafe', text: 'カフェにテーブルを足してほしい' });
  store.pickSuggestion(s.id, { summary: 'テーブルを足してほしい', answer: 'ジャンルのリクエストからどうぞ' });
  const n = (await call('/api/notices', { as: writer })).data.items[0];
  assert.match(n.text, /新聞の「目安箱から」にのったよ/);
  assert.equal(n.link, '/news.html');

  const agents = (await call('/api/agents')).data;
  assert.deepEqual(agents.filter((x) => x.place === 'post').map((x) => [x.name, x.roleLabel]), [['ハト', 'お知らせの郵便屋さん']]);
  assert.equal((await call('/api/posts')).data.some((p) => p.authorId === 'agent-hato'), false, '広場には出ない');
  const page = await (await fetch(`${base}/notices.html`)).text();
  assert.match(page, /hato\.svg/);
});

// ---- ベータ版の🟡：ログイン中にパスワードを変える ----
test('パスワードを変える：いまのパスワードを確かめる・ほかの端末のログインは切れて、この端末は続けて使える', async () => {
  const user = await signup('パスワードを変える人');
  // もう1台の端末でもログインしておく
  const other = await call('/api/auth/login', { method: 'POST', body: { loginId: user.loginId, password: user.password } });
  const otherCookie = other.res.headers.get('set-cookie').split(';')[0];

  assert.equal((await call('/api/auth/password', { method: 'POST', body: { current: 'x', next: 'new-password-1' } })).status, 401, 'ログインが必要');
  const wrong = await call('/api/auth/password', { method: 'POST', as: user, body: { current: 'ちがうパスワード', next: 'new-password-1' } });
  assert.equal(wrong.status, 401);
  assert.equal((await call('/api/auth/password', { method: 'POST', as: user, body: { current: user.password, next: 'short' } })).status, 400, '8文字から');
  assert.equal((await call('/api/auth/password', { method: 'POST', as: user, body: { current: user.password, next: user.password } })).status, 400, '同じものにはできない');

  const ok = await call('/api/auth/password', { method: 'POST', as: user, body: { current: user.password, next: 'new-password-1' } });
  assert.equal(ok.status, 200);
  const newCookie = ok.res.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/auth/me', { as: { cookie: newCookie } })).data.name, 'パスワードを変える人', 'この端末は続けて使える');
  assert.equal((await call('/api/auth/me', { as: { cookie: otherCookie } })).data, null, 'ほかの端末のログインは切れる');
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { loginId: user.loginId, password: user.password } })).status, 401, '前のパスワードでは入れない');
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { loginId: user.loginId, password: 'new-password-1' } })).status, 200, '新しいパスワードで入れる');
  people.set('パスワードを変える人', { ...user, cookie: newCookie, password: 'new-password-1' });

  // まちがいが続くと、しばらく止まる
  const t = await signup('パスワードをまちがえる人');
  let last;
  for (let i = 0; i < 6; i += 1) last = await call('/api/auth/password', { method: 'POST', as: t, body: { current: 'ちがう', next: 'new-password-2' } });
  assert.equal(last.status, 429);
});

// ---- ベータ版の🟡：プロフィール ----
test('プロフィール：ひとこと・推し・図書館の本・最近の投稿。生年月日は出さない。子どもは名前だけ', async () => {
  const fan = await signup('プロフィールの人');
  const viewer = await signup('プロフィールを見る人');
  await call(`/api/users/${fan.id}/oshi`, { method: 'PUT', as: fan, body: { name: 'ほしのアイ', genre: 'idol' } });
  assert.equal((await call('/api/profile/bio', { method: 'POST', as: fan, body: { bio: 'あ'.repeat(61) } })).status, 400, '60文字まで');
  assert.equal((await call('/api/profile/bio', { method: 'POST', as: fan, body: { bio: 'ライブの話をしたいです' } })).status, 200);
  await call('/api/posts', { method: 'POST', as: fan, body: { text: 'プロフィールのための投稿' } });
  const book = (await call('/api/library/books', { method: 'POST', as: fan, body: { kind: 'novel', title: 'プロフィールの本', genre: 'idol', minAge: 'teen', text: 'はじまり' } })).data;
  await call(`/api/library/books/${book.id}/publish`, { method: 'POST', as: fan, body: { consent: true } });

  const p = (await call(`/api/users/${fan.id}/profile`, { as: viewer })).data;
  assert.equal(p.bio, 'ライブの話をしたいです');
  assert.deepEqual(p.oshi, { name: 'ほしのアイ', genre: 'idol' });
  assert.ok(p.posts.some((x) => x.text === 'プロフィールのための投稿'));
  assert.deepEqual(p.books.map((b) => b.title), ['プロフィールの本']);
  assert.ok(!JSON.stringify(p).includes('1990'), '生年月日は出さない');
  assert.equal(p.self, false);
  assert.deepEqual((await call(`/api/users/${fan.id}/profile`)).data.books, [], 'ログインしていない人には、中高生からの本は出さない');

  // 子どもは、ほかの人には名前だけ。本人とおうちの人には見える
  const guardian = await signup('プロフィールのおうちの人');
  const kid = await signup('プロフィールの子', { birthdate: '2018-02-02' });
  await call('/api/profile/bio', { method: 'POST', as: kid, body: { bio: 'ねこがすき' } });
  const { code } = (await call('/api/guardian/code', { method: 'POST', as: guardian })).data;
  await call('/api/guardian/join', { method: 'POST', as: kid, body: { code } });
  const other = (await call(`/api/users/${kid.id}/profile`, { as: viewer })).data;
  assert.deepEqual(other, { id: kid.id, name: 'プロフィールの子', self: false, limited: true });
  assert.equal((await call(`/api/users/${kid.id}/profile`, { as: guardian })).data.bio, 'ねこがすき', 'おうちの人には見える');
  assert.equal((await call(`/api/users/${kid.id}/profile`, { as: kid })).data.self, true);

  // ブロックされている人には見せない。キャラはプロフィールなし
  await call(`/api/blocks/${viewer.id}`, { method: 'PUT', as: fan, body: { kind: 'block' } });
  assert.equal((await call(`/api/users/${fan.id}/profile`, { as: viewer })).status, 404);
  assert.equal((await call('/api/users/agent-shiba/profile')).status, 404);
});

// ---- ベータ版の🟡：さがす（投稿・図書館の本・人・#タグ） ----
test('さがす：投稿・本・人・#タグ。見てよいものだけ（ブロック・練習モード・年齢の棚・子どもの名前）', async () => {
  const writer = await signup('さがされる書き手');
  const seeker = await signup('さがす人');
  const kid = await signup('さがされる子', { birthdate: '2018-03-03' });
  await call('/api/posts', { method: 'POST', as: writer, body: { text: 'きのうのライブ、ペンライトが最高だった #ライブ #推し活' } });
  await call('/api/posts', { method: 'POST', as: kid, body: { text: 'ペンライトのれんしゅう（練習モード）' } });
  const book = (await call('/api/library/books', { method: 'POST', as: writer, body: { kind: 'novel', title: 'ペンライトの夜', genre: 'idol', minAge: 'teen', text: 'はじまり' } })).data;
  await call(`/api/library/books/${book.id}/publish`, { method: 'POST', as: writer, body: { consent: true } });

  const r = (await call(`/api/search?q=${encodeURIComponent('ぺんらいと')}`, { as: seeker })).data;
  assert.ok(r.posts.some((p) => p.text.includes('ライブ、ペンライト')), 'カタカナ／ひらがなのちがいは気にしない');
  assert.ok(!r.posts.some((p) => p.text.includes('れんしゅう')), '練習モードの投稿は出ない');
  assert.ok(r.books.some((b) => b.title === 'ペンライトの夜'));
  assert.ok(r.books.some((b) => b.title === 'はじめてのペンライト' && b.sample), 'サンプルの本も');
  assert.deepEqual((await call(`/api/search?q=${encodeURIComponent('ペンライトの夜')}`)).data.books, [], 'ログインしていない人には、中高生からの本は出さない');

  const people = (await call(`/api/search?q=${encodeURIComponent('さがされる')}`, { as: seeker })).data.people.map((u) => u.name);
  assert.ok(people.includes('さがされる書き手'));
  assert.ok(!people.includes('さがされる子'), '子どもの名前は出さない');

  const tag = (await call(`/api/search?q=${encodeURIComponent('#ライブ')}`, { as: seeker })).data;
  assert.equal(tag.tag, 'らいぶ');
  assert.ok(tag.posts.some((p) => p.text.includes('#ライブ')));
  assert.equal((await call(`/api/search?q=${encodeURIComponent('#ライ')}`, { as: seeker })).data.posts.length, 0, 'タグはぴったり同じものだけ');

  await call(`/api/blocks/${writer.id}`, { method: 'PUT', as: seeker, body: { kind: 'block' } });
  const after = (await call(`/api/search?q=${encodeURIComponent('ペンライト')}`, { as: seeker })).data;
  assert.ok(!after.posts.some((p) => p.authorId === writer.id), 'ブロックした人の投稿は出ない');
  assert.equal((await call(`/api/search?q=${'あ'.repeat(31)}`)).status, 400, '30文字まで');

  const { linkifyTags, tagsOf } = await import('../../shared/search.js');
  assert.deepEqual(tagsOf('たのしい #ライブ！ #推し活、また'), ['らいぶ', '推し活']);
  assert.ok(linkifyTags('&lt;b&gt; #ライブ').includes('<a class="tag-link" href="/search.html?q=%23%E3%83%A9%E3%82%A4%E3%83%96">#ライブ</a>'));
});

// ---- ✉️ 招待状（クローズドβ）：招待コード＋人数の上限 ----
test('招待状：モードがオフならだれでも登録できる。オンにすると招待コードが要り、上限の人数まで', async () => {
  // テストのデータには運営がいないことがあるので、運営を用意する
  const admin = await signup('招待状の運営');
  store.getUser(admin.id).role = 'admin';
  const reg = (loginId, name, extra = {}) => call('/api/auth/register', { method: 'POST', body: { loginId, password: 'invite-pass-2026', name, birthdate: '1995-05-05', agreeTerms: true, ...extra } });

  assert.deepEqual((await call('/api/invites/status')).data, { on: false, full: false });
  assert.equal((await call('/api/invites', { method: 'POST', as: admin })).status, 403, 'オフのときは出さない');
  assert.equal((await call('/api/invites/settings', { method: 'PUT', as: (await signup('招待状のふつうの人')), body: { on: true } })).status, 403, '切りかえは運営だけ');

  // いまの人数 + 2人 を上限にして、オンにする
  const now = (await call('/api/invites', { as: admin })).data.members;
  const s = (await call('/api/invites/settings', { method: 'PUT', as: admin, body: { on: true, limit: now + 2 } })).data;
  assert.equal(s.on, true);
  try {
    assert.equal((await reg('inv_nocode', '招待なしの人')).status, 400, '招待コードが要る');
    assert.equal((await reg('inv_badcode', 'まちがいコードの人', { inviteCode: 'XXXX-XXXX' })).status, 403);

    const first = (await call('/api/invites', { method: 'POST', as: admin })).data;
    assert.match(first.code, /\S{4,}/, 'コードはこのときだけ見せる');
    const a = await reg('inv_a', '招待で来た人A', { inviteCode: first.code });
    assert.equal(a.status, 200);
    assert.equal((await reg('inv_again', 'もう一回使う人', { inviteCode: first.code })).status, 403, '1回だけ');
    const n = (await call('/api/notices', { as: admin })).data.items[0];
    assert.match(n.text, /あなたの招待状で、招待で来た人Aさんが ともはね に来たよ/);

    // 入った人は1人1枚
    const aCookie = a.res.headers.get('set-cookie').split(';')[0];
    const asA = { cookie: aCookie };
    const fromA = await call('/api/invites', { method: 'POST', as: asA });
    assert.equal(fromA.status, 200);
    assert.equal((await call('/api/invites', { method: 'POST', as: asA })).status, 403, '1人1枚まで');
    assert.equal((await call('/api/invites', { method: 'POST', as: admin })).status, 403, '席がいっぱい（使われていない招待状もふくめて）');
    const b = await reg('inv_b', '招待で来た人B', { inviteCode: fromA.data.code });
    assert.equal(b.status, 200);
    assert.deepEqual((await call('/api/invites/status')).data, { on: true, full: true });
    assert.equal((await reg('inv_c', 'いっぱいのときの人', { inviteCode: 'XXXX-XXXX' })).status, 403, '上限の人数になったら登録できない');

    // 子どもは招待状を出せない（でも人数には数える）
    const summary = (await call('/api/invites', { as: admin })).data;
    assert.equal(summary.seatsLeft, 0);
  } finally {
    await call('/api/invites/settings', { method: 'PUT', as: admin, body: { on: false, limit: 50 } });
  }
  assert.equal((await reg('inv_open', 'オフにもどしたあとの人')).status, 200, 'オフにもどすと、また登録できる');
});

test('招待状：子ども（12歳まで）は出せない・出した招待状は取り消せる', async () => {
  const admin = await signup('招待状の運営');
  store.getUser(admin.id).role = 'admin';
  const kid = await signup('招待状の子', { birthdate: '2017-07-07' });
  await call('/api/invites/settings', { method: 'PUT', as: admin, body: { on: true, limit: 500 } });
  try {
    const r = await call('/api/invites', { method: 'POST', as: kid });
    assert.equal(r.status, 403);
    assert.match(r.data.error, /13歳から/);
    const inv = (await call('/api/invites', { method: 'POST', as: admin })).data;
    assert.equal((await call(`/api/invites/${inv.id}`, { method: 'DELETE', as: admin })).data.ok, true);
    const gone = await call('/api/auth/register', { method: 'POST', body: { loginId: 'inv_cancel', password: 'pw-cancel-12345', name: '取り消されたコードの人', birthdate: '1995-05-05', agreeTerms: true, inviteCode: inv.code } });
    assert.equal(gone.status, 403, '取り消した招待状は使えない');
  } finally {
    await call('/api/invites/settings', { method: 'PUT', as: admin, body: { on: false, limit: 50 } });
  }
});

// ---- 💝 応援（寄付）：新聞社の募金箱 ----
test('寄付：振込先は大人だけに見せる・1円から1,000円まで・運営が確かめたらお礼と領収書', async () => {
  const admin = await signup('寄付の運営');
  store.getUser(admin.id).role = 'admin';
  const adult = await signup('寄付する大人');
  const other = await signup('寄付を見る大人');
  const teen = await signup('寄付の中高生', { birthdate: '2011-04-04' });
  const kid = await signup('寄付の子', { birthdate: '2018-08-08' });

  // はじめはお休み
  assert.equal((await call('/api/donations')).data.on, false);
  assert.equal((await call('/api/donations', { method: 'POST', as: adult, body: { amount: 100, payerName: 'キフ スル' } })).status, 403);
  // 切りかえは運営だけ。振込先と発行者がないとオンにできない
  assert.equal((await call('/api/donations/settings', { method: 'PUT', as: adult, body: { on: true } })).status, 403);
  assert.equal((await call('/api/donations/settings', { method: 'PUT', as: admin, body: { on: true } })).status, 400);
  assert.equal((await call('/api/donations/settings', { method: 'PUT', as: admin, body: { supportUrl: 'http://example.com' } })).status, 400, 'https だけ');
  const set = await call('/api/donations/settings', { method: 'PUT', as: admin, body: { on: true, account: 'ゆうちょ銀行（テスト）', issuer: 'ともはね 運営' } });
  assert.equal(set.status, 200);
  try {
    // 振込先が見えるのは、ログインした大人だけ
    assert.equal((await call('/api/donations')).data.account, undefined, 'ログインしていない人には出さない');
    assert.equal((await call('/api/donations', { as: adult })).data.account, 'ゆうちょ銀行（テスト）');
    const t = (await call('/api/donations', { as: teen })).data;
    assert.equal(t.account, '');
    assert.match(t.reason, /おうちの人/);
    assert.equal((await call('/api/donations', { as: kid })).data.account, '');
    assert.equal((await call('/api/donations', { method: 'POST', as: teen, body: { amount: 100, payerName: 'チュウコウセイ' } })).status, 403);
    assert.equal((await call('/api/donations', { method: 'POST', as: kid, body: { amount: 1, payerName: 'コドモ' } })).status, 403);

    // 金額は1円から1,000円まで（1円単位）
    for (const amount of [0, 1001, 1.5, '十円']) {
      assert.equal((await call('/api/donations', { method: 'POST', as: adult, body: { amount, payerName: 'キフ スル' } })).status, 400, String(amount));
    }
    assert.equal((await call('/api/donations', { method: 'POST', as: adult, body: { amount: 10 } })).status, 400, '振込のお名前が要る');
    const one = await call('/api/donations', { method: 'POST', as: adult, body: { amount: 1, payerName: 'キフ スル', showName: true } });
    assert.equal(one.status, 200);
    assert.equal(one.data.status, 'pending');
    const big = await call('/api/donations', { method: 'POST', as: adult, body: { amount: 1000, payerName: 'キフ スル' } });
    assert.equal(big.status, 200);

    // 確かめる前は領収書が出ない。確かめは運営だけ
    assert.equal((await call(`/api/donations/${one.data.id}/receipt`, { as: adult })).status, 400);
    assert.equal((await call(`/api/donations/${one.data.id}/confirm`, { method: 'POST', as: adult })).status, 403);
    assert.equal((await call('/api/donations/admin', { as: adult })).status, 403);
    const ok = await call(`/api/donations/${one.data.id}/confirm`, { method: 'POST', as: admin });
    assert.equal(ok.data.status, 'confirmed');
    assert.match(ok.data.receiptNo, /^TH-\d{4}-\d{4}$/);

    // ハトがお礼を届ける（金額は書かない）
    const n = (await call('/api/notices', { as: adult })).data.items[0];
    assert.equal(n.kind, 'donation');
    assert.match(n.text, /ありがとう/);
    assert.doesNotMatch(n.text, /円/);
    assert.equal((await call('/api/donations', { as: adult })).data.thanked, true);

    // 領収書は本人と運営だけ
    const r = (await call(`/api/donations/${one.data.id}/receipt`, { as: adult })).data;
    assert.equal(r.amount, 1);
    assert.equal(r.issuer, 'ともはね 運営');
    assert.match(r.purpose, /寄付/);
    assert.equal((await call(`/api/donations/${one.data.id}/receipt`, { as: other })).status, 404);
    assert.equal((await call(`/api/donations/${one.data.id}/receipt`, { as: admin })).status, 200);

    // 新聞にのせるのは、のせたい人の名前だけ（金額は出さない）
    const pub = (await call('/api/donations')).data.supporters;
    assert.ok(pub.names.includes('寄付する大人'));
    assert.equal(JSON.stringify(pub).includes('1000'), false);

    // 通帳で見つからなかったとき・まちがえて押したとき
    const no = await call(`/api/donations/${big.data.id}/cancel`, { method: 'POST', as: admin });
    assert.equal(no.data.status, 'cancelled');
    const oops = await call('/api/donations', { method: 'POST', as: adult, body: { amount: 50, payerName: 'キフ スル' } });
    assert.equal((await call(`/api/donations/${oops.data.id}`, { method: 'DELETE', as: other })).status, 404, 'ほかの人は取り消せない');
    assert.equal((await call(`/api/donations/${oops.data.id}`, { method: 'DELETE', as: adult })).data.ok, true);
    assert.equal((await call(`/api/donations/${one.data.id}`, { method: 'DELETE', as: adult })).status, 400, '確かめたものは取り消せない');

    // 運営の帳簿：月ごとの合計
    const books = (await call('/api/donations/admin', { as: admin })).data;
    assert.ok(books.months[0].total >= 1);
    assert.ok(books.items.some((x) => x.payerName === 'キフ スル'));
  } finally {
    await call('/api/donations/settings', { method: 'PUT', as: admin, body: { on: false } });
  }
});
