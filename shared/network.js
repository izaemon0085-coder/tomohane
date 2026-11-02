// ローカル回線：つながりのようすを見張り、オフライン対応を動かす。
// ・Service Worker を登録して、前に見た画面・投稿をこの端末に保存（オフラインでも見られる）
// ・サーバーにつながるかを定期的に確かめ、ヘッダーの 📶 に表示する
// ・つながったら、送信待ちの投稿を自動で送る
// ・同じ Wi-Fi の端末から入るアドレス（LAN）を表示する
// ・回線が切れた／戻ったときは、キャラたちがひとこと言う（遊び場の 'agent-say'）
import { api, escapeHtml } from '/shared/api.js';
import { getOutbox, flushOutbox, cancelOutboxItem } from '/shared/outbox.js';

const CHECK_MS = 10000;
let online = true;
let lanUrls = [];
let line = null; // 回線番のモグが選んだ回線：wifi / local / offline

// ---- オフライン保存（Service Worker）----
const offlineCacheReady = 'serviceWorker' in navigator && window.isSecureContext;
if (offlineCacheReady) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('オフライン保存を始められませんでした', err));
}

// ---- つながりの確認 ----
async function check() {
  let ok = false;
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    ok = res.ok;
    if (ok) line = (await res.json().catch(() => ({}))).line ?? null;
  } catch { ok = false; }
  setOnline(ok);
  if (ok && getOutbox().length) flushOutbox();
}

function setOnline(next) {
  if (next === online) return render();
  online = next;
  render();
  // キャラたちの反応
  const line = online
    ? { agentId: 'agent-shiba', text: 'つながったっす！ おかえりなさいっす！' }
    : { agentId: 'agent-fukurou', text: 'ほう、回線が切れましたな。投稿はこの端末にためておきますぞ。' };
  window.dispatchEvent(new CustomEvent('agent-say', { detail: line }));
}

window.addEventListener('online', check);
window.addEventListener('offline', () => setOnline(false));
window.addEventListener('outbox-change', render);
window.addEventListener('outbox-sent', (e) => {
  window.dispatchEvent(new CustomEvent('agent-say', {
    detail: { agentId: 'agent-shiba', text: `ためてた投稿 ${e.detail.sent}件、ちゃんと届けたっす！` },
  }));
});

// ---- ヘッダーの 📶 ----
function chipText() {
  const n = getOutbox().length;
  if (!online) return n ? `📴 オフライン（送信待ち ${n}）` : '📴 オフライン';
  const label = { wifi: '📶 Wi-Fi', local: '🏠 ローカル回線', offline: '🔌 この端末だけ' }[line] || '📶';
  return n ? `${label}（送信待ち ${n}）` : label;
}
function render() {
  for (const chip of document.querySelectorAll('[data-net-chip]')) {
    chip.textContent = chipText();
    chip.classList.toggle('offline', !online);
    chip.title = online ? 'ローカル回線：つながっています' : 'ローカル回線：オフライン';
  }
  if (dialog.open) renderPanel();
}

// ---- ローカル回線パネル ----
const dialog = document.createElement('dialog');
dialog.className = 'card net-panel';
dialog.setAttribute('aria-labelledby', 'net-title');

function renderPanel() {
  const box = getOutbox();
  const secureNote = offlineCacheReady
    ? '✅ この端末に、前に見た投稿を保存しています。オフラインでも見られます。'
    : 'ℹ️ この開き方（http のアドレス）では、オフライン保存はお休みです。送信待ちは使えます。';
  dialog.innerHTML = `
    <div class="net-head">
      <h2 id="net-title">📶 ローカル回線</h2>
      <button class="btn ghost" data-close aria-label="閉じる">✕</button>
    </div>
    <p class="net-status ${online ? 'on' : 'off'}">${online ? '● つながっています' : '● オフラインです'}</p>
    ${online && line ? `<p class="small">使っている回線：<strong>${{ wifi: '📶 Wi-Fi（インターネット）', local: '🏠 ローカル回線（同じ Wi-Fi の中だけ）', offline: '🔌 この端末だけ' }[line]}</strong>（回線番が自動で切り替えます）</p>` : ''}
    <p class="muted small">${secureNote}</p>

    <h3>📮 送信待ち（${box.length}件）</h3>
    ${box.length ? `<ul class="net-outbox">${box.map((x) => `<li>
        <span>${escapeHtml(x.text)}</span>
        <button class="link-btn" data-cancel="${escapeHtml(x.localId)}">取り消す</button>
      </li>`).join('')}</ul>
      <button class="btn" data-flush ${online ? '' : 'disabled'}>今すぐ送る</button>`
    : '<p class="muted small">送信待ちの投稿はありません。オフラインで投稿すると、ここにたまります。</p>'}

    <h3>🏠 同じ Wi-Fi の端末から入る</h3>
    ${lanUrls.length
      ? `<p class="muted small">インターネットがなくても、同じ Wi-Fi（家のルーターなど）につながっている端末なら、このアドレスで入れます。</p>
         <ul class="net-lan">${lanUrls.map((u) => `<li><code>${escapeHtml(u)}</code> <button class="link-btn" data-copy="${escapeHtml(u)}">コピー</button></li>`).join('')}</ul>`
      : '<p class="muted small">Wi-Fi のアドレスが見つかりませんでした。</p>'}

    <p class="muted small net-future">🛰️ 近くの端末どうしで、電波をバケツリレーしてつなぐ機能（メッシュ回線）は準備中です。</p>`;
}

dialog.addEventListener('click', async (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) return dialog.close();
  const cancel = e.target.closest('[data-cancel]');
  if (cancel) cancelOutboxItem(cancel.dataset.cancel);
  if (e.target.closest('[data-flush]')) await flushOutbox();
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      copy.textContent = 'コピーしました';
    } catch { copy.textContent = '手でコピーしてください'; }
  }
});

async function openPanel() {
  try { lanUrls = (await api('/network')).lanUrls; } catch { /* オフラインなら前の値 */ }
  renderPanel();
  if (!dialog.isConnected) document.body.append(dialog);
  dialog.showModal();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-network]')) openPanel();
});

render();
check();
setInterval(check, CHECK_MS);
// ヘッダーは各画面が後から描くので、少し待ってからもう一度表示をそろえる
setTimeout(render, 300);
