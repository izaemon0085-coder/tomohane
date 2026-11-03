// ともはね連結キット：あなたのゲームに「ともはねでログイン」をつなぐ部品（Node 20 から・外部パッケージなし）
//
// つかいかた（くわしくは README.md）
//   import { createTomohaneLink } from './tomohane-link.js';
//   const tomohane = createTomohaneLink({
//     baseUrl: 'http://localhost:3000',          // ともはね のアドレス
//     gameId: 'my-game',                          // 申しこんだときのゲームのID
//     secret: process.env.TOMOHANE_SECRET,        // 申しこんだときに1回だけ出た合言葉（コードに書かない）
//   });
//   // 1) あなたのサーバーの /auth/callback?ticket=... で
//   const player = await tomohane.redeem(ticket); // → { gameId: 'x_…', name: '表示名', ageGroup: 'child' | 'teen' | 'adult' }
//   // 2) 遊んだあとに（数だけ送れる。ほかのことは送れない）
//   await tomohane.report(player.gameId, { plays: 3, best: 120 });
//
// 約束
// ・ともはねから来るのは「ゲーム用の番号・表示名・年齢の区分」だけ。本当の ID やパスワードは来ない
// ・番号はゲームごとにちがう（ほかのゲームと見比べても、同じ人だと分からない）
// ・年齢の区分が child（12歳まで）の人には、広告・課金を出さないでください
// ・合言葉は、サーバーの中だけに置く（ブラウザの JavaScript やリポジトリに書かない）

export function createTomohaneLink({ baseUrl, gameId, secret, fetchImpl = fetch, timeoutMs = 3000 }) {
  if (!baseUrl || !gameId || !secret) throw new Error('baseUrl・gameId・secret が必要です');
  const base = String(baseUrl).replace(/\/+$/, '');
  const root = `${base}/api/link/x/${encodeURIComponent(gameId)}`;
  const headers = { 'X-Link-Secret': secret };

  return {
    // ともはねの「遊ぶ」ボタンのアドレス（あなたのゲームの「ともはねでログイン」ボタンにも使える）
    startUrl: `${root}/start`,

    // 通行証（1分・1回だけ）を、ともはねに確かめてもらう
    async redeem(ticket) {
      if (!/^[\w-]{16,64}$/.test(String(ticket ?? ''))) throw new Error('通行証の形が正しくありません');
      const res = await fetchImpl(`${root}/ticket/${encodeURIComponent(ticket)}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `ともはねに確かめられませんでした（${res.status}）`);
      return { gameId: String(data.gameId), name: String(data.name), ageGroup: data.ageGroup };
    },

    // 遊んだ回数（plays）と、いちばんの記録（best・なくてもよい）を知らせる。どちらも 0 以上の整数
    async report(playerId, { plays, best = null }) {
      const res = await fetchImpl(`${root}/results`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: playerId, plays, best }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `記録を送れませんでした（${res.status}）`);
      return data;
    },
  };
}
