// 🔍 さがす：投稿・図書館の本・人・#タグ（見てよいものだけ。サーバーがしぼる）
import { api, headerHtml, escapeHtml, timeAgo } from '/shared/api.js';
import { linkifyTags } from '/shared/search.js';

const $ = (s) => document.querySelector(s);
document.querySelector('#header').innerHTML = headerHtml('search');
const form = $('#search-form');
const snippet = (t, n = 100) => ([...t].length > n ? `${[...t].slice(0, n).join('')}…` : t);

function postLink(p) {
  if (p.threadId) return `/plaza.html?thread=${encodeURIComponent(p.threadId)}`;
  return p.table ? '/cafe.html' : '/plaza.html';
}

function show(r) {
  const none = !r.posts.length && !r.books.length && !r.people.length;
  $('#state').textContent = none
    ? `「${r.q}」は見つかりませんでした。ことばを短くしてみてください。`
    : r.tag ? `${r.q} のタグがついた投稿` : `「${r.q}」のさがした結果`;
  $('#sec-people').hidden = !r.people.length;
  $('#people').innerHTML = r.people.map((u) => `<li><a href="/profile.html?id=${encodeURIComponent(u.id)}">
    <strong>${escapeHtml(u.name)}</strong>さん${u.bio ? `<span class="muted small">${escapeHtml(u.bio)}</span>` : ''}</a></li>`).join('');
  $('#sec-books').hidden = !r.books.length;
  $('#books').innerHTML = r.books.map((b) => `<li><a class="lib-book" href="/library.html?book=${encodeURIComponent(b.id)}">
    <span class="book-cover" style="--cover:${escapeHtml(b.cover.color)}" aria-hidden="true"><span class="cover-emoji">${escapeHtml(b.cover.emoji)}</span></span>
    <span class="book-info"><strong>${escapeHtml(b.title)}</strong><span class="muted small">${b.kind === 'novel' ? '📖 小説' : '🖼️ 漫画'}・${escapeHtml(b.author)}${b.sample ? '' : 'さん'}</span></span></a></li>`).join('');
  $('#sec-posts').hidden = !r.posts.length;
  $('#posts').innerHTML = r.posts.map((p) => `<li><div class="search-post">
    <span class="muted small">${escapeHtml(p.author?.name ?? '？')}・${escapeHtml(timeAgo(p.createdAt))}${p.table ? '・☕ カフェ' : '・💬 広場'}</span>
    <span>${linkifyTags(escapeHtml(snippet(p.text)))}</span>
    <a class="small" href="${postLink(p)}">ひらく →</a></div></li>`).join('');
}

async function search(q, { push = true } = {}) {
  form.q.value = q;
  if (!q.trim()) return;
  if (push) history.pushState({}, '', `?q=${encodeURIComponent(q)}`);
  $('#state').textContent = 'さがしています…';
  try {
    show(await api(`/search?q=${encodeURIComponent(q)}`));
  } catch (err) {
    $('#state').textContent = err.message;
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); search(form.q.value); });
window.addEventListener('popstate', () => search(new URLSearchParams(location.search).get('q') ?? '', { push: false }));
const first = new URLSearchParams(location.search).get('q');
if (first) search(first, { push: false }); else form.q.focus();
