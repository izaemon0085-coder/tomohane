// ログイン・はじめる（登録）・パスワードを忘れた・アカウント
// ログインのしるしはサーバーのクッキー（JavaScript からは読めない）。ここでは画面の写しだけを更新する
import { api, refreshMe, rememberMe, logout, headerHtml, escapeHtml, toast, timeAgo } from '/shared/api.js';

const $ = (sel) => document.querySelector(sel);
const AGE = { child: '子ども（12歳まで）', teen: '中高生（13〜17歳）', adult: '大人（18歳から）' };
const ROLE = { admin: '運営（管理者）', user: 'ユーザー' };

// ログインしたあとに、もどる画面（このサイトの中のページだけ）
function nextUrl() {
  const next = new URLSearchParams(location.search).get('next') || '/';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login.html') ? next : '/';
}

function guide(face, name, text) {
  $('#guide-face').src = `/shared/avatars/${face}.svg`;
  $('#guide-name').textContent = `${name}から`;
  $('#guide-text').textContent = text;
}

function showTab(id) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const on = tab.id === `tab-${id}`;
    tab.setAttribute('aria-selected', String(on));
    $(`#${tab.getAttribute('aria-controls')}`).hidden = !on;
  }
  if (id === 'register') guide('fukurou', 'フクロウ', 'ほう、ようこそ。パスワードは、ほかのサイトと同じものは使わないでくだされ。');
  if (id === 'recover') guide('yamaneko', 'ヤマネコ', '登録したときの回復コードを使う。1つ使うと、そのコードはもう使えない。');
  if (id === 'login') guide('shiba', 'シバ', 'おかえりなさいっす！');
}
document.querySelector('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[role="tab"]');
  if (tab) showTab(tab.id.replace('tab-', ''));
});

function render(me) {
  $('#header').innerHTML = headerHtml('login');
  $('#auth').hidden = Boolean(me);
  $('#account').hidden = !me;
  if (!me) return;
  $('#account-title').textContent = `${me.name} さん`;
  $('#acc-login').textContent = me.loginId;
  $('#acc-age').textContent = AGE[me.ageGroup] ?? '―';
  $('#acc-role').textContent = ROLE[me.role] ?? me.role;
  $('#acc-soratomo').textContent = me.soratomo ? `ミッション達成 ${me.soratomo.missions}回（${me.soratomo.plays}回あそんだ）` : 'まだ遊んでいません（町の地図の「宇宙」から）';
  $('#acc-korotomo').textContent = me.korotomo ? `ゴール ${me.korotomo.goals}回（${me.korotomo.plays}回あそんだ）` : 'まだ遊んでいません（町の地図のガレージのとなりから）';
  $('#acc-ghost').textContent = me.ghost ? `自己ベスト更新 ${me.ghost.bests}回・${me.ghost.days}日つづけた` : 'まだ使っていません（町の地図のグラウンドから）';
  $('#acc-game').textContent = me.game ? `${me.game.wins}勝（${me.game.plays}回あそんだ）` : 'まだ遊んでいません（町の地図のシバの家から）';
  $('#acc-child').hidden = me.ageGroup !== 'child';
  $('#acc-back').href = nextUrl();
  renderFamily(me);
}

