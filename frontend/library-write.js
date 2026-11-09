// 作家の机：小説・漫画を書く → （ネズミのまとめた案・運営の手伝い）→ 同意して図書館に出す
// お話や文章を変えるのは、作者だけ。ネズミと運営は「案」を出すだけ
import { api, refreshMe, headerHtml, escapeHtml, toast } from '/shared/api.js';
import { formatNovel, LIBRARY_GENRES, AGE_SHELVES, shelfAllows } from '/shared/library.js';

const $ = (s) => document.querySelector(s);
document.querySelector('#header').innerHTML = headerHtml('library');

const STATUS = { draft: '下書き', published: '📚 図書館に出ています', hidden: '🦉 運営が取り下げました' };
let me = null;
let books = [];
let current = null; // いま開いている本（null なら新しい本）

const form = $('#book-form');
const nezumi = (t) => { $('#nezumi-say').textContent = `（ちいさな声で）${t}`; };
const showError = (err) => { $('#form-error').textContent = err?.message ?? ''; };

// ---- わたしの本 ----
function renderMine() {
  $('#mine').innerHTML = books.map((b) => `<li class="lib-mine-item">
    <span class="book-cover" style="--cover:${escapeHtml(b.cover.color)}" aria-hidden="true"><span class="cover-emoji">${escapeHtml(b.cover.emoji)}</span></span>
    <span class="book-info"><strong>${escapeHtml(b.title)}</strong>
      <span class="muted small">${b.kind === 'novel' ? `📖 小説・${b.length.toLocaleString()}字` : `🖼️ 漫画・${b.length}ページ`}・${STATUS[b.status]}${b.tidy.help ? (b.tidy.help.reply ? '・🦉 運営から返事あり' : '・🦉 運営に相談中') : ''}</span></span>
    <button class="btn ghost" type="button" data-open="${escapeHtml(b.id)}">${b.status === 'published' ? 'なおす' : '書く'}</button></li>`).join('');
  $('#mine-empty').hidden = books.length > 0;
}
$('#mine').addEventListener('click', (e) => {
  const id = e.target.closest('[data-open]')?.dataset.open;
  if (id) openEditor(books.find((b) => b.id === id));
});
async function loadMine() {
  books = await api('/library/mine');
  renderMine();
  if (current) {
    current = books.find((b) => b.id === current.id) ?? null;
    if (current) renderBook();
  }
}

