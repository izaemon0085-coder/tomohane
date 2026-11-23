// 📚 新聞の「みんなの知恵ぶくろ」のテスト
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { createStore } from '../store.js';
import { createSimulation } from '../simulation.js';

let server; let base; let admin; let alice; let bob;
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
    body: JSON.stringify({ loginId: `wise${seq}`, password: `pass-word-${seq}`, name: `知恵${seq}`, birthdate, agreeTerms: true }),
  });
  assert.equal(res.status, 200);
  return { cookie: res.headers.get('set-cookie').split(';')[0], ...(await res.json()).me };
}
before(async () => {
  const store = createStore({ now: () => new Date(Date.parse('2026-11-23T03:00:00Z')).toISOString() });
  const sim = createSimulation(store, { random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'] });
  server = http.createServer(createApp({ store, sim }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  admin = await signup('1980-01-01');
  alice = await signup();
  bob = await signup();
});
after(() => server.close());

const send = (as, body) => call('/api/news/wisdom', { method: 'POST', as, body: { topic: 'interview', text: 'バイトの面接で週に何日入れるか聞かれた', okToPrint: true, ...body } });

test('知恵ぶくろ：テーマと「のせてもいい」がいる・送ると記者が受けとる・まだ新聞には出ない', async () => {
  assert.equal((await send(alice, { okToPrint: false })).status, 400);
  assert.equal((await send(alice, { topic: 'nanika' })).status, 400);
  assert.equal((await call('/api/news/wisdom', { method: 'POST', body: { topic: 'school', text: 'x', okToPrint: true } })).status, 401);
  const r = await send(alice, { penName: 'はたらく猫' });
  assert.equal(r.status, 201);
  assert.ok(r.data.reply.text);
  assert.equal((await call('/api/news/wisdom')).data.length, 0, '運営が確かめるまで出ない');
  const mine = (await call('/api/news/wisdom/mine', { as: alice })).data;
  assert.equal(mine[0].status, 'new');
  assert.equal(mine[0].penName, 'はたらく猫');
});

test('知恵ぶくろ：運営は名前なしで見て、のせる → 新聞に出る・本人に 🔔・本人だけ mine', async () => {
  const w = await send(bob, { topic: 'school', text: '病院への電話は、名前と症状を先に言うとよい' });
  assert.equal((await call('/api/news/wisdom/all', { as: bob })).status, 403);
  const all = (await call('/api/news/wisdom/all', { as: admin })).data;
  const item = all.find((x) => x.id === w.data.id);
  assert.equal(item.userId, undefined);
  assert.equal(item.name, undefined);
  assert.equal((await call(`/api/news/wisdom/${w.data.id}/pick`, { method: 'POST', as: bob })).status, 403);
  assert.equal((await call(`/api/news/wisdom/${w.data.id}/pick`, { method: 'POST', as: admin })).status, 200);
  const shown = (await call('/api/news/wisdom', { as: bob })).data.find((x) => x.id === w.data.id);
  assert.equal(shown.topic, 'school');
  assert.equal(shown.mine, true);
  assert.equal((await call('/api/news/wisdom')).data.find((x) => x.id === w.data.id).mine, false);
  assert.ok(JSON.stringify((await call('/api/notices', { as: bob })).data).includes('知恵ぶくろ'));
});

test('知恵ぶくろ：本人の取り下げ・運営の片づけで新聞から消える・1日3つまで・つながる前の子どもは送れない', async () => {
  const w = await send(alice, { topic: 'society', text: '給料明細で引かれるお金がある' });
  await call(`/api/news/wisdom/${w.data.id}/pick`, { method: 'POST', as: admin });
  assert.equal((await call(`/api/news/wisdom/${w.data.id}`, { method: 'DELETE', as: bob })).status, 404, 'ほかの人は取り下げられない');
  assert.equal((await call(`/api/news/wisdom/${w.data.id}`, { method: 'DELETE', as: alice })).status, 200);
  assert.ok(!(await call('/api/news/wisdom')).data.some((x) => x.id === w.data.id));
  const w2 = await send(bob, { topic: 'help', text: 'ある窓口が親切だった' });
  await call(`/api/news/wisdom/${w2.data.id}/pick`, { method: 'POST', as: admin });
  await call(`/api/news/wisdom/${w2.data.id}/close`, { method: 'POST', as: admin });
  assert.ok(!(await call('/api/news/wisdom')).data.some((x) => x.id === w2.data.id));
  assert.equal((await send(bob)).status, 201, 'bob の3つめ');
  assert.equal((await send(bob)).status, 429, '4つめはだめ');
  const kid = await signup('2016-01-01');
  const k = await send(kid);
  assert.equal(k.status, 403);
  assert.match(k.data.error, /おうちの人/);
});
