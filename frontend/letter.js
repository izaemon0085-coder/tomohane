// 手紙キット：宛名 → 便箋 → ビデオ → QR コード。できた便箋と QR は画像で保存して、セブンイレブンのアプリで印刷する
// ・ともはねのほかのユーザーには送らない。届け方は紙の手紙＋QR だけ
// ・手紙の合言葉（key）はこの端末の localStorage にだけ置く。合言葉がないと、一覧・削除はできない
import { api, getMe, login, escapeHtml, timeAgo, headerHtml, toast, onServerEvents } from '/shared/api.js';
import { qrMatrix, qrSvg, drawQr } from '/shared/qrcode.js';

const $ = (sel) => document.querySelector(sel);
const form = $('#letter-form');
const STORE_KEY = 'tomohane:letters';
const MAX_SECONDS = 180;
const MAX_BYTES = 200 * 1024 * 1024;
const TYPE_BY_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
const FONT = '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';

let me = getMe();
let video = null; // { file, type }
let previewUrl = null;
let current = null; // いま「できあがり」に出している手紙 { letter, key, url }
const openedSeen = new Map(); // 手紙の id → 前に見たときの openedAt（「とどいた」を知らせるため）

// ---- キャラのひとこと（画面の案内と、遊び場の吹き出しの両方に出す） ----
const CHARS = {
  usagi: { id: 'agent-usagi', name: 'ウサギ', face: 'usagi.svg' },
  yamaneko: { id: 'agent-yamaneko', name: 'ヤマネコ', face: 'yamaneko.svg' },
  fukurou: { id: 'agent-fukurou', name: 'フクロウ', face: 'fukurou.svg' },
  shiba: { id: 'agent-shiba', name: 'シバ', face: 'shiba.svg' },
};
function guide(who, text) {
  const c = CHARS[who];
  $('#guide-face').src = `/shared/avatars/${c.face}`;
  $('#guide-name').textContent = `${c.name}から`;
  $('#guide-text').textContent = text;
  window.dispatchEvent(new CustomEvent('agent-say', { detail: { agentId: c.id, text } }));
}

// ---- この端末に置く、手紙の合言葉 ----
function savedLetters() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function writeSaved(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    toast('この端末に手紙の記録を保存できませんでした');
  }
}
const mySaved = () => savedLetters().filter((s) => s.userId === me?.id);
const forget = (id) => writeSaved(savedLetters().filter((s) => s.id !== id));
const keyHeader = (key) => ({ 'X-Letter-Key': key });

function render() {
  $('#header').innerHTML = headerHtml('letter');
  $('#login-form').hidden = Boolean(me);
  $('#letter-app').hidden = !me;
  if (me && !form.elements.from.value) form.elements.from.value = me.name;
}

// ---- 1. 宛名など：電話番号や住所らしきものがあればフクロウが注意する ----
const PRIVATE_PATTERNS = [
  /0\d{1,4}[-ー－−\s]?\d{1,4}[-ー－−\s]?\d{3,4}/, // 電話番号
  /〒|\d{3}[-ー－−]\d{4}/, // 郵便番号
  /(都|道|府|県).{0,8}(市|区|町|村)/, // 住所
  /\S+@\S+\.\S+/, // メールアドレス
];
let warnedPrivacy = false;
form.addEventListener('input', (e) => {
  if (!['to', 'from', 'note'].includes(e.target.name)) return;
  const text = ['to', 'from', 'note'].map((k) => form.elements[k].value).join(' ');
  const risky = PRIVATE_PATTERNS.some((re) => re.test(text));
  const warn = $('#privacy-warn');
  warn.hidden = !risky;
  if (risky) {
    warn.textContent = '🦉 ほう、電話番号や住所のようなものが見えますぞ。QR コードを持つ人ならだれでも見られるので、書かないほうが安心ですぞ。';
    if (!warnedPrivacy) guide('fukurou', 'ほう、電話番号や住所は書かないほうが安心ですぞ。');
    warnedPrivacy = true;
  } else {
    warnedPrivacy = false;
  }
});

