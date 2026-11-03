// きせかえ：推しカラー・字体・背景のもよう・飾り・レイアウトを自分の好きに変えられる。
// 設定はこのブラウザに保存する（β版。あとでアカウントに保存して、どの端末でも同じにできる）。
import { api } from '/shared/api.js';
import { opinionsFor, closingLines } from '/shared/kisekae-opinions.js';
import { TYPEFACES, DEFAULT_TYPEFACE, fontStack } from '/shared/typefaces.js';

const KEY = 'agent-sns:design';

export const OSHI_COLORS = [
  { name: 'あか', hex: '#e5383b' },
  { name: 'ピンク', hex: '#ec5f9a' },
  { name: 'オレンジ', hex: '#c8642a' },
  { name: 'きいろ', hex: '#e6b800' },
  { name: 'みどり', hex: '#2f9e5b' },
  { name: 'みずいろ', hex: '#2fa8d8' },
  { name: 'あお', hex: '#3563d9' },
  { name: 'むらさき', hex: '#8a4fd8' },
  { name: 'しろ', hex: '#a7a9b8' },
  { name: 'くろ', hex: '#3a3a46' },
];
const PATTERNS = [
  { key: 'none', label: 'なし' },
  { key: 'dots', label: 'ドット' },
  { key: 'stripe', label: 'ストライプ' },
  { key: 'check', label: 'チェック' },
  { key: 'hearts', label: 'ハート' },
  { key: 'stars', label: '星' },
];
const MARKS = ['', '💖', '⭐', '🎀', '🌸', '👑', '🌙', '🐾', '🎤', '🍀'];
const DEFAULTS = {
  color: '', pattern: 'none', mark: '', oshiName: '', sparkle: false, sticker: false,
  side: 'auto', width: 'normal', card: 'round', font: 'm', typeface: DEFAULT_TYPEFACE,
};

// ★β版は「推しカラー」と「字体」だけ変えられる。もよう・飾り・レイアウトは作ってあるが、正式版まで隠しておく。
//   正式版で全部使えるようにするときは false にする。
export const BETA_COLOR_ONLY = true;

function readStored() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
// 色・もよう・推しマークは、決まった形のものだけ使う（保存した値も、画面で選んだ値も）
// ほかのスクリプトが書きかえても、パネルの HTML に入らないように
const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
function clean(d) {
  const out = { ...d };
  if ('color' in out) out.color = isColor(out.color) ? out.color : '';
  if ('pattern' in out) out.pattern = PATTERNS.some((p) => p.key === out.pattern) ? out.pattern : DEFAULTS.pattern;
  if ('mark' in out) out.mark = MARKS.includes(out.mark) ? out.mark : DEFAULTS.mark;
  return out;
}
function load() {
  const stored = clean({ color: '', pattern: DEFAULTS.pattern, mark: DEFAULTS.mark, ...readStored() });
  // β版では、前に保存した色と字体以外の設定は使わない（保存はそのまま残すので、正式版で復活する）
  const typeface = TYPEFACES.some((t) => t.key === stored.typeface) ? stored.typeface : DEFAULT_TYPEFACE;
  return BETA_COLOR_ONLY
    ? { ...DEFAULTS, color: stored.color || '', typeface }
    : { ...DEFAULTS, ...stored, typeface };
}
function save(d) {
  const data = BETA_COLOR_ONLY ? { ...readStored(), color: d.color, typeface: d.typeface } : d;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 保存できなくても見た目は変わる */ }
}

let design = load();
// いまのきせかえ（手紙キットが、推しカラーや字体をそのまま使うため）
export const getDesign = () => design;

// ---- 色の計算 ----
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// 明るすぎる色は、文字に使うときだけ暗くして読みやすくする
function darken(hex, amount) {
  return `#${hexToRgb(hex).map((v) => Math.round(v * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;
}

function svgPattern(shape, color) {
  const c = encodeURIComponent(color);
  const shapes = {
    hearts: `<path d='M14 24s-9-5.6-9-11.2A4.8 4.8 0 0 1 14 10a4.8 4.8 0 0 1 9 2.8C23 18.4 14 24 14 24z' fill='${c}' fill-opacity='.16'/>`,
    stars: `<path d='M14 5l2.6 5.6 6.1.7-4.5 4.2 1.2 6L14 18.6 8.6 21.5l1.2-6-4.5-4.2 6.1-.7z' fill='${c}' fill-opacity='.16'/>`,
  };
  return `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'>${shapes[shape]}</svg>")`;
}

