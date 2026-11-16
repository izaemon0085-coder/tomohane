// ※ ビーバー一家の工房（../kobo/public/board.js）の写し。直すときは工房のほうを直して、ここにコピーする（テストで同じか確かめる）
// ビーバー一家の工房（仮）：地図の描き方（工房の画面でも、ともはね のゲームセンターでも同じものを使う・外部パッケージなし）
// ともはね の shared/kobo/board.js はこのファイルの写し
import { TILES, npcEmoji } from './game.js';

export const T = 40; // 1マスの大きさ（canvas の中）

export function drawTile(ctx, t, x, y) {
  const px = x * T; const py = y * T;
  ctx.fillStyle = TILES[t].color; ctx.fillRect(px, py, T, T);
  if (t === 'tree') { ctx.fillStyle = '#4f8f4a'; ctx.beginPath(); ctx.arc(px + T / 2, py + T * 0.42, T * 0.34, 0, 7); ctx.fill(); ctx.fillStyle = '#7a4a2a'; ctx.fillRect(px + T * 0.44, py + T * 0.68, T * 0.12, T * 0.22); }
  if (t === 'wall') { ctx.fillStyle = '#6f757b'; ctx.beginPath(); ctx.ellipse(px + T / 2, py + T * 0.6, T * 0.4, T * 0.3, 0, 0, 7); ctx.fill(); }
  if (t === 'water') { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; for (const k of [0.35, 0.7]) { ctx.beginPath(); ctx.moveTo(px + 6, py + T * k); ctx.quadraticCurveTo(px + T / 2, py + T * k - 6, px + T - 6, py + T * k); ctx.stroke(); } }
  if (t === 'house') { ctx.fillStyle = '#f2e6c8'; ctx.fillRect(px + 8, py + 18, T - 16, T - 22); ctx.fillStyle = '#c8642a'; ctx.beginPath(); ctx.moveTo(px + 4, py + 20); ctx.lineTo(px + T / 2, py + 4); ctx.lineTo(px + T - 4, py + 20); ctx.fill(); }
  if (t === 'flower') { for (const [a, b, c] of [[0.3, 0.35, '#e8739a'], [0.7, 0.6, '#f8b500'], [0.4, 0.75, '#fff']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px + T * a, py + T * b, 3.5, 0, 7); ctx.fill(); } }
  if (t === 'bridge') { ctx.fillStyle = '#6fb6e8'; ctx.fillRect(px, py, 5, T); ctx.fillRect(px + T - 5, py, 5, T); ctx.strokeStyle = '#7a4a2a'; ctx.lineWidth = 2; for (let k = 6; k < T; k += 8) { ctx.beginPath(); ctx.moveTo(px + 5, py + k); ctx.lineTo(px + T - 5, py + k); ctx.stroke(); } }
  if (t === 'path') { ctx.fillStyle = 'rgba(0,0,0,.05)'; ctx.fillRect(px + 2, py + 2, T - 4, T - 4); }
  if (t === 'door') { ctx.fillStyle = '#8a5a3c'; ctx.fillRect(px + 6, py + 4, T - 12, T - 6); ctx.strokeStyle = '#5a3520'; ctx.lineWidth = 2; ctx.strokeRect(px + 6, py + 4, T - 12, T - 6); ctx.fillStyle = '#e9b949'; ctx.beginPath(); ctx.arc(px + T - 12, py + T / 2 + 2, 2.5, 0, 7); ctx.fill(); }
}
export function drawStar(ctx, x, y, got) {
  const cx = x * T + T / 2; const cy = y * T + T / 2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? 6 : 14; ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  ctx.closePath(); ctx.fillStyle = got ? 'rgba(233,185,73,.25)' : '#e9b949'; ctx.fill(); ctx.strokeStyle = '#3b2f2a'; ctx.lineWidth = 1.5; ctx.stroke();
}
function drawGoal(ctx, p) {
  const gx = p.x * T; const gy = p.y * T;
  ctx.fillStyle = '#7a4a2a'; ctx.fillRect(gx + 12, gy + 6, 3, T - 10);
  ctx.fillStyle = '#e8739a'; ctx.beginPath(); ctx.moveTo(gx + 15, gy + 6); ctx.lineTo(gx + 32, gy + 12); ctx.lineTo(gx + 15, gy + 19); ctx.fill();
}
// 村の人（ミッションでまだ話していない人には「！」）。numbers：番号をつける（おはなし係の作業台）
export function drawNpcs(ctx, npcs = [], { talked = null, numbers = false } = {}) {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  npcs.forEach((n, i) => {
    ctx.font = '28px system-ui, "Segoe UI Emoji", "Apple Color Emoji"';
    ctx.fillText(npcEmoji(n.kind), n.x * T + T / 2, n.y * T + T / 2 + 2);
    if (n.must && !talked?.includes(i)) { ctx.fillStyle = '#f2a93b'; ctx.beginPath(); ctx.arc(n.x * T + T - 8, n.y * T + 8, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.fillText('！', n.x * T + T - 8, n.y * T + 9); }
    if (numbers) { ctx.fillStyle = '#6a4fc9'; ctx.font = 'bold 12px system-ui'; ctx.fillText(String(i + 1), n.x * T + 8, n.y * T + 9); }
  });
  ctx.restore();
}
// 地図をまるごと描く：マス（テストプレイ中は、しかけで変わった地図）・ゴール・スタート・星・村の人。
// over(ctx) は、キャラの前に重ねる印（作業台の印など）。キャラ（chara：Image）は最後
export function drawBoard(canvas, game, { play = null, chara = null, numbers = false, over = null } = {}) {
  const h = game.map.length; const w = game.map[0].length;
  canvas.width = w * T; canvas.height = h * T;
  const ctx = canvas.getContext('2d');
  const cur = play?.map ?? game.map;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) drawTile(ctx, cur[y][x], x, y);
  drawGoal(ctx, game.goal);
  if (!play) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('S', game.start.x * T + T / 2, game.start.y * T + T / 2); }
  for (const s of game.stars) drawStar(ctx, s.x, s.y, play?.got.includes(`${s.x},${s.y}`));
  drawNpcs(ctx, game.npcs, { talked: play?.talked ?? null, numbers });
  over?.(ctx);
  const at = play ?? game.start;
  if (chara) ctx.drawImage(chara, at.x * T + 2, at.y * T - 14, T - 4, (T - 4) * (64 / 48));
  return ctx;
}
