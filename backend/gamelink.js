// ゲームのアプリ「ともじゃん」との連結：「ともはねでログイン」の通行証と、勝ち数の受けとり。
// ゲームに渡すのは、ゲーム用の番号（ともはねの ID そのものではない）・表示名・年齢の区分だけ
// ゲームから受けとるのは、勝ち数と参加回数だけ
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GAME_URL = (process.env.GAME_URL || 'http://localhost:3300').replace(/\/+$/, '');
// ゲームのアプリと ともはね で同じ値にする合言葉（サーバーどうしの確認用）。本番では必ず設定する
export const LINK_SECRET = process.env.LINK_SECRET || 'tomohane-dev-link-secret';
const TICKET_MS = 60 * 1000; // 通行証は1分だけ・1回だけ

export function createGameLink({ secret = LINK_SECRET, gameUrl = GAME_URL, now = () => Date.now() } = {}) {
  const tickets = new Map();
  return {
    gameUrl,
    gameIdOf: (userId) => `g_${createHmac('sha256', secret).update(String(userId)).digest('base64url').slice(0, 22)}`,
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