function patternCss(pattern, color) {
  const tint = `color-mix(in srgb, ${color} 14%, transparent)`;
  switch (pattern) {
    case 'dots': return { image: `radial-gradient(${tint} 2px, transparent 2.5px)`, size: '18px 18px' };
    case 'stripe': return { image: `repeating-linear-gradient(45deg, ${tint} 0 10px, transparent 10px 22px)`, size: 'auto' };
    case 'check': return { image: `conic-gradient(${tint} 25%, transparent 0 50%, ${tint} 0 75%, transparent 0)`, size: '28px 28px' };
    case 'hearts':
    case 'stars': return { image: svgPattern(pattern, color), size: '28px 28px' };
    default: return { image: 'none', size: 'auto' };
  }
}

// ---- 画面に反映 ----
export function applyDesign(d = design) {
  const root = document.documentElement;
  if (d.color) {
    const light = luminance(d.color) > 0.45;
    root.dataset.oshiColor = '';
    root.style.setProperty('--oshi', d.color);
    root.style.setProperty('--accent', d.color);
    root.style.setProperty('--accent-text', light ? '#1c1612' : '#ffffff');
    root.style.setProperty('--accent-ink', light ? darken(d.color, 0.45) : d.color);
  } else {
    delete root.dataset.oshiColor;
    for (const v of ['--oshi', '--accent', '--accent-text', '--accent-ink']) root.style.removeProperty(v);
  }
  const color = d.color || getComputedStyle(root).getPropertyValue('--accent').trim() || '#c8642a';
  const p = patternCss(d.pattern, color);
  root.style.setProperty('--pattern-image', p.image);
  root.style.setProperty('--pattern-size', p.size);
  root.style.setProperty('--oshi-mark', d.mark ? `"${d.mark} "` : '""');
  root.dataset.side = d.side;
  root.dataset.width = d.width;
  root.dataset.card = d.card;
  root.dataset.font = d.font;
  if (d.typeface && d.typeface !== DEFAULT_TYPEFACE) root.style.setProperty('--typeface', fontStack(d.typeface));
  else root.style.removeProperty('--typeface');
  root.toggleAttribute('data-sparkle', d.sparkle);
  root.toggleAttribute('data-sticker', d.sticker && Boolean(d.mark));
  renderBanner(d);
}

// 推しの名前のバナー（ヘッダーの下）
function renderBanner(d) {
  let banner = document.querySelector('.oshi-banner');
  if (!d.oshiName) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'oshi-banner';
    const header = document.querySelector('.site-header');
    if (header) header.after(banner);
    else document.body.prepend(banner);
  }
  const mark = d.mark || '♡';
  banner.textContent = `${mark} わたしの推し：${d.oshiName} ${mark}`;
}

function update(patch) {
  design = { ...design, ...clean(patch) };
  save(design);
  applyDesign();
  syncPanel();
  const [change, value] = Object.entries(patch)[0];
  changedThisTime = true;
  if (change === 'oshiName') {
    clearTimeout(nameTimer); // 入力し終わってから意見する
    nameTimer = setTimeout(() => showOpinion(change, value), 700);
  } else {
    showOpinion(change, value);
  }
}

// ---- キャラたちの意見 ----
let agentsById = {};
let changedThisTime = false;
let nameTimer = null;

async function loadAgents() {
  try {
    const agents = await api('/agents');
    agentsById = Object.fromEntries(agents.map((a) => [a.id, a]));
  } catch { /* 取れなければ意見はお休み */ }
}

// 会議中（秘密基地にいる）や寝ているキャラは意見できないので、次の候補に回す
function firstAvailable(candidates) {
  return candidates.find((c) => agentsById[c.agentId]?.status === 'home') || null;
}

function showOpinion(change, value) {
  const colorName = OSHI_COLORS.find((c) => c.hex === value)?.name;
  showOpinionLine(firstAvailable(opinionsFor(change, value, { colorName })));
}

