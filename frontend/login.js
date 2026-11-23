// ログイン・はじめる（登録）・パスワードを忘れた・アカウント
// ログインのしるしはサーバーのクッキー（JavaScript からは読めない）。ここでは画面の写しだけを更新する
import { callName, codeLabel, HONORS } from '/shared/honor.js';
import { api, refreshMe, rememberMe, logout, headerHtml, escapeHtml, toast, timeAgo, safeNext } from '/shared/api.js';
import { REPORT_REASONS } from '/shared/report.js';
import { isComingSoon, SOON_LABEL } from '/shared/soon.js';
import { FAREWELL_CHOICES, SEND_OFF, WELCOME_BACK } from '/shared/leave.js';
import { FAMILY_SWITCHES } from '/shared/family-rules.js';

const $ = (sel) => document.querySelector(sel);
const AGE = { child: '子ども（12歳まで）', teen: '中高生（13〜17歳）', adult: '大人（18歳から）' };
const ROLE = { admin: '運営（管理者）', user: 'ユーザー' };

const nextUrl = () => safeNext(new URLSearchParams(location.search).get('next'));

// パスワードの欄に「👁 表示／🙈 かくす」のボタン（入れたものを確かめられる）。送るとき・切りかえるときは、またかくす
function addPasswordEyes() {
  for (const input of document.querySelectorAll('input[type="password"]')) {
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.replaceWith(wrap);
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'pw-eye';
    const set = (show) => {
      input.type = show ? 'text' : 'password';
      eye.textContent = show ? '🙈 かくす' : '👁 表示';
      eye.setAttribute('aria-pressed', String(show));
      eye.setAttribute('aria-label', show ? 'パスワードをかくす' : 'パスワードを表示する');
    };
    eye.addEventListener('click', (e) => { e.preventDefault(); set(input.type === 'password'); input.focus(); });
    input.form?.addEventListener('submit', () => set(false), true);
    wrap.append(input, eye);
    set(false);
  }
}
addPasswordEyes();

// パスワードを覚える：ブラウザ（Chrome など）の「パスワードを保存しますか？」を出す。
// ともはね のページ・サーバーには保存しない（ブラウザのパスワード管理にまかせる）。聞けないブラウザでは何もしない
async function offerToSave(id, password, name) {
  try {
    if (!id || !password || !('PasswordCredential' in window) || !navigator.credentials?.store) return;
    await navigator.credentials.store(new window.PasswordCredential({ id, password, name: name || id }));
  } catch { /* ことわられた・使えないときは、そのまま */ }
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
  $('#account-title').textContent = me.name;
  $('#account-code').textContent = codeLabel(me.code);
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
  renderGoodsAdmin(me);
  renderInvites(me);
  renderNameBox(me);
  renderPasskeys(me);
}

// ---- 🏷️ 名前と呼び方（名前の下のコードは変えられない） ----
function renderNameBox(me) {
  $('#name-code').textContent = codeLabel(me.code);
  const f = $('#name-form');
  if (document.activeElement !== f.elements.name) f.elements.name.value = me.name;
  $('#honor-list').innerHTML = HONORS.map((h) => `<label class="honor-choice"><input type="radio" name="honor" value="${h.id}"${h.id === (me.honor ?? 'san') ? ' checked' : ''}> ${escapeHtml(h.label.replace('〇〇', me.name))}</label>`).join('');
  $('#honor-sample').textContent = `🐕 シバ：「${callName(me)}、おかえりなさいっす！」`;
}
$('#name-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = e.target.querySelector('.error');
  err.textContent = '';
  try {
    const r = await api('/profile/name', { method: 'POST', body: { name: e.target.elements.name.value } });
    rememberMe(r.me);
    render(r.me);
    toast(`🏷️ 名前を「${r.me.name}」にしました（コード ${codeLabel(r.me.code)} はそのまま）`, 5000);
  } catch (ex) {
    err.textContent = ex.offline ? 'つながっていません。つながってから、もう一度どうぞ' : ex.message;
  }
});
$('#honor-form').addEventListener('change', async (e) => {
  if (e.target.name !== 'honor') return;
  try {
    const r = await api('/profile/honor', { method: 'POST', body: { honor: e.target.value } });
    rememberMe(r.me);
    renderNameBox(r.me);
    toast(`🐕 これからは「${callName(r.me)}」って呼ぶっす！`, 4000);
  } catch (ex) {
    toast(ex.message, 5000);
  }
});

