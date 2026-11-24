// 🚩 通報への対応の決まり（運営に 🔔・重い通報は12時間・ほかは24時間）のテスト
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { createStore } from '../store.js';
import { createSimulation } from '../simulation.js';
import { reviewDue, REVIEW_HOURS } from '../../shared/report.js';

const NOON = Date.parse('2026-11-24T03:00:00Z');
let server; let base; let admin; let writer; let r1; let r2;

async function call(path, { method = 'GET', body, as } = {}) {
  const res = await fetch(base + path, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(as ? { Cookie: as.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
let seq = 0;
async function signup() {
  seq += 1;
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: `rep${seq}`, password: `pass-word-${seq}`, name: `通報${seq}`, birthdate: '1990-01-01', agreeTerms: true }),
  });
  return { cookie: res.headers.get('set-cookie').split(';')[0], ...(await res.json()).me };
}
before(async () => {
  const store = createStore({ now: () => new Date(NOON).toISOString() });
  const sim = createSimulation(store, { random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'] });
  server = http.createServer(createApp({ store, sim }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  admin = await signup();
  writer = await signup();
  r1 = await signup();
  r2 = await signup();
});
after(() => server.close());

test('通報の期限：重い通報は12時間、ほかは24時間・見たら期限はなくなる', () => {
  const at = '2026-11-24T00:00:00.000Z';
  assert.equal(reviewDue([{ status: 'open', reason: 'rude', createdAt: at }]).dueAt, new Date(Date.parse(at) + REVIEW_HOURS.light * 3600000).toISOString());
  const heavy = reviewDue([{ status: 'open', reason: 'rude', createdAt: at }, { status: 'open', reason: 'crime', createdAt: '2026-11-24T05:00:00.000Z' }]);
  assert.equal(heavy.heavy, true);
  assert.equal(heavy.dueAt, new Date(Date.parse(at) + 12 * 3600000).toISOString(), 'いちばん早い通報から数える');
  assert.equal(reviewDue([{ status: 'stopped', reason: 'crime', createdAt: at }]), null);
});

test('通報が来ると運営に 🔔（通報した人の名前は出さない）・一覧に期限・重いものが上・決めると期限が消える', async () => {
  const light = (await call('/api/posts', { method: 'POST', as: writer, body: { text: 'ふつうの投稿' } })).data;
  const heavyPost = (await call('/api/posts', { method: 'POST', as: writer, body: { text: 'もうひとつの投稿' } })).data;
  assert.equal((await call(`/api/posts/${light.id}/report`, { method: 'POST', as: r1, body: { reason: 'rude' } })).status, 201);
  assert.equal((await call(`/api/posts/${heavyPost.id}/report`, { method: 'POST', as: r2, body: { reason: 'expose' } })).status, 201);

  const notices = JSON.stringify((await call('/api/notices', { as: admin })).data);
  assert.ok(notices.includes('24時間以内'));
  assert.ok(notices.includes('12時間以内'));
  assert.ok(!notices.includes(r1.name) && !notices.includes(r2.name), '通報した人の名前は出さない');
  assert.ok(!JSON.stringify((await call('/api/notices', { as: r1 })).data).includes('通報がありました'), '運営でない人には届かない');

  const list = (await call('/api/reports', { as: admin })).data;
  assert.equal(list[0].postId, heavyPost.id, '期限の近い（重い）ものが上');
  assert.equal(list[0].due.heavy, true);
  assert.equal(list[1].due.heavy, false);
  await call(`/api/reports/${heavyPost.id}/decision`, { method: 'POST', as: admin, body: { action: 'hide' } });
  const after = (await call('/api/reports', { as: admin })).data.find((x) => x.postId === heavyPost.id);
  assert.equal(after.due, null, '決めたら期限はなくなる');
});
