// 手紙の受け取りページ：QR コードの URL（/open/#<token>）から開く。ともはねの登録はいらない
// ・token は URL の「#」のうしろに入れる。# のうしろはサーバーの記録や、ほかのサイトへの Referer に残らない
// ・封筒をタップしたら「とどいた」とサーバーに知らせる（送った人だけに届く）
// ・送った人が「ためしに開く」ときは ?preview を付けるので、とどいた記録はしない
import { DEFAULT_TYPEFACE, fontStack } from '/shared/typefaces.js';

const $ = (sel) => document.querySelector(sel);
const token = decodeURIComponent(location.hash.slice(1));
const preview = new URLSearchParams(location.search).has('preview');

function showError(message) {
  $('#loading').hidden = true;
  $('#envelope-view').hidden = true;
  $('#error-view').hidden = false;
  if (message) $('#error-text').textContent = message;
}

async function load() {
  if (!/^[\w-]{16,64}$/.test(token)) return showError();
  let letter;
  try {
    const res = await fetch(`/api/open/${encodeURIComponent(token)}`);
    if (res.status === 404) return showError('送った人が手紙を消したか、QR コードがちがうのかもしれません。');
    if (!res.ok) throw new Error();
    letter = await res.json();
  } catch {
    return showError('いまはつながりません。少したってから、もう一度ひらいてね。');
  }

  // 送った人が選んだ字体にする（てがき風は線が細いので、open.css で文字を少し大きくする）
  if (letter.typeface && letter.typeface !== DEFAULT_TYPEFACE) {
    document.documentElement.style.setProperty('--typeface', fontStack(letter.typeface));
    document.documentElement.dataset.typeface = letter.typeface;
  }
  document.title = `${letter.to}へのお手紙`;
  $('#to-line').textContent = `${letter.to}へ`;
  $('#to-small').textContent = `${letter.to}へ`;
  $('#from-line').textContent = `${letter.from}より`;
  if (letter.note) {
    $('#note').textContent = letter.note;
    $('#note').hidden = false;
  }
  const video = $('#video');
  if (letter.hasVideo) {
    video.src = `/api/open/${encodeURIComponent(token)}/video`;
  } else {
    video.hidden = true;
    $('#no-video').hidden = false;
  }
  $('#loading').hidden = true;
  $('#envelope-view').hidden = false;
}

$('#open-btn').addEventListener('click', () => {
  const env = $('#open-btn');
  if (env.classList.contains('opening')) return;
  env.classList.add('opening');
  // タップと同じタイミングで再生を始める（スマホは、さわったときでないと音つきで再生できない）。
  // 封筒がひらいている間に声が聞こえはじめ、ひらき終わると顔が見える
  const video = $('#video');
  if (!video.hidden) video.play().catch(() => { /* 自動で始まらなければ、再生ボタンで見られる */ });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    $('#envelope-view').hidden = true;
    $('#letter-view').hidden = false;
  }, reduce ? 0 : 1200);
  if (!preview) fetch(`/api/open/${encodeURIComponent(token)}/opened`, { method: 'POST' }).catch(() => {});
});

load();
