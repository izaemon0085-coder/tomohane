// 🔑 パスキーと「このまま入っておく」のテスト。
// 本物のスマホのかわりに、テストの中で本物のカギ（P-256）を作って署名する
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createApp } from '../server.js';
import { createStore, SHORT_SESSION_HOURS } from '../store.js';
import { createSimulation } from '../simulation.js';
import { decodeCbor } from '../webauthn.js';

let server;
let base;
let store;
let nowMs = Date.parse('2026-11-21T03:00:00Z');

before(async () => {
  store = createStore({ now: () => new Date(nowMs).toISOString() });
  const sim = createSimulation(store, { random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'] });
  server = http.createServer(createApp({ store, sim }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'POST', body, cookie, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), setCookie: res.headers.get('set-cookie') };
}
const cookieOf = (r) => r.setCookie.split(';')[0];

let seq = 0;
async function signup(extra = {}) {
  seq += 1;
  const r = await call('/api/auth/register', { body: { loginId: `pk${seq}`, password: `pass-word-${seq}`, name: `パス${seq}`, birthdate: '1990-01-01', agreeTerms: true, ...extra } });
  assert.equal(r.status, 200, r.data.error);
  return { me: r.data.me, cookie: cookieOf(r), loginId: `pk${seq}`, password: `pass-word-${seq}`, setCookie: r.setCookie };
}

// ---- テスト用の CBOR（書くほう） ----
function cbor(v) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b;
  };
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported');
}
const sha256 = (b) => createHash('sha256').update(b).digest();
const b64 = (b) => Buffer.from(b).toString('base64url');

// テスト用の「スマホ」：パスキーを作る・署名する
function fakePhone() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  let count = 0;
  return {
    id: b64(credId),
    create({ challenge, rpId = 'localhost', origin = base }) {
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([sha256(rpId), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, credId, cose]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin }));
      return { id: b64(credId), clientDataJSON: b64(clientDataJSON), attestationObject: b64(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))) };
    },
    get({ challenge, rpId = 'localhost', origin = base, signCount }) {
      count = signCount ?? count + 1;
      const c = Buffer.alloc(4); c.writeUInt32BE(count);
      const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), c]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
      const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), privateKey);
      return { id: b64(credId), clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authenticatorData), signature: b64(signature) };
    },
  };
}

async function addPasskey(person, phone = fakePhone(), label = 'わたしのスマホ') {
  const opt = await call('/api/auth/passkey-register-options', { cookie: person.cookie });
  assert.equal(opt.status, 200, opt.data.error);
  const r = await call('/api/auth/passkey-register', { cookie: person.cookie, body: { ...phone.create({ challenge: opt.data.challenge }), label } });
  return { r, phone, opt };
}
async function passkeyLogin(phone, extra = {}, getOpts = {}) {
  const opt = await call('/api/auth/passkey-login-options');
  assert.equal(opt.status, 200);
  return call('/api/auth/passkey-login', { body: { ...phone.get({ challenge: opt.data.challenge, ...getOpts }), ...extra } });
}

test('このまま入っておく：チェックありは30日のクッキー、なしはブラウザを閉じたら消えるクッキー', async () => {
  const p = await signup();
  assert.match(p.setCookie, /Max-Age=2592000/, '送られてこないときは前と同じ30日');
  const keep = await call('/api/auth/login', { body: { loginId: p.loginId, password: p.password, remember: true } });
  assert.match(keep.setCookie, /Max-Age=2592000/);
  const once = await call('/api/auth/login', { body: { loginId: p.loginId, password: p.password, remember: false } });
  assert.equal(once.status, 200);
  assert.doesNotMatch(once.setCookie, /Max-Age/, 'Max-Age なし＝ブラウザを閉じたら消える');
  assert.match(once.setCookie, /HttpOnly; SameSite=Lax/);
  // サーバー側でも短く切れる（ブラウザがクッキーを残しても入れない）
  const me1 = await call('/api/auth/me', { method: 'GET', cookie: cookieOf(once) });
  assert.equal(me1.data.loginId, p.loginId);
  nowMs += (SHORT_SESSION_HOURS + 1) * 3600000;
  const me2 = await call('/api/auth/me', { method: 'GET', cookie: cookieOf(once) });
  assert.equal(me2.data, null, `${SHORT_SESSION_HOURS}時間で切れる`);
  const me3 = await call('/api/auth/me', { method: 'GET', cookie: cookieOf(keep) });
  assert.equal(me3.data.loginId, p.loginId, '30日のほうはまだ入れる');
});

test('このまま入っておく：チェックなしで入った人がパスワードを変えても、チェックなしのまま', async () => {
  const p = await signup();
  const once = await call('/api/auth/login', { body: { loginId: p.loginId, password: p.password, remember: false } });
  const r = await call('/api/auth/password', { cookie: cookieOf(once), body: { current: p.password, next: 'new-pass-word' } });
  assert.equal(r.status, 200, r.data.error);
  assert.doesNotMatch(r.setCookie, /Max-Age/);
});