// ---- ✉️ 招待状（クローズドβ） ----
async function renderInvites(me) {
  let s;
  try { s = await api('/invites'); } catch { $('#invite-box').hidden = true; return; }
  const admin = me.role === 'admin';
  $('#invite-box').hidden = !s.on && !admin;
  $('#invite-settings').hidden = !admin;
  if (admin) {
    $('#invite-settings').elements.on.checked = s.on;
    $('#invite-settings').elements.limit.value = s.limit;
  }
  $('#invite-state').textContent = s.on
    ? `いまはクローズドβ：${s.limit}人まで（いま${s.members}人・のこり${s.seatsLeft}席・まだ使われていない招待状${s.pending}枚）`
    : 'いまは招待状モードではありません。だれでも登録できます。';
  $('#invite-issue').hidden = !s.on;
  $('#invite-issue').disabled = !s.canIssue;
  $('#invite-why').textContent = s.on && !s.canIssue ? s.reason : '';
  const dateJa = (iso) => new Date(iso).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
  $('#invite-list').innerHTML = s.mine.map((i) => `<li class="row wrap">
    <span>${i.used ? `✅ ${escapeHtml(i.usedName)}が使いました` : i.expired ? '⌛ 切れました' : `📨 まだ使われていません（${dateJa(i.expiresAt)}まで）`}</span>
    ${!i.used && !i.expired ? `<button class="btn ghost small" type="button" data-invite-cancel="${escapeHtml(i.id)}">取り消す</button>` : ''}</li>`).join('');
}
$('#invite-issue').addEventListener('click', async () => {
  try {
    const r = await api('/invites', { method: 'POST' });
    $('#invite-code').textContent = r.code;
    $('#invite-new').hidden = false;
    renderInvites(await refreshMe());
  } catch (err) { toast(err.message, 5000); }
});
$('#invite-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#invite-code').textContent); toast('コピーしました'); } catch { toast('コピーできませんでした。手で書き写してください'); }
});
$('#invite-list').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-invite-cancel]')?.dataset.inviteCancel;
  if (!id || !confirm('この招待状を取り消しますか？（もう使えなくなります）')) return;
  try { await api(`/invites/${id}`, { method: 'DELETE' }); renderInvites(await refreshMe()); } catch (err) { toast(err.message, 5000); }
});
$('#invite-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  try {
    await api('/invites/settings', { method: 'PUT', body: { on: f.on.checked, limit: Number(f.limit.value) } });
    toast(f.on.checked ? '✉️ 招待状モードにしました' : '招待状モードをやめました（だれでも登録できます）');
    renderInvites(await refreshMe());
  } catch (err) { toast(err.message, 5000); }
});
// 登録の画面：招待状モードなら、招待コードの欄を出す
api('/invites/status').then((st) => {
  $('#invite-need').hidden = !st.on;
  if (st.full) $('#invite-note').textContent = '✉️ いまはクローズドβの人数がいっぱいです。席があいたら、また来てください。';
}).catch(() => {});

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
// パスワードを変える（ログイン中）。ほかの端末のログインは切れる
$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const err = e.target.querySelector('.error');
  err.textContent = '';
  if (f.next.value !== f.again.value) {
    err.textContent = '新しいパスワードが、2回で同じになっていません';
    return;
  }
  try {
    const r = await api('/auth/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
    await offerToSave(r.me.loginId, f.next.value, r.me.name);
    e.target.reset();
    $('#password-box').open = false;
    rememberMe(r.me);
    toast('🔑 パスワードを変えました。ほかの端末のログインは切れました', 5000);
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

// ---- 運営だけ：グッズの絵を見てから出す ----
async function renderGoodsAdmin(me) {
  $('#goods-admin').hidden = me.role !== 'admin';
  if (me.role !== 'admin') return;
  let list;
  try { list = await api('/goods-images/pending'); } catch { return; }
  $('#goods-admin-list').innerHTML = list.length ? list.map((x) => `<li class="row wrap">
    <img src="${escapeHtml(x.url)}" alt="${escapeHtml(x.name)}の絵" class="goods-review" width="160">
    <div><strong>${escapeHtml(x.owner?.name ?? '？')}</strong> <span class="user-code">${escapeHtml(codeLabel(x.owner?.code))}</span>
      <p class="small">「${escapeHtml(x.name)}」・${escapeHtml(timeAgo(x.at))}</p>
      <div class="row wrap">
        <button type="button" class="btn" data-goods-review="1" data-user="${escapeHtml(x.userId)}" data-goods="${escapeHtml(x.goodsId)}">出す</button>
        <button type="button" class="btn ghost" data-goods-review="0" data-user="${escapeHtml(x.userId)}" data-goods="${escapeHtml(x.goodsId)}">出さない</button>
      </div></div></li>`).join('') : '<li class="muted small">見るものはありません</li>';
}
$('#goods-admin-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-goods-review]');
  if (!btn) return;
  try {
    await api(`/goods-images/${encodeURIComponent(btn.dataset.user)}/${encodeURIComponent(btn.dataset.goods)}/review`, { method: 'POST', body: { ok: btn.dataset.goodsReview === '1' } });
    toast(btn.dataset.goodsReview === '1' ? '🖼️ プロフィールに出しました' : '出さないことにしました（本人に 🔔 で伝えました）');
    renderGoodsAdmin(await refreshMe());
  } catch (err) {
    toast(err.message, 5000);
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
      const call = escapeHtml(b.user ? callName(b.user) : '？'); // キャラが呼ぶときの呼び名
      const other = b.kind === 'mute' ? 'block' : 'mute';
      return `<li><strong>${name}</strong>${b.user?.code ? `<span class="user-code">${escapeHtml(codeLabel(b.user.code))}</span>` : ''}
      <span class="muted small">${KIND_NAME[b.kind] ?? ''}（${escapeHtml(timeAgo(b.createdAt))}）</span>
      <div class="row wrap">
        <button type="button" class="btn ghost" data-switch="${id}" data-kind="${other}" data-name="${call}">${KIND_NAME[other]}にする</button>
        <button type="button" class="btn ghost" data-unblock="${id}" data-name="${call}">外す</button>
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
      toast(`🐕 ${sw.dataset.name}を${KIND_NAME[sw.dataset.kind]}にしたっす`);
    } else {
      if (!confirm(`${un.dataset.name}のミュート・ブロックを外しますか？`)) return;
      await api(`/blocks/${encodeURIComponent(un.dataset.unblock)}`, { method: 'DELETE' });
      toast(`🐕 ${un.dataset.name}を外したっす`);
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
    renderMyRules(data.myRules);
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
    const name = escapeHtml(callName(c)); // キャラ・確認の文で使う呼び名
    const until = c.leaving?.guardianUntil ?? c.leaving?.until;
    const leave = c.leaving
      ? `<p class="note-line">🌸 退会の手続き中です。${escapeHtml(dateJa(c.leaving.until))} に本人は入れなくなり、${escapeHtml(dateJa(until))} にアカウントと投稿などが消えます。機種変更などのまちがいなら、それまでここで取り消せます。</p>
        <div class="row wrap"><button type="button" class="btn ghost" data-leave="${id}" data-name="${name}">退会を取り消す</button></div>`
      : '';
    return `<li><strong>${escapeHtml(c.name)}</strong>${c.code ? `<span class="user-code">${escapeHtml(codeLabel(c.code))}</span>` : ''} <span class="muted small">${escapeHtml(games)}</span>${posts}${leave}
      ${c.ageGroup === 'child' ? rulesFormHtml(c) : ''}
      <button type="button" class="btn ghost" data-unlink="${id}" data-name="${name}">つなぐのをやめる</button></li>`;
  }).join('');
}

// ---- 👪 おうちの人との決まり（A カギ・C こどもテーブル・D スイッチ・夜9時）。子どもと話しあってから決める ----
function rulesFormHtml(c) {
  const r = c.familyRules ?? { lock: false, kidsRoom: true, night: true, switches: {} };
  const on = (v) => (v !== false ? ' checked' : '');
  const state = !r.decided
    ? '<p class="note-line small">まだ決めていません（いまは、ふだんどおり使えて、夜9時から朝6時は書けません）。</p>'
    : `<p class="small">${escapeHtml(dateJa(r.decidedAt))}に決めました。${r.ackAt ? `✅ ${escapeHtml(callName(c))}が ${escapeHtml(dateJa(r.ackAt))}に「話しあった・わかった」を押しました。` : `⏳ ${escapeHtml(callName(c))}の「話しあった・わかった」を待っています。`}</p>`;
  return `<details class="rules-box"><summary>👪 ${escapeHtml(callName(c))}との決まり</summary>
    ${state}
    <p class="muted small"><a href="/family-guide.html" target="_blank" rel="noopener">家族の話しあいの案内</a>を一緒に読んで、話しあってから決めてください。</p>
    <form class="rules-form" data-rules="${escapeHtml(c.id)}">
      <fieldset><legend>🔒 A カギ</legend>
        <label class="row"><input type="checkbox" name="lock"${r.lock ? ' checked' : ''}> カギをかける（書くのは全部お休み。読む・いいね・目安箱はできる）</label></fieldset>
      <fieldset><legend>🎚️ D スイッチ（使える場所）</legend>
        ${FAMILY_SWITCHES.map((s) => `<label class="row"><input type="checkbox" name="sw-${s.id}"${on(r.switches?.[s.id])}> ${escapeHtml(s.label)}</label>`).join('')}</fieldset>
      <fieldset><legend>🧸 C 子どもの部屋</legend>
        <label class="row"><input type="checkbox" name="kidsRoom"${on(r.kidsRoom)}> カフェの「こどもテーブル」で話す（12歳までの人とキャラだけ。おうちの人は見守りで読める）</label></fieldset>
      <fieldset><legend>🌙 夜のお休み</legend>
        <label class="row"><input type="checkbox" name="night"${on(r.night)}> 夜9時から朝6時までは書かない（読むのはできる）</label></fieldset>
      <label class="row talked"><input type="checkbox" name="talked" required> <strong>${escapeHtml(callName(c))}と話しあって決めた</strong></label>
      <p class="error" role="alert"></p>
      <button class="btn" type="submit">この決まりにする</button>
    </form></details>`;
}
function renderMyRules(r) {
  $('#family-rules').hidden = !r;
  if (!r) return;
  const yes = '⭕';
  const no = '💤 お休み';
  const lines = [
    r.lock ? ['🔒 カギ', 'かかっている（書くのはお休み。読む・いいねはできるよ）'] : null,
    ...FAMILY_SWITCHES.map((s) => [s.label, r.lock && s.id !== 'games' ? no : r.switches[s.id] ? yes : no]),
    ['🧸 こどもテーブル', r.lock ? no : r.kidsRoom ? yes : no],
    ['🌙 夜9時から朝6時', r.night ? '書くのはお休み（読むのはできるよ）' : '書いてもいい'],
  ].filter(Boolean);
  $('#family-rules-list').innerHTML = lines.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></li>`).join('');
  $('#family-rules-when').textContent = !r.decided
    ? '🐕 まだ、おうちの人と決まりを決めていないっす。いまは、ふだんどおりで、夜9時から朝6時は書くのがお休みっす。'
    : r.ackAt ? `✅ ${dateJa(r.ackAt)}に「わかった」を押したよ。` : '🐕 おうちの人と話しあったら、下のボタンを押してほしいっす！';
  $('#family-rules-ack').hidden = !r.decided || Boolean(r.ackAt);
}
$('#family-rules-ack').addEventListener('click', async () => {
  try {
    renderMyRules(await api('/guardian/rules/ack', { method: 'POST' }));
    toast('🐕 ありがとうっす！ おうちの人にも伝えたっす', 4000);
  } catch (err) {
    toast(err.message, 5000);
  }
});
$('#family-children').addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-rules]');
  if (!form) return;
  e.preventDefault();
  const f = form.elements;
  const err = form.querySelector('.error');
  err.textContent = '';
  const rules = {
    lock: f.lock.checked, kidsRoom: f.kidsRoom.checked, night: f.night.checked,
    switches: Object.fromEntries(FAMILY_SWITCHES.map((s) => [s.id, f[`sw-${s.id}`].checked])),
  };
  try {
    await api(`/guardian/children/${encodeURIComponent(form.dataset.rules)}/rules`, { method: 'PUT', body: { rules, talked: f.talked.checked } });
    toast('👪 決まりを保存しました。子どもの画面に届いて、「話しあった・わかった」を押してもらえます', 6000);
    renderFamily(await refreshMe());
  } catch (ex) {
    err.textContent = ex.offline ? 'つながっていません。つながってから、もう一度どうぞ' : ex.message;
  }
});
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
    if (!confirm(`${lv.dataset.name}の退会を取り消しますか？`)) return;
    try {
      await api(`/guardian/children/${encodeURIComponent(lv.dataset.leave)}/leave-cancel`, { method: 'POST' });
      toast(`🐕 取り消したっす。${lv.dataset.name}、おかえりなさいっす！`, 5000);
      renderFamily(await refreshMe());
    } catch (err) {
      toast(err.message, 5000);
    }
    return;
  }
  const btn = e.target.closest('[data-unlink]');
  if (!btn || !confirm(`${btn.dataset.name}と、つなぐのをやめますか？`)) return;
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
  toast(`${r.name}とつながりました`, 5000);
  renderFamily(await refreshMe());
});

