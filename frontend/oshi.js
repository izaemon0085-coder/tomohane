// わたしの推しページ（推しダッシュボード）：推しの名前・ライブまで・誕生日まで・グッズの記録・同じ推しの仲間
import { api, refreshMe, escapeHtml, timeAgo, headerHtml, toast } from '/shared/api.js';
import { GENRE_TABLES } from '/shared/cafe.js';
import { ILLUST_STYLES, ILLUST_MAX_SIDE, GOODS_IMAGE_MAX_BYTES, illustrate, pixelate } from '/shared/illust.js';

const $ = (sel) => document.querySelector(sel);
const dialog = $('#edit-dialog');
const form = $('#edit-form');

let me = await refreshMe();
let oshi = null;

function render() {
  $('#header').innerHTML = headerHtml('oshi');
  $('#login-form').hidden = Boolean(me);
  $('#dash').hidden = !me;
}

// 今日から、その日まであと何日か（今日なら 0）
function daysUntil(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / 86400000);
}
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// 誕生日は年を気にせず、次に来る日を数える
function nextBirthday(s) {
  const b = parseDate(s);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, b.getMonth(), b.getDate());
  return next;
}

function shibaSays(liveLeft, bdayLeft) {
  if (!oshi.name) return '推しのこと、教えてほしいっす！ 上の「登録・へんしゅう」からっす！';
  if (bdayLeft === 0) return `${oshi.name}さん、お誕生日おめでとうございますっす！ 🎂 みんなでお祝いするっす！`;
  if (liveLeft === 0) return 'きょうはライブっすね！ 楽しんできてほしいっす！ 帰り道は気をつけてっす！';
  if (liveLeft !== null && liveLeft > 0 && liveLeft <= 7) return `ライブまであと${liveLeft}日っす！ わくわくが止まらないっす！`;
  if (bdayLeft !== null && bdayLeft <= 7) return `${oshi.name}さんの誕生日まであと${bdayLeft}日っす！ お祝いの準備するっす！`;
  if (oshi.goods.length) return `グッズ${oshi.goods.length}個、ちゃんと記録してえらいっす！`;
  return `${oshi.name}さんの話、広場でもっと聞かせてほしいっす！`;
}

function renderOshi() {
  $('#oshi-name').textContent = oshi.name || 'まだ登録していません';

  let liveLeft = null;
  if (oshi.liveDate) {
    liveLeft = daysUntil(parseDate(oshi.liveDate));
    $('#live-days').textContent = liveLeft > 0 ? `あと${liveLeft}日` : liveLeft === 0 ? 'きょう！' : '終わりました';
    $('#live-venue').textContent = `${oshi.liveDate.replaceAll('-', '/')}${oshi.liveVenue ? `・${oshi.liveVenue}` : ''}`;
  } else {
    $('#live-days').textContent = '－';
    $('#live-venue').textContent = 'ライブの日を登録すると、あと何日か出ます';
  }

  let bdayLeft = null;
  if (oshi.birthday) {
    const next = nextBirthday(oshi.birthday);
    bdayLeft = daysUntil(next);
    $('#bday-days').textContent = bdayLeft === 0 ? 'きょう！🎂' : `あと${bdayLeft}日`;
    $('#bday-date').textContent = `${next.getMonth() + 1}月${next.getDate()}日`;
  } else {
    $('#bday-days').textContent = '－';
    $('#bday-date').textContent = '誕生日を登録すると、あと何日か出ます';
  }

  $('#goods-count').textContent = `${oshi.goods.length}個`;
  $('#goods-list').innerHTML = oshi.goods.length
    ? oshi.goods.map((g) => `<li>${g.image ? `<img class="goods-thumb" src="${escapeHtml(g.image.url)}" alt="${escapeHtml(g.name)}の絵" width="48" height="48">` : ''}<span>${escapeHtml(g.name)}</span>
        <span class="muted small">${timeAgo(g.addedAt)}${g.image ? `・${IMAGE_STATUS[g.image.status] ?? ''}` : ''}</span>
        ${canDraw() ? `<button type="button" class="link-btn" data-illust="${g.id}">${g.image ? '絵をかえる' : '🖼️ 絵をつける'}</button>` : ''}
        ${g.image ? `<button type="button" class="link-btn" data-unimage="${g.id}" aria-label="${escapeHtml(g.name)}の絵を消す">絵を消す</button>` : ''}
        <button type="button" class="link-btn" data-remove="${g.id}" aria-label="${escapeHtml(g.name)}を記録から消す">消す</button></li>`).join('')
    : '<li class="muted small">まだ記録がありません</li>';

  $('#shiba-says').textContent = shibaSays(liveLeft, bdayLeft);
}

