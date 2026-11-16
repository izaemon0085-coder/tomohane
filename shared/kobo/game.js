// ※ ビーバー一家の工房（../kobo/public/game.js）の写し。直すときは工房のほうを直して、ここにコピーする（テストで同じか確かめる）
// ビーバー一家の工房（仮）：ゲームのしくみ（ブラウザでもテストでも同じもの・外部パッケージなし）
// いま作れるのは「ゴールまで歩く・星を集める」ゲームと、からくり係の「しかけ」（〇〇したら △△）、おはなし係の「村の人」（会話・ミッション）
import { precheck } from './precheck.js';
import { checkLook, DEFAULT_LOOK } from './parts.js';

// マス：歩けるか・色・名前
export const TILES = {
  grass: { label: '草', walk: true, color: '#9fd68a' },
  path: { label: '道', walk: true, color: '#e8d3a8' },
  flower: { label: '花', walk: true, color: '#9fd68a' },
  bridge: { label: '橋', walk: true, color: '#b07a4a' },
  water: { label: '川', walk: false, color: '#6fb6e8' },
  wall: { label: '岩', walk: false, color: '#8a8f94' },
  tree: { label: '木', walk: false, color: '#9fd68a' },
  house: { label: '家', walk: false, color: '#9fd68a' },
  door: { label: '扉', walk: false, color: '#e8d3a8' }, // しかけで開く
};
export const TILE_IDS = Object.keys(TILES);
export const MIN = 5;
export const MAX_W = 20;
export const MAX_H = 15;
export const MAX_STARS = 10;
export const TITLE_MAX = 20;
export const isWalk = (map, x, y) => y >= 0 && y < map.length && x >= 0 && x < map[0].length && TILES[map[y][x]]?.walk === true;
const same = (a, b) => a && b && a.x === b.x && a.y === b.y;
const key = (p) => `${p.x},${p.y}`;

