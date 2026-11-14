// つながるアプリ（ともじゃん・ゴーストエージェント・みせとも・ころとも・そらとも・はーとも美術館・ともーるアリーナ・Vとも・2Dメタバース）との連結：「ともはねでログイン」の通行証と、結果の受けとり。
// アプリに渡すのは、アプリ用の番号（ともはねの ID そのものではない）・表示名・年齢の区分だけ
// アプリ用の番号はアプリごとにちがう（ともじゃんとゴーストの番号を見比べても、同じ人だと分からない）
// アプリから受けとるのは、数（勝ち数・自己ベストの回数など）だけ
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GAME_URL = (process.env.GAME_URL || 'http://localhost:3300').replace(/\/+$/, '');
export const GHOST_URL = (process.env.GHOST_URL || 'http://localhost:3500').replace(/\/+$/, '');
export const MISETOMO_URL = (process.env.MISETOMO_URL || 'http://localhost:3600').replace(/\/+$/, '');
export const KOROTOMO_URL = (process.env.KOROTOMO_URL || 'http://localhost:3700').replace(/\/+$/, '');
export const SORATOMO_URL = (process.env.SORATOMO_URL || 'http://localhost:3800').replace(/\/+$/, '');
export const HAATOMO_URL = (process.env.HAATOMO_URL || 'http://localhost:4000').replace(/\/+$/, ''); // はーとも美術館
export const TOMORU_URL = (process.env.TOMORU_URL || 'http://localhost:4100').replace(/\/+$/, ''); // ともーるアリーナ
export const VTOMO_URL = (process.env.VTOMO_URL || 'http://localhost:4200').replace(/\/+$/, ''); // Vとも（2D のキャラ作り）
export const METAVERSE_URL = (process.env.METAVERSE_URL || 'http://localhost:4300').replace(/\/+$/, ''); // 2Dメタバース（仮）
// ゲームのアプリと ともはね で同じ値にする合言葉（サーバーどうしの確認用）。本番では必ず設定する
export const LINK_SECRET = process.env.LINK_SECRET || 'tomohane-dev-link-secret';
const TICKET_MS = 60 * 1000; // 通行証は1分だけ・1回だけ

export function createGameLink({ app = 'tomojan', secret = LINK_SECRET, gameUrl = GAME_URL, now = () => Date.now() } = {}) {
  const tickets = new Map();
  return {
    gameUrl,
    app,
    // ともじゃんは前からの番号のまま。ほかのアプリは、アプリの名前もまぜて別の番号にする
    gameIdOf: (userId) => (app === 'tomojan'
      ? `g_${createHmac('sha256', secret).update(String(userId)).digest('base64url').slice(0, 22)}`
      : `${app[0]}_${createHmac('sha256', secret).update(`${app}:${userId}`).digest('base64url').slice(0, 22)}`),
    issue(userId) {
      for (const [t, x] of tickets) if (x.expires < now()) tickets.delete(t);
      const ticket = randomBytes(24).toString('base64url');
      tickets.set(ticket, { userId, expires: now() + TICKET_MS });
      return ticket;
    },
    redeem(ticket) {
      const x = tickets.get(ticket);
      tickets.delete(ticket);
      return x && x.expires >= now() ? x.userId : null;
    },
    checkSecret(given) {
      const a = Buffer.from(String(given ?? ''));
      const b = Buffer.from(secret);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
