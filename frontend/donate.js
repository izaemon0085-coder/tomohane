// 💝 ともはね を応援する（新聞社の募金箱）。決まりは shared/donation.js
import { api, refreshMe, getMe, headerHtml, escapeHtml, toast, timeAgo, onServerEvents } from '/shared/api.js';
import { THANKS, ASK_LINE, QUICK_AMOUNTS } from '/shared/donation.js';

const $ = (s) => document.querySelector(s);
const NAMES = {
  'agent-hato': 'ハト', 'agent-shiba': 'シバ', 'agent-usagi': 'ウサギ', 'agent-yamaneko': 'ヤマネコ', 'agent-fukurou': 'フクロウ',
  'agent-tanuki': 'タヌキ', 'agent-penguin': 'ペンギン', 'agent-kitsune': 'キツネ', 'agent-kaeru': 'カエル', 'agent-nezumi': 'ネズミ', 'agent-mogu': 'モグ',
};
const face = (id) => `/shared/avatars/${id.replace('agent-', '')}.svg`;
const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;
const STATUS = { pending: '⏳ 運営が確かめ中', confirmed: '✅ 確かめました', cancelled: '🔍 通帳で見つかりませんでした' };
const sayHtml = (l) => `<img src="${face(l.by)}" alt="" width="44" height="44"><p><strong>${escapeHtml(NAMES[l.by] ?? '')}</strong>：${escapeHtml(l.text)}</p>`;

$('#ask-line').innerHTML = sayHtml(ASK_LINE);
$('#quick').innerHTML = QUICK_AMOUNTS.map((n) => `<button class="btn ghost" type="button" data-amount="${n}">${yen(n)}</button>`).join('');

async function load() {
  const me = getMe();
  $('#header').innerHTML = headerHtml('news');
  const info = await api('/donations');
  const body = $('#give-body');
  body.hidden = true;
  if (!info.on) $('#give-state').textContent = 'いまは募金箱をお休みしています。ひらいたら、新聞でお知らせします。';
  else if (!info.login) $('#give-state').innerHTML = '<a href="/login.html?next=/donate.html">ログイン</a>すると、振込先が見られます（大人の人だけ）。';
  else if (!info.canDonate) $('#give-state').textContent = info.reason ?? '';
  else {
    $('#give-state').textContent = '';
    body.hidden = false;
    $('#account').textContent = info.account || '（振込先はまだありません。下の応援サービスからどうぞ）';
    $('#support-link').hidden = !info.supportUrl;
    if (info.supportUrl) $('#support-link').innerHTML = `カードで応援するときは：<a href="${escapeHtml(info.supportUrl)}" target="_blank" rel="noopener noreferrer">応援サービス（ともはね の外のページ）</a>`;
  }

  const mine = info.mine ?? [];
  $('#mine-box').hidden = !mine.length;
  $('#mine').innerHTML = mine.map((d) => `<li data-id="${escapeHtml(d.id)}">
    <strong>${yen(d.amount)}</strong> <span class="muted small">${escapeHtml(timeAgo(d.createdAt))}・振込のお名前：${escapeHtml(d.payerName)}</span><br>
    ${escapeHtml(STATUS[d.status] ?? '')}
    ${d.status === 'confirmed' ? ` <a class="btn ghost" href="/receipt.html?id=${encodeURIComponent(d.id)}">🧾 領収書</a>` : ''}
    ${d.status === 'pending' ? ' <button class="btn ghost" type="button" data-withdraw>取り消す</button>' : ''}
  </li>`).join('');

  $('#thanks').hidden = !info.thanked;
  if (info.thanked) $('#thanks-list').innerHTML = THANKS.map((l) => `<li class="say-line">${sayHtml(l)}</li>`).join('');
  if (info.thanked && location.hash === '#thanks') $('#thanks').scrollIntoView();

  const names = info.supporters?.names ?? [];
  $('#supporters-box').hidden = !names.length;
  $('#supporters').textContent = names.map((n) => `${n}さん`).join('、');

  $('#admin').hidden = me?.role !== 'admin';
  if (me?.role === 'admin' && $('#admin').open) await loadAdmin();
}