// ───── からくり係のしかけ：「〇〇したら △△」 ─────
export const WHEN = [['step', 'ふんだら'], ['stars', '星を集めたら'], ['talk', '話しかけたら']];
export const THEN = [['open', '扉があく'], ['bridge', '橋がかかる'], ['warp', 'ワープする'], ['message', 'メッセージ'], ['win', 'その場でクリア'], ['lose', 'スタートにもどる（わな）']];
export const MAX_RULES = 10;
export const MSG_MAX = 30;
export const needsCell = (t) => t === 'open' || t === 'bridge' || t === 'warp';
// しかけの説明（画面に出す）
export function ruleText(r, npcs = []) {
  const w = r.when.type === 'step' ? `（${r.when.x + 1}, ${r.when.y + 1}）をふんだら` : r.when.type === 'talk' ? `${npcs[r.when.npc]?.name ?? '村の人'}と話したら` : `星を${r.when.n}こ集めたら`;
  const t = {
    open: `（${r.then.x + 1}, ${r.then.y + 1}）の扉があく`, bridge: `（${r.then.x + 1}, ${r.then.y + 1}）に橋がかかる`, warp: `（${r.then.x + 1}, ${r.then.y + 1}）へワープ`,
    message: `「${r.then.text}」と出る`, win: 'その場でクリア', lose: 'スタートにもどる（わな）',
  }[r.then.type];
  return `${w} → ${t}`;
}
// しかけを確かめる（決まった中からだけ・メッセージは送る前のチェック）
export function checkRules(input, w, h, starCount, npcCount = 0) {
  const rules = Array.isArray(input) ? input : [];
  if (rules.length > MAX_RULES) return { ok: false, error: `しかけは${MAX_RULES}こまでです` };
  const pt = (p) => p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  const out = [];
  for (const r of rules) {
    const wt = r?.when?.type;
    const tt = r?.then?.type;
    if (!WHEN.some(([id]) => id === wt) || !THEN.some(([id]) => id === tt)) return { ok: false, error: '知らないしかけがあります' };
    const when = wt === 'step' ? (pt(r.when) ? { type: 'step', x: r.when.x, y: r.when.y } : null)
      : wt === 'talk' ? (Number.isInteger(r.when.npc) && r.when.npc >= 0 && r.when.npc < npcCount ? { type: 'talk', npc: r.when.npc } : null)
      : (Number.isInteger(r.when.n) && r.when.n >= 1 && r.when.n <= starCount ? { type: 'stars', n: r.when.n } : null);
    if (!when) return { ok: false, error: 'しかけの「〇〇したら」の場所や数が正しくありません' };
    let then;
    if (needsCell(tt)) then = pt(r.then) ? { type: tt, x: r.then.x, y: r.then.y } : null;
    else if (tt === 'message') {
      const text = String(r.then.text ?? '').replace(/\s+/g, ' ').trim();
      if (!text || [...text].length > MSG_MAX) return { ok: false, error: `メッセージは1〜${MSG_MAX}文字です` };
      if (precheck(text).level === 'block') return { ok: false, error: 'このメッセージは使えません' };
      then = { type: 'message', text };
    } else then = { type: tt };
    if (!then) return { ok: false, error: 'しかけの「△△」の場所が正しくありません' };
    out.push({ when, then });
  }
  return { ok: true, rules: out };
}
// ───── おはなし係：村の人（会話・ミッション） ─────
// 村の人は運営が用意した動物だけ（絵文字で描く）。せりふ・名前は送る前のチェックを通す
export const NPC_KINDS = [['usagi', 'ウサギ', '🐰'], ['fukurou', 'フクロウ', '🦉'], ['risu', 'リス', '🐿️'], ['kitsune', 'キツネ', '🦊'], ['kaeru', 'カエル', '🐸'], ['tanuki', 'タヌキ', '🦝']];
export const MAX_NPCS = 5;
export const NAME_MAX = 10;
export const LINE_MAX = 40;
export const MAX_LINES = 5;
export const MAX_DONE = 3;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const npcAt = (npcs = [], x, y) => npcs.findIndex((n) => n.x === x && n.y === y);
export const npcEmoji = (kind) => (NPC_KINDS.find(([id]) => id === kind) ?? NPC_KINDS[0])[2];
// せりふの行（1行＝1ふきだし）を確かめる
function checkLines(input, min, max) {
  const lines = (Array.isArray(input) ? input : String(input ?? '').split('\n')).map(clean).filter(Boolean);
  if (lines.length < min || lines.length > max) return { ok: false, error: `せりふは${min}〜${max}行です` };
  for (const l of lines) {
    if ([...l].length > LINE_MAX) return { ok: false, error: `せりふは1行${LINE_MAX}文字までです` };
    if (precheck(l).level === 'block') return { ok: false, error: 'このせりふは使えません' };
  }
  return { ok: true, lines };
}
// 村の人を確かめる（決まった中からだけ）
export function checkNpcs(input, w, h, starCount) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > MAX_NPCS) return { ok: false, error: `村の人は${MAX_NPCS}人までです` };
  const out = [];
  for (const n of list) {
    if (!n || !NPC_KINDS.some(([id]) => id === n.kind)) return { ok: false, error: '知らない村の人がいます' };
    if (!(Number.isInteger(n.x) && Number.isInteger(n.y) && n.x >= 0 && n.y >= 0 && n.x < w && n.y < h)) return { ok: false, error: '村の人の立つ場所が正しくありません' };
    if (out.some((o) => o.x === n.x && o.y === n.y)) return { ok: false, error: 'おなじマスに2人は立てません' };
    const name = clean(n.name) || NPC_KINDS.find(([id]) => id === n.kind)[1];
    if ([...name].length > NAME_MAX) return { ok: false, error: `村の人の名前は${NAME_MAX}文字までです` };
    if (precheck(name).level === 'block') return { ok: false, error: 'この名前は使えません' };
    const lc = checkLines(n.lines, 1, MAX_LINES);
    if (!lc.ok) return lc;
    let quest = null;
    let done = [];
    if (n.quest) {
      if (!(Number.isInteger(n.quest.n) && n.quest.n >= 1 && n.quest.n <= starCount)) return { ok: false, error: 'おねがいの星の数が正しくありません' };
      quest = { n: n.quest.n };
      const dc = checkLines(n.done?.length ? n.done : ['ありがとう！'], 1, MAX_DONE);
      if (!dc.ok) return dc;
      done = dc.lines;
    }
    out.push({ kind: n.kind, x: n.x, y: n.y, name, lines: lc.lines, must: n.must === true, quest, done });
  }
  return { ok: true, npcs: out };
}
// ミッション（クリアに必要な「話す」「星を見せる」）の一覧
export function missionText(n) { return n.quest ? `${n.name}に星を${n.quest.n}こ見せる` : `${n.name}と話す`; }
export function missions(game, st = null) {
  return (game.npcs ?? []).map((n, i) => ({ i, text: missionText(n), done: !!st?.talked?.includes(i), must: n.must })).filter((m) => m.must);
}
// 村の人を消す（しかけの「〇〇と話したら」も直す）
export function removeNpc(game, i) {
  const npcs = game.npcs.filter((_, k) => k !== i);
  const rules = game.rules.filter((r) => !(r.when.type === 'talk' && r.when.npc === i))
    .map((r) => (r.when.type === 'talk' && r.when.npc > i ? { ...r, when: { type: 'talk', npc: r.when.npc - 1 } } : r));
  return { ...game, npcs, rules };
}