// ---- 保護者とつなぐ ----
async function renderFamily(me) {
  const isAdult = me.ageGroup === 'adult';
  const isChild = me.ageGroup === 'child';
  $('#family').hidden = !isAdult && !isChild;
  $('#family-adult').hidden = !isAdult;
  $('#family-child').hidden = !isChild;
  if (!isAdult && !isChild) return;
  let data;
  try { data = await api('/guardian'); } catch { return; }
  if (isChild) {
    $('#family-guardians').textContent = data.guardians.length
      ? `つながっているおうちの人：${data.guardians.map((g) => g.name).join('、')}`
      : 'まだ、おうちの人とつながっていません。';
    return;
  }
  const count = (label, v, text) => (v ? `${label} ${text(v)}` : null);
  $('#family-children').innerHTML = data.children.map((c) => {
    const games = [
      count('じゃんけん', c.game, (g) => `${g.wins}勝`),
      count('ゴースト', c.ghost, (g) => `自己ベスト${g.bests}回`),
      count('ころとも', c.korotomo, (g) => `ゴール${g.goals}回`),
      count('そらとも', c.soratomo, (g) => `ミッション${g.missions}回`),
    ].filter(Boolean).join('・') || 'ゲームはまだ';
    const posts = c.recentPosts.length
      ? `<ul class="posts">${c.recentPosts.map((p) => `<li>${escapeHtml(p.text)} <span class="muted">（${escapeHtml(timeAgo(p.createdAt))}）</span></li>`).join('')}</ul>`
      : '<p class="muted small">広場の投稿はまだありません</p>';
    return `<li><strong>${escapeHtml(c.name)}</strong> <span class="muted small">${escapeHtml(games)}</span>${posts}
      <button type="button" class="btn ghost" data-unlink="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">つなぐのをやめる</button></li>`;
  }).join('');
}
$('#family-issue').addEventListener('click', async () => {
  try {
    const r = await api('/guardian/code', { method: 'POST' });
    $('#family-code').textContent = r.code;
  } catch (e) {
    toast(e.message, 5000);
  }
});
$('#family-children').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-unlink]');
  if (!btn || !confirm(`${btn.dataset.name} さんと、つなぐのをやめますか？`)) return;
  try {
    await api(`/guardian/children/${btn.dataset.unlink}`, { method: 'DELETE' });
    toast('つなぐのをやめました');
    renderFamily(await refreshMe());
  } catch (err) {
    toast(err.message, 5000);
  }
});
$('#family-join').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await submit(e.target, '/guardian/join', ['code']);
  if (!r) return;
  e.target.reset();
  toast(`${r.name} さんとつながりました`, 5000);
  renderFamily(await refreshMe());
});

async function submit(form, path, fields) {
  const err = form.querySelector('.error');
  err.textContent = '';
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const body = Object.fromEntries(fields.map((k) => [k, form.elements[k].value.trim()]));
    return await api(path, { method: 'POST', body });
  } catch (e) {
    err.textContent = e.offline ? 'つながっていません。つながってから、もう一度どうぞ' : e.message;
    return null;
  } finally {
    btn.disabled = false;
  }
}

$('#panel-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await submit(e.target, '/auth/login', ['loginId', 'password']);
  if (!r) return;
  rememberMe(r.me);
  location.href = nextUrl();
});

let pendingCodes = [];
$('#panel-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await submit(e.target, '/auth/register', ['loginId', 'name', 'password', 'birthdate']);
  if (!r) return;
  rememberMe(r.me);
  pendingCodes = r.recoveryCodes;
  $('#auth').hidden = true;
  $('#header').innerHTML = headerHtml('login');
  $('#code-list').innerHTML = pendingCodes.map((c) => `<li><code>${escapeHtml(c)}</code></li>`).join('');
  $('#codes').hidden = false;
  $('#codes').focus?.();
});
$('#codes-done').addEventListener('change', (e) => { $('#codes-next').disabled = !e.target.checked; });
$('#save-codes').addEventListener('click', () => {
  const text = ['ともはね 回復コード（1つにつき1回だけ使えます。人に見せないでください）', '', ...pendingCodes].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = 'tomohane-recovery-codes.txt';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});
$('#codes-next').addEventListener('click', () => { location.href = nextUrl(); });

$('#panel-recover').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await submit(e.target, '/auth/recover', ['loginId', 'code', 'newPassword']);
  if (!r) return;
  rememberMe(r.me);
  toast(`パスワードを変えました。回復コードはあと ${r.codesLeft} つです`, 5000);
  render(r.me);
});

$('#logout').addEventListener('click', async () => {
  await logout();
  toast('ログアウトしました');
  render(null);
});
$('#logout-all').addEventListener('click', async () => {
  if (!confirm('すべての端末からログアウトしますか？')) return;
  await logout({ everywhere: true });
  toast('すべての端末からログアウトしました');
  render(null);
});

if (new URLSearchParams(location.search).get('tab') === 'register') showTab('register');
render(await refreshMe());
