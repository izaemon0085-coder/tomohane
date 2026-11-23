// 🖼️ グッズの絵（写真はブラウザの中でイラストにして、絵だけ送る・運営が見てから出す）のテスト
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { createStore } from '../store.js';
import { createSimulation } from '../simulation.js';
import { illustrate, pixelate, makeImage, ILLUST_STYLES, GOODS_IMAGE_MAX_BYTES } from '../../shared/illust.js';

let server; let base; let dir;
let admin; let fan; let other; let kid;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);

async function call(path, { method = 'GET', body, as, raw, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(as ? { Cookie: as.cookie } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), type };
}
let seq = 0;
async function signup(birthdate = '1990-01-01') {
  seq += 1;
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: `goods${seq}`, password: `pass-word-${seq}`, name: `グッズ${seq}`, birthdate, agreeTerms: true }),
  });
  assert.equal(res.status, 200);
  return { cookie: res.headers.get('set-cookie').split(';')[0], ...(await res.json()).me };
}
const addGoods = async (as, name = 'アクスタ') => (await call(`/api/users/${as.id}/oshi/goods`, { method: 'POST', as, body: { name } })).data.goods[0];
const upload = (as, gid, bytes = PNG, type = 'image/png', style = 'pop') => call(`/api/users/${as.id}/oshi/goods/${gid}/image`, { method: 'PUT', as, raw: bytes, headers: { 'Content-Type': type, 'X-Style': style } });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'goods-'));
  const store = createStore();
  const sim = createSimulation(store, { random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'] });
  server = http.createServer(createApp({ store, sim, libraryDir: dir }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  admin = await signup('1980-01-01');
  fan = await signup();
  other = await signup();
  kid = await signup('2016-01-01');
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

test('イラスト：4つの絵柄で絵ができる・モザイクで円の中がならされる', () => {
  const img = makeImage(24, 24);
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = (i * 7) % 256; img.data[i + 1] = (i * 3) % 256; img.data[i + 2] = (i * 11) % 256; img.data[i + 3] = 255; }
  for (const s of ILLUST_STYLES) {
    const out = illustrate(img, s.id);
    assert.equal(out.width, 24);
    assert.equal(out.data.length, img.data.length);
    assert.notDeepEqual(out.data, img.data, `${s.label} は元とちがう`);
  }
  const m = makeImage(28, 28, new Uint8ClampedArray(img.data.length + 28 * 4 * 4).slice(0, 28 * 28 * 4));
  for (let i = 0; i < m.data.length; i += 4) m.data[i] = i % 256;
  pixelate(m, 14, 14, 10, 14);
  assert.equal(m.data[(14 * 28 + 14) * 4], m.data[(14 * 28 + 15) * 4], 'ます目の中は同じ色');
});

test('グッズの絵：送ると「運営が見ています」→ 本人と運営は見られる・ほかの人とログインしていない人は見られない', async () => {
  const g = await addGoods(fan);
  const r = await upload(fan, g.id);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.status, 'pending');
  const mine = (await call(`/api/users/${fan.id}/oshi`, { as: fan })).data.goods[0];
  assert.equal(mine.image.status, 'pending');
  assert.equal(mine.image.style, 'pop');
  assert.equal(mine.image.file, undefined, 'ファイルの名前は出さない');
  assert.equal((await call(mine.image.url, { as: fan })).status, 200);
  assert.equal((await call(mine.image.url, { as: admin })).status, 200);
  assert.equal((await call(mine.image.url, { as: other })).status, 404);
  assert.equal((await call(mine.image.url)).status, 404);
  assert.equal((await call(`/api/users/${fan.id}/profile`, { as: other })).data.goods.length, 0, 'まだプロフィールに出ない');
});

test('グッズの絵：運営が OK → プロフィールに出る・本人に 🔔。だめ → 出ない', async () => {
  const g = await addGoods(fan, '缶バッジ');
  await upload(fan, g.id);
  assert.equal((await call('/api/goods-images/pending', { as: other })).status, 403);
  const pending = (await call('/api/goods-images/pending', { as: admin })).data;
  const item = pending.find((x) => x.goodsId === g.id);
  assert.ok(item);
  assert.equal((await call(`/api/goods-images/${fan.id}/${g.id}/review`, { method: 'POST', as: other, body: { ok: true } })).status, 403);
  assert.equal((await call(`/api/goods-images/${fan.id}/${g.id}/review`, { method: 'POST', as: admin, body: { ok: true } })).status, 200);
  const prof = (await call(`/api/users/${fan.id}/profile`, { as: other })).data;
  const shown = prof.goods.find((x) => x.id === g.id);
  assert.ok(shown);
  const img = await call(shown.image, { as: other });
  assert.equal(img.status, 200);
  assert.equal(img.type, 'image/png');
  assert.ok(JSON.stringify((await call('/api/notices', { as: fan })).data).includes('缶バッジ'));
  // だめ
  const g2 = await addGoods(fan, 'うちわ');
  await upload(fan, g2.id);
  await call(`/api/goods-images/${fan.id}/${g2.id}/review`, { method: 'POST', as: admin, body: { ok: false } });
  assert.ok(!(await call(`/api/users/${fan.id}/profile`, { as: other })).data.goods.some((x) => x.id === g2.id));
  // ブロックされている人には見せない
  await call(`/api/blocks/${other.id}`, { method: 'PUT', as: fan, body: { kind: 'block', reason: '' } });
  assert.equal((await call(shown.image, { as: other })).status, 404);
  await call(`/api/blocks/${other.id}`, { method: 'DELETE', as: fan });
});

test('グッズの絵：子どもは出せない・画像でないもの・大きすぎるものはことわる・ほかの人のグッズには出せない', async () => {
  const kg = await addGoods(kid, 'シール');
  const r = await upload(kid, kg.id);
  assert.equal(r.status, 403);
  assert.match(r.data.error, /12歳/);
  const g = await addGoods(fan, 'タオル');
  assert.equal((await upload(fan, g.id, Buffer.from('<script>alert(1)</script>'), 'image/png')).status, 415);
  assert.equal((await upload(fan, g.id, PNG, 'text/html')).status, 415);
  assert.equal((await upload(fan, g.id, Buffer.concat([PNG, Buffer.alloc(GOODS_IMAGE_MAX_BYTES)]))).status, 413);
  const res = await fetch(`${base}/api/users/${fan.id}/oshi/goods/${g.id}/image`, { method: 'PUT', headers: { Cookie: other.cookie, 'Content-Type': 'image/png' }, body: PNG });
  assert.equal(res.status, 403);
});

test('グッズの絵：入れかえると前のファイルは消える・絵だけ消す・グッズを消すとファイルも消える', async () => {
  const g = await addGoods(fan, 'ペンライト');
  await upload(fan, g.id);
  const before = readdirSync(dir).filter((f) => f.startsWith(`goods_${g.id}`));
  assert.equal(before.length, 1);
  await upload(fan, g.id, PNG, 'image/png', 'pencil');
  const after1 = readdirSync(dir).filter((f) => f.startsWith(`goods_${g.id}`));
  assert.equal(after1.length, 1);
  assert.notEqual(after1[0], before[0]);
  assert.equal((await call(`/api/users/${fan.id}/oshi/goods/${g.id}/image`, { method: 'DELETE', as: fan })).status, 200);
  assert.equal(readdirSync(dir).filter((f) => f.startsWith(`goods_${g.id}`)).length, 0);
  await upload(fan, g.id);
  await call(`/api/users/${fan.id}/oshi/goods/${g.id}`, { method: 'DELETE', as: fan });
  assert.equal(readdirSync(dir).filter((f) => f.startsWith(`goods_${g.id}`)).length, 0);
});