// わな（ふんだらスタートにもどる）のマス
const trapCells = (rules = []) => new Set(rules.filter((r) => r.when.type === 'step' && r.then.type === 'lose').map((r) => key(r.when)));

// 入口から歩いて行けるマス（幅優先）。ワープのしかけは道としてたどる。わなのマスは通らない
export function reachable(map, start, rules = [], npcs = [], extra = []) {
  const seen = new Set();
  if (!isWalk(map, start.x, start.y)) return seen;
  const traps = trapCells(rules);
  for (const n of npcs) traps.add(key(n)); // 村の人のマスは通れない（となりから話しかける）
  const warps = new Map(rules.filter((r) => r.when.type === 'step' && r.then.type === 'warp').map((r) => [key(r.when), r.then]));
  const q = [[start.x, start.y]];
  seen.add(key(start));
  // 話したら・星を集めたら のワープ先も、そこから歩ける
  for (const p of extra) if (!seen.has(key(p)) && isWalk(map, p.x, p.y) && !traps.has(key(p))) { seen.add(key(p)); q.push([p.x, p.y]); }
  while (q.length) {
    const [x, y] = q.shift();
    const next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    const wp = warps.get(`${x},${y}`);
    if (wp) next.push([wp.x, wp.y]);
    for (const [nx, ny] of next) {
      const k = `${nx},${ny}`;
      if (!seen.has(k) && isWalk(map, nx, ny) && !traps.has(k)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen;
}

// しかけを、行けるところから順に動かしてみる（扉があく・橋がかかる）。行ける場所が増えなくなるまで
export function simulate(game) {
  const map = game.map.map((r) => [...r]);
  const rules = game.rules ?? [];
  const npcs = game.npcs ?? [];
  const fired = new Set();
  const talked = new Set();
  const extra = [];
  let r = reachable(map, game.start, rules, npcs);
  let win = false;
  for (let changed = true; changed;) {
    changed = false;
    const stars = game.stars.filter((s) => r.has(key(s))).length;
    // となりまで行ける村の人とは話せる（おねがいは、星が足りていれば）
    npcs.forEach((n, i) => {
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => r.has(`${n.x + dx},${n.y + dy}`));
      if (near && (!n.quest || stars >= n.quest.n)) talked.add(i);
    });
    rules.forEach((rule, i) => {
      if (fired.has(i) || rule.then.type === 'lose') return;
      const ok = rule.when.type === 'step' ? r.has(key(rule.when)) : rule.when.type === 'talk' ? talked.has(rule.when.npc) : stars >= rule.when.n;
      if (!ok) return;
      fired.add(i);
      if (rule.then.type === 'open' && map[rule.then.y][rule.then.x] === 'door') { map[rule.then.y][rule.then.x] = 'path'; changed = true; }
      if (rule.then.type === 'bridge' && map[rule.then.y][rule.then.x] === 'water') { map[rule.then.y][rule.then.x] = 'bridge'; changed = true; }
      if (rule.then.type === 'win') win = true;
      if (rule.then.type === 'warp' && rule.when.type !== 'step') { extra.push(rule.then); changed = true; }
    });
    if (changed) r = reachable(map, game.start, rules, npcs, extra);
  }
  return { reachable: r, map, win, talked };
}

// 地図係のチェック：入口からゴール・全部の星まで歩いて行けるか（しかけもふくめて）。行けないものを教える
export function checkPlayable(game) {
  const { reachable: r, win, talked } = simulate(game);
  const problems = [];
  if (!isWalk(game.map, game.start.x, game.start.y)) problems.push({ kind: 'start', ...game.start, text: 'スタートが歩けないマスの上にあります' });
  if (!win) {
    if (!r.has(key(game.goal))) problems.push({ kind: 'goal', ...game.goal, text: 'ゴールまで歩いて行けません' });
    for (const s of game.stars) if (!r.has(key(s))) problems.push({ kind: 'star', ...s, text: `星（${s.x + 1}, ${s.y + 1}）まで歩いて行けません` });
    (game.npcs ?? []).forEach((n, i) => { if (n.must && !talked.has(i)) problems.push({ kind: 'npc', x: n.x, y: n.y, text: `ミッション「${missionText(n)}」ができません` }); });
  }
  return { ok: problems.length === 0, problems, reachable: r, win };
}

// ゲームのデータを確かめる（ゲームコードを読みこむときも）。決まった中からだけ
export function checkGame(input) {
  const g = input && typeof input === 'object' ? input : null;
  if (!g || !Array.isArray(g.map)) return { ok: false, error: '地図がありません' };
  const h = g.map.length;
  const w = Array.isArray(g.map[0]) ? g.map[0].length : 0;
  if (h < MIN || h > MAX_H || w < MIN || w > MAX_W) return { ok: false, error: `地図の大きさは ${MIN}〜${MAX_W}×${MIN}〜${MAX_H} マスです` };
  for (const row of g.map) {
    if (!Array.isArray(row) || row.length !== w || !row.every((t) => TILE_IDS.includes(t))) return { ok: false, error: '地図に知らないマスがあります' };
  }
  const pt = (p) => p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  if (!pt(g.start) || !pt(g.goal)) return { ok: false, error: 'スタートとゴールを置いてください' };
  if (same(g.start, g.goal)) return { ok: false, error: 'スタートとゴールは別のマスにしてください' };
  const stars = Array.isArray(g.stars) ? g.stars : [];
  if (stars.length > MAX_STARS || !stars.every(pt)) return { ok: false, error: `星は${MAX_STARS}こまでです` };
  const title = String(g.title ?? '').replace(/\s+/g, ' ').trim() || 'わたしのゲーム';
  if ([...title].length > TITLE_MAX) return { ok: false, error: `ゲームの名前は${TITLE_MAX}文字までです` };
  if (precheck(title).level === 'block') return { ok: false, error: 'この名前は使えません' };
  const look = checkLook(g.look ?? DEFAULT_LOOK).look ?? DEFAULT_LOOK;
  const nc = checkNpcs(g.npcs, w, h, stars.length);
  if (!nc.ok) return { ok: false, error: nc.error };
  if (nc.npcs.some((n) => same(n, g.start) || same(n, g.goal) || stars.some((s) => same(s, n)))) return { ok: false, error: 'スタート・ゴール・星と同じマスに、村の人は立てません' };
  const rc = checkRules(g.rules, w, h, stars.length, nc.npcs.length);
  if (!rc.ok) return { ok: false, error: rc.error };
  return {
    ok: true,
    game: {
      title, map: g.map.map((r) => [...r]), start: { x: g.start.x, y: g.start.y }, goal: { x: g.goal.x, y: g.goal.y },
      stars: stars.filter((s, i) => !same(s, g.start) && !same(s, g.goal) && stars.findIndex((t) => same(t, s)) === i).map((s) => ({ x: s.x, y: s.y })),
      look,
      rules: rc.rules,
      npcs: nc.npcs,
    },
  };
}

// テストプレイ：はじまり・1歩・クリア
export function startPlay(game) {
  return { x: game.start.x, y: game.start.y, dir: 'down', steps: 0, got: [], cleared: false, map: game.map.map((r) => [...r]), fired: [], talked: [], msg: null, talk: null };
}
// しかけを動かす（ワープとわな以外は1回だけ）。hit(rule) が true のものだけ
function fire(game, s, pos, hit) {
  let win = false;
  (game.rules ?? []).forEach((r, i) => {
    const repeat = r.then.type === 'warp' || r.then.type === 'lose';
    if (s.fired.includes(i) && !repeat) return;
    if (!hit(r)) return;
    if (!repeat) s.fired.push(i);
    if (r.then.type === 'open' && s.map[r.then.y][r.then.x] === 'door') s.map[r.then.y][r.then.x] = 'path';
    if (r.then.type === 'bridge' && s.map[r.then.y][r.then.x] === 'water') s.map[r.then.y][r.then.x] = 'bridge';
    if (r.then.type === 'message') s.msg = r.then.text;
    if (r.then.type === 'win') win = true;
    if (r.then.type === 'warp' && isWalk(s.map, r.then.x, r.then.y) && npcAt(game.npcs, r.then.x, r.then.y) < 0) { pos.x = r.then.x; pos.y = r.then.y; s.warped = true; }
    if (r.then.type === 'lose') { pos.x = game.start.x; pos.y = game.start.y; s.lost = true; s.msg = 'あっ、わなだ！ スタートにもどった'; }
  });
  return win;
}
const allMissions = (game, talked) => (game.npcs ?? []).every((n, i) => !n.must || talked.includes(i));
// 村の人に話しかける（その人のマスには入らない・歩数にも数えない）
function talkTo(game, s, i, dir) {
  const n = game.npcs[i];
  const met = !n.quest || s.got.length >= n.quest.n;
  const lines = n.quest && met ? n.done : n.quest ? [...n.lines, `（星をあと${n.quest.n - s.got.length}こ）`] : n.lines;
  const pos = { x: s.x, y: s.y };
  let win = false;
  if (met) {
    if (!s.talked.includes(i)) s.talked.push(i);
    win = fire(game, s, pos, (r) => r.when.type === 'talk' && r.when.npc === i);
  }
  const atGoal = pos.x === game.goal.x && pos.y === game.goal.y;
  const cleared = win || (atGoal && s.got.length === game.stars.length && allMissions(game, s.talked));
  return { ...s, ...pos, dir, talk: { npc: i, name: n.name, kind: n.kind, lines }, cleared, bump: false, needStars: false };
}
export function step(game, st, dir) {
  if (st.cleared) return st;
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  if (!d) return st;
  const nx = st.x + d[0];
  const ny = st.y + d[1];
  const map = st.map ?? game.map;
  const s = { ...st, map: map.map((r) => [...r]), fired: [...(st.fired ?? [])], talked: [...(st.talked ?? [])], talk: null, msg: null, lost: false, warped: false };
  const ni = npcAt(game.npcs, nx, ny);
  if (ni >= 0) return talkTo(game, s, ni, dir);
  if (!isWalk(map, nx, ny)) return { ...s, dir, bump: true };
  const pos = { x: nx, y: ny };
  let got = game.stars.some((t) => t.x === nx && t.y === ny) && !st.got.includes(`${nx},${ny}`) ? [...st.got, `${nx},${ny}`] : st.got;
  const g0 = got;
  const win = fire(game, s, pos, (r) => (r.when.type === 'step' ? r.when.x === nx && r.when.y === ny : r.when.type === 'stars' ? g0.length >= r.when.n : false));
  if (s.warped && game.stars.some((t) => t.x === pos.x && t.y === pos.y) && !got.includes(`${pos.x},${pos.y}`)) got = [...got, `${pos.x},${pos.y}`];
  const atGoal = pos.x === game.goal.x && pos.y === game.goal.y;
  const cleared = win || (atGoal && got.length === game.stars.length && allMissions(game, s.talked));
  return { ...s, ...pos, dir, steps: st.steps + 1, got, cleared, bump: false, needStars: atGoal && !cleared };
}

// ちびビーバーのおまかせ：ランダムの迷路（かならずゴールと星まで行ける）
export function randomMaze(w = 13, h = 9, { stars = 3, rand = Math.random } = {}) {
  const W = Math.max(MIN, Math.min(MAX_W, w | 1));
  const H = Math.max(MIN, Math.min(MAX_H, h | 1));
  const map = Array.from({ length: H }, () => Array(W).fill('tree'));
  const carve = (x, y) => {
    map[y][x] = 'path';
    const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]].sort(() => rand() - 0.5);
    for (const [dx, dy] of dirs) {
      const nx = x + dx; const ny = y + dy;
      if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && map[ny][nx] === 'tree') { map[y + dy / 2][x + dx / 2] = 'path'; carve(nx, ny); }
    }
  };
  carve(1, 1);
  const cells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map[y][x] === 'path') cells.push({ x, y });
  const start = { x: 1, y: 1 };
  // ゴールはスタートからいちばん遠いあたり
  const goal = cells.reduce((a, c) => (Math.abs(c.x - 1) + Math.abs(c.y - 1) > Math.abs(a.x - 1) + Math.abs(a.y - 1) ? c : a), start);
  const free = cells.filter((c) => !same(c, start) && !same(c, goal)).sort(() => rand() - 0.5);
  return { title: 'ちびビーバーの迷路', map, start, goal, stars: free.slice(0, Math.min(stars, MAX_STARS)), look: DEFAULT_LOOK, rules: [], npcs: [] };
}