// ---- 3. ビデオ ----
function videoType(file) {
  if (Object.values(TYPE_BY_EXT).includes(file.type)) return file.type;
  if (file.type === 'video/x-m4v') return 'video/mp4';
  return TYPE_BY_EXT[file.name.split('.').pop().toLowerCase()] || null;
}
function clearVideo() {
  video = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  const preview = $('#video-preview');
  preview.removeAttribute('src');
  preview.load();
  preview.hidden = true;
}
const mbText = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
const timeText = (sec) => `${Math.floor(sec / 60)}分${String(Math.round(sec % 60)).padStart(2, '0')}秒`;

$('#video-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // 同じファイルをもう一度えらんでも反応するように
  $('#video-error').textContent = '';
  clearVideo();
  if (!file) return;
  const type = videoType(file);
  if (!type) {
    $('#video-error').textContent = 'ビデオは mp4・mov・webm のどれかにしてください';
    return;
  }
  if (file.size > MAX_BYTES) {
    $('#video-error').textContent = `ビデオが大きすぎます（${mbText(file.size)}）。200MB までにしてください`;
    guide('yamaneko', `そのビデオは${mbText(file.size)}。200MB までにおさめてくれ。短く撮りなおすのが早い。`);
    return;
  }
  const preview = $('#video-preview');
  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;
  preview.hidden = false;
  preview.onloadedmetadata = () => {
    if (preview.duration > MAX_SECONDS + 1) {
      $('#video-error').textContent = `ビデオが長すぎます（${timeText(preview.duration)}）。3分までにしてください`;
      guide('yamaneko', '3分をこえている。いちばん伝えたいところだけにしぼろう。');
      clearVideo();
      return;
    }
    video = { file, type };
    guide('yamaneko', `ビデオは${timeText(preview.duration)}・${mbText(file.size)}。ちょうどいい。`);
  };
  preview.onerror = () => {
    // このブラウザで再生できない形式でも、受け取る人のスマホでは見られることがある（iPhone の mov など）
    video = { file, type };
    $('#video-error').textContent = 'このブラウザでは再生できない形式ですが、そのまま使えます。「ためしにひらく」をスマホで確かめてね';
    preview.hidden = true;
  };
});

