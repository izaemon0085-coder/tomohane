// 📇 投稿のページ分け（工程7：人が増えたときの準備）：?limit= で新しいほうから・広場はスレッドの返信を出さない・返信の数は全部で数える
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { createStore } from '../store.js';
import { createSimulation } from '../simulation.js';

let server; let base; let store;
let t = Date.parse('2026-11-24T03:00:00Z');
const get = async (path) => { const r = await fetch(base + path); return { status: r.status, data: await r.json() }; };

before(async () => {
  store = createStore({ now: () => new Date(t).toISOString() });
  const sim = createSimulation(store, { random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'] });
  server = http.createServer(createApp({ store, sim }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  const author = store.listUsers().find((u) => u.kind === 'agent').id;
  // 広場に 300件・新聞のスレッド1つ（返信 5件）・カフェに 40件
  for (let i = 0; i < 300; i++) { t += 1000; store.createPost({ authorId: author, text: `ひろば ${i}` }); }
  t += 1000;
  const official = store.listUsers().find((u) => u.kind === 'official').id;
  const root = store.createPost({ authorId: official, text: 'スレッドのはじまり', thread: true, newsIssueId: 'n1' });
  let parent = root;
  for (let i = 0; i < 5; i++) { t += 1000; parent = store.createPost({ authorId: author, text: `スレッドの返信 ${i}`, replyTo: parent.id }); }
  for (let i = 0; i < 40; i++) { t += 1000; store.createPost({ authorId: author, text: `カフェ ${i}`, table: 'free' }); }
});
after(() => server.close());

test('limit なしは、前と同じく全部（古い画面・テストのため）', async () => {
  const all = (await get('/api/posts')).data;
  assert.ok(all.length >= 306);
});

test('?limit=N は新しいほうから N 件・新しい順', async () => {
  const page = (await get('/api/posts?limit=50')).data;
  assert.equal(page.length, 50);
  const all = (await get('/api/posts')).data;
  assert.deepEqual(page.map((p) => p.id), all.slice(0, 50).map((p) => p.id));
  for (let i = 1; i < page.length; i++) assert.ok(page[i - 1].createdAt >= page[i].createdAt);
  assert.equal((await get('/api/posts?limit=1')).data.length, 1);
  assert.equal((await get('/api/posts?limit=abc')).data.length, all.length, 'へんな limit は全部');
  assert.equal((await get('/api/posts?limit=999999')).data.length, Math.min(all.length, 2000), '上限は 2000');
});

test('?plaza=1 はスレッドの返信を出さない・はじまりの返信の数は、ページの外もふくめて数える', async () => {
  const page = (await get('/api/posts?plaza=1&limit=3')).data;
  assert.ok(page.every((p) => !p.threadId || p.thread), '返信は入らない');
  const root = (await get('/api/posts?plaza=1&limit=10')).data.find((p) => p.thread);
  assert.ok(root, 'はじまりはページに入る');
  assert.equal(root.replyCount, 5, '返信はページに入らなくても数える');
  const plain = (await get('/api/posts?limit=3')).data;
  assert.ok(plain.some((p) => p.threadId && !p.thread), 'plaza なしなら返信も入る（前と同じ）');
});

test('カフェのテーブルも ?limit= でページ分け', async () => {
  const page = (await get('/api/posts?table=free&limit=10')).data;
  assert.equal(page.length, 10);
  assert.ok(page.every((p) => p.table === 'free'));
  assert.equal(page[0].text, 'カフェ 39');
});

test('ふえても速い：投稿 5000件で 1ページを読むのが 1秒より速い', async () => {
  const author = store.listUsers().find((u) => u.kind === 'agent').id;
  for (let i = 0; i < 4700; i++) { t += 1000; store.createPost({ authorId: author, text: `たくさん ${i}`, ...(i % 3 === 0 && i > 0 ? { replyTo: null } : {}) }); }
  const t0 = Date.now();
  const page = (await get('/api/posts?plaza=1&limit=101')).data;
  const ms = Date.now() - t0;
  assert.equal(page.length, 101);
  assert.ok(ms < 1000, `${ms}ms`);
});

test('速い見え方（seer）は、canSee とまったく同じ答え（ブロック・通報・こども・退会中もふくめて）', async () => {
  const humans = [];
  for (let i = 0; i < 4; i++) humans.push((await store.register({ loginId: `seer${i}`, password: `pass-word-s${i}`, name: `みえかた${i}`, birthdate: i === 3 ? '2016-01-01' : '1990-01-01', agreeTerms: true })).user);
  const [a, b, c, kid] = humans;
  const p1 = store.createPost({ authorId: a.id, text: 'a の投稿' });
  const p2 = store.createPost({ authorId: b.id, text: 'b の返事', replyTo: p1.id });
  store.createPost({ authorId: c.id, text: 'c の投稿' });
  store.createPost({ authorId: kid.id, text: '練習モードの子の投稿' });
  store.blockUser(a.id, b.id, '', 'block');
  store.blockUser(c.id, a.id, '', 'mute');
  const viewers = [null, ...humans.map((u) => u.id), ...store.listUsers().filter((u) => u.kind !== 'human').slice(0, 2).map((u) => u.id)];
  let checked = 0;
  for (const v of viewers) {
    const see = store.seer(v);
    for (const p of store.listPosts()) { assert.equal(see(p), store.canSee(p, v), `${v} ${p.id}`); checked += 1; }
  }
  assert.ok(checked > 1000);
  assert.ok(p2);
});
