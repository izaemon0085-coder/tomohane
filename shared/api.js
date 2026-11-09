// 3つのフロント共通：API 呼び出し、リアルタイム更新、ログインユーザー、表示ヘルパー
// サーバーにつながらないときのエラーには err.offline = true が付く（ローカル回線の送信待ちで使う）
import { latestIssueId, publishedIssues } from '/shared/news.js';
import { TERMS_VERSION, TERMS_PAGE } from '/shared/terms.js';

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('つながっていません（オフライン）'), { offline: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `エラー (${res.status})`), { offline: Boolean(data.offline), status: res.status });
  }
  return data;
}

// サーバーからの変更通知を受け取り、コールバックごとにまとめて（デバウンスして）呼ぶ
// 例: onServerEvents({ post: loadPosts, agent: loadAgents })
// 1ページで接続は1本だけにして、画面と遊び場で共有する
let sharedSource = null;
export function onServerEvents(handlers, delay = 150) {
  sharedSource ||= new EventSource('/api/events');
  const source = sharedSource;
  const timers = new Map();
  for (const [type, callback] of Object.entries(handlers)) {
    source.addEventListener(type, () => {
      clearTimeout(timers.get(callback));
      timers.set(callback, setTimeout(callback, delay));
    });
  }
  return source;
}

// ログインしている人。本当のしるしはサーバーのクッキー（JavaScript からは読めない）にあり、
// ここには画面をすぐ出すための写しだけを置く（オフラインのときも名前を出せるように）
const ME_KEY = 'agent-sns:me';
export function getMe() {
  try {
    return JSON.parse(localStorage.getItem(ME_KEY));
  } catch {
    return null;
  }
}
function setMeCache(user) {
  try {
    if (user) localStorage.setItem(ME_KEY, JSON.stringify(user));
    else localStorage.removeItem(ME_KEY);
  } catch { /* 保存できなくても続行 */ }
}
// サーバーに「いまログインしているのはだれ？」と聞く。オフラインなら写しを使う
export async function refreshMe() {
  try {
    const user = await api('/auth/me');
    setMeCache(user);
    // ともはね の約束（利用規約）にまだ同意していない・新しくなったときは、約束のページで同意してもらう
    if (user && user.termsVersion !== TERMS_VERSION && typeof location !== 'undefined'
      && ![TERMS_PAGE, '/login.html'].includes(location.pathname)) {
      location.href = `${TERMS_PAGE}?agree=1&next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
    }
    return user;
  } catch (err) {
    if (err.offline) return getMe();
    setMeCache(null);
    return null;
  }
}
export function rememberMe(user) {
  setMeCache(user);
}
// ログインの画面へ（ログインしたら、いまの画面にもどってくる）
export function loginUrl() {
  return `/login.html?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
}
export async function logout({ everywhere = false } = {}) {
  try {
    await api(everywhere ? '/auth/logout-all' : '/auth/logout', { method: 'POST' });
  } catch { /* オフラインでも、この端末の写しは消す */ }
  setMeCache(null);
}
// data-login-link のついたリンクは、押したときに「いまの画面にもどる」ログインのアドレスにする
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('[data-login-link]');
    if (a) a.href = loginUrl();
  });
}

export const STATUS_LABEL = {
  home: '🏠 在宅',
  sleeping: '💤 睡眠中',
  meeting: '🗣️ 会議中',
};

// ログインや案内のあとに、もどる画面（このサイトの中のページだけ）
// 「/\よそ.example」のような書き方も、ブラウザはよそのサイトとして読むので、アドレスとして組み立ててから確かめる
export function safeNext(raw) {
  const next = raw || '/';
  if (!next.startsWith('/') || /[\\\s]/.test(next)) return '/';
  let u;
  try { u = new URL(next, location.origin); } catch { return '/'; }
  // いまの画面そのものには、もどらない（ログイン画面からログイン画面へ、など）
  if (u.origin !== location.origin || u.pathname === location.pathname) return '/';
  return u.pathname + u.search + u.hash;
}

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

// ともはね新聞：まだ読んでいない新しい号があるか（この端末で見たかどうか）
const NEWS_SEEN_KEY = 'tomohane.newsSeen';
function hasUnreadNews() {
  try { return Boolean(latestIssueId()) && localStorage.getItem(NEWS_SEEN_KEY) !== latestIssueId(); } catch { return false; }
}
// 号外は赤い「号外」の札、ふだんの号は小さな点
function newsMark() {
  return publishedIssues()[0]?.kind === 'extra'
    ? '<span class="news-extra">号外</span>'
    : '<span class="news-dot"></span><span class="sr-only">（新しい号）</span>';
}
// 地図の新聞社の札用：まだ読んでいない号があれば 'weekly' か 'extra'、なければ null
export function unreadNewsKind() {
  return hasUnreadNews() ? (publishedIssues()[0]?.kind ?? 'weekly') : null;
}
export function markNewsSeen() {
  try { localStorage.setItem(NEWS_SEEN_KEY, latestIssueId()); } catch { /* 保存できない端末 */ }
}

// 🔔 お知らせ：まだ読んでいない数をヘッダーの 🔔 に出す（ログインしている人だけ）
export async function refreshNoticeCount() {
  const el = document.querySelector('[data-notice-count]');
  if (!el) return;
  try {
    const { unread } = await api('/notices');
    el.textContent = unread > 99 ? '99+' : String(unread);
    el.hidden = !unread;
    el.closest('a')?.setAttribute('aria-label', unread ? `お知らせ（まだ読んでいないものが${unread}件）` : 'お知らせ');
  } catch { el.hidden = true; }
}

export function headerHtml(current) {
  const me = getMe();
  if (me) setTimeout(refreshNoticeCount, 0); // ヘッダーが画面に入ってから数を取りにいく
  const link = (href, label, key) =>
    `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<div class="inner">
    <a class="brand" href="/" title="推し活SNS ともはね">ともはね <span class="beta">β版</span></a>
    <nav class="nav" aria-label="メイン">
      ${link('/', '🗺️ 町', 'map')}
      ${link('/plaza.html', '💬 広場', 'plaza')}
      ${link('/cafe.html', '☕ カフェ', 'cafe')}
      ${link('/oshi.html', '💖 わたしの推し', 'oshi')}
      ${link('/games.html', '🎮 ゲーセン', 'games')}
      ${link('/library.html', '📚 図書館', 'library')}
      ${link('/letter.html', '✉️ 手紙', 'letter')}
      ${link('/news.html', `📰 新聞${current !== 'news' && hasUnreadNews() ? newsMark() : ''}`, 'news')}
      ${link('/side/', '🏡 家', 'side')}
      ${link('/sub/', '🗣️ 会議室', 'sub')}
    </nav>
    <button type="button" class="net-chip" data-open-network data-net-chip title="ローカル回線のようす">📶</button>
    <button type="button" class="kisekae-btn" data-open-customize title="推しカラーや飾りで画面をきせかえ">🎨 きせかえ</button>
    ${me ? `<a class="notice-bell"${current === 'notices' ? ' aria-current="page"' : ''} href="/notices.html" title="お知らせ（ハトの郵便屋さん）" aria-label="お知らせ">🔔<span class="notice-count" data-notice-count hidden></span></a>` : ''}
    ${me
    ? `<a class="me" href="/login.html" title="アカウント・ログアウト">${escapeHtml(me.name)} さん</a>`
    : '<a class="me" href="/login.html" data-login-link>ログイン</a>'}
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