async function submit(form, path, fields, extra = {}) {
  const err = form.querySelector('.error');
  err.textContent = '';
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const body = { ...Object.fromEntries(fields.map((k) => [k, form.elements[k].value.trim()])), ...extra };
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
  const r = await submit(e.target, '/auth/login', ['loginId', 'password'], { remember: e.target.elements.remember.checked });
  if (!r) return;
  rememberMe(r.me);
  await offerToSave(e.target.elements.loginId.value.trim(), e.target.elements.password.value.trim(), r.me.name);
  afterLogin(r.me);
});
// ログインできたあと：退会の手続き中なら、取り消せるようにアカウントのページを出す
function afterLogin(me) {
  if (me.leaving) {
    toast(`🐕 ${WELCOME_BACK.text}　退会を取り消すなら、下のボタンっす`, 6000);
    return render(me);
  }
  location.href = nextUrl();
}

// ---- 🔑 パスキー（WebAuthn）。指紋・顔・スマホのロックは端末の中だけで使われ、ともはね には来ない ----
const passkeyOk = Boolean(window.PublicKeyCredential && window.isSecureContext && navigator.credentials);
const toBuf = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer;
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const passkeyError = (e) => (e?.name === 'NotAllowedError' ? 'パスキーを使うのを、やめました（または時間が切れました）'
  : e?.name === 'InvalidStateError' ? 'この端末のパスキーは、もう登録されています'
    : e?.offline ? 'つながっていません。つながってから、もう一度どうぞ' : e?.message || 'パスキーが使えませんでした');