// ---- 4. QR コードをつくる ----
function uploadVideo(letter, key, { file, type }, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/letters/${letter.id}/video`);
    xhr.setRequestHeader('Content-Type', type);
    xhr.setRequestHeader('X-Letter-Key', key);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* noop */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `エラー (${xhr.status})`));
    };
    xhr.onerror = () => reject(Object.assign(new Error('つながっていません（オフライン）'), { offline: true }));
    xhr.send(file);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#make-error').textContent = '';
  const to = form.elements.to.value.trim();
  const from = form.elements.from.value.trim();
  const note = form.elements.note.value.trim();
  if (!to || !from) {
    $('#make-error').textContent = '宛名と差出人を入れてね';
    (to ? form.elements.from : form.elements.to).focus();
    return;
  }
  if (!video) {
    $('#make-error').textContent = 'ビデオをえらんでね';
    return;
  }

  const btn = $('#make-btn');
  const progress = $('#upload-progress');
  const status = $('#upload-status');
  btn.disabled = true;
  status.textContent = 'お手紙をつくっています…';
  let letter;
  try {
    letter = await api('/letters', { method: 'POST', body: { authorId: me.id, to, from, note } });
    writeSaved([...savedLetters(), { id: letter.id, key: letter.key, userId: me.id }]);
    progress.hidden = false;
    progress.value = 0;
    await uploadVideo(letter, letter.key, video, (p) => {
      progress.value = p;
      status.textContent = `ビデオを送っています… ${Math.round(p * 100)}%`;
    });
  } catch (err) {
    // ビデオが入らなかった手紙は残さない
    if (letter) {
      api(`/letters/${letter.id}`, { method: 'DELETE', headers: keyHeader(letter.key) }).catch(() => {});
      forget(letter.id);
    }
    $('#make-error').textContent = err.offline ? 'つながっていません。つながってから、もう一度どうぞ' : err.message;
    status.textContent = '';
    progress.hidden = true;
    btn.disabled = false;
    return;
  }

  btn.disabled = false;
  progress.hidden = true;
  status.textContent = '';
  form.reset();
  form.elements.from.value = me.name;
  clearVideo();
  await showResult({ ...letter, hasVideo: true }, letter.key);
  guide('shiba', `できたっす！ ${to}、きっと喜ぶっす！`);
  loadMine();
});

// ---- できあがり：QR と画像の保存 ----
// QR に入れるアドレス。このパソコン（localhost）で開いているときは、スマホからも届く
// 同じ Wi-Fi のアドレスにする
let shareBaseCache = null;
async function shareBase() {
  if (shareBaseCache) return shareBaseCache;
  const host = location.hostname;
  const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    try {
      const net = await api('/network');
      if (net.lanUrls?.[0]) {
        shareBaseCache = { origin: net.lanUrls[0].replace(/\/$/, ''), reach: 'lan' };
        return shareBaseCache;
      }
    } catch { /* noop */ }
    return { origin: location.origin, reach: 'this-pc' };
  }
  shareBaseCache = { origin: location.origin, reach: isPrivate ? 'lan' : 'internet' };
  return shareBaseCache;
}
const REACH_NOTE = {
  lan: '🐾 モグより：いまの QR は、同じ Wi-Fi の中のスマホだけで開けるモグ。遠くの家族に届けるのは、インターネット版（AWS）ができてからモグ。',
  'this-pc': '🐾 モグより：Wi-Fi が見つからないから、この QR はこのパソコンでしか開けないモグ。',
  internet: '',
};

async function showResult(letter, key) {
  const base = await shareBase();
  const url = `${base.origin}/open/#${letter.token}`;
  current = { letter, key, url };
  $('#result-to').textContent = letter.to;
  $('#qr-box').innerHTML = qrSvg(qrMatrix(url), { label: `${escapeHtml(letter.to)}へのビデオレターの QR コード` });
  $('#preview-link').href = `/open/?preview#${letter.token}`;
  $('#line-note').textContent = REACH_NOTE[base.reach];
  $('#line-note').hidden = !REACH_NOTE[base.reach];
  const result = $('#result');
  result.hidden = false;
  result.focus();
  result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function accentColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c8642a';
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
async function download(canvas, name) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// 便箋（A4 を 150dpi で）：ふちは推しカラー、手書き用の罫線、いちばん下に QR コード
function paperCanvas({ letter, url }) {
  const W = 1240;
  const H = 1754;
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  const accent = accentColor();
  ctx.fillStyle = '#fffaf3';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  roundRect(ctx, 40, 40, W - 80, H - 80, 28);
  ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 2;
  roundRect(ctx, 62, 62, W - 124, H - 124, 20);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#3d2e22';
  ctx.font = `bold 60px ${FONT}`;
  ctx.fillText(`${letter.to}へ`, 120, 200);

  ctx.strokeStyle = '#e6d3bd';
  ctx.lineWidth = 2;
  for (let y = 320; y <= 1220; y += 84) {
    ctx.beginPath();
    ctx.moveTo(120, y);
    ctx.lineTo(W - 120, y);
    ctx.stroke();
  }

  ctx.font = `bold 48px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${letter.from}より`, W - 120, 1300);
  ctx.textAlign = 'left';

  const qrSize = 300;
  const qx = W - 120 - qrSize;
  const qy = H - 110 - qrSize;
  drawQr(ctx, qrMatrix(url), qx, qy, qrSize);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 10]);
  ctx.strokeRect(qx - 14, qy - 14, qrSize + 28, qrSize + 28); // シールを貼る目安
  ctx.setLineDash([]);

  ctx.fillStyle = '#6f5e50';
  ctx.font = `bold 38px ${FONT}`;
  ctx.fillText('♡ さいごまで読んだら', 120, qy + 110);
  ctx.fillText('　シールをめくってね', 120, qy + 165);
  ctx.font = `30px ${FONT}`;
  ctx.fillText('ビデオレターが見られます', 120, qy + 235);
  ctx.font = `22px ${FONT}`;
  ctx.fillText('ともはね 手紙キット', 120, H - 90);
  return canvas;
}

