// 🔔 お知らせ：ハトの郵便屋さんが届ける（図書館・おうちの人・目安箱・招待状・応援のお礼）
// ・まだ読んでいないものは目立たせる。押すと読んだことになって、そのページへ行く
import { api, refreshMe, headerHtml, escapeHtml, timeAgo, toast, refreshNoticeCount, onServerEvents } from '/shared/api.js';

const $ = (s) => document.querySelector(s);
document.querySelector('#header').innerHTML = headerHtml('notices');

const KIND = { invite: { icon: '✉️', label: '招待状' }, library: { icon: '📚', label: '図書館' }, family: { icon: '🏠', label: 'おうちの人' }, suggest: { icon: '📮', label: '目安箱' }, donation: { icon: '💝', label: '応援' } };
// ハトのひとこと（まだ読んでいない数で変わる）
const hatoLine = (unread) => (unread
  ? `クルックー！ まだ読んでいないお知らせが ${unread}通 あるよ。`
  : 'クルックー！ ぜんぶ読んでくれたね。また届けにくるよ。');
// 中のリンクは、ともはねの中だけ（よそのページには飛ばさない）
const safeLink = (link) => (typeof link === 'string' && /^\/[\w\-./?=&%]*$/.test(link) && !link.startsWith('//') ? link : null);

function itemHtml(n) {
  const k = KIND[n.kind] ?? { icon: '🕊️', label: 'お知らせ' };
  const link = safeLink(n.link);
  const inner = `<span class="notice-icon" aria-hidden="true">${k.icon}</span>
    <span class="notice-body"><span class="muted small">${escapeHtml(k.label)}・${escapeHtml(timeAgo(n.at))}${n.readAt ? '' : ' <strong class="notice-new">あたらしい</strong>'}</span>
    <span>${escapeHtml(n.text)}</span></span>`;
  return `<li class="notice-item${n.readAt ? '' : ' unread'}">${link
    ? `<a href="${escapeHtml(link)}" data-notice="${escapeHtml(n.id)}">${inner}</a>`
    : `<div data-notice="${escapeHtml(n.id)}">${inner}</div>`}</li>`;
}

async function load() {
  const { unread, items } = await api('/notices');
  $('#list').innerHTML = items.map(itemHtml).join('');
  $('#empty').hidden = items.length > 0;
  $('#read-all').hidden = !unread;
  $('#hato-say').textContent = hatoLine(unread);
  refreshNoticeCount();
}

// 押したお知らせは読んだことにする（ページへ行く前に送る）
$('#list').addEventListener('click', (e) => {
  const el = e.target.closest('[data-notice]');
  if (!el) return;
  fetch('/api/notices/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [el.dataset.notice] }), keepalive: true }).catch(() => {});
  if (el.tagName !== 'A') setTimeout(load, 200);
});
$('#read-all').addEventListener('click', async () => {
  try {
    await api('/notices/read', { method: 'POST', body: {} });
    await load();
  } catch (err) { toast(`🕊️ ${err.message}`); }
});

const me = await refreshMe();
if (!me) {
  $('#need-login').hidden = false;
  $('#hato-say').textContent = 'クルックー！ ログインしたら、あなたあてのお知らせを届けるよ。';
} else {
  $('#box').hidden = false;
  try { await load(); } catch (err) { toast(`🕊️ ${err.message}`); }
  onServerEvents({ notice: load });
}
