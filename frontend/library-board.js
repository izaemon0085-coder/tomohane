// 募集の掲示板：作者の「挿し絵・表紙を描いてほしい」に、描いた人が絵とひとことで応募する
// ・返事（おしゃべり）の場所は置かない（図書館はしずかに）
// ・応募するときは「選ばれたら、この本に載せてもいい」に同意する
// ・選ぶのは作者。選ばれた絵は、本に描いた人の名前といっしょに載る
import { api, refreshMe, headerHtml, escapeHtml, toast } from '/shared/api.js';
import { LIBRARY_GENRES } from '/shared/library.js';

const $ = (s) => document.querySelector(s);
document.querySelector('#header').innerHTML = headerHtml('library');
const AGE = { child: 'だれでも', teen: '中高生から', adult: '大人だけ' };
const genre = (id) => LIBRARY_GENRES.find((g) => g.id === id) ?? { emoji: '🌈', name: 'そのほか' };
const callLabel = (c) => (c.kind === 'cover' ? '📕 表紙' : `🖼️ 挿絵${c.slot}`);
let me = null;

function entryHtml(c, e) {
  return `<li class="lib-entry${c.adoptedEntryId === e.id ? ' adopted' : ''}">
    <img src="${escapeHtml(e.image)}" alt="${escapeHtml(e.name)}さんの絵" loading="lazy">
    <span class="small"><strong>${escapeHtml(e.name)}</strong>さん${c.adoptedEntryId === e.id ? ' 🏅 選ばれました' : ''}</span>
    ${e.comment ? `<span class="small">${escapeHtml(e.comment)}</span>` : ''}
    ${e.mine && c.adoptedEntryId !== e.id ? `<button class="btn ghost small" type="button" data-withdraw="${escapeHtml(e.id)}" data-call="${escapeHtml(c.id)}">応募を取り下げる</button>` : ''}
  </li>`;
}
function callHtml(c) {
  const g = genre(c.book.genre);
  const mineCount = c.entries.filter((e) => e.mine).length;
  return `<li class="card panel lib-call" id="call-${escapeHtml(c.id)}">
    <div class="lib-call-head">
      <span class="book-cover" style="--cover:${escapeHtml(c.book.cover.color)}" aria-hidden="true"><span class="cover-emoji">${escapeHtml(c.book.cover.emoji)}</span></span>
      <div>
        <p class="call-kind">${callLabel(c)} を募集${c.status !== 'open' ? '（しめきり）' : ''}</p>
        <h2>${escapeHtml(c.book.title)}</h2>
        <p class="muted small">${escapeHtml(c.book.author)}さん・${c.book.kind === 'novel' ? '小説' : '漫画'}・${g.emoji} ${escapeHtml(g.name)}・${AGE[c.book.minAge]}</p>
        ${c.book.blurb ? `<p class="small">${escapeHtml(c.book.blurb)}</p>` : ''}
      </div>
    </div>
    <p class="call-note">「${escapeHtml(c.note)}」</p>
    <ul class="lib-entries">${c.entries.map((e) => entryHtml(c, e)).join('') || '<li class="muted small">まだ応募はありません</li>'}</ul>
    ${c.status === 'open' && me && !c.mine && mineCount < 3 ? `<form class="lib-apply" data-apply="${escapeHtml(c.id)}">
      <label class="btn ghost file-btn">絵をえらぶ（PNG・JPEG・WebP、5MBまで）<input type="file" name="image" accept="image/png,image/jpeg,image/webp" hidden required></label>
      <span class="small muted" data-file-name></span>
      <label class="field small">ひとこと（60文字まで・なくてもよい）<input class="input" name="comment" maxlength="60"></label>
      <label class="row small"><input type="checkbox" name="consent"> 自分で描いた絵です。選ばれたら、この本に名前といっしょに載せてもいいです</label>
      <button class="btn" type="submit" disabled>応募する</button>
    </form>` : ''}
    ${c.mine ? '<p class="muted small">あなたの募集です。選ぶのは「作家の机」から。</p>' : ''}
  </li>`;
}

async function load() {
  const calls = await api('/library/calls');
  $('#calls').innerHTML = calls.map(callHtml).join('');
  $('#empty').hidden = calls.length > 0;
}

document.addEventListener('change', (e) => {
  const form = e.target.closest('[data-apply]');
  if (!form) return;
  if (e.target.name === 'image') form.querySelector('[data-file-name]').textContent = e.target.files[0]?.name ?? '';
  form.querySelector('[type=submit]').disabled = !(form.image.files.length && form.consent.checked);
});
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-apply]');
  if (!form) return;
  e.preventDefault();
  const file = form.image.files[0];
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/library/calls/${form.dataset.apply}/entries`, {
      method: 'POST', body: file,
      headers: { 'Content-Type': file.type, 'X-Comment': encodeURIComponent(form.comment.value), 'X-Consent': form.consent.checked ? 'yes' : 'no' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `エラー (${res.status})`);
    toast('🐢 応募をあずかったよ。作者さんが選ぶのを待っておくれ');
    await load();
  } catch (err) {
    toast(`🐭 ${err.message}`, 5000);
    btn.disabled = false;
  }
});
document.addEventListener('click', async (e) => {
  const w = e.target.closest('[data-withdraw]');
  if (!w || !confirm('この応募を取り下げますか？')) return;
  try {
    await api(`/library/calls/${w.dataset.call}/entries/${w.dataset.withdraw}`, { method: 'DELETE' });
    await load();
  } catch (err) { toast(`🐭 ${err.message}`); }
});

me = await refreshMe();
$('#need-login').hidden = Boolean(me);
try {
  await load();
  const id = location.hash.slice(1);
  if (id) document.getElementById(id)?.scrollIntoView();
} catch (err) { toast(`🐭 ${err.message}`); }
