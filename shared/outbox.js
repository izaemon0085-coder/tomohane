// ローカル回線：送信待ちボックス（アウトボックス）
// オフラインで投稿したら、この端末にためておき、つながったら自動で送る。
import { api } from '/shared/api.js';

const KEY = 'agent-sns:outbox';

export function getOutbox() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function setOutbox(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* 保存できない環境 */ }
  window.dispatchEvent(new CustomEvent('outbox-change', { detail: { count: items.length } }));
}

// 投稿する。つながらなければ送信待ちにためて { queued: true } を返す
export async function sendPost(body) {
  try {
    return await api('/posts', { method: 'POST', body });
  } catch (err) {
    if (!err.offline) throw err; // 入力ミスなどはそのままエラーにする
    const item = { ...body, localId: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, queuedAt: new Date().toISOString() };
    setOutbox([...getOutbox(), item]);
    return { queued: true, item };
  }
}

let flushing = false;
// ためていた投稿を順番に送る。送れた件数を返す
export async function flushOutbox() {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of getOutbox()) {
      const { localId, queuedAt, ...body } = item;
      try {
        await api('/posts', { method: 'POST', body });
        sent += 1;
      } catch (err) {
        if (err.offline) break; // まだつながらない → 次の機会に
        // 送れない内容（返信先が消えた など）は、送信待ちから外す
        console.warn('送信待ちの投稿を送れませんでした', err.message);
      }
      setOutbox(getOutbox().filter((x) => x.localId !== localId));
    }
  } finally {
    flushing = false;
  }
  if (sent) window.dispatchEvent(new CustomEvent('outbox-sent', { detail: { sent } }));
  return sent;
}

export function cancelOutboxItem(localId) {
  setOutbox(getOutbox().filter((x) => x.localId !== localId));
}
