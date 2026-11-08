// ログイン・はじめる（登録）・パスワードを忘れた・アカウント
// ログインのしるしはサーバーのクッキー（JavaScript からは読めない）。ここでは画面の写しだけを更新する
import { api, refreshMe, rememberMe, logout, headerHtml, escapeHtml, toast, timeAgo, safeNext } from '/shared/api.js';
import { REPORT_REASONS } from '/shared/report.js';
import { isComingSoon, SOON_LABEL } from '/shared/soon.js';
import { FAREWELL_CHOICES, SEND_OFF, WELCOME_BACK } from '/shared/leave.js';

const $ = (sel) => document.querySelector(sel);
const AGE = { child: '子ども（12歳まで）', teen: '中高生（13〜17歳）', adult: '大人（18歳から）' };
const ROLE = { admin: '運営（管理者）', user: 'ユーザー' };

const nextUrl = () => safeNext(new URLSearchParams(location.search).get('next'));

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
  $('#acc-soratomo').textContent = isComingSoon('soratomo') && !me.soratomo ? SOON_LABEL : me.soratomo ? `ミッション達成 ${me.soratomo.missions}回（${me.soratomo.plays}回あそんだ）` : 'まだ遊んでいません（ゲームセンターから）';
  $('#acc-korotomo').textContent = isComingSoon('korotomo') && !me.korotomo ? SOON_LABEL : me.korotomo ? `ゴール ${me.korotomo.goals}回（${me.korotomo.plays}回あそんだ）` : 'まだ遊んでいません（ゲームセンターから）';
  $('#acc-ghost').textContent = me.ghost ? `自己ベスト更新 ${me.ghost.bests}回・${me.ghost.days}日つづけた` : 'まだ使っていません（町の地図のグラウンドから）';
  $('#acc-game').textContent = me.game ? `${me.game.wins}勝（${me.game.plays}回あそんだ）` : 'まだ遊んでいません（ゲームセンターから）';
  renderLeaving(me);
  $('#acc-child').hidden = me.ageGroup !== 'child';
  $('#acc-back').href = nextUrl();
  renderFamily(me);
  renderBlocks();
  renderReportAdmin(me);
  renderCafeAdmin(me);
}

// ---- 退会（7日たってから消える。それまではここで取り消せる） ----
const sayLine = (l) => `<div class="say-line"><img src="/shared/avatars/${l.face}.svg" alt="" width="40" height="40"><p><strong>${escapeHtml(l.name)}</strong>：${escapeHtml(l.text)}</p></div>`;
const dateJa = (iso) => new Date(iso).toLocaleString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
function renderLeaving(me) {
  const l = me.leaving;
  $('#leaving').hidden = !l;
  $('#leave-box').hidden = Boolean(l) || me.role === 'admin';
  $('#leave-child-note').hidden = me.ageGroup !== 'child';
  if (!l) return;
  $('#leaving-when').textContent = l.guarded
    ? `${dateJa(l.until)} に、ともはね に入れなくなります。おうちの人には、シバの日記で伝わっています。`
    : `${dateJa(l.until)} に、アカウントと投稿などが消えます。`;
  $('#leaving-lines').innerHTML = SEND_OFF.map(sayLine).join('');
}
$('#leave-farewell-choices').innerHTML = [...FAREWELL_CHOICES, ''].map((t, i) => `<label class="block-kind">
  <input type="radio" name="farewell" value="${escapeHtml(t)}"${i === 0 ? ' checked' : ''}>
  <span><strong>${t ? `「${escapeHtml(t)}」` : '✏️ 自分のことばで'}</strong></span></label>`).join('');
$('#leave-form').addEventListener('change', (e) => {
  if (e.target.name === 'farewell') $('#leave-own-box').hidden = e.target.value !== '';
});
$('#leave-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const err = e.target.querySelector('.error');
  err.textContent = '';
  const farewell = f.farewell.value || f.own.value.trim();
  if (!farewell) {
    err.textContent = 'ひとことを選ぶか、自分のことばを書いてください';
    return;
  }
  if (!confirm('退会を申しこみますか？（7日のあいだは取り消せます）')) return;
  try {
    const r = await api('/auth/leave', { method: 'POST', body: { password: f.password.value, farewell } });
    e.target.reset();
    $('#leave-own-box').hidden = true;
    $('#leave-box').open = false;
    rememberMe(r.me);
    render(r.me);
    $('#leaving').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (ex) {
    err.textContent = ex.offline ? 'つながっていません。つながってから、もう一度どうぞ' : ex.message;
  }
});
$('#leave-cancel').addEventListener('click', async () => {
  try {
    const r = await api('/auth/leave-cancel', { method: 'POST' });
    rememberMe(r.me);
    render(r.me);
    toast(`🐕 ${WELCOME_BACK.text}`, 5000);
  } catch (ex) {
    toast(ex.message, 5000);
  }
});

