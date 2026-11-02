// きせかえ：推しカラー・背景のもよう・飾り・レイアウトを自分の好きに変えられる。
// 設定はこのブラウザに保存する（β版。あとでアカウントに保存して、どの端末でも同じにできる）。
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
  side: 'auto', width: 'normal', card: 'round', font: 'm',
};

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* 保存できなくても見た目は変わる */ }
}

let design = load();

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
  design = { ...design, ...patch };
  save(design);
  applyDesign();
  syncPanel();
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
      <p class="muted kk-note">推しの色や飾りで、画面を自分好みにできます。設定はこのブラウザに保存されます。</p>

      <fieldset class="kk-group"><legend>推しカラー</legend>
        <div class="kk-swatches">
          <label class="kk-swatch kk-default" title="はじめの色"><input type="radio" name="color" value=""${d.color ? '' : ' checked'}><span>なし</span></label>
          ${OSHI_COLORS.map((c) => `<label class="kk-swatch" title="${c.name}" style="--sw:${c.hex}">
            <input type="radio" name="color" value="${c.hex}"${d.color === c.hex ? ' checked' : ''}><span class="sr-only">${c.name}</span></label>`).join('')}
          <label class="kk-custom" title="好きな色を選ぶ">🎨<input type="color" name="customColor" value="${d.color || '#ec5f9a'}" aria-label="好きな色を選ぶ"></label>
        </div>
      </fieldset>

      ${radioGroup('pattern', '背景のもよう', PATTERNS, d.pattern)}

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
      ${radioGroup('font', '文字の大きさ', [{ key: 's', label: '小' }, { key: 'm', label: '中' }, { key: 'l', label: '大' }], d.font)}

      <div class="kk-foot">
        <button type="button" class="btn ghost" data-reset>はじめの見た目に戻す</button>
        <button class="btn" value="close">できた！</button>
      </div>
    </form>`;
  dialog.querySelector('[name="oshiName"]').value = d.oshiName; // ユーザーの入力は value で入れる（HTML に埋め込まない）
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
  }
});

export function openCustomize() {
  renderPanel();
  if (!dialog.isConnected) document.body.append(dialog);
  dialog.showModal();
}

// ヘッダーの「きせかえ」ボタン（各画面がヘッダーを描き直しても動くように、document で受ける）
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-customize]')) openCustomize();
});

applyDesign();
// ヘッダーが後から描かれる画面のため、もう一度バナー位置を整える
requestAnimationFrame(() => applyDesign());
