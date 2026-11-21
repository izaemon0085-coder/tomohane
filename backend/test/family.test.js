// 👪 おうちの人との決まり（A カギ・C こどもテーブル・D スイッチ・夜9時）のテスト
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { createStore } from '../store.js';
import { createSimulation } from '../simulation.js';
import { familyStop, normalizeRules, isNightJst, DEFAULT_FAMILY_RULES } from '../../shared/family-rules.js';

const NOON = Date.parse('2026-11-21T03:00:00Z'); // 日本時間 12:00
const NIGHT = Date.parse('2026-11-21T13:30:00Z'); // 日本時間 22:30
let nowMs = NOON;
let server;
let base;
let mom; let kid; let stranger; let teen;

async function call(path, { method = 'GET', body, as, redirect } = {}) {
  const res = await fetch(base + path, {
    method, redirect,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(as ? { Cookie: as.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, location: res.headers.get('location') };
}
let seq = 0;
async function signup(birthdate) {
  seq += 1;
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: `fam${seq}`, password: `pass-word-${seq}`, name: `家族${seq}`, birthdate, agreeTerms: true }),
  });
  assert.equal(res.status, 200);
  return { cookie: res.headers.get('set-cookie').split(';')[0], ...(await res.json()).me };
}

before(async () => {
  const store = createStore({ now: () => new Date(nowMs).toISOString() });
  const sim = createSimulation(store, { random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'] });
  server = http.createServer(createApp({ store, sim, clock: () => new Date(nowMs) }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  await signup('1980-01-01'); // 運営
  mom = await signup('1985-05-05');
  kid = await signup('2016-04-01');
  stranger = await signup('1990-01-01');
  teen = await signup('2011-01-01');
  const { code } = (await call('/api/guardian/code', { method: 'POST', as: mom })).data;
  assert.equal((await call('/api/guardian/join', { method: 'POST', as: kid, body: { code } })).status, 200);
});
after(() => server.close());

const post = (as, text, table) => call('/api/posts', { method: 'POST', as, body: { text, ...(table ? { table } : {}) } });
const setRules = (rules, talked = true, as = mom) => call(`/api/guardian/children/${kid.id}/rules`, { method: 'PUT', as, body: { rules, talked } });

test('決まり：きまった形にそろえる・夜は21時から6時', () => {
  assert.deepEqual(normalizeRules({}), normalizeRules(DEFAULT_FAMILY_RULES));
  assert.equal(normalizeRules({ switches: { cafe: false } }).switches.cafe, false);
  assert.equal(isNightJst(new Date('2026-11-21T20:59:00+09:00')), false);
  assert.equal(isNightJst(new Date('2026-11-21T21:00:00+09:00')), true);
  assert.equal(isNightJst(new Date('2026-11-22T05:59:00+09:00')), true);
  assert.equal(isNightJst(new Date('2026-11-22T06:00:00+09:00')), false);
  assert.equal(familyStop(DEFAULT_FAMILY_RULES, 'plaza', new Date('2026-11-21T12:00:00+09:00')), null);
});

test('夜9時：まだ話しあっていなくても、子どもは夜は書けない（読むのはできる）・大人は書ける', async () => {
  nowMs = NIGHT;
  const r = await post(kid, 'よるのおしゃべり');
  assert.equal(r.status, 403);
  assert.match(r.data.error, /夜21時から朝6時/);
  assert.equal((await call('/api/posts', { as: kid })).status, 200, '読むのはできる');
  assert.equal((await post(stranger, '大人は夜も書ける')).status, 201);
  // 夜9時のまもりを外すと、書ける
  await setRules({ night: false });
  assert.equal((await post(kid, 'きょうだけ夜ふかし')).status, 201);
  nowMs = NOON;
  await setRules({});
});

test('決める：子どもと話しあったチェックがいる・つながっている人だけ・子どもに 🔔 → 「わかった」でおうちの人に 🔔', async () => {
  assert.equal((await setRules({ lock: true }, false)).status, 400);
  assert.equal((await setRules({ lock: true }, true, stranger)).status, 404, 'つながっていない大人は決められない');
  const r = await setRules({ lock: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.lock, true);
  assert.equal(r.data.ackAt, null);
  const notices = await call('/api/notices', { as: kid });
  assert.ok(JSON.stringify(notices.data).includes('おうちの人との決まり'));
  const g = await call('/api/guardian', { as: kid });
  assert.equal(g.data.myRules.lock, true);
  const ack = await call('/api/guardian/rules/ack', { method: 'POST', as: kid });
  assert.ok(ack.data.ackAt);
  const momView = await call('/api/guardian', { as: mom });
  assert.ok(momView.data.children[0].familyRules.ackAt);
  assert.ok(JSON.stringify((await call('/api/notices', { as: mom })).data).includes('話しあった・わかった'));
});

test('A カギ：書くのは全部お休み（いいね・目安箱はできる）', async () => {
  await setRules({ lock: true });
  const r = await post(kid, 'かきたい');
  assert.equal(r.status, 403);
  assert.match(r.data.error, /カギ/);
  assert.equal((await post(kid, 'カフェも', 'free')).status, 403);
  assert.equal((await call('/api/letters', { method: 'POST', as: kid, body: { to: 'ママ', from: 'わたし' } })).status, 403);
  const p = await post(stranger, 'いいねしてね');
  assert.equal((await call(`/api/posts/${p.data.id}/like`, { method: 'POST', as: kid })).status, 200, 'いいねはできる');
  assert.equal((await call('/api/suggestions', { method: 'POST', as: kid, body: { topic: 'other', text: 'こまったよ' } })).status, 201, '目安箱はいつでも');
  await setRules({});
});

test('D スイッチ：カフェだけお休み・ゲームだけお休み', async () => {
  await setRules({ switches: { cafe: false, games: false } });
  assert.equal((await post(kid, 'カフェで', 'free')).status, 403);
  assert.equal((await post(kid, '広場はOK')).status, 201);
  const game = await call('/api/link/game-start', { as: kid, redirect: 'manual' });
  assert.equal(game.status, 302);
  assert.equal(game.location, '/games.html?family=1');
  await setRules({});
  const ok = await call('/api/link/game-start', { as: kid, redirect: 'manual' });
  assert.notEqual(ok.location, '/games.html?family=1');
});

test('C こどもテーブル：子どもは書ける・おうちの人は読むだけ・ほかの大人と中高生には見えない', async () => {
  const kidTables = (await call('/api/cafe/tables', { as: kid })).data.map((t) => t.id);
  assert.ok(kidTables.includes('kids'));
  assert.ok(!(await call('/api/cafe/tables', { as: stranger })).data.some((t) => t.id === 'kids'));
  assert.ok(!(await call('/api/cafe/tables')).data.some((t) => t.id === 'kids'), 'ログインしていない人にも見えない');
  assert.ok((await call('/api/cafe/tables', { as: mom })).data.some((t) => t.id === 'kids'), 'おうちの人は見守り');

  const w = await post(kid, 'こどもテーブルでこんにちは', 'kids');
  assert.equal(w.status, 201);
  assert.ok((await call('/api/posts?table=kids', { as: mom })).data.some((p) => p.id === w.data.id));
  assert.equal((await call('/api/posts?table=kids', { as: stranger })).status, 403);
  assert.equal((await call('/api/posts?table=kids', { as: teen })).status, 403);
  assert.equal((await post(mom, 'ママも書きたい', 'kids')).status, 403, 'おうちの人は読むだけ');
  assert.equal((await post(stranger, 'こんにちは', 'kids')).status, 403);
  // さがす・プロフィールなどでも出ない
  const search = await call(`/api/search?q=${encodeURIComponent('こどもテーブルでこんにちは')}`, { as: stranger });
  assert.ok(!JSON.stringify(search.data).includes(w.data.id));
  // 子どもの部屋をお休みにすると、書けない
  await setRules({ kidsRoom: false });
  assert.equal((await post(kid, 'もういちど', 'kids')).status, 403);
  await setRules({});
});