async function loadAdmin() {
  const a = await api('/donations/admin');
  const f = $('#settings-form');
  if (!f.contains(document.activeElement)) {
    f.on.checked = a.settings.on;
    f.account.value = a.settings.account;
    f.supportUrl.value = a.settings.supportUrl;
    f.issuer.value = a.settings.issuer;
  }
  $('#months').innerHTML = a.months.length ? a.months.map((m) => `<li>${escapeHtml(m.month)}：${m.count}件・${yen(m.total)}</li>`).join('') : '<li class="muted">まだありません</li>';
  $('#admin-list').innerHTML = a.items.length ? a.items.map((d) => `<li data-id="${escapeHtml(d.id)}">
    <strong>${yen(d.amount)}</strong>・振込のお名前：<strong>${escapeHtml(d.payerName || '—')}</strong>
    <span class="muted small">（${escapeHtml(d.userName)}・${escapeHtml(timeAgo(d.createdAt))}）</span><br>
    ${escapeHtml(STATUS[d.status] ?? '')}${d.receiptNo ? ` ${escapeHtml(d.receiptNo)} <a href="/receipt.html?id=${encodeURIComponent(d.id)}">領収書</a>` : ''}
    ${d.status === 'pending' ? '<div class="row wrap"><button class="btn" type="button" data-confirm>確かめた（お礼を届ける）</button><button class="btn ghost" type="button" data-cancel>見つからない</button></div>' : ''}
  </li>`).join('') : '<li class="muted">まだありません</li>';
}

$('#quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-amount]');
  if (b) $('#give-form').amount.value = b.dataset.amount;
});

$('#give-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = f.querySelector('.error');
  err.textContent = '';
  try {
    await api('/donations', { method: 'POST', body: { amount: Number(f.amount.value), payerName: f.payerName.value.trim(), showName: f.showName.checked } });
    f.reset();
    toast('🕊️ 運営に知らせたよ。通帳で確かめたら、お礼を届けるね', 5000);
    await load();
  } catch (x) { err.textContent = x.message; }
});

$('#mine').addEventListener('click', async (e) => {
  if (!e.target.closest('[data-withdraw]')) return;
  const id = e.target.closest('li').dataset.id;
  if (!confirm('この「振り込みました」のお知らせを取り消しますか？')) return;
  try { await api(`/donations/${encodeURIComponent(id)}`, { method: 'DELETE' }); await load(); } catch (x) { toast(x.message, 5000); }
});

$('#admin').addEventListener('toggle', () => { if ($('#admin').open) loadAdmin().catch((x) => toast(x.message, 5000)); });
$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = f.querySelector('.error');
  err.textContent = '';
  try {
    await api('/donations/settings', { method: 'PUT', body: { on: f.on.checked, account: f.account.value, supportUrl: f.supportUrl.value.trim(), issuer: f.issuer.value.trim() } });
    toast(f.on.checked ? '💝 募金箱をひらきました' : '募金箱の設定を保存しました');
    await load();
  } catch (x) { err.textContent = x.message; }
});
$('#admin-list').addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-id]');
  const act = e.target.closest('[data-confirm]') ? 'confirm' : e.target.closest('[data-cancel]') ? 'cancel' : null;
  if (!li || !act) return;
  if (act === 'cancel' && !confirm('通帳で見つからなかったことを、本人に知らせますか？')) return;
  try { await api(`/donations/${encodeURIComponent(li.dataset.id)}/${act}`, { method: 'POST' }); await load(); } catch (x) { toast(x.message, 5000); }
});

await refreshMe().catch(() => null);
await load().catch((x) => toast(x.message, 5000));
const reload = () => {
  if ($('#give-form').contains(document.activeElement) || $('#settings-form').contains(document.activeElement)) return;
  load().catch(() => {});
};
onServerEvents({ donation: reload, notice: reload });
