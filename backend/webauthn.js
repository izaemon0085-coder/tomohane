// 🔑 パスキー（WebAuthn）。外の部品は使わず、Node.js の crypto だけで確かめる。
// しくみ：登録のとき、スマホ・パソコンが「公開カギ」だけをくれる（秘密のカギは端末の中から出ない）。
// ログインのとき、サーバーが出した「くじ（challenge）」に端末が署名し、サーバーは公開カギで確かめる。
// ともはね が持つのは公開カギだけなので、もれても、それだけではログインできない。
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

export const MAX_PASSKEYS = 5;
export const MAX_PASSKEY_LABEL = 20;
const CHALLENGE_MS = 5 * 60 * 1000;

const sha256 = (buf) => createHash('sha256').update(buf).digest();
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function fromB64url(s, what) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length > 8192) throw new WebAuthnError(`${what}が読めません`);
  return Buffer.from(s, 'base64url');
}

export class WebAuthnError extends Error {}

// ---- CBOR（パスキーの中身の書き方）を読む。使う分だけ（数・バイト・文字・配列・表・true/false/null） ----
export function decodeCbor(buf) {
  let pos = 0;
  const need = (n) => { if (pos + n > buf.length) throw new WebAuthnError('パスキーの中身がこわれています'); };
  const readLen = (info) => {
    if (info < 24) return info;
    const size = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (!size) throw new WebAuthnError('パスキーの中身が読めません');
    need(size);
    const v = size === 8 ? Number(buf.readBigUInt64BE(pos)) : buf.readUIntBE(pos, size);
    pos += size;
    return v;
  };
  const item = (depth) => {
    if (depth > 16) throw new WebAuthnError('パスキーの中身が深すぎます');
    need(1);
    const first = buf[pos++];
    const major = first >> 5;
    const info = first & 31;
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22 || info === 23) return null;
      throw new WebAuthnError('パスキーの中身が読めません');
    }
    const len = readLen(info);
    switch (major) {
      case 0: return len;
      case 1: return -1 - len;
      case 2: { need(len); const b = buf.subarray(pos, pos + len); pos += len; return b; }
      case 3: { need(len); const s = buf.subarray(pos, pos + len).toString('utf8'); pos += len; return s; }
      case 4: return Array.from({ length: len }, () => item(depth + 1));
      case 5: {
        const m = new Map();
        for (let i = 0; i < len; i += 1) { const k = item(depth + 1); m.set(k, item(depth + 1)); }
        return m;
      }
      default: throw new WebAuthnError('パスキーの中身が読めません');
    }
  };
  const value = item(0);
  return { value, length: pos };
}

// ---- authenticatorData（端末からの短い報告）を読む ----
export function parseAuthData(buf) {
  if (buf.length < 37) throw new WebAuthnError('パスキーの中身が短すぎます');
  const flags = buf[32];
  const out = {
    rpIdHash: buf.subarray(0, 32),
    userPresent: Boolean(flags & 0x01),
    userVerified: Boolean(flags & 0x04),
    signCount: buf.readUInt32BE(33),
  };
  if (flags & 0x40) { // 新しいカギが入っている（登録のとき）
    if (buf.length < 55) throw new WebAuthnError('パスキーの中身が短すぎます');
    const idLen = buf.readUInt16BE(53);
    if (idLen < 1 || idLen > 1023 || buf.length < 55 + idLen) throw new WebAuthnError('パスキーの番号が読めません');
    out.credentialId = buf.subarray(55, 55 + idLen);
    out.publicKey = decodeCbor(buf.subarray(55 + idLen)).value;
  }
  return out;
}

// COSE（パスキーのカギの書き方）→ JWK（Node.js が読める形）。ES256・RS256・Ed25519 だけ受けつける
export function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new WebAuthnError('カギが読めません');
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64url(cose.get(-2)), y: b64url(cose.get(-3)) } };
  }
  if (kty === 3 && alg === -257) return { alg, jwk: { kty: 'RSA', n: b64url(cose.get(-1)), e: b64url(cose.get(-2)) } };
  if (kty === 1 && alg === -8 && cose.get(-1) === 6) return { alg, jwk: { kty: 'OKP', crv: 'Ed25519', x: b64url(cose.get(-2)) } };
  throw new WebAuthnError('この端末のカギの種類には、まだ対応していません');
}

