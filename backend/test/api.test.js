import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { createStore } from '../store.js';
import { createSimulation } from '../simulation.js';
import { MEETING_SCRIPT } from '../agents.js';

let server;
let base;
let store;
let sim;

before(async () => {
  store = createStore();
  sim = createSimulation(store, { random: () => 0, replyDelayMs: null });
  server = http.createServer(createApp({ store, sim }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

test('3つのフロントが配信される', async () => {
  for (const [path, marker] of [['/', 'タイムライン'], ['/side/', 'エージェントの家'], ['/sub/', '会議室']]) {
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
  assert.equal((await call('/api/users', { method: 'POST', body: { name: 'ルリ' } })).status, 409);
  assert.equal((await call('/api/nothing')).status, 404);
});

test('サイドフロント：エージェントの家とノック', async () => {
  const { data: agents } = await call('/api/agents');
  assert.equal(agents.length, 4);
  const id = agents[0].id;
  store.updateAgent(id, { status: 'sleeping' });
  const { data } = await call(`/api/agents/${id}/knock`, { method: 'POST' });
  assert.equal(data.agent.status, 'home', 'ノックで起きる');
  assert.match(data.message, /起こされ/);
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
  assert.ok(agents.every((a) => a.status === 'meeting'), '全員が会議室へ移動');

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