// ---- 運営だけ：カフェのリクエスト ----
async function renderCafeAdmin(me) {
  $('#cafe-admin').hidden = me.role !== 'admin';
  if (me.role !== 'admin') return;
  let list;
  try { list = await api('/cafe/requests'); } catch { return; }
  $('#cafe-admin-list').innerHTML = list.length ? list.map((r) => `<li>「${escapeHtml(r.text)}」
    <span class="muted small">（${escapeHtml(timeAgo(r.at))}）</span>
    <div class="row wrap">
      <button type="button" class="btn ghost" data-use="${escapeHtml(r.text)}">名前に入れる</button>
      <button type="button" class="btn ghost" data-done="${escapeHtml(r.id)}">片づける</button>
    </div></li>`).join('') : '<li class="muted small">リクエストはありません</li>';
}
$('#cafe-admin-list').addEventListener('click', async (e) => {
  const use = e.target.closest('[data-use]');
  if (use) {
    $('#cafe-add-form').elements.name.value = [...use.dataset.use].slice(0, 12).join('');
    return $('#cafe-add-form').elements.name.focus();
  }
  const done = e.target.closest('[data-done]');
  if (!done) return;
  try {
    await api(`/cafe/requests/${encodeURIComponent(done.dataset.done)}`, { method: 'DELETE' });
    renderCafeAdmin(await refreshMe());
  } catch (err) {
    toast(err.message, 5000);
  }
});
$('#cafe-add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  try {
    const t = await api('/cafe/tables', { method: 'POST', body: { name: f.name.value.trim(), emoji: f.emoji.value.trim() } });
    e.target.reset();
    toast(`☕ 「${t.emoji} ${t.name}」のテーブルを足しました`);
  } catch (err) {
    toast(err.message, 5000);
  }
});

// ---- 運営だけ：通報の一覧 ----
const STAGE_NAME = { gentle: 'やさしく声かけ', police: '👮 お巡りさん', lawyer: '⚖ 弁護士', enma: '👹 エンマ大王もどき' };
const REASON_NAME = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r.label]));
async function renderReportAdmin(me) {
  $('#report-admin').hidden = me.role !== 'admin';
  if (me.role !== 'admin') return;
  let list;
  try { list = await api('/reports'); } catch { return; }
  $('#report-admin-list').innerHTML = list.length ? list.map((r) => {
    const reasons = Object.entries(r.reasons).map(([k, n]) => `${REASON_NAME[k] ?? k} ${n}`).join('・');
    const state = r.hidden === 'admin' ? '止めた' : r.hidden === 'report' ? '運営が見るまで見えない' : r.status === 'kept' ? '出したまま' : '出ている';
    return `<li><strong>${escapeHtml(r.author)}</strong>「${escapeHtml(r.text)}」
      <span class="muted small">${escapeHtml(reasons)}（${r.reporters}人）・${STAGE_NAME[r.stage] ?? ''}・いま：${state}</span>
      <div class="row wrap">
        <button type="button" class="btn ghost" data-decide="hide" data-post="${escapeHtml(r.postId)}">止める</button>
        <button type="button" class="btn ghost" data-decide="show" data-post="${escapeHtml(r.postId)}">出す</button>
      </div></li>`;
  }).join('') : '<li class="muted small">通報はありません</li>';
}
$('#report-admin-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-decide]');
  if (!btn) return;
  const label = btn.dataset.decide === 'hide' ? '止め' : '出し';
  if (!confirm(`この投稿を${label}ますか？`)) return;
  try {
    await api(`/reports/${encodeURIComponent(btn.dataset.post)}/decision`, { method: 'POST', body: { action: btn.dataset.decide } });
    toast(`投稿を${label}ました`);
    renderReportAdmin(await refreshMe());
  } catch (err) {
    toast(err.message, 5000);
  }
});