async function loadFriends() {
  const list = $('#friends');
  if (!oshi.name) {
    list.innerHTML = '<li class="muted small">推しを登録すると、同じ推しの人の投稿が出ます</li>';
    return;
  }
  try {
    const posts = await api(`/users/${me.id}/oshi/friends`);
    list.innerHTML = posts.length
      ? posts.map((p) => `<li><strong>${escapeHtml(p.author.name)}</strong> ${escapeHtml(p.text)} <span class="muted small">${timeAgo(p.createdAt)}</span></li>`).join('')
      : `<li class="muted small">まだ「${escapeHtml(oshi.name)}」推しの仲間の投稿はありません。広場で呼びかけてみよう！</li>`;
  } catch {
    list.innerHTML = '<li class="muted small">いまは読み込めません</li>';
  }
}

// こことも のリンク：このパソコン（localhost）のアドレスのとき、スマホから開いても届くように、
// いま ともはね を開いているアドレスに合わせる（同じパソコンで両方を動かしている前提）
function reachableUrl(url) {
  try {
    const u = new URL(url);
    if (['localhost', '127.0.0.1'].includes(u.hostname) && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      u.hostname = location.hostname;
    }
    return u.href;
  } catch {
    return null;
  }
}

// 次のライブ会場のバリアフリーメモ（こことも から読むだけ。送るのは会場の名前だけ）
async function loadAccess() {
  const tile = $('#access-tile');
  if (!oshi.liveVenue) {
    tile.hidden = true;
    return;
  }
  let memo;
  try {
    memo = await api(`/kokotomo/venue?name=${encodeURIComponent(oshi.liveVenue)}`);
  } catch {
    tile.hidden = true;
    return;
  }
  tile.hidden = false;
  const link = $('#access-link');
  link.href = reachableUrl(memo.url) || '#';
  const list = $('#access-list');
  const say = $('#access-say');
  say.hidden = true;
  if (!memo.linked) {
    $('#access-venue').textContent = `${oshi.liveVenue}：こことも につながっていません`;
    list.innerHTML = '';
    link.textContent = 'こことも で調べる';
    return;
  }
  if (!memo.found) {
    $('#access-venue').textContent = `${oshi.liveVenue}：まだメモがありません`;
    list.innerHTML = '<li class="muted small">行ったら、エレベーターやトイレの場所を書き足してみよう。次に行く人の助けになるよ</li>';
    link.textContent = 'こことも で書く';
    return;
  }
  $('#access-venue').textContent = memo.venue.name;
  list.innerHTML = memo.summary.map((s) => `<li><strong>${escapeHtml(s.label)}</strong>
      <span>${escapeHtml(s.text)}</span>
      <span class="muted small">${s.createdAt ? new Date(s.createdAt).toLocaleDateString('ja-JP') : ''}</span></li>`).join('');
  link.textContent = 'こことも で見る・書き足す';
  const first = memo.summary[0];
  if (first) {
    $('#access-say-text').textContent = `${first.label}は「${first.text}」だそうだ。行く前に、会場にも確かめておこう。`;
    say.hidden = false;
  }
}

async function load() {
  if (!me) return;
  try {
    oshi = await api(`/users/${me.id}/oshi`);
  } catch (err) {
    toast(err.message);
    return;
  }
  renderOshi();
  loadFriends();
  loadAccess();
}


$('#genre-select').insertAdjacentHTML('beforeend', GENRE_TABLES.map((g) => `<option value="${g.id}">${g.emoji} ${g.name}</option>`).join(''));
$('#edit-btn').addEventListener('click', () => {
  for (const key of ['name', 'genre', 'liveDate', 'liveVenue', 'birthday']) form.elements[key].value = oshi?.[key] ?? '';
  $('#edit-error').textContent = '';
  dialog.showModal();
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(['name', 'genre', 'liveDate', 'liveVenue', 'birthday'].map((k) => [k, form.elements[k].value.trim()]));
  try {
    const goods = oshi.goods;
    oshi = { ...(await api(`/users/${me.id}/oshi`, { method: 'PUT', body })), goods };
    dialog.close();
    renderOshi();
    loadFriends();
    loadAccess();
  } catch (err) {
    $('#edit-error').textContent = err.offline ? 'オフラインなので保存できません。つながってからもう一度どうぞ' : err.message;
  }
});

