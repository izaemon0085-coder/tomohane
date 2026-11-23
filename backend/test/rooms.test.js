// 🚪 カフェの「仲間内だけの個室」のテスト
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { createStore } from '../store.js';
import { createSimulation } from '../simulation.js';

const NOON = Date.parse('2026-11-23T03:00:00Z');
let server; let base;
let owner; let friend; let other; let teen; let teen2; let kid;

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
    body: JSON.stringify({ loginId: `room${seq}`, password: `pass-word-${seq}`, name: `仲間${seq}`, birthdate, agreeTerms: true }),
  });
  assert.equal(res.status, 200);
  return { cookie: res.headers.get('set-cookie').split(';')[0], ...(await res.json()).me };
}
before(async () => {
  const store = createStore({ now: () => new Date(NOON).toISOString() });
  const sim = createSimulation(store, { random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'] });
  server = http.createServer(createApp({ store, sim }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  await signup('1980-01-01'); // 運営
  owner = await signup();
  friend = await signup();
  other = await signup();
  teen = await signup('2011-05-05');
  teen2 = await signup('2010-05-05');
  kid = await signup('2016-05-05');
});
after(() => server.close());

const create = (as, body) => call('/api/cafe/rooms', { method: 'POST', as, body: { genre: 'idol', name: '推しの部屋', entry: 'invite', age: 'adult', ...body } });
const post = (as, table, text = 'こんにちは') => call('/api/posts', { method: 'POST', as, body: { text, table } });

test('個室：招待の個室は一覧に出ない・コードで招待 → 入ると読める・書ける。ほかの人には見えない', async () => {
  const r = await create(owner, { name: 'ないしょ会' });
  assert.equal(r.status, 201);
  const id = r.data.id;
  assert.ok(!(await call('/api/cafe/rooms', { as: other })).data.open.some((x) => x.id === id), '招待の個室は一覧に出ない');
  assert.equal((await post(owner, id, '主のあいさつ')).status, 201);
  assert.equal((await call(`/api/posts?table=${id}`, { as: friend })).status, 403, 'まだ仲間ではない');
  assert.equal((await post(friend, id)).status, 403);

  assert.equal((await call(`/api/cafe/rooms/${id}/invite`, { method: 'POST', as: friend, body: { code: owner.code } })).status, 403, '主だけが招待できる');
  assert.equal((await call(`/api/cafe/rooms/${id}/invite`, { method: 'POST', as: owner, body: { code: 'nosuchcode' } })).status, 404);
  assert.equal((await call(`/api/cafe/rooms/${id}/invite`, { method: 'POST', as: owner, body: { code: `#${friend.code}` } })).status, 200);
  const inv = await call('/api/cafe/rooms', { as: friend });
  assert.ok(inv.data.invited.some((x) => x.id === id));
  assert.ok(JSON.stringify((await call('/api/notices', { as: friend })).data).includes('ないしょ会'));
  assert.equal((await call(`/api/cafe/rooms/${id}/answer`, { method: 'POST', as: friend, body: { accept: true } })).status, 200);
  assert.ok((await call(`/api/posts?table=${id}`, { as: friend })).data.some((p) => p.text === '主のあいさつ'));
  assert.equal((await post(friend, id, '入りました')).status, 201);
  // ほかの人：一覧・さがす・広場には出ない
  assert.equal((await call(`/api/posts?table=${id}`, { as: other })).status, 403);
  assert.equal((await call(`/api/posts?table=${id}`)).status, 403);
  assert.ok(!(await call('/api/posts', { as: other })).data.some((p) => p.text === '入りました'));
  const search = await call(`/api/search?q=${encodeURIComponent('入りました')}`, { as: other });
  assert.equal(search.data.posts.length, 0, 'さがすにも出ない');
});

test('個室：申しこみの個室は一覧に出る → 申しこむ → 主が OK すると入れる・ことわると入れない', async () => {
  const r = await create(owner, { name: 'みんなで', entry: 'apply' });
  const id = r.data.id;
  const list = await call('/api/cafe/rooms', { as: other });
  assert.ok(list.data.open.some((x) => x.id === id));
  assert.equal((await call(`/api/cafe/rooms/${id}/request`, { method: 'POST', as: other })).status, 201);
  assert.equal((await call(`/api/cafe/rooms/${id}/request`, { method: 'POST', as: other })).status, 409, '2回は申しこめない');
  const mine = (await call('/api/cafe/rooms', { as: owner })).data.mine.find((x) => x.id === id);
  assert.equal(mine.requests[0].user.id, other.id);
  assert.equal((await call(`/api/cafe/rooms/${id}/requests/${other.id}`, { method: 'POST', as: friend, body: { accept: true } })).status, 403, '主だけ');
  assert.equal((await call(`/api/cafe/rooms/${id}/requests/${other.id}`, { method: 'POST', as: owner, body: { accept: true } })).status, 200);
  assert.equal((await post(other, id)).status, 201);
  // ことわる
  const r2 = await create(owner, { name: 'ことわる部屋', entry: 'apply' });
  await call(`/api/cafe/rooms/${r2.data.id}/request`, { method: 'POST', as: friend });
  await call(`/api/cafe/rooms/${r2.data.id}/requests/${friend.id}`, { method: 'POST', as: owner, body: { accept: false } });
  assert.equal((await post(friend, r2.data.id)).status, 403);
});

test('個室：年齢（大人だけ・中高生どうし）・12歳までは使えない・1人3つまで', async () => {
  assert.equal((await create(kid, { age: 'same' })).status, 403, '子どもは作れない');
  assert.equal((await create(teen, { age: 'adult' })).status, 403, '中高生は「大人だけ」を作れない');
  const t = await create(teen, { age: 'same', entry: 'apply', name: '中高生の部屋' });
  assert.equal(t.status, 201);
  const adultList = (await call('/api/cafe/rooms', { as: other })).data.open;
  assert.ok(!adultList.some((x) => x.id === t.data.id), '大人には中高生の個室は出ない');
  assert.ok((await call('/api/cafe/rooms', { as: teen2 })).data.open.some((x) => x.id === t.data.id));
  assert.equal((await call(`/api/cafe/rooms/${t.data.id}/request`, { method: 'POST', as: other })).status, 404);
  assert.equal((await call(`/api/cafe/rooms/${t.data.id}/invite`, { method: 'POST', as: teen, body: { code: kid.code } })).status, 404, '子どもは招待できない');
  const adultRoom = (await call('/api/cafe/rooms', { as: owner })).data.mine[0];
  assert.equal((await call(`/api/cafe/rooms/${adultRoom.id}/invite`, { method: 'POST', as: owner, body: { code: teen.code } })).status, 404, '大人だけの個室に中高生は招待できない');
  // 1人3つまで（owner はもう3つ作った）
  assert.equal((await create(owner, { name: '4つめ' })).status, 409);
});

test('個室：ブロックの関係があると招待・申しこみできない・出る・外す・閉じると見えなくなる', async () => {
  const blocker = await signup();
  await call(`/api/blocks/${blocker.id}`, { method: 'PUT', as: friend, body: { kind: 'block', reason: '' } });
  const r = await create(friend, { name: 'ブロック確認', entry: 'apply' });
  assert.equal((await call(`/api/cafe/rooms/${r.data.id}/invite`, { method: 'POST', as: friend, body: { code: blocker.code } })).status, 404);
  assert.ok(!(await call('/api/cafe/rooms', { as: blocker })).data.open.some((x) => x.id === r.data.id));
  assert.equal((await call(`/api/cafe/rooms/${r.data.id}/request`, { method: 'POST', as: blocker })).status, 404);

  const m = await signup();
  await call(`/api/cafe/rooms/${r.data.id}/request`, { method: 'POST', as: m });
  await call(`/api/cafe/rooms/${r.data.id}/requests/${m.id}`, { method: 'POST', as: friend, body: { accept: true } });
  assert.equal((await call(`/api/cafe/rooms/${r.data.id}/leave`, { method: 'POST', as: friend })).status, 400, '主は出られない');
  assert.equal((await call(`/api/cafe/rooms/${r.data.id}/remove`, { method: 'POST', as: friend, body: { userId: m.id } })).status, 200);
  assert.equal((await post(m, r.data.id)).status, 403, '外された人は書けない');
  await post(friend, r.data.id, 'さいごのことば');
  assert.equal((await call(`/api/cafe/rooms/${r.data.id}`, { method: 'DELETE', as: m })).status, 403);
  assert.equal((await call(`/api/cafe/rooms/${r.data.id}`, { method: 'DELETE', as: friend })).status, 200);
  assert.equal((await call(`/api/posts?table=${r.data.id}`, { as: friend })).status, 404, '閉じた個室は主にも見えない');
});
