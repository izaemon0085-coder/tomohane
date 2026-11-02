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

let server;
let base;
let store;
let sim;
let videoDir;
const MAX_TEST_VIDEO = 1024;

before(async () => {
  store = createStore();
  sim = createSimulation(store, {
    random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'],
  });
  videoDir = mkdtempSync(join(tmpdir(), 'letters-'));
  server = http.createServer(createApp({ store, sim, videoDir, maxVideoBytes: MAX_TEST_VIDEO }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(videoDir, { recursive: true, force: true });
});

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
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
  const { status, data: me } = await call('/api/users', { method: 'POST', body: { name: 'テスター' } });
  assert.equal(status, 201);
  const again = await call('/api/users', { method: 'POST', body: { name: 'テスター' } });
  assert.equal(again.data.id, me.id, '同じ名前なら同じユーザー');

  const created = await call('/api/posts', { method: 'POST', body: { authorId: me.id, text: 'おはよう！' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.author.name, 'テスター');

  const liked = await call(`/api/posts/${created.data.id}/like`, { method: 'POST', body: { userId: me.id } });
  assert.equal(liked.data.likeCount, 1);
  const unliked = await call(`/api/posts/${created.data.id}/like`, { method: 'POST', body: { userId: me.id } });
  assert.equal(unliked.data.likeCount, 0);

  const reply = await call('/api/posts', { method: 'POST', body: { authorId: me.id, text: '返信です', replyTo: created.data.id } });
  assert.equal(reply.data.replyTo, created.data.id);

  const { data: posts } = await call('/api/posts');
  assert.ok(posts.some((p) => p.id === created.data.id));
});

test('入力チェック', async () => {
  const { data: me } = await call('/api/users', { method: 'POST', body: { name: 'チェック' } });
  assert.equal((await call('/api/posts', { method: 'POST', body: { authorId: me.id, text: '   ' } })).status, 400);
  assert.equal((await call('/api/posts', { method: 'POST', body: { authorId: me.id, text: 'あ'.repeat(281) } })).status, 400);
  assert.equal((await call('/api/posts', { method: 'POST', body: { authorId: 'nobody', text: 'hi' } })).status, 404);
  assert.equal((await call('/api/users', { method: 'POST', body: { name: 'ヤマネコ' } })).status, 409);
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
  const { data: me } = await call('/api/users', { method: 'POST', body: { name: '議長' } });
  const { status, data: meeting } = await call('/api/meetings', { method: 'POST', body: { topic: '新機能', createdBy: me.id } });
  assert.equal(status, 201);
  assert.equal((await call('/api/meetings', { method: 'POST', body: { topic: '別の議題' } })).status, 409, '同時に1つまで');

  const { data: agents } = await call('/api/agents');
  assert.ok(agents.filter((a) => a.place === 'house').every((a) => a.status === 'meeting'), '家のキャラ全員が会議室へ移動');
  assert.ok(!meeting.participantIds.includes('agent-mogu'), 'モグは金庫で回線の見張りを続ける');
  assert.notEqual(agents.find((a) => a.role === 'car').status, 'meeting', '車はガレージで留守番');
  assert.ok(!meeting.participantIds.includes('agent-kuruma'));

  await call(`/api/meetings/${meeting.id}/step`, { method: 'POST' });
  await call(`/api/meetings/${meeting.id}/messages`, { method: 'POST', body: { authorId: me.id, text: 'スマホ対応を優先したい' } });
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
  const { data: me } = await call('/api/users', { method: 'POST', body: { name: 'しんじん' } });
  const { data: first } = await call('/api/posts', { method: 'POST', body: { authorId: me.id, text: 'よろしくお願いします' } });
  const r1 = sim.respondToHumanPost(store.getPost(first.id));
  assert.equal(r1.authorId, 'agent-shiba');
  assert.match(r1.text, /はじめまして/);

  store.updateAgent('agent-fukurou', { status: 'sleeping' });
  const { data: harsh } = await call('/api/posts', { method: 'POST', body: { authorId: me.id, text: 'あいつほんとうざい' } });
  const r2 = sim.respondToHumanPost(store.getPost(harsh.id));
  assert.equal(r2.authorId, 'agent-fukurou', '寝ていても見守り番が起きて返事をする');
  assert.match(r2.text, /トゲ/);

  const { data: lonely } = await call('/api/posts', { method: 'POST', body: { authorId: me.id, text: '今日はちょっとさみしい' } });
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
  const { data: a } = await call('/api/users', { method: 'POST', body: { name: '推し活A' } });
  const { data: b } = await call('/api/users', { method: 'POST', body: { name: '推し活B' } });

  const empty = await call(`/api/users/${a.id}/oshi`);
  assert.equal(empty.data.name, '');

  const saved = await call(`/api/users/${a.id}/oshi`, {
    method: 'PUT', body: { name: 'ほしの', liveDate: '2026-12-24', liveVenue: '〇〇ホール', birthday: '2000-07-07' },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.name, 'ほしの');
  assert.equal((await call(`/api/users/${a.id}/oshi`, { method: 'PUT', body: { liveDate: '12/24' } })).status, 400, '日付の形が違う');

  const g = await call(`/api/users/${a.id}/oshi/goods`, { method: 'POST', body: { name: 'アクスタ' } });
  assert.equal(g.status, 201);
  assert.equal(g.data.goods.length, 1);
  const removed = await call(`/api/users/${a.id}/oshi/goods/${g.data.goods[0].id}`, { method: 'DELETE' });
  assert.equal(removed.data.goods.length, 0);

  // 同じ推しの B さんの投稿が、A さんの「仲間」に出る
  await call(`/api/users/${b.id}/oshi`, { method: 'PUT', body: { name: 'ほしの' } });
  await call('/api/posts', { method: 'POST', body: { authorId: b.id, text: 'ほしの最高！' } });
  const { data: friends } = await call(`/api/users/${a.id}/oshi/friends`);
  assert.ok(friends.some((p) => p.text === 'ほしの最高！'));

  assert.equal((await call('/api/users/agent-usagi/oshi')).status, 400, 'キャラには推しページがない');
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
  const { data: me } = await call('/api/users', { method: 'POST', body: { name } });
  const res = await call('/api/letters', { method: 'POST', body: { authorId: me.id, to: 'おばあちゃん', from: 'ゆうた', note: '元気？', ...extra } });
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
  assert.equal((await call('/api/letters', { method: 'POST', body: { authorId: 'agent-usagi', to: 'a', from: 'b' } })).status, 400, 'キャラは手紙を書かない');
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