// 名前の例（端末の種類から）
function deviceLabel() {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'この端末';
  return `${kind}のパスキー`;
}
$('#passkey-login').hidden = !passkeyOk;
$('#passkey-login-btn').addEventListener('click', async () => {
  const form = $('#panel-login');
  const err = form.querySelector('.error');
  const btn = $('#passkey-login-btn');
  err.textContent = '';
  btn.disabled = true;
  try {
    const opt = await api('/auth/passkey-login-options', { method: 'POST' });
    const cred = await navigator.credentials.get({ publicKey: { challenge: toBuf(opt.challenge), rpId: opt.rpId, userVerification: opt.userVerification, timeout: opt.timeout } });
    const res = cred.response;
    const r = await api('/auth/passkey-login', { method: 'POST', body: {
      id: cred.id, clientDataJSON: toB64(res.clientDataJSON), authenticatorData: toB64(res.authenticatorData), signature: toB64(res.signature),
      remember: form.elements.remember.checked,
    } });
    rememberMe(r.me);
    afterLogin(r.me);
  } catch (e) {
    err.textContent = passkeyError(e);
  } finally {
    btn.disabled = false;
  }
});
function renderPasskeys(me) {
  $('#passkey-add').hidden = !passkeyOk;
  $('#passkey-unsupported').hidden = passkeyOk;
  const f = $('#passkey-add');
  if (!f.elements.label.value) f.elements.label.placeholder = deviceLabel();
  const day = (iso) => new Date(iso).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
  $('#passkey-list').innerHTML = me.passkeys?.length
    ? me.passkeys.map((p) => `<li class="row wrap"><span>🔑 <strong>${escapeHtml(p.label)}</strong>
      <span class="muted small">（${escapeHtml(day(p.createdAt))}に登録・${p.lastUsedAt ? `${escapeHtml(timeAgo(p.lastUsedAt))}に使った` : 'まだ使っていない'}）</span></span>
      <button type="button" class="btn ghost small" data-passkey-del="${escapeHtml(p.id)}" data-label="${escapeHtml(p.label)}">消す</button></li>`).join('')
    : '<li class="muted small">まだ登録していません</li>';
}
$('#passkey-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = e.target.querySelector('.error');
  const btn = e.target.querySelector('button[type="submit"]');
  err.textContent = '';
  btn.disabled = true;
  try {
    const opt = await api('/auth/passkey-register-options', { method: 'POST' });
    const cred = await navigator.credentials.create({ publicKey: {
      ...opt,
      challenge: toBuf(opt.challenge),
      user: { ...opt.user, id: toBuf(opt.user.id) },
      excludeCredentials: opt.excludeCredentials.map((c) => ({ ...c, id: toBuf(c.id) })),
    } });
    const r = await api('/auth/passkey-register', { method: 'POST', body: {
      id: cred.id, clientDataJSON: toB64(cred.response.clientDataJSON), attestationObject: toB64(cred.response.attestationObject),
      label: e.target.elements.label.value.trim() || deviceLabel(),
    } });
    e.target.reset();
    renderPasskeys({ passkeys: r.passkeys });
    rememberMe(await refreshMe());
    toast('🔑 パスキーを登録しました。つぎからは「パスキーでログイン」で入れます', 5000);
  } catch (ex) {
    err.textContent = passkeyError(ex);
  } finally {
    btn.disabled = false;
  }
});
$('#passkey-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-passkey-del]');
  if (!btn || !confirm(`パスキー「${btn.dataset.label}」を消しますか？（その端末からは、パスキーで入れなくなります）`)) return;
  try {
    const r = await api('/auth/passkey-delete', { method: 'POST', body: { id: btn.dataset.passkeyDel } });
    renderPasskeys({ passkeys: r.passkeys });
    toast('パスキーを消しました。スマホ・パソコンの設定に残っているパスキーも、消しておくと安心です', 6000);
  } catch (ex) {
    toast(passkeyError(ex), 5000);
  }
});

