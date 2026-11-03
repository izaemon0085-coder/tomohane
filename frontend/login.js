// ログイン・はじめる（登録）・パスワードを忘れた・アカウント
// ログインのしるしはサーバーのクッキー（JavaScript からは読めない）。ここでは画面の写しだけを更新する
import { api, refreshMe, rememberMe, logout, headerHtml, escapeHtml, toast } from '/shared/api.js';

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
  $('#acc-child').hidden = me.ageGroup !== 'child';
  $('#acc-back').href = nextUrl();
}

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