// 吹き出しを表示する。opinion が null なら「みんな留守」
function showOpinionLine(opinion) {
  const box = dialog.querySelector('.kk-opinion');
  if (!box) return;
  const agent = opinion && agentsById[opinion.agentId];
  if (!agent) {
    box.textContent = '（みんな出かけているみたい…）';
    return;
  }
  const img = document.createElement('img');
  img.src = agent.avatar;
  img.alt = '';
  const body = document.createElement('div');
  const who = document.createElement('strong');
  who.textContent = agent.name;
  const text = document.createElement('p');
  text.textContent = opinion.text; // 推しの名前など、ユーザーの入力が入るので textContent で表示
  body.append(who, text);
  box.replaceChildren(img, body);
  box.classList.remove('kk-pop');
  void box.offsetWidth; // アニメーションをやり直す
  box.classList.add('kk-pop');
}

// ---- きせかえパネル ----
const dialog = document.createElement('dialog');
dialog.className = 'card kisekae';
dialog.setAttribute('aria-labelledby', 'kisekae-title');

function radioGroup(name, label, options, current) {
  return `<fieldset class="kk-group"><legend>${label}</legend><div class="kk-options">
    ${options.map((o) => `<label class="kk-chip"><input type="radio" name="${name}" value="${o.key}"${o.key === current ? ' checked' : ''}><span>${o.label}</span></label>`).join('')}
  </div></fieldset>`;
}

function renderPanel() {
  const d = design;
  dialog.innerHTML = `
    <form method="dialog" class="kk-form">
      <div class="kk-head">
        <h2 id="kisekae-title">🎨 きせかえ</h2>
        <button class="btn ghost" value="close" aria-label="閉じる">✕</button>
      </div>
      <p class="muted kk-note">${BETA_COLOR_ONLY
        ? 'β版では「推しカラー」と「字体」を変えられます。もようや飾り、レイアウトの変更は正式版でお楽しみに。設定はこのブラウザに保存されます。'
        : '推しの色や飾りで、画面を自分好みにできます。設定はこのブラウザに保存されます。'}</p>
      <div class="kk-opinion" aria-live="polite"></div>

      <fieldset class="kk-group"><legend>推しカラー</legend>
        <div class="kk-swatches">
          <label class="kk-swatch kk-default" title="はじめの色"><input type="radio" name="color" value=""${d.color ? '' : ' checked'}><span>なし</span></label>
          ${OSHI_COLORS.map((c) => `<label class="kk-swatch" title="${c.name}" style="--sw:${c.hex}">
            <input type="radio" name="color" value="${c.hex}"${d.color === c.hex ? ' checked' : ''}><span class="sr-only">${c.name}</span></label>`).join('')}
          <label class="kk-custom" title="好きな色を選ぶ">🎨<input type="color" name="customColor" value="${d.color || '#ec5f9a'}" aria-label="好きな色を選ぶ"></label>
        </div>
      </fieldset>

      <fieldset class="kk-group"><legend>字体</legend>
        <div class="kk-options">
          ${TYPEFACES.map((t) => `<label class="kk-chip kk-typeface"><input type="radio" name="typeface" value="${t.key}"${t.key === d.typeface ? ' checked' : ''}><span style="font-family:${fontStack(t.key).replaceAll('"', "'")}">${t.label}</span></label>`).join('')}
        </div>
        <p class="muted kk-note">手紙キットの便箋にも使えます。</p>
      </fieldset>

      ${BETA_COLOR_ONLY ? '' : `${radioGroup('pattern', '背景のもよう', PATTERNS, d.pattern)}

      <fieldset class="kk-group"><legend>推しマーク</legend>
        <div class="kk-options">
          ${MARKS.map((m) => `<label class="kk-chip"><input type="radio" name="mark" value="${m}"${m === d.mark ? ' checked' : ''}><span>${m || 'なし'}</span></label>`).join('')}
        </div>
      </fieldset>

      <fieldset class="kk-group"><legend>飾り</legend>
        <label class="kk-field">推しの名前（ヘッダーの下に表示）
          <input class="input" name="oshiName" maxlength="20" placeholder="例：推しの名前" value="">
        </label>
        <label class="kk-check"><input type="checkbox" name="sparkle"${d.sparkle ? ' checked' : ''}> ヘッダーをキラキラにする</label>
        <label class="kk-check"><input type="checkbox" name="sticker"${d.sticker ? ' checked' : ''}> カードに推しマークのシールを貼る</label>
      </fieldset>

      ${radioGroup('side', 'サイドの欄の位置', [{ key: 'auto', label: 'おまかせ' }, { key: 'left', label: '左' }, { key: 'right', label: '右' }], d.side)}
      ${radioGroup('width', '画面の幅', [{ key: 'narrow', label: 'せまい' }, { key: 'normal', label: 'ふつう' }, { key: 'wide', label: 'ひろい' }], d.width)}
      ${radioGroup('card', 'カードの形', [{ key: 'round', label: 'まる' }, { key: 'soft', label: 'ふんわり' }, { key: 'square', label: 'しかく' }], d.card)}
      ${radioGroup('font', '文字の大きさ', [{ key: 's', label: '小' }, { key: 'm', label: '中' }, { key: 'l', label: '大' }], d.font)}`}

      <div class="kk-foot">
        <button type="button" class="btn ghost" data-reset>${BETA_COLOR_ONLY ? 'はじめの色と字体に戻す' : 'はじめの見た目に戻す'}</button>
        <button class="btn" value="close">できた！</button>
      </div>
    </form>`;
  const nameInput = dialog.querySelector('[name="oshiName"]');
  if (nameInput) nameInput.value = d.oshiName; // ユーザーの入力は value で入れる（HTML に埋め込まない）
}

