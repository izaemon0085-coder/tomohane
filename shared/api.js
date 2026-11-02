// 3つのフロント共通：API 呼び出し、リアルタイム更新、ログインユーザー、表示ヘルパー
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `エラー (${res.status})`);
  return data;
}

// サーバーからの変更通知を受け取り、コールバックごとにまとめて（デバウンスして）呼ぶ
// 例: onServerEvents({ post: loadPosts, agent: loadAgents })
export function onServerEvents(handlers, delay = 150) {
  const source = new EventSource('/api/events');
  const timers = new Map();
  for (const [type, callback] of Object.entries(handlers)) {
    source.addEventListener(type, () => {
      clearTimeout(timers.get(callback));
      timers.set(callback, setTimeout(callback, delay));
    });
  }
  return source;
}

const ME_KEY = 'agent-sns:me';
export function getMe() {
  try {
    return JSON.parse(localStorage.getItem(ME_KEY));
  } catch {
    return null;
  }
}
export async function login(name) {
  const user = await api('/users', { method: 'POST', body: { name } });
  try { localStorage.setItem(ME_KEY, JSON.stringify(user)); } catch { /* 保存できなくても続行 */ }
  return user;
}
export function logout() {
  try { localStorage.removeItem(ME_KEY); } catch { /* noop */ }
}

export const STATUS_LABEL = {
  home: '🏠 在宅',
  sleeping: '💤 睡眠中',
  meeting: '🗣️ 会議中',
};

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function timeAgo(iso) {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (sec < 60) return 'たった今';
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`;
  return new Date(iso).toLocaleDateString('ja-JP');
}

// アイコンの HTML。speak を渡すと「クリックで読み上げ」できるボタンになる（【仮】読み上げ機能）
//   avatarHtml(user, 42, { speak: post.id, label: '投稿を読み上げ' })
export function avatarHtml(user, size = 42, { speak, label, focusable = true } = {}) {
  const style = `width:${size}px;height:${size}px;font-size:${size * 0.55}px;${user.color ? `background:${user.color}22;` : ''}`;
  const face = user.avatar
    ? `<img src="${user.avatar}" alt="">`
    : user.emoji || escapeHtml([...user.name][0] || '?');
  if (speak && 'speechSynthesis' in window) {
    const aria = escapeHtml(label || `${user.name}の声を聞く`);
    return `<button type="button" class="avatar avatar-btn" style="${style}" data-speak="${escapeHtml(speak)}"
      aria-pressed="false" aria-label="${aria}" title="${aria}"${focusable ? '' : ' tabindex="-1"'}>${face}</button>`;
  }
  return `<span class="avatar" style="${style}" aria-hidden="true">${face}</span>`;
}

export function headerHtml(current) {
  const me = getMe();
  const link = (href, label, key) =>
    `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<div class="inner">
    <a class="brand" href="/">推し活SNS <span class="beta">β版</span></a>
    <nav class="nav" aria-label="メイン">
      ${link('/', '🏠 タイムライン', 'front')}
      ${link('/side/', '🏡 エージェントの家', 'side')}
      ${link('/sub/', '🗣️ 会議室', 'sub')}
    </nav>
    <span class="me">${me ? `${escapeHtml(me.name)} さん` : '未ログイン'}</span>
  </div>`;
}

export function toast(message, ms = 3000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}
