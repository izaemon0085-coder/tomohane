// プロフィール：その人のひとこと・推し・図書館の本・最近の投稿（生年月日・年齢は出さない）
// ・子ども（12歳まで）は、本人とおうちの人のほかには名前だけ
// ・?id= がなければ、自分のページ
import { api, refreshMe, headerHtml, escapeHtml, timeAgo, toast } from '/shared/api.js';
import { LIBRARY_GENRES } from '/shared/library.js';

const $ = (s) => document.querySelector(s);
document.querySelector('#header').innerHTML = headerHtml('profile');
const genre = (id) => LIBRARY_GENRES.find((g) => g.id === id);
const snippet = (t, n = 80) => ([...t].length > n ? `${[...t].slice(0, n).join('')}…` : t);

function render(p) {
  document.title = `${p.name}さん | ともはね β版`;
  $('#name').textContent = `${p.name}さん`;
  $('#face').textContent = [...p.name][0] ?? '？';
  $('#limited').hidden = !p.limited;
  $('#more').hidden = p.limited;
  $('#bio-form').hidden = !p.self;
  if (p.limited) { $('#bio').textContent = ''; return; }
  $('#bio').textContent = p.bio || (p.self ? 'まだひとことがありません。下から書けます。' : '');
  if (p.self) $('#bio-form').bio.value = p.bio;
  const g = p.oshi?.genre && genre(p.oshi.genre);
  $('#oshi').innerHTML = p.oshi
    ? `<strong>${escapeHtml(p.oshi.name)}</strong>${g ? ` <span class="muted small">${g.emoji} ${escapeHtml(g.name)}</span>` : ''}`
    : '<span class="muted">まだ登録していません</span>';
  $('#books').innerHTML = p.books.map((b) => `<li><a class="lib-book" href="/library.html?book=${encodeURIComponent(b.id)}">
      <span class="book-cover" style="--cover:${escapeHtml(b.cover.color)}" aria-hidden="true"><span class="cover-emoji">${escapeHtml(b.cover.emoji)}</span></span>
      <span class="book-info"><strong>${escapeHtml(b.title)}</strong><span class="muted small">${b.kind === 'novel' ? '📖 小説' : '🖼️ 漫画'}</span></span></a></li>`).join('')
    || '<li class="muted">まだありません</li>';
  $('#posts').innerHTML = p.posts.map((x) => {
    const href = x.thread ? `/plaza.html?thread=${encodeURIComponent(x.thread)}` : x.table ? '/cafe.html' : '/plaza.html';
    return `<li><a href="${href}"><span>${escapeHtml(snippet(x.text))}</span>
      <span class="muted small">${escapeHtml(timeAgo(x.createdAt))}${x.table ? '・☕ カフェ' : '・💬 広場'}${x.likeCount ? `・💖 ${x.likeCount}` : ''}</span></a></li>`;
  }).join('') || '<li class="muted">まだありません</li>';
}

$('#bio-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = e.target.querySelector('.error');
  err.textContent = '';
  try {
    await api('/profile/bio', { method: 'POST', body: { bio: e.target.bio.value } });
    toast('ひとことを保存しました');
    load();
  } catch (ex) { err.textContent = ex.message; }
});

async function load() {
  const me = await refreshMe();
  const id = new URLSearchParams(location.search).get('id') ?? me?.id;
  if (!id) { location.href = '/login.html?next=/profile.html'; return; }
  try {
    render(await api(`/users/${encodeURIComponent(id)}/profile`));
  } catch (err) {
    $('#name').textContent = 'プロフィール';
    $('#bio').textContent = err.status === 404 ? 'この人のページは見られません。' : err.message;
  }
}
load();