function syncPanel() {
  if (!dialog.open) return;
  for (const input of dialog.querySelectorAll('input[type="radio"]')) {
    input.checked = String(design[input.name] ?? '') === input.value;
  }
}

dialog.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'customColor') return update({ color: t.value });
  if (t.type === 'checkbox') return update({ [t.name]: t.checked });
  if (t.type === 'radio') return update({ [t.name]: t.value });
});
dialog.addEventListener('input', (e) => {
  if (e.target.name === 'oshiName') update({ oshiName: e.target.value.trim().slice(0, 20) });
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
  if (e.target.closest('[data-reset]')) {
    design = { ...DEFAULTS };
    save(design);
    applyDesign();
    renderPanel();
    changedThisTime = true;
    showOpinion('reset');
  }
});

// 閉じたら、遊び場のキャラがまとめのひとこと（playground.js が 'agent-say' を受け取って吹き出しを出す）
dialog.addEventListener('close', () => {
  clearTimeout(nameTimer);
  if (!changedThisTime) return;
  const lines = closingLines(design).filter((l) => agentsById[l.agentId]?.status === 'home').slice(0, 2);
  lines.forEach((l, i) => setTimeout(() => {
    window.dispatchEvent(new CustomEvent('agent-say', { detail: l }));
  }, 400 + i * 1200));
});

export async function openCustomize() {
  renderPanel();
  if (!dialog.isConnected) document.body.append(dialog);
  dialog.showModal();
  changedThisTime = false;
  await loadAgents();
  const hello = firstAvailable([
    { agentId: 'agent-shiba', text: 'きせかえっすか！ わくわくするっす！ どれにするっすか？' },
    { agentId: 'agent-usagi', text: 'きせかえ〜！ いっしょに選ぼう ♪' },
    { agentId: 'agent-yamaneko', text: 'きせかえか。気になったところから変えてみるといい。' },
    { agentId: 'agent-fukurou', text: 'ほう、きせかえですか。ゆっくり選びなされ。' },
  ]);
  // 読み込み中にもう何か変えていたら、そっちの意見を残す
  if (!dialog.querySelector('.kk-opinion')?.childElementCount) showOpinionLine(hello);
}

// ヘッダーの「きせかえ」ボタン（各画面がヘッダーを描き直しても動くように、document で受ける）
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-customize]')) openCustomize();
});

applyDesign();
// ヘッダーが後から描かれる画面のため、もう一度バナー位置を整える
requestAnimationFrame(() => applyDesign());
