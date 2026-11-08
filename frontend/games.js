// ゲーム一覧：遊ぶ・おすすめする（一言つき）・シバのおすすめ・ゲームを作っている人の申しこみ・運営の確認
import { api, refreshMe, headerHtml, escapeHtml, toast, onServerEvents } from '/shared/api.js';
import { SOON_LABEL } from '/shared/soon.js';
import { kitsuneLine } from '/shared/arcade.js';

const $ = (s) => document.querySelector(s);
const AGE = { child: 'だれでも', teen: '13歳から', adult: '18歳から' };
const STATUS = { pending: '運営が見ています', listed: '一覧に出ています', rejected: '見送り' };
let me = null;
let games = [];
let tag = null;
let arcade = { open: true }; // ゲームセンターの営業時間（見る人の年齢で、閉店の時間がちがう）

// ゲームの台（筐体）の見た目：上の看板・画面の絵・台の色。インディーズの台は 🕹️
// ※ ともはね は課金なしなので、コインやお金の絵は使わない
const CABINET = {
  tomojan: { icon: '✊✌️✋', color: '#e8873a', attract: 'シバと勝負！' },
  ghost: { icon: '👻🏃', color: '#7e5bb5', attract: 'きのうの自分と勝負！' },
  korotomo: { icon: '🤖⭐', color: '#3b7dc4', attract: '星をあつめよう' },
  soratomo: { icon: '🛰️🌍', color: '#1b2560', attract: '衛星をうごかそう' },
};
function screenHtml(g, closed) {
  const c = CABINET[g.id] ?? { icon: '🕹️', attract: 'スタートをおしてね' };
  const msg = g.soon ? '🛠 じゅんび中' : closed ? '🌙 閉店中' : c.attract;
  return `<div class="cab-screen${g.soon || closed ? ' is-off' : ''}" aria-hidden="true">
      <span class="cab-icon">${c.icon}</span><span class="cab-attract">${msg}</span></div>`;
}

function gameHtml(g, isNew = false) {
  const closed = g.id !== 'ghost' && !arcade.open;
  const voices = g.voices.map((v) => `<li>${v.oshi ? `<span class="oshi-badge">${escapeHtml(v.oshi)}推し</span> ` : ''}${escapeHtml(v.name)}さん「${escapeHtml(v.comment)}」</li>`).join('');
  const marks = [
    g.soon ? `<strong>${SOON_LABEL}</strong>` : null,
    g.builtin ? 'ともはね' : `🛠️ ${escapeHtml(g.maker)}`,
    AGE[g.minAge],
  ].filter(Boolean).map((t) => `<span class="game-tag">${t}</span>`).join('');
  return `<li class="card game-card cabinet" style="--cab:${(CABINET[g.id] ?? { color: '#2f9e8f' }).color}">
    <div class="cab-marquee"><h2>${escapeHtml(g.name)}</h2>${isNew ? '<span class="cab-new">NEW</span>' : ''}</div>
    ${screenHtml(g, closed)}
    <div class="game-head">
      <span class="muted small">${g.builtin ? 'ともはねの台' : 'インディーズ・個人の台'}</span>
      <span class="rec-count" title="おすすめの数">💖 ${g.recCount}</span>
    </div>
    <p>${escapeHtml(g.description)}</p>
    <p class="game-tags">${marks}${g.tags.map((t) => `<button type="button" class="game-tag tag-btn" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('')}</p>
    ${g.myRecord ? `<p class="muted small">あなたの記録：${g.myRecord.plays}回あそんだ${g.myRecord.best != null ? `・いちばん ${g.myRecord.best}` : ''}</p>` : ''}
    ${voices ? `<ul class="voices">${voices}</ul>` : ''}
    <div class="row wrap">
      ${g.soon ? `<span class="btn ghost" aria-disabled="true">${SOON_LABEL}（まだ遊べません）</span>`
    : closed ? `<span class="btn ghost" aria-disabled="true">🌙 閉店中（${arcade.opensAt}時に開店）</span>`
    : `<a class="btn" href="${escapeHtml(g.play)}">▶ 遊ぶ</a>`}
      ${me && !g.soon ? `<button type="button" class="btn ghost" data-rec="${escapeHtml(g.id)}">${g.myRec ? '💖 おすすめ中（一言を変える）' : '🤍 おすすめする'}</button>` : ''}
      ${g.myRec ? `<button type="button" class="btn ghost" data-unrec="${escapeHtml(g.id)}">取り消す</button>` : ''}
    </div>
    <form class="rec-form" data-form="${escapeHtml(g.id)}" hidden>
      <label class="field">おすすめの一言（60文字まで・なくてもよい）
        <input class="input" name="comment" maxlength="60" value="${escapeHtml(g.myRec?.comment ?? '')}"></label>
      <p class="error" role="alert"></p>
      <button class="btn" type="submit">おすすめする</button>
    </form>
  </li>`;
}

function renderList() {
  const tags = [...new Set(games.flatMap((g) => g.tags))];
  $('#tags').innerHTML = [`<button type="button" class="game-tag tag-btn" data-tag="" aria-pressed="${!tag}">すべて</button>`,
    ...tags.map((t) => `<button type="button" class="game-tag tag-btn" data-tag="${escapeHtml(t)}" aria-pressed="${tag === t}">#${escapeHtml(t)}</button>`)].join('');
  const shown = tag ? games.filter((g) => g.tags.includes(tag)) : games;
  // いちばん新しく入ったインディーズ・個人の台に「NEW」
  const newest = games.filter((g) => !g.builtin).at(-1)?.id;
  $('#games').innerHTML = shown.map((g) => gameHtml(g, g.id === newest)).join('') || '<li class="muted">このタグのゲームはありません</li>';
}

