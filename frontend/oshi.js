// わたしの推しページ（推しダッシュボード）：推しの名前・ライブまで・誕生日まで・グッズの記録・同じ推しの仲間
import { api, refreshMe, escapeHtml, timeAgo, headerHtml, toast } from '/shared/api.js';

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
    ? oshi.goods.map((g) => `<li><span>${escapeHtml(g.name)}</span>
        <span class="muted small">${timeAgo(g.addedAt)}</span>
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


$('#edit-btn').addEventListener('click', () => {
  for (const key of ['name', 'liveDate', 'liveVenue', 'birthday']) form.elements[key].value = oshi?.[key] ?? '';
  $('#edit-error').textContent = '';
  dialog.showModal();
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
});
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(['name', 'liveDate', 'liveVenue', 'birthday'].map((k) => [k, form.elements[k].value.trim()]));
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
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  try {
    oshi = await api(`/users/${me.id}/oshi/goods/${btn.dataset.remove}`, { method: 'DELETE' });
    renderOshi();
  } catch (err) {
    toast(err.message);
  }
});

render();
load();