let pendingCodes = [];
$('#panel-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await submit(e.target, '/auth/register', ['loginId', 'name', 'password', 'birthdate', 'inviteCode'], { agreeTerms: e.target.elements.agreeTerms.checked, remember: e.target.elements.remember.checked });
  if (!r) return;
  rememberMe(r.me);
  await offerToSave(e.target.elements.loginId.value.trim(), e.target.elements.password.value.trim(), r.me.name);
  pendingCodes = r.recoveryCodes;
  $('#auth').hidden = true;
  $('#header').innerHTML = headerHtml('login');
  $('#code-list').innerHTML = pendingCodes.map((c) => `<li><code>${escapeHtml(c)}</code></li>`).join('');
  $('#codes').hidden = false;
  $('#codes').focus?.();
});
// 12歳までの人は、はじめは「このまま入っておく」なし（みんなの端末で使うことが多いため。自分でチェックはできる）
$('#panel-register').elements.birthdate.addEventListener('change', (e) => {
  const b = new Date(e.target.value);
  if (Number.isNaN(b.getTime())) return;
  const t = new Date();
  const age = t.getFullYear() - b.getFullYear() - (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate()) ? 1 : 0);
  const child = age <= 12;
  $('#panel-register').elements.remember.checked = !child;
  $('#remember-child').hidden = !child;
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
  await offerToSave(e.target.elements.loginId.value.trim(), e.target.elements.newPassword.value.trim(), r.me.name);
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
