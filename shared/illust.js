// 🖼️ 写真をイラストにする（ごちとも と同じ計算。外のサービス・AI なし。すべてブラウザの中で計算する）
// 元の写真はサーバーに送らない。送るのは、イラストにして小さくした絵だけ。
// img は { data: Uint8ClampedArray(RGBA), width, height }。ブラウザの ImageData でも、テストの作り物でも動く
// 絵柄は少しずつ増やす（ユーザーの声で）。はじめは ごちとも の4つ
export const ILLUST_STYLES = [
  { id: 'watercolor', label: '🖌️ 水彩・筆ペン風' },
  { id: 'cafe', label: '☕ カフェメニュー風' },
  { id: 'pop', label: '🎨 ポップイラスト' },
  { id: 'pencil', label: '✏️ えんぴつ画' },
];
export const ILLUST_STYLE_IDS = ILLUST_STYLES.map((s) => s.id);
export const ILLUST_MAX_SIDE = 640; // 長い辺をここまで小さくしてから絵にする
export const GOODS_IMAGE_MAX_BYTES = 400 * 1024;

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function makeImage(width, height, data) {
  return { width, height, data: data || new Uint8ClampedArray(width * height * 4) };
}
const copy = (img) => makeImage(img.width, img.height, new Uint8ClampedArray(img.data));

// 横と縦に分けたボックスぼかし（なめらかにして、色の面をつくる）
export function boxBlur(img, r) {
  if (r < 1) return copy(img);
  const { width: w, height: h } = img;
  const tmp = new Float32Array(w * h * 4);
  const out = makeImage(w, h);
  const src = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        const i = (y * w + xx) * 4;
        s0 += src[i]; s1 += src[i + 1]; s2 += src[i + 2]; s3 += src[i + 3]; n++;
      }
      const o = (y * w + x) * 4;
      tmp[o] = s0 / n; tmp[o + 1] = s1 / n; tmp[o + 2] = s2 / n; tmp[o + 3] = s3 / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        const i = (yy * w + x) * 4;
        s0 += tmp[i]; s1 += tmp[i + 1]; s2 += tmp[i + 2]; s3 += tmp[i + 3]; n++;
      }
      const o = (y * w + x) * 4;
      out.data[o] = s0 / n; out.data[o + 1] = s1 / n; out.data[o + 2] = s2 / n; out.data[o + 3] = s3 / n;
    }
  }
  return out;
}

// 色の数をへらす（levels 段）＋あざやかさ（sat）＋色みの足し算（tint）
export function toneMap(img, { levels = 6, sat = 1, tint = [0, 0, 0], lift = 0 } = {}) {
  const out = copy(img);
  const d = out.data;
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    for (let c = 0; c < 3; c++) {
      let v = g + (d[i + c] - g) * sat + tint[c];
      v = Math.round(clamp(v) / step) * step;
      d[i + c] = clamp(v + (255 - v) * lift);
    }
  }
  return out;
}

// 明るさの差（ソーベル）から、輪かくの強さ 0〜1 を出す
export function edges(img) {
  const { width: w, height: h, data: d } = img;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const e = new Float32Array(w * h);
  const at = (x, y) => gray[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      e[y * w + x] = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 360);
    }
  }
  return e;
}

function inkLines(img, e, { color, threshold, strength }) {
  const d = img.data;
  for (let p = 0; p < e.length; p++) {
    const v = e[p];
    if (v < threshold) continue;
    const a = Math.min(1, (v - threshold) / (1 - threshold) * 2.2) * strength;
    const i = p * 4;
    for (let c = 0; c < 3; c++) d[i + c] = clamp(d[i + c] * (1 - a) + color[c] * a);
  }
  return img;
}

// 決まった種から作る、紙のざらざら（毎回同じ模様になる）
function paper(img, amount, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n);
  }
  return img;
}

export function illustrate(img, style) {
  const e = edges(boxBlur(img, 1));
  switch (style) {
    case 'pop': {
      const out = toneMap(boxBlur(img, 2), { levels: 4, sat: 1.6 });
      return inkLines(out, e, { color: [30, 25, 35], threshold: 0.16, strength: 1 });
    }
    case 'cafe': {
      const out = toneMap(boxBlur(img, 2), { levels: 7, sat: 0.85, tint: [14, 4, -12], lift: 0.06 });
      return paper(inkLines(out, e, { color: [92, 60, 40], threshold: 0.2, strength: 0.8 }), 10);
    }
    case 'pencil': {
      const out = makeImage(img.width, img.height);
      for (let p = 0; p < e.length; p++) {
        const v = Math.min(1, e[p] * 1.8);
        const i = p * 4;
        out.data[i] = clamp(250 - v * 190); out.data[i + 1] = clamp(246 - v * 190); out.data[i + 2] = clamp(236 - v * 180);
        out.data[i + 3] = 255;
      }
      return paper(out, 14);
    }
    case 'watercolor':
    default: {
      const out = toneMap(boxBlur(img, 3), { levels: 6, sat: 1.05, lift: 0.14 });
      return paper(inkLines(out, e, { color: [70, 72, 96], threshold: 0.24, strength: 0.55 }), 16);
    }
  }
}

// モザイク：顔や名前・住所の文字をかくす。円の中を大きなます目にする
export function pixelate(img, cx, cy, radius, cell = 14) {
  const { width: w, height: h, data: d } = img;
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(w, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(h, Math.ceil(cy + radius));
  for (let by = y0; by < y1; by += cell) {
    for (let bx = x0; bx < x1; bx += cell) {
      let s0 = 0, s1 = 0, s2 = 0, n = 0;
      const ey = Math.min(y1, by + cell), ex = Math.min(x1, bx + cell);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const i = (y * w + x) * 4; s0 += d[i]; s1 += d[i + 1]; s2 += d[i + 2]; n++;
      }
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
        const i = (y * w + x) * 4; d[i] = s0 / n; d[i + 1] = s1 / n; d[i + 2] = s2 / n;
      }
    }
  }
  return img;
}