// ---- ミュート・ブロックした人 ----
const KIND_NAME = { mute: '🙈 ミュート', block: '🚫 ブロック' };
async function renderBlocks() {
  let list;
  try { list = await api('/blocks'); } catch { return; }
  $('#block-list').innerHTML = list.length
    ? list.map((b) => {
      const id = escapeHtml(b.user?.id ?? '');
      const name = escapeHtml(b.user?.name ?? '？');
      const other = b.kind === 'mute' ? 'block' : 'mute';
      return `<li><strong>${name}</strong>
      <span class="muted small">${KIND_NAME[b.kind] ?? ''}（${escapeHtml(timeAgo(b.createdAt))}）</span>
      <div class="row wrap">
        <button type="button" class="btn ghost" data-switch="${id}" data-kind="${other}" data-name="${name}">${KIND_NAME[other]}にする</button>
        <button type="button" class="btn ghost" data-unblock="${id}" data-name="${name}">外す</button>
      </div></li>`;
    }).join('')
    : '<li class="muted small">ミュート・ブロックした人はいません</li>';
}
$('#block-list').addEventListener('click', async (e) => {
  const sw = e.target.closest('[data-switch]');
  const un = e.target.closest('[data-unblock]');
  if (!sw && !un) return;
  try {
    if (sw) {
      // 切りかえだけ。前に書いた理由はそのまま残す（keepReason）
      await api(`/blocks/${encodeURIComponent(sw.dataset.switch)}`, { method: 'PUT', body: { kind: sw.dataset.kind, keepReason: true } });
      toast(`🐕 ${sw.dataset.name} さんを${KIND_NAME[sw.dataset.kind]}にしたっす`);
    } else {
      if (!confirm(`${un.dataset.name} さんのミュート・ブロックを外しますか？`)) return;
      await api(`/blocks/${encodeURIComponent(un.dataset.unblock)}`, { method: 'DELETE' });
      toast(`🐕 ${un.dataset.name} さんを外したっす`);
    }
    renderBlocks();
  } catch (err) {
    toast(err.message, 5000);
  }
});

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
  const diary = data.diary ?? [];
  $('#family-diary-box').hidden = !diary.length;
  $('#family-diary').innerHTML = diary.map((d) => `<li><img src="/shared/avatars/shiba.svg" alt="" width="32" height="32">
    <div><span class="muted small">${escapeHtml(dateJa(d.at))}</span><p>${escapeHtml(d.text)}</p></div></li>`).join('');
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
    const id = escapeHtml(c.id);
    const name = escapeHtml(c.name);
    const until = c.leaving?.guardianUntil ?? c.leaving?.until;
    const leave = c.leaving
      ? `<p class="note-line">🌸 退会の手続き中です。${escapeHtml(dateJa(c.leaving.until))} に本人は入れなくなり、${escapeHtml(dateJa(until))} にアカウントと投稿などが消えます。機種変更などのまちがいなら、それまでここで取り消せます。</p>
        <div class="row wrap"><button type="button" class="btn ghost" data-leave="${id}" data-name="${name}">退会を取り消す</button></div>`
      : '';
    return `<li><strong>${name}</strong> <span class="muted small">${escapeHtml(games)}</span>${posts}${leave}
      <button type="button" class="btn ghost" data-unlink="${id}" data-name="${name}">つなぐのをやめる</button></li>`;
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
  const lv = e.target.closest('[data-leave]');
  if (lv) {
    if (!confirm(`${lv.dataset.name} さんの退会を取り消しますか？`)) return;
    try {
      await api(`/guardian/children/${encodeURIComponent(lv.dataset.leave)}/leave-cancel`, { method: 'POST' });
      toast(`🐕 取り消したっす。${lv.dataset.name}さん、おかえりなさいっす！`, 5000);
      renderFamily(await refreshMe());
    } catch (err) {
      toast(err.message, 5000);
    }
    return;
  }
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
  // 退会の手続き中なら、取り消せるようにアカウントのページを出す
  if (r.me.leaving) {
    toast(`🐕 ${WELCOME_BACK.text}　退会を取り消すなら、下のボタンっす`, 6000);
    return render(r.me);
  }
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
// はじめて登録した人は、案内スライドを見てから行きたかった画面へ
$('#codes-next').addEventListener('click', () => { location.href = `/welcome.html?next=${encodeURIComponent(nextUrl())}`; });

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
