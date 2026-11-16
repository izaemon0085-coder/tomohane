// 工房の台で遊ぶ：ビーバー一家の工房で作られたゲーム（運営が並べたもの）を、ともはね の中で遊ぶ
// しくみ・描き方は工房と同じもの（/shared/kobo/）。記録はサーバーに送らない
import { api, refreshMe, headerHtml, escapeHtml } from '/shared/api.js';
import { startPlay, step, missions, npcEmoji } from '/shared/kobo/game.js';
import { drawBoard } from '/shared/kobo/board.js';
import { renderChibi } from '/shared/kobo/parts.js';

const $ = (s) => document.querySelector(s);
let game = null;
let play = null;
let talkIdx = 0;
let frame = 0;
let charaImg = null;

async function loadChara(dir = 'down') {
  const im = new Image();
  im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderChibi(game.look, { dir, frame }))}`;
  await im.decode();
  charaImg = im;
}
function draw() {
  drawBoard($('#board'), game, { play, chara: charaImg });
  $('#stars').textContent = game.stars.length ? `★ ${play.got.length} / ${game.stars.length}` : '';
  const ms = missions(game, play);
  $('#missions').innerHTML = ms.length ? `<span class="muted">ミッション：</span>${ms.map((m) => `<span class="${m.done ? 'is-done' : ''}">${m.done ? '✅' : '⬜'} ${escapeHtml(m.text)}</span>`).join('')}` : '';
  const t = play.talk;
  $('#talk').hidden = !t;
  if (t) {
    $('#talk-face').textContent = npcEmoji(t.kind);
    $('#talk-name').textContent = t.name;
    $('#talk-line').textContent = t.lines[talkIdx] ?? '';
    $('#talk-next').textContent = talkIdx < t.lines.length - 1 ? `つぎへ ▶（${talkIdx + 1}/${t.lines.length}）` : 'とじる ✕';
  }
}
function nextTalk() {
  if (!play?.talk) return false;
  if (talkIdx < play.talk.lines.length - 1) talkIdx += 1;
  else { play = { ...play, talk: null }; talkIdx = 0; }
  draw();
  return true;
}
async function move(dir) {
  if (!play || play.cleared) return;
  if (nextTalk()) return; // 話しているあいだは、歩かずにつぎへ
  play = step(game, play, dir);
  talkIdx = 0;
  frame = (frame + 1) % 4;
  await loadChara(play.dir);
  draw();
  const left = missions(game, play).filter((m) => !m.done);
  if (play.cleared) $('#msg').innerHTML = `<span class="ok">🎉 クリア！ ${play.steps}歩でゴール。</span>${play.msg ? ` ${escapeHtml(play.msg)}` : ''} 🦊「もう一回！」`;
  else if (play.msg) $('#msg').textContent = `💬 ${play.msg}`;
  else if (play.needStars) $('#msg').textContent = play.got.length < game.stars.length ? `★ をあと ${game.stars.length - play.got.length} こ集めてから🚩へ！` : `ミッション「${left[0]?.text ?? ''}」をすませてから🚩へ！`;
  else if (!play.talk) $('#msg').textContent = '';
}
async function restart() {
  play = startPlay(game); talkIdx = 0; frame = 0;
  $('#msg').textContent = '';
  await loadChara();
  draw();
  $('#board').focus();
}

const me = await refreshMe();
$('#header').innerHTML = headerHtml('games');
const id = new URLSearchParams(location.search).get('id') ?? '';
try {
  const r = await api(`/kobo/${encodeURIComponent(id)}`);
  game = r.game;
  document.title = `${r.title} | 工房の台 | ともはね β版`;
  $('#game-title').textContent = `🦫 ${r.title}`;
  $('#by').textContent = `作った人：${r.author}（ビーバー一家の工房）`;
  $('#trial').hidden = r.status === 'listed';
  $('#stage').hidden = false;
  await restart();
} catch (e) {
  if (e.status === 423) location.replace('/games.html?closed=1');
  $('#none').hidden = false;
  $('#none').textContent = me ? e.message : `${e.message}（ログインすると見られるゲームもあります）`;
}

const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
$('#board').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextTalk(); return; }
  if (!KEYS[e.key]) return;
  e.preventDefault(); move(KEYS[e.key]);
});
$('#pad').addEventListener('click', (e) => { const b = e.target.closest('[data-move]'); if (b) move(b.dataset.move); });
$('#talk-next').addEventListener('click', () => { nextTalk(); $('#board').focus(); });
$('#again').addEventListener('click', restart);