// 親方が用意した見本
export function blankGame(w = 12, h = 9) {
  const map = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 'tree' : 'grass')));
  return { title: 'わたしのゲーム', map, start: { x: 1, y: 1 }, goal: { x: w - 2, y: h - 2 }, stars: [], look: DEFAULT_LOOK, rules: [], npcs: [] };
}
// からくり係の見本：スイッチで橋がかかる・星を2こ集めたら扉があく・わな
export function karakuriGame() {
  const g = blankGame(12, 9);
  for (let y = 1; y < 8; y++) g.map[y][8] = 'wall';
  g.map[4][8] = 'door';
  for (let x = 1; x < 8; x++) g.map[6][x] = 'water';
  g.title = 'からくり屋敷';
  g.stars = [{ x: 6, y: 2 }, { x: 3, y: 7 }];
  g.rules = [
    { when: { type: 'step', x: 2, y: 4 }, then: { type: 'bridge', x: 3, y: 6 } },
    { when: { type: 'stars', n: 2 }, then: { type: 'open', x: 8, y: 4 } },
    { when: { type: 'stars', n: 2 }, then: { type: 'message', text: 'ガチャン！ どこかで扉があいた' } },
    { when: { type: 'step', x: 5, y: 4 }, then: { type: 'lose' } },
  ];
  return g;
}
// おはなし係の見本：村の人と話す・星を見せる → 扉があく
export function ohanashiGame() {
  const g = blankGame(12, 9);
  for (let y = 1; y < 8; y++) g.map[y][9] = 'wall';
  g.map[4][9] = 'door';
  g.map[2][3] = 'house'; g.map[2][6] = 'house'; g.map[6][5] = 'flower'; g.map[6][6] = 'flower';
  for (let x = 1; x < 9; x++) g.map[4][x] = 'path';
  g.title = 'おはなしの村';
  g.start = { x: 1, y: 4 };
  g.goal = { x: 10, y: 4 };
  g.stars = [{ x: 7, y: 1 }, { x: 2, y: 7 }];
  g.npcs = [
    { kind: 'fukurou', x: 2, y: 3, name: '村長のフクロウ', lines: ['ようこそ、おはなしの村へ。', '門番のタヌキに、星を2こ見せておくれ。', 'そうすれば、むこうへの扉をあけてくれるよ。'] },
    { kind: 'usagi', x: 5, y: 5, name: 'ウサギのミミ', lines: ['花がきれいでしょう？', '星はね、村のすみっこにあるんだって。'], must: true },
    { kind: 'tanuki', x: 8, y: 3, name: '門番のタヌキ', lines: ['ここは門だよ。', '星を2こ見せてくれたら、あけてあげる。'], must: true, quest: { n: 2 }, done: ['おお、星が2こ！', 'ガチャン。扉をあけたよ。いってらっしゃい！'] },
  ];
  g.rules = [{ when: { type: 'talk', npc: 2 }, then: { type: 'open', x: 9, y: 4 } }];
  return g;
}
export function riverGame() {
  const g = blankGame(12, 9);
  for (let y = 1; y < 8; y++) g.map[y][6] = 'water';
  g.map[2][6] = 'bridge';
  for (const [x, y] of [[3, 4], [4, 4], [8, 6], [9, 2]]) g.map[y][x] = 'wall';
  g.map[6][2] = 'house';
  g.title = '川をわたって';
  g.stars = [{ x: 3, y: 6 }, { x: 9, y: 4 }];
  return g;
}

// ゲームコード（ゲームをほかの人にわたす・あとで読みこむ文字列）
export function toCode(game) {
  const s = JSON.stringify({ v: 1, ...game });
  return (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromCode(code) {
  try {
    const b = String(code).trim().replace(/-/g, '+').replace(/_/g, '/');
    const s = typeof atob === 'function' ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, 'base64').toString('utf8');
    return checkGame(JSON.parse(s));
  } catch {
    return { ok: false, error: 'ゲームコードが読めませんでした' };
  }
}
