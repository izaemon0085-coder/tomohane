// 図書館：ジャンル別・年齢別の棚から、小説・漫画をえらんで読む
// ・年齢の棚（中高生から・大人だけ）に入るときは、ひとこと同意してから（このタブを閉じるまでおぼえておく）
// ・本のページには、おしゃべりの場所を置かない（しずかに）。感想はカフェで
import { api, headerHtml, escapeHtml, toast } from '/shared/api.js';
import { formatNovel } from '/shared/library.js';

const $ = (s) => document.querySelector(s);
document.querySelector('#header').innerHTML = headerHtml('library');

const KINDS = [{ id: 'all', name: 'ぜんぶ' }, { id: 'novel', name: '📖 小説' }, { id: 'manga', name: '🖼️ 漫画' }];
const CONSENT_TEXT = {
  teen: '「中高生から」の棚には、13歳からの本が並んでいるよ。少しむずかしい気持ちや、恋や別れの話もあるからね。',
  adult: '「大人だけ」の棚は、18歳からの仲間内だけの本だよ。ここで読んだものは、広場やカフェには持ち出さないでおくれ。',
};
let lib = null;
const view = { shelf: 'child', kind: 'all', genre: 'all' };

// ---- 同意（タブを閉じるまでおぼえる。保存できないときは、そのたびに聞く） ----
const consented = new Set(['child']);
try { for (const s of JSON.parse(sessionStorage.getItem('library-consent') ?? '[]')) consented.add(s); } catch { /* noop */ }
function rememberConsent(shelf) {
  consented.add(shelf);
  try { sessionStorage.setItem('library-consent', JSON.stringify([...consented])); } catch { /* noop */ }
}
let afterConsent = null;
function askConsent(shelf, then) {
  afterConsent = then;
  $('#consent-text').textContent = CONSENT_TEXT[shelf];
  $('#consent-check').checked = false;
  $('#consent-yes').disabled = true;
  $('#consent').dataset.askShelf = shelf;
  $('#consent').hidden = false;
  $('#consent').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#consent-check').addEventListener('change', (e) => { $('#consent-yes').disabled = !e.target.checked; });
$('#consent-yes').addEventListener('click', () => {
  rememberConsent($('#consent').dataset.askShelf);
  $('#consent').hidden = true;
  afterConsent?.();
});
$('#consent-no').addEventListener('click', () => { $('#consent').hidden = true; afterConsent = null; });

// ---- 棚 ----
const genreOf = (id) => lib.genres.find((g) => g.id === id) ?? { name: 'そのほか', emoji: '🌈' };
const shelfName = (id) => ({ child: 'だれでも', teen: '中高生から', adult: '大人だけ' })[id];

function chip(group, id, label, pressed) {
  return `<button type="button" class="lib-chip" data-${group}="${id}" aria-pressed="${pressed}">${label}</button>`;
}
function coverHtml(b, big = false) {
  if (b.coverImage) return `<img class="cover-img" src="${escapeHtml(b.coverImage)}" alt="" loading="lazy">`;
  return `<span class="cover-emoji">${escapeHtml(b.cover.emoji)}</span>${big ? '' : `<span class="cover-title">${escapeHtml(b.title)}</span>`}`;
}
function renderLobby() {
  $('#shelves').innerHTML = lib.shelves.map((s) => chip('shelf', s.id, `${s.id === 'child' ? '' : '🔖 '}${escapeHtml(s.name)}`, view.shelf === s.id)).join('');
  $('#kinds').innerHTML = KINDS.map((k) => chip('kind', k.id, k.name, view.kind === k.id)).join('');
  $('#genres').innerHTML = chip('genre', 'all', 'ジャンル：ぜんぶ', view.genre === 'all')
    + lib.genres.map((g) => chip('genre', g.id, `${g.emoji} ${escapeHtml(g.name)}`, view.genre === g.id)).join('');
  const books = lib.books.filter((b) => b.minAge === view.shelf
    && (view.kind === 'all' || b.kind === view.kind) && (view.genre === 'all' || b.genre === view.genre));
  $('#books').innerHTML = books.map((b) => `<li>
    <a class="lib-book" href="?book=${encodeURIComponent(b.id)}" data-book="${escapeHtml(b.id)}">
      <span class="book-cover" style="--cover:${escapeHtml(b.cover.color)}" aria-hidden="true">${coverHtml(b)}</span>
      <span class="book-info">
        <strong>${escapeHtml(b.title)}</strong>
        <span class="muted small">${b.kind === 'novel' ? `📖 小説・${b.length.toLocaleString()}字` : `🖼️ 漫画・${b.length}ページ`}・${genreOf(b.genre).emoji} ${escapeHtml(genreOf(b.genre).name)}</span>
        <span class="small">${escapeHtml(b.blurb)}</span>
        ${b.sample ? '<span class="sample-badge">サンプル</span>' : ''}
      </span></a></li>`).join('');
  $('#empty').hidden = books.length > 0;
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-shelf],[data-kind],[data-genre],[data-book]');
  if (!t || !lib) return;
  if (t.dataset.book) { e.preventDefault(); openBook(t.dataset.book); return; }
  if (t.dataset.shelf) {
    const shelf = t.dataset.shelf;
    const go = () => { view.shelf = shelf; renderLobby(); $('#nezumi-say').textContent = `（ちいさな声で）「${shelfName(shelf)}」の棚です。`; };
    return consented.has(shelf) ? go() : askConsent(shelf, go);
  }
  if (t.dataset.kind) view.kind = t.dataset.kind;
  if (t.dataset.genre) view.genre = t.dataset.genre;
  renderLobby();
});