// ---- 本を書く・なおす ----
const kindNow = () => current?.kind ?? form.kind.value;
function fillSelects() {
  $('#genre').innerHTML = LIBRARY_GENRES.map((g) => `<option value="${g.id}">${g.emoji} ${escapeHtml(g.name)}</option>`).join('');
  $('#min-age').innerHTML = AGE_SHELVES.filter((s) => shelfAllows(s.id, me.ageGroup))
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}（${escapeHtml(s.note)}）</option>`).join('');
}
function openEditor(book = null) {
  current = book;
  showError(null);
  form.reset();
  $('#editor').hidden = false;
  $('#kind-field').hidden = Boolean(book);
  $('#editor-title').textContent = book ? `「${book.title}」` : '新しい本';
  if (book) {
    form.title.value = book.title;
    form.genre.value = book.genre;
    form.minAge.value = book.minAge;
    form.blurb.value = book.blurb;
    form.emoji.value = book.cover.emoji;
    form.color.value = book.cover.color;
    form.text.value = book.text ?? '';
    form.tidyWanted.checked = book.tidy.wanted;
  }
  syncKind();
  renderBook();
  $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function syncKind() {
  const novel = kindNow() === 'novel';
  $('#novel-field').hidden = !novel;
  $('#manga-field').hidden = novel || !current;
  $('#save').textContent = current ? '保存する' : (novel ? '下書きを保存' : '下書きを作ってページを入れる');
  $('#text-count').textContent = [...form.text.value].length.toLocaleString();
}
form.addEventListener('change', (e) => { if (e.target.name === 'kind') syncKind(); });
form.text.addEventListener('input', syncKind);
$('#new-book').addEventListener('click', () => openEditor(null));
$('#close-editor').addEventListener('click', () => { current = null; $('#editor').hidden = true; });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(null);
  const body = {
    title: form.title.value, genre: form.genre.value, minAge: form.minAge.value, blurb: form.blurb.value,
    cover: { emoji: form.emoji.value, color: form.color.value }, tidyWanted: form.tidyWanted.checked,
  };
  if (kindNow() === 'novel') body.text = form.text.value;
  try {
    const saved = current
      ? await api(`/library/books/${current.id}`, { method: 'PUT', body })
      : await api('/library/books', { method: 'POST', body: { ...body, kind: kindNow() } });
    current = saved;
    toast('🐭 保存しました');
    if (saved.tidy.nezumi) nezumi('まとめた案を出しました。下で見くらべてくださいね。');
    await loadMine();
    openEditor(current);
  } catch (err) { showError(err); }
});

// 本の状態に合わせて、ページ・ネズミの案・手伝い・出す を見せる
function renderBook() {
  const b = current;
  $('#tidy').hidden = true;
  $('#help').hidden = !b;
  $('#publish').hidden = !b;
  if (!b) return;
  if (b.kind === 'manga') renderPages();
  renderTidy();
  renderHelp();
  renderPublish();
}

// ---- 漫画のページ ----
const thumb = (p, label) => `<img src="${escapeHtml(p.url)}" alt="${escapeHtml(label)}" loading="lazy">`;
function renderPages() {
  const b = current;
  $('#pages').innerHTML = b.pages.map((p, i) => `<li>
    ${thumb(p, `${i + 1}ページめ`)}
    <span class="small">${i + 1}. ${escapeHtml(p.name || '名前なし')}${b.coverPage === i ? ' <strong>（表紙）</strong>' : ''}</span>
    <span class="row wrap page-tools">
      <button class="btn ghost small" type="button" data-move="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="${i + 1}ページめを前へ">↑</button>
      <button class="btn ghost small" type="button" data-move="${i}" data-d="1" ${i === b.pages.length - 1 ? 'disabled' : ''} aria-label="${i + 1}ページめを後ろへ">↓</button>
      <button class="btn ghost small danger" type="button" data-remove="${i}">消す</button>
    </span></li>`).join('');
}
$('#pages').addEventListener('click', async (e) => {
  const mv = e.target.closest('[data-move]');
  const rm = e.target.closest('[data-remove]');
  try {
    if (mv) {
      const i = Number(mv.dataset.move);
      const j = i + Number(mv.dataset.d);
      const order = current.pages.map((_, k) => k);
      [order[i], order[j]] = [order[j], order[i]];
      current = await api(`/library/books/${current.id}/order`, { method: 'PUT', body: { order } });
    } else if (rm) {
      if (!confirm(`${Number(rm.dataset.remove) + 1}ページめを消しますか？`)) return;
      current = await api(`/library/books/${current.id}/pages/${rm.dataset.remove}`, { method: 'DELETE' });
    } else return;
    await loadMine();
  } catch (err) { toast(`🐭 ${err.message}`); }
});
$('#page-files').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  let ok = 0;
  for (const [i, file] of files.entries()) {
    $('#upload-state').textContent = `${i + 1} / ${files.length} 枚め を入れています…`;
    try {
      const res = await fetch(`/api/library/books/${current.id}/pages`, {
        method: 'POST', body: file, headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `エラー (${res.status})`);
      ok += 1;
    } catch (err) {
      toast(`🐭 ${file.name}：${err.message}`, 5000);
    }
  }
  $('#upload-state').textContent = `${ok}枚入れました。`;
  await loadMine();
});

// ---- ネズミのまとめた案 ----
function renderTidy() {
  const s = current.tidy.nezumi;
  if (!s) return;
  $('#tidy').hidden = false;
  $('#tidy-changes').innerHTML = s.changes.length
    ? s.changes.map((c) => `<li>${escapeHtml(c.label)}${c.count > 1 ? `（${c.count}か所）` : ''}</li>`).join('')
    : '<li>見た目は、もうきれいにそろっていました。</li>';
  const novel = current.kind === 'novel';
  $('#tidy-novel').hidden = !novel;
  $('#tidy-manga').hidden = novel;
  if (novel) {
    $('#cmp-before').innerHTML = formatNovel(current.text);
    $('#cmp-after').innerHTML = formatNovel(s.text);
    $('#ruby-box').hidden = !s.ruby.length;
    $('#ruby-list').innerHTML = s.ruby.map((r) => `<label class="row ruby-pick"><input type="checkbox" value="${escapeHtml(r.kanji)}" checked>
      <span><ruby>${escapeHtml(r.kanji)}<rt>${escapeHtml(r.reading)}</rt></ruby> <span class="muted small">${escapeHtml(r.context)}</span></span></label>`).join('');
    $('#typo-box').hidden = !s.typos.length;
    $('#typo-list').innerHTML = s.typos.map((t) => `<li>${t.line}行め「${escapeHtml(t.snippet)}」… ${escapeHtml(t.note)}</li>`).join('');
  } else {
    $('#tidy-pages').innerHTML = s.order.map((i, n) => `<li>${current.pages[i] ? thumb(current.pages[i], `${n + 1}ページめ`) : ''}<span class="small">${n + 1}. ${escapeHtml(current.pages[i]?.name ?? '')}</span></li>`).join('');
  }
}
$('#use-nezumi').addEventListener('click', async () => {
  const ruby = [...document.querySelectorAll('#ruby-list input:checked')].map((i) => i.value);
  try {
    current = await api(`/library/books/${current.id}/tidy`, { method: 'POST', body: { from: 'nezumi', ruby } });
    nezumi('使ってくれて、ありがとうございます。');
    await loadMine();
    openEditor(current);
  } catch (err) { toast(`🐭 ${err.message}`); }
});

// ---- 運営に手伝ってもらう ----
function renderHelp() {
  const h = current.tidy.help;
  $('#help-ask').hidden = Boolean(h);
  $('#help-wait').hidden = !h;
  if (!h) return;
  $('#help').open = true;
  $('#help-asked').textContent = h.note;
  const r = h.reply;
  $('#help-reply').textContent = r
    ? `🦉 運営から：${r.note || '案を作りました'}${r.text ? '（本文の案があります）' : ''}${r.order ? '（ページの順番の案があります）' : ''}${h.used ? '・使いました' : ''}`
    : '🦉 運営が見ています。少し待ってくださいね。';
  $('#use-admin').hidden = !(r && (r.text || r.order || r.cover != null));
}
$('#help-send').addEventListener('click', async () => {
  try {
    current = await api(`/library/books/${current.id}/help`, { method: 'POST', body: { note: $('#help-note').value } });
    nezumi('運営に伝えました。返事が来たら、ここに出ます。');
    await loadMine();
  } catch (err) { toast(`🐭 ${err.message}`); }
});
$('#help-cancel').addEventListener('click', async () => {
  current = await api(`/library/books/${current.id}/help`, { method: 'DELETE' });
  await loadMine();
});
$('#use-admin').addEventListener('click', async () => {
  try {
    current = await api(`/library/books/${current.id}/tidy`, { method: 'POST', body: { from: 'admin' } });
    toast('🦉 運営の案を使いました');
    await loadMine();
    openEditor(current);
  } catch (err) { toast(`🐭 ${err.message}`); }
});

// ---- 図書館に出す ----
function renderPublish() {
  const b = current;
  $('#publish-state').textContent = b.status === 'hidden'
    ? `🦉 運営が取り下げました（理由：${b.hiddenReason}）。運営に相談してください。`
    : b.status === 'published' ? '📚 いま、図書館の棚に出ています。' : 'まだ下書きです。図書館の約束に同意すると、棚に並びます。';
  $('#consent-box').hidden = b.status !== 'draft';
  $('#consent').checked = false;
  $('#publish-btn').disabled = true;
  $('#unpublish').hidden = b.status !== 'published';
  $('#read-link').hidden = b.status !== 'published';
  $('#read-link').href = `/library.html?book=${encodeURIComponent(b.id)}`;
}
$('#consent').addEventListener('change', (e) => { $('#publish-btn').disabled = !e.target.checked; });
$('#publish-btn').addEventListener('click', async () => {
  try {
    current = await api(`/library/books/${current.id}/publish`, { method: 'POST', body: { consent: true } });
    nezumi('棚に並べました。しーっ……みんな、静かに読んでくれますよ。');
    await loadMine();
  } catch (err) { toast(`🐭 ${err.message}`, 5000); }
});
$('#unpublish').addEventListener('click', async () => {
  current = await api(`/library/books/${current.id}/unpublish`, { method: 'POST' });
  await loadMine();
});
$('#delete-book').addEventListener('click', async () => {
  if (!confirm(`「${current.title}」を消しますか？ 消した本は、もとにもどせません。`)) return;
  await api(`/library/books/${current.id}`, { method: 'DELETE' });
  current = null;
  $('#editor').hidden = true;
  toast('🐭 本を消しました');
  await loadMine();
});

// ---- 運営 ----
async function loadAdmin() {
  const a = await api('/library/admin');
  $('#admin').hidden = false;
  $('#admin-help').innerHTML = a.help.map((b) => `<li class="card panel" data-book="${escapeHtml(b.id)}" data-kind="${b.kind}">
    <strong>${escapeHtml(b.title)}</strong> <span class="muted small">${escapeHtml(b.author)}・${b.kind === 'novel' ? '小説' : `漫画 ${b.pages.length}ページ`}</span>
    <p class="small">頼まれたこと：「${escapeHtml(b.tidy.help.note)}」${b.tidy.help.reply ? '<br>（返事ずみ。作り直すと上書きします）' : ''}</p>
    ${b.kind === 'novel'
    ? `<label class="field small">本文の案（作者が「使う」と決めたら入ります）<textarea class="input" rows="6" data-f="text">${escapeHtml(b.tidy.help.reply?.text ?? b.text)}</textarea></label>`
    : `<label class="field small">ページの順番の案（0から。例：2,0,1）<input class="input" data-f="order" value="${b.pages.map((_, i) => i).join(',')}"></label>
       <div class="lib-pages small-pages">${b.pages.map((p) => thumb(p, `${p.n + 1}`)).join('')}</div>`}
    <label class="field small">ひとこと<input class="input" data-f="note" maxlength="200"></label>
    <button class="btn" type="button" data-reply>案を送る</button></li>`).join('') || '<li class="muted small">いまはありません</li>';
  $('#admin-books').innerHTML = a.books.map((b) => `<li class="row wrap"><a href="/library.html?book=${encodeURIComponent(b.id)}">${escapeHtml(b.title)}</a>
    <span class="muted small">${escapeHtml(b.author)}</span>
    <input class="input small-input" data-reason="${escapeHtml(b.id)}" placeholder="取り下げる理由（作者に見せます）" maxlength="100">
    <button class="btn ghost small danger" type="button" data-hide="${escapeHtml(b.id)}">取り下げる</button></li>`).join('') || '<li class="muted small">いまはありません</li>';
  $('#admin-hidden').innerHTML = a.hidden.map((b) => `<li class="row wrap"><strong>${escapeHtml(b.title)}</strong>
    <span class="muted small">${escapeHtml(b.author)}・理由：${escapeHtml(b.hiddenReason)}</span>
    <button class="btn ghost small" type="button" data-restore="${escapeHtml(b.id)}">もどす（作者の下書きに）</button></li>`).join('') || '<li class="muted small">いまはありません</li>';
}
$('#admin').addEventListener('click', async (e) => {
  try {
    const reply = e.target.closest('[data-reply]');
    const hide = e.target.closest('[data-hide]');
    const restore = e.target.closest('[data-restore]');
    if (reply) {
      const li = reply.closest('[data-book]');
      const body = { note: li.querySelector('[data-f="note"]').value };
      if (li.dataset.kind === 'novel') body.text = li.querySelector('[data-f="text"]').value;
      else body.order = li.querySelector('[data-f="order"]').value.split(/[,、\s]+/).filter(Boolean).map(Number);
      await api(`/library/books/${li.dataset.book}/help-reply`, { method: 'POST', body });
      toast('🦉 案を送りました');
    } else if (hide) {
      const reason = document.querySelector(`[data-reason="${hide.dataset.hide}"]`).value;
      await api(`/library/books/${hide.dataset.hide}/hide`, { method: 'POST', body: { reason } });
      toast('🦉 取り下げました');
    } else if (restore) {
      await api(`/library/books/${restore.dataset.restore}/restore`, { method: 'POST' });
    } else return;
    await loadAdmin();
  } catch (err) { toast(`🦉 ${err.message}`, 5000); }
});

// ---- はじめ ----
me = await refreshMe();
if (!me) {
  $('#need-login').hidden = false;
} else {
  $('#desk').hidden = false;
  fillSelects();
  try { await loadMine(); } catch (err) { toast(`🐭 ${err.message}`); }
  if (me.role === 'admin') loadAdmin().catch(() => {});
}
