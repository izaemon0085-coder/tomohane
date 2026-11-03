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
let base;
let store;
let sim;
let videoDir;
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
  const kokotomo = createKokotomoClient({ baseUrl: 'http://localhost:3100', fetchImpl: fakeKokotomoFetch });
  server = http.createServer(createApp({ store, sim, videoDir, maxVideoBytes: MAX_TEST_VIDEO, kokotomo }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(videoDir, { recursive: true, force: true });
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
  const r = await call('/api/auth/register', { method: 'POST', body: { loginId: `user${seq}`, password: `pass-word-${seq}`, name, birthdate } });
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
  assert.equal((await call('/api/auth/register', { method: 'POST', body: { loginId: 'neko1', password: 'password-123', name: 'ヤマネコ', birthdate: '2000-01-01' } })).status, 409, 'キャラの名前は使えない');
  assert.equal((await call('/api/nothing')).status, 404);
});

test('サイドフロント：エージェントの家とノック', async () => {
  const { data: agents } = await call('/api/agents');
  assert.equal(agents.length, 6);
  assert.deepEqual(agents.map((a) => a.name), ['ヤマネコ', 'ウサギ', 'フクロウ', 'シバ', 'クルマ', 'モグ']);
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
  assert.equal(loaded.listAgents().length, 6);
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

  const reg = await call('/api/auth/register', { method: 'POST', body: { loginId: 'cookie_check', password: 'long-password', name: 'クッキー', birthdate: '1990-01-01' } });
  assert.match(reg.res.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/, 'JavaScript から読めないクッキー');

  await call('/api/auth/logout', { method: 'POST', as: me });
  assert.equal((await call('/api/auth/me', { as: me })).data, null, 'ログアウトしたら、そのしるしは使えない');
  const again = await call('/api/auth/login', { method: 'POST', body: { loginId: me.loginId, password: me.password } });
  assert.equal(again.status, 200);
  assert.equal(again.data.me.id, me.id);
});

test('ログイン：入力チェック', async () => {
  const reg = (body) => call('/api/auth/register', { method: 'POST', body: { loginId: 'check_user', password: 'password-ok', name: 'チェック登録', birthdate: '1990-01-01', ...body } });
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