// ---- 読む ----
let book = null;
let page = 0;
const facesHtml = (faces) => faces.map((f) => (/^[a-z-]+$/.test(f)
  ? `<img class="koma-face" src="/shared/avatars/${f}.svg" alt="">`
  : `<span class="koma-face emoji">${escapeHtml(f)}</span>`)).join('');
function komaHtml(k, i) {
  const says = (k.say ?? []).map((s) => `<p class="bubble"><span class="sr-only">${escapeHtml(s.who)}：</span>${escapeHtml(s.text)}</p>`).join('');
  return `<div class="koma${k.dark ? ' dark' : ''}" style="--koma:${escapeHtml(k.bg ?? '#fff')}" aria-label="${i + 1}コマめ">
    ${k.narr ? `<p class="koma-narr">${escapeHtml(k.narr)}</p>` : ''}
    ${k.sfx ? `<p class="koma-sfx" aria-label="音：${escapeHtml(k.sfx)}">${escapeHtml(k.sfx)}</p>` : ''}
    <div class="koma-cast">${facesHtml(k.face ?? [])}</div>
    <div class="koma-says">${says}</div></div>`;
}
// サンプルは4コマのデータ、ユーザーの漫画は画像のページ
const pageTotal = () => (book.pages ? book.pages.length : book.pageCount);
function renderPage() {
  const total = pageTotal();
  $('#manga-page').classList.toggle('is-image', !book.pages);
  $('#manga-page').innerHTML = book.pages
    ? book.pages[page].panels.map(komaHtml).join('')
    : `<img class="manga-img" src="/api/library/books/${encodeURIComponent(book.id)}/pages/${page}" alt="${page + 1}ページめ">`;
  $('#page-no').textContent = `${page + 1} / ${total} ページ`;
  $('#next').disabled = page >= total - 1;
  $('#prev').disabled = page <= 0;
}
function turn(d) {
  if (book?.kind !== 'manga') return;
  const p = Math.min(Math.max(page + d, 0), pageTotal() - 1);
  if (p !== page) { page = p; renderPage(); $('#manga').scrollIntoView({ block: 'start' }); }
}
$('#next').addEventListener('click', () => turn(1));
$('#prev').addEventListener('click', () => turn(-1));
document.addEventListener('keydown', (e) => {
  if ($('#reader').hidden || book?.kind !== 'manga' || e.target.closest('input,textarea,select')) return;
  if (e.key === 'ArrowLeft') turn(1);
  if (e.key === 'ArrowRight') turn(-1);
});

function showReader(on) {
  $('#lobby').hidden = on;
  $('#reader').hidden = !on;
  window.scrollTo(0, 0);
}
async function openBook(id, { push = true } = {}) {
  const card = lib.books.find((b) => b.id === id);
  if (!card) { toast('🐭 その本は、この棚では見つかりませんでした'); return showLobby({ push }); }
  if (!consented.has(card.minAge)) {
    showLobby({ push: false });
    return askConsent(card.minAge, () => openBook(id, { push }));
  }
  try {
    book = await api(`/library/books/${encodeURIComponent(id)}`);
  } catch (err) {
    toast(`🐭 ${err.message}`);
    return;
  }
  if (push) history.pushState({ book: id }, '', `?book=${encodeURIComponent(id)}`);
  page = 0;
  const g = genreOf(book.genre);
  $('#book-cover').style.setProperty('--cover', book.cover.color);
  $('#book-cover').innerHTML = coverHtml(book, true);
  $('#book-title').textContent = book.title;
  $('#book-meta').textContent = `${book.author}${book.sample ? '' : 'さん'}・${book.kind === 'novel' ? '小説' : '漫画'}・${g.emoji} ${g.name}・${shelfName(book.minAge)}`;
  $('#book-blurb').textContent = book.blurb;
  $('#novel').hidden = book.kind !== 'novel';
  $('#novel-tools').hidden = book.kind !== 'novel';
  $('#manga').hidden = book.kind !== 'manga';
  if (book.kind === 'novel') $('#novel').innerHTML = formatNovel(book.text);
  else renderPage();
  document.title = `${book.title} | 図書館 | ともはね β版`;
  showReader(true);
}
function showLobby({ push = true } = {}) {
  if (push) history.pushState({}, '', '/library.html');
  document.title = '図書館 | ともはね β版';
  book = null;
  showReader(false);
}
$('#back').addEventListener('click', () => showLobby());
window.addEventListener('popstate', () => {
  const id = new URLSearchParams(location.search).get('book');
  if (id) openBook(id, { push: false }); else showLobby({ push: false });
});

// 小説の読み方：縦書き・横書き、字の大きさ（この端末におぼえる）
const prefs = { vertical: false, big: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('library-prefs') ?? '{}')); } catch { /* noop */ }
function applyPrefs() {
  $('#novel').classList.toggle('vertical', prefs.vertical);
  $('#novel').classList.toggle('big', prefs.big);
  $('#dir').textContent = prefs.vertical ? '横書きにする' : '縦書きにする';
  $('#dir').setAttribute('aria-pressed', String(prefs.vertical));
  $('#size').textContent = prefs.big ? '字をふつうに' : '字を大きく';
  try { localStorage.setItem('library-prefs', JSON.stringify(prefs)); } catch { /* noop */ }
}
$('#dir').addEventListener('click', () => { prefs.vertical = !prefs.vertical; applyPrefs(); });
$('#size').addEventListener('click', () => { prefs.big = !prefs.big; applyPrefs(); });
applyPrefs();

try {
  lib = await api('/library');
  $('#kame-say').textContent = lib.kame;
  renderLobby();
  const id = new URLSearchParams(location.search).get('book');
  if (id) openBook(id, { push: false });
} catch {
  $('#kame-say').textContent = 'おや、いまは棚が開けないようだね。少しあとで、また来ておくれ。';
}
