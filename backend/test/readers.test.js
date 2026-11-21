// 📝 新聞の「読者の声」（投書欄）のテスト
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { createStore } from '../store.js';
import { createSimulation } from '../simulation.js';
import { latestIssueId, READER_DEFAULT_NAME } from '../../shared/news.js';

let server;
let base;
let admin;
let alice;
before(async () => {
  const store = createStore();
  const sim = createSimulation(store, { random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'] });
  server = http.createServer(createApp({ store, sim }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  admin = await signup(); // いちばん最初の人が運営
  alice = await signup();
});
after(() => server.close());

async function call(path, { method = 'GET', body, as } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(as ? { Cookie: as.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
let seq = 0;
async function signup(birthdate = '1990-01-01') {
  seq += 1;
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: `reader${seq}`, password: `pass-word-${seq}`, name: `読者${seq}`, birthdate, agreeTerms: true }),
  });
  assert.equal(res.status, 200);
  return { cookie: res.headers.get('set-cookie').split(';')[0], ...(await res.json()).me };
}


const issueId = latestIssueId();

test('読者の声：「のせてもいい」がないと投書できない・ペンネームなしは「町の読者」', async () => {
  assert.equal((await call('/api/news/letters', { method: 'POST', as: alice, body: { text: '新聞たのしい' } })).status, 400);
  const r = await call('/api/news/letters', { method: 'POST', as: alice, body: { text: '新聞たのしい', okToPrint: true } });
  assert.equal(r.status, 201);
  assert.ok(r.data.reply.text, '記者が受け取る');
  const mine = await call('/api/news/letters/mine', { as: alice });
  assert.equal(mine.data[0].penName, READER_DEFAULT_NAME);
  assert.equal(mine.data[0].status, 'new');
  assert.equal((await call('/api/news/letters', { method: 'POST', body: { text: 'x', okToPrint: true } })).status, 401, 'ログインがいる');
});

test('読者の声：運営は名前なしで見て、号にのせる → 号にペンネームで出る・本人にだけ mine', async () => {
  const w = await call('/api/news/letters', { method: 'POST', as: alice, body: { text: 'カフェのテーブルがすき', penName: 'ねこまる', okToPrint: true } });
  assert.equal((await call('/api/news/letters', { as: alice })).status, 403, '運営だけ');
  const list = await call('/api/news/letters', { as: admin });
  const item = list.data.find((x) => x.id === w.data.id);
  assert.equal(item.penName, 'ねこまる');
  assert.equal(item.userId, undefined, '書いた人は運営にも出さない');
  assert.equal(item.name, undefined);
  assert.equal((await call(`/api/news/letters/${item.id}/pick`, { method: 'POST', as: admin, body: { issueId: 'no-such-issue' } })).status, 400);
  assert.equal((await call(`/api/news/letters/${item.id}/pick`, { method: 'POST', as: admin, body: { issueId } })).status, 200);

  const seen = (await call('/api/news', { as: alice })).data.find((i) => i.id === issueId);
  const r = seen.readers.find((x) => x.text === 'カフェのテーブルがすき');
  assert.equal(r.penName, 'ねこまる');
  assert.equal(r.mine, true);
  const other = (await call('/api/news')).data.find((i) => i.id === issueId).readers.find((x) => x.id === item.id);
  assert.equal(other.mine, false);
  assert.equal(other.userId, undefined);
  // お知らせ 🔔 が本人に届く
  const notices = await call('/api/notices', { as: alice });
  assert.ok(JSON.stringify(notices.data).includes('読者の声'));
});

test('読者の声：本人が取り下げると号からも消える・ほかの人は取り下げられない', async () => {
  const w = await call('/api/news/letters', { method: 'POST', as: alice, body: { text: '取り下げるかも', okToPrint: true } });
  await call(`/api/news/letters/${w.data.id}/pick`, { method: 'POST', as: admin, body: { issueId } });
  assert.equal((await call(`/api/news/letters/${w.data.id}`, { method: 'DELETE', as: admin })).status, 404, '運営でも本人でなければ取り下げられない');
  assert.equal((await call(`/api/news/letters/${w.data.id}`, { method: 'DELETE', as: alice })).status, 200);
  const seen = (await call('/api/news')).data.find((i) => i.id === issueId);
  assert.ok(!seen.readers.some((x) => x.id === w.data.id));
});

test('読者の声：運営が片づけると号から外れる・1日3通まで', async () => {
  const bob = await signup();
  const w = await call('/api/news/letters', { method: 'POST', as: bob, body: { text: 'のせてね', okToPrint: true } });
  await call(`/api/news/letters/${w.data.id}/pick`, { method: 'POST', as: admin, body: { issueId } });
  assert.equal((await call(`/api/news/letters/${w.data.id}/close`, { method: 'POST', as: admin })).status, 200);
  assert.ok(!(await call('/api/news')).data.find((i) => i.id === issueId).readers.some((x) => x.id === w.data.id));
  await call('/api/news/letters', { method: 'POST', as: bob, body: { text: '2通め', okToPrint: true } });
  await call('/api/news/letters', { method: 'POST', as: bob, body: { text: '3通め', okToPrint: true } });
  assert.equal((await call('/api/news/letters', { method: 'POST', as: bob, body: { text: '4通め', okToPrint: true } })).status, 429);
});

test('読者の声：おうちの人とつながる前の子どもは投書できない・ペンネームは12文字まで', async () => {
  const kid = await signup('2018-04-01');
  const r = await call('/api/news/letters', { method: 'POST', as: kid, body: { text: 'こんにちは', okToPrint: true } });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /おうちの人/);
  const long = await call('/api/news/letters', { method: 'POST', as: alice, body: { text: 'ながい', penName: 'あ'.repeat(13), okToPrint: true } });
  assert.equal(long.status, 400);
});