$('#goods-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#goods-name');
  try {
    oshi = await api(`/users/${me.id}/oshi/goods`, { method: 'POST', body: { name: input.value } });
    input.value = '';
    renderOshi();
  } catch (err) {
    toast(err.offline ? '📴 オフラインなので、つながってから記録してね' : err.message);
  }
});
$('#goods-list').addEventListener('click', async (e) => {
  const il = e.target.closest('[data-illust]');
  if (il) return openIllust(oshi.goods.find((g) => g.id === il.dataset.illust));
  const un = e.target.closest('[data-unimage]');
  if (un) {
    if (!confirm('この絵を消しますか？')) return;
    try {
      await api(`/users/${me.id}/oshi/goods/${un.dataset.unimage}/image`, { method: 'DELETE' });
      oshi = await api(`/users/${me.id}/oshi`);
      renderOshi();
    } catch (err) { toast(err.message); }
    return;
  }
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  try {
    oshi = await api(`/users/${me.id}/oshi/goods/${btn.dataset.remove}`, { method: 'DELETE' });
    renderOshi();
  } catch (err) {
    toast(err.message);
  }
});

// ---- 🖼️ グッズの絵：写真をこの中でイラストにする（元の写真は送らない） ----
const IMAGE_STATUS = { pending: '🦉 運営が見ています', ok: '✅ プロフィールに出ています', rejected: '🙅 今回は出せませんでした' };
function canDraw() { return Boolean(me && me.ageGroup !== 'child'); }
const ill = { goods: null, base: null, style: ILLUST_STYLES[0].id, out: null, taps: [] };
const illDialog = $('#illust-dialog');
const canvas = $('#illust-canvas');
$('#illust-styles').innerHTML = ILLUST_STYLES.map((s, i) => `<label class="row"><input type="radio" name="style" value="${s.id}"${i === 0 ? ' checked' : ''}> ${escapeHtml(s.label)}</label>`).join('');
function openIllust(g) {
  if (!g) return;
  Object.assign(ill, { goods: g, base: null, out: null, taps: [] });
  $('#illust-for').textContent = `「${g.name}」の写真をえらぶと、絵柄をえらんでイラストにできます。`;
  $('#illust-photo').value = '';
  $('#illust-error').textContent = '';
  $('#illust-send').disabled = true;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  illDialog.showModal();
}
// 写真を読む → 小さくする → 色のデータ（ImageData）。場所などの情報は、色のデータには入らない
async function readPhoto(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, ILLUST_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return ctx.getImageData(0, 0, w, h);
}
function drawIllust() {
  if (!ill.base) return;
  const out = illustrate({ width: ill.base.width, height: ill.base.height, data: new Uint8ClampedArray(ill.base.data) }, ill.style);
  const r = Math.round(Math.max(out.width, out.height) * 0.08);
  for (const t of ill.taps) pixelate(out, t.x, t.y, r, Math.max(8, Math.round(r / 2.5)));
  ill.out = out;
  canvas.width = out.width;
  canvas.height = out.height;
  canvas.getContext('2d').putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  $('#illust-send').disabled = false;
}
$('#illust-photo').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  $('#illust-error').textContent = '';
  try {
    ill.base = await readPhoto(file);
    ill.taps = [];
    drawIllust();
  } catch {
    $('#illust-error').textContent = 'この写真は読めませんでした。べつの写真でためしてください';
  }
});
$('#illust-styles').addEventListener('change', (e) => {
  if (e.target.name !== 'style') return;
  ill.style = e.target.value;
  drawIllust();
});
// タップした所をモザイクに（見えている大きさから、絵の大きさに直す）
canvas.addEventListener('click', (e) => {
  if (!ill.out) return;
  const rect = canvas.getBoundingClientRect();
  ill.taps.push({ x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) });
  drawIllust();
});
$('#illust-reset').addEventListener('click', () => { ill.taps = []; drawIllust(); });
illDialog.addEventListener('click', (e) => { if (e.target === illDialog || e.target.closest('[data-close]')) illDialog.close(); });
const toBlob = (quality) => new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', quality); });
$('#illust-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ill.out || !ill.goods) return;
  const btn = $('#illust-send');
  btn.disabled = true;
  try {
    let blob = await toBlob(0.85);
    if (blob && blob.size > GOODS_IMAGE_MAX_BYTES) blob = await toBlob(0.6);
    if (!blob || blob.size > GOODS_IMAGE_MAX_BYTES) throw new Error('絵が大きすぎました。べつの写真でためしてください');
    const res = await fetch(`/api/users/${me.id}/oshi/goods/${ill.goods.id}/image`, {
      method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'X-Style': ill.style }, body: blob, credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '送れませんでした');
    illDialog.close();
    oshi = await api(`/users/${me.id}/oshi`);
    renderOshi();
    toast('🦉 絵を送ったっす！ 運営が見てから、プロフィールに出るっす', 5000);
  } catch (err) {
    $('#illust-error').textContent = err.offline ? 'つながっていません' : err.message;
  } finally {
    btn.disabled = false;
  }
});

render();
load();