test('パスキー：登録して、パスキーでログインできる（パスワードなし）', async () => {
  const p = await signup();
  const { r, phone, opt } = await addPasskey(p);
  assert.equal(r.status, 200, r.data.error);
  assert.equal(r.data.passkeys.length, 1);
  assert.equal(r.data.passkeys[0].label, 'わたしのスマホ');
  assert.equal(opt.data.rp.id, 'localhost');
  assert.equal(opt.data.user.name, p.loginId);
  assert.equal(r.data.passkeys[0].jwk, undefined, 'カギは返さない');

  const login = await passkeyLogin(phone);
  assert.equal(login.status, 200, login.data.error);
  assert.equal(login.data.me.loginId, p.loginId);
  assert.match(login.setCookie, /Max-Age=2592000/);
  assert.equal(login.data.me.passkeys.length, 1);
  assert.ok(login.data.me.passkeys[0].lastUsedAt, '使った日が残る');
  const once = await passkeyLogin(phone, { remember: false });
  assert.equal(once.status, 200);
  assert.doesNotMatch(once.setCookie, /Max-Age/, 'パスキーでも「このまま入っておく」を選べる');
  // 2つ目の登録はできるが、同じカギの2回目はことわる
  const again = await addPasskey(p, phone);
  assert.equal(again.r.status, 409);
});

test('パスキー：ログインしていないと登録できない・ほかのページや使い回しのくじはことわる', async () => {
  const noLogin = await call('/api/auth/passkey-register-options');
  assert.equal(noLogin.status, 401);

  const p = await signup();
  const phone = fakePhone();
  // ほかのページ（にせサイト）で作ったもの
  const opt = await call('/api/auth/passkey-register-options', { cookie: p.cookie });
  const fake = await call('/api/auth/passkey-register', { cookie: p.cookie, body: phone.create({ challenge: opt.data.challenge, origin: 'https://tomohane-sms.example' }) });
  assert.equal(fake.status, 400);
  // ほかのサイトのカギ（rpId がちがう）
  const opt2 = await call('/api/auth/passkey-register-options', { cookie: p.cookie });
  const otherRp = await call('/api/auth/passkey-register', { cookie: p.cookie, body: phone.create({ challenge: opt2.data.challenge, rpId: 'example.com' }) });
  assert.equal(otherRp.status, 400);
  // ほかの人のくじは使えない
  const q = await signup();
  const opt3 = await call('/api/auth/passkey-register-options', { cookie: q.cookie });
  const stolen = await call('/api/auth/passkey-register', { cookie: p.cookie, body: phone.create({ challenge: opt3.data.challenge }) });
  assert.equal(stolen.status, 400);

  await addPasskey(p, phone);
  // くじは1回だけ
  const lo = await call('/api/auth/passkey-login-options');
  const body = phone.get({ challenge: lo.data.challenge });
  assert.equal((await call('/api/auth/passkey-login', { body })).status, 200);
  assert.equal((await call('/api/auth/passkey-login', { body })).status, 400, '同じくじの2回目');
  // にせサイトでの署名
  assert.equal((await passkeyLogin(phone, {}, { origin: 'https://tomohane-sms.example' })).status, 400);
});

test('パスキー：署名がちがう・回数がもどった・登録していないカギはことわる', async () => {
  const p = await signup();
  const { phone } = await addPasskey(p);
  // ほかの人のスマホ（同じ番号だけまねる）
  const thief = fakePhone();
  const lo = await call('/api/auth/passkey-login-options');
  const forged = { ...thief.get({ challenge: lo.data.challenge }), id: phone.id };
  assert.equal((await call('/api/auth/passkey-login', { body: forged })).status, 400);
  // 登録していないカギ
  assert.equal((await passkeyLogin(thief)).status, 401);
  // 回数が前より大きくない（カギのコピーのおそれ）
  assert.equal((await passkeyLogin(phone, {}, { signCount: 5 })).status, 200);
  assert.equal((await passkeyLogin(phone, {}, { signCount: 5 })).status, 400);
  assert.equal((await passkeyLogin(phone, {}, { signCount: 6 })).status, 200);
});

test('パスキー：消すと、もう入れない・5つまで', async () => {
  const p = await signup();
  const { phone } = await addPasskey(p);
  const me = await call('/api/auth/me', { method: 'GET', cookie: p.cookie });
  const del = await call('/api/auth/passkey-delete', { cookie: p.cookie, body: { id: me.data.passkeys[0].id } });
  assert.equal(del.status, 200);
  assert.equal(del.data.passkeys.length, 0);
  assert.equal((await passkeyLogin(phone)).status, 401);
  // ほかの人のパスキーは消せない
  const q = await signup();
  const { phone: qPhone } = await addPasskey(q);
  const qMe = await call('/api/auth/me', { method: 'GET', cookie: q.cookie });
  assert.equal((await call('/api/auth/passkey-delete', { cookie: p.cookie, body: { id: qMe.data.passkeys[0].id } })).status, 404);
  assert.equal((await passkeyLogin(qPhone)).status, 200);
  // 5つまで
  for (let i = 0; i < 5; i += 1) assert.equal((await addPasskey(p)).r.status, 200);
  const sixth = await call('/api/auth/passkey-register-options', { cookie: p.cookie });
  assert.equal(sixth.status, 400);
});

test('パスキー：CBOR の読みとり（こわれたものはエラー）', () => {
  assert.deepEqual(decodeCbor(cbor(new Map([['a', 1], [-1, Buffer.from([1, 2])]]))).value, new Map([['a', 1], [-1, Buffer.from([1, 2])]]));
  assert.throws(() => decodeCbor(Buffer.from([0x5f])));
  assert.throws(() => decodeCbor(Buffer.from([0x42, 0x01])));
});