// くじ（challenge）。5分で切れて、1回だけ使える
export function createChallenges(clockMs = () => Date.now()) {
  const map = new Map(); // challenge → { userId（登録のとき）, expiresAt }
  const sweep = () => { for (const [k, v] of map) if (v.expiresAt <= clockMs()) map.delete(k); };
  return {
    issue(userId = null) {
      sweep();
      if (map.size > 10000) throw new WebAuthnError('いまは混んでいます。少し待ってからどうぞ');
      const c = b64url(randomBytes(32));
      map.set(c, { userId, expiresAt: clockMs() + CHALLENGE_MS });
      return c;
    },
    take(challenge, userId = null) {
      const v = map.get(challenge);
      map.delete(challenge);
      if (!v || v.expiresAt <= clockMs() || v.userId !== userId) throw new WebAuthnError('時間が切れました。もう一度どうぞ');
    },
  };
}

// clientDataJSON（ブラウザが書いた「どのページで・何のために」）を確かめて、くじを返す
function checkClientData(clientDataJSON, type, origin) {
  let data;
  try { data = JSON.parse(clientDataJSON.toString('utf8')); } catch { throw new WebAuthnError('パスキーの中身が読めません'); }
  if (data.type !== type) throw new WebAuthnError('パスキーの使いかたがちがいます');
  if (data.origin !== origin) throw new WebAuthnError('ほかのページのパスキーは使えません');
  if (data.crossOrigin === true) throw new WebAuthnError('ほかのページのパスキーは使えません');
  return data.challenge;
}

const sameHash = (a, b) => a.length === b.length && timingSafeEqual(a, b);

// 登録：端末がくれたものを確かめて、しまうカギを返す
export function verifyRegistration({ body, rpId, origin, challenges, userId }) {
  const clientDataJSON = fromB64url(body?.clientDataJSON, 'パスキーの中身');
  const attestation = fromB64url(body?.attestationObject, 'パスキーの中身');
  challenges.take(checkClientData(clientDataJSON, 'webauthn.create', origin), userId);
  const att = decodeCbor(attestation).value;
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw new WebAuthnError('パスキーの中身が読めません');
  const auth = parseAuthData(att.get('authData'));
  if (!sameHash(auth.rpIdHash, sha256(rpId))) throw new WebAuthnError('ほかのページのパスキーは使えません');
  if (!auth.userPresent) throw new WebAuthnError('端末で「OK」されませんでした');
  if (!auth.credentialId || !auth.publicKey) throw new WebAuthnError('パスキーのカギが入っていません');
  if (body.id !== undefined && body.id !== b64url(auth.credentialId)) throw new WebAuthnError('パスキーの番号が合いません');
  const { alg, jwk } = coseToJwk(auth.publicKey);
  createPublicKey({ key: jwk, format: 'jwk' }); // 読めるカギか、いま確かめる
  return { id: b64url(auth.credentialId), alg, jwk, signCount: auth.signCount };
}

// ログイン：くじを取り出して、どのパスキーかを返す（カギの持ち主さがしは呼ぶ側で）
export function readAssertion({ body, origin, challenges }) {
  const clientDataJSON = fromB64url(body?.clientDataJSON, 'パスキーの中身');
  const authenticatorData = fromB64url(body?.authenticatorData, 'パスキーの中身');
  const signature = fromB64url(body?.signature, 'パスキーの署名');
  if (typeof body?.id !== 'string' || !body.id) throw new WebAuthnError('パスキーの番号がありません');
  challenges.take(checkClientData(clientDataJSON, 'webauthn.get', origin));
  return { id: body.id, clientDataJSON, authenticatorData, signature };
}

// ログイン：署名を、しまってある公開カギで確かめる。新しい回数（signCount）を返す
export function verifyAssertion({ assertion, passkey, rpId }) {
  const auth = parseAuthData(assertion.authenticatorData);
  if (!sameHash(auth.rpIdHash, sha256(rpId))) throw new WebAuthnError('ほかのページのパスキーは使えません');
  if (!auth.userPresent) throw new WebAuthnError('端末で「OK」されませんでした');
  const data = Buffer.concat([assertion.authenticatorData, sha256(assertion.clientDataJSON)]);
  const key = createPublicKey({ key: passkey.jwk, format: 'jwk' });
  let ok = false;
  try {
    ok = verify(passkey.alg === -8 ? null : 'sha256', data, key, assertion.signature);
  } catch { ok = false; }
  if (!ok) throw new WebAuthnError('パスキーが合いません');
  // 回数が前より大きくならないときは、カギのコピーのおそれ（0 のままの端末もあるので、そのときは見ない）
  if (auth.signCount !== 0 || passkey.signCount !== 0) {
    if (auth.signCount <= passkey.signCount) throw new WebAuthnError('このパスキーは使えません。べつの方法でログインしてください');
  }
  return { signCount: auth.signCount };
}