// QR だけ（便箋は自分で用意する人や、シールに印刷する人向け）
function qrCanvas({ letter, url }) {
  const W = 800;
  const H = 960;
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  drawQr(ctx, qrMatrix(url), 50, 40, 700);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#3d2e22';
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillText('めくると ビデオレター', W / 2, 820);
  ctx.fillStyle = '#6f5e50';
  ctx.font = `30px ${FONT}`;
  ctx.fillText(`${letter.to}へ`, W / 2, 885);
  return canvas;
}

$('#save-paper').addEventListener('click', () => {
  if (current) download(paperCanvas(current), `便箋_${current.letter.to}へ.png`);
});
$('#save-qr').addEventListener('click', () => {
  if (current) download(qrCanvas(current), `QR_${current.letter.to}へ.png`);
});
$('#copy-link').addEventListener('click', async () => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(current.url);
    toast('リンクをコピーしました。人に見せないでね');
  } catch {
    prompt('このリンクをコピーしてください', current.url);
  }
});

// ---- つくった手紙の一覧 ----
const dateText = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

let mineCache = [];
async function loadMine() {
  if (!me) return;
  const list = $('#my-letters');
  const saved = mySaved();
  const results = await Promise.all(saved.map(async (s) => {
    try {
      return { s, letter: await api(`/letters/${s.id}`, { headers: keyHeader(s.key) }) };
    } catch (err) {
      return { s, err };
    }
  }));
  // サーバーにもうない手紙（消した・データを初期化した）は、この端末の記録からも消す
  for (const r of results) if (r.err?.status === 404 || r.err?.status === 403) forget(r.s.id);
  mineCache = results.filter((r) => r.letter).sort((a, b) => b.letter.createdAt.localeCompare(a.letter.createdAt));

  // とどいたら、シバが知らせる（この画面を開いている間に、ひらかれたとき）
  for (const { letter } of mineCache) {
    if (openedSeen.has(letter.id) && !openedSeen.get(letter.id) && letter.openedAt) {
      toast(`💌 ${letter.to}に、とどきました！`);
      guide('shiba', `${letter.to}に、とどいたっす！ 今ごろ見てくれてるっす！`);
    }
    openedSeen.set(letter.id, letter.openedAt);
  }

  if (!mineCache.length) {
    list.innerHTML = results.some((r) => r.err?.offline)
      ? '<li class="muted small">いまは読み込めません</li>'
      : '<li class="muted small">まだありません。上からつくってみよう！</li>';
    return;
  }
  list.innerHTML = mineCache.map(({ letter }) => {
    const status = letter.openedAt
      ? `<span class="letter-status opened">💌 ${dateText(letter.openedAt)} にとどきました</span>`
      : letter.hasVideo
        ? '<span class="letter-status">📮 まだひらかれていません</span>'
        : '<span class="letter-status">🎬 ビデオがありません</span>';
    return `<li class="letter-item">
      <div class="letter-info"><strong>${escapeHtml(letter.to)}へ</strong>
        <span class="muted small">${timeAgo(letter.createdAt)}</span><br>${status}</div>
      <div class="row">
        <button type="button" class="btn ghost" data-show="${letter.id}">QR を見る</button>
        <button type="button" class="link-btn" data-delete="${letter.id}" aria-label="${escapeHtml(letter.to)}への手紙を消す">消す</button>
      </div>
    </li>`;
  }).join('');
}

$('#my-letters').addEventListener('click', async (e) => {
  const show = e.target.closest('[data-show]');
  const del = e.target.closest('[data-delete]');
  const id = show?.dataset.show || del?.dataset.delete;
  const entry = mineCache.find((r) => r.letter.id === id);
  if (!entry) return;
  if (show) {
    showResult(entry.letter, entry.s.key);
    return;
  }
  if (!confirm(`${entry.letter.to}への手紙を消しますか？\nQR コードを読んでも、もう見られなくなります。`)) return;
  try {
    await api(`/letters/${id}`, { method: 'DELETE', headers: keyHeader(entry.s.key) });
    forget(id);
    if (current?.letter.id === id) {
      current = null;
      $('#result').hidden = true;
    }
    toast('手紙を消しました');
    loadMine();
  } catch (err) {
    toast(err.offline ? 'オフラインなので消せません' : err.message);
  }
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    me = await login($('#login-name').value);
    render();
    loadMine();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

render();
loadMine();
onServerEvents({ letter: loadMine });