async function loadGames() {
  try {
    games = await api('/games');
    renderList();
  } catch (e) {
    $('#games').innerHTML = `<li class="error">${escapeHtml(e.message)}</li>`;
  }
}
async function loadPick() {
  try {
    const r = await api('/games/recommend');
    $('#pick').innerHTML = r && !arcade.open
      ? `ゲロ……いまは閉店中。あした開いたら「${escapeHtml(r.name)}」がおすすめだよ。おやすみゲロ〜`
      : r
      ? `ゲロゲロ！ ${me ? `${escapeHtml(me.name)}さん` : 'いま'}へのおすすめは「<a href="${escapeHtml(r.play)}">${escapeHtml(r.name)}</a>」！ ${escapeHtml(r.reason)}んだよ。${r.comment ? `「${escapeHtml(r.comment)}」って声もあるよ！` : ''}`
      : 'ゲロ……いまは遊べる台がないみたい……';
  } catch { /* noop */ }
}

$('#tags').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tag]');
  if (!b) return;
  tag = b.dataset.tag || null;
  renderList();
});
$('#games').addEventListener('click', async (e) => {
  const t = e.target.closest('.tag-btn');
  if (t) { tag = t.dataset.tag; renderList(); return; }
  const rec = e.target.closest('[data-rec]');
  if (rec) {
    const form = $(`[data-form="${CSS.escape(rec.dataset.rec)}"]`);
    form.hidden = !form.hidden;
    if (!form.hidden) form.elements.comment.focus();
    return;
  }
  const un = e.target.closest('[data-unrec]');
  if (un) {
    await api(`/games/${encodeURIComponent(un.dataset.unrec)}/recommend`, { method: 'DELETE' });
    toast('おすすめを取り消しました');
    loadGames(); loadPick();
  }
});
$('#games').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api(`/games/${encodeURIComponent(form.dataset.form)}/recommend`, { method: 'PUT', body: { comment: form.elements.comment.value } });
    toast('おすすめしました 💖');
    loadGames(); loadPick();
  } catch (err) {
    form.querySelector('.error').textContent = err.message;
  }
});

// ---- ゲームを作っている人へ ----
async function loadMine() {
  if (me?.ageGroup !== 'adult') return;
  const mine = await api('/games/mine').catch(() => []);
  $('#mine').innerHTML = mine.map((g) => `<li>${escapeHtml(g.name)}（ID：<code>${escapeHtml(g.id)}</code>）… ${STATUS[g.status] ?? g.status}</li>`).join('');
}
$('#apply').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = f.querySelector('.error');
  err.textContent = '';
  const body = Object.fromEntries(['id', 'name', 'maker', 'url', 'description', 'tags', 'minAge'].map((k) => [k, f.elements[k].value.trim()]));
  try {
    const r = await api('/games/apply', { method: 'POST', body });
    $('#secret').textContent = r.secret;
    $('#secret-box').hidden = false;
    f.reset();
    toast('申しこみました。運営が見るまで待ってください', 5000);
    loadMine(); loadReview();
  } catch (x) {
    err.textContent = x.message;
  }
});

// ---- 運営 ----
async function loadReview() {
  if (me?.role !== 'admin') return;
  const list = await api('/games/review').catch(() => []);
  $('#review').hidden = false;
  $('#review-list').innerHTML = list.map((g) => `<li>
    <strong>${escapeHtml(g.name)}</strong>（${escapeHtml(g.maker)}・申しこみ：${escapeHtml(g.owner)}さん）… ${STATUS[g.status] ?? g.status}<br>
    <span class="small">${escapeHtml(g.url)}・${AGE[g.minAge]}<br>${escapeHtml(g.description)}</span>
    <div class="row wrap">
      ${g.status !== 'listed' ? `<button type="button" class="btn" data-status="listed" data-id="${escapeHtml(g.id)}">一覧に出す</button>` : ''}
      ${g.status !== 'rejected' ? `<button type="button" class="btn ghost" data-status="rejected" data-id="${escapeHtml(g.id)}">見送る</button>` : ''}
    </div></li>`).join('') || '<li class="muted">申しこみはまだありません</li>';
}
$('#review-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-status]');
  if (!b) return;
  await api(`/games/${encodeURIComponent(b.dataset.id)}/status`, { method: 'POST', body: { status: b.dataset.status } });
  loadReview(); loadGames();
});

me = await refreshMe();
$('#header').innerHTML = headerHtml('games');
try { arcade = await api('/arcade'); } catch { /* オフラインなら開いているあつかい（サーバーでも止める） */ }
$('#kitsune-say').textContent = kitsuneLine(arcade);
document.body.classList.toggle('arcade-closed', !arcade.open);
if (new URLSearchParams(location.search).get('closed')) {
  toast('🦊 いまは閉店中！ また明日「もう一回！」しよう', 5000);
  history.replaceState(null, '', location.pathname);
}
$('#apply').hidden = me?.ageGroup !== 'adult';
$('#apply-login').hidden = me?.ageGroup === 'adult';
loadGames();
loadPick();
loadMine();
loadReview();
onServerEvents({ game: () => { loadGames(); loadPick(); } });
