// 字体（きせかえ・手紙キットで共通）。増やすときは shared/fonts/README.md を見る
// サーバーの store.js は、手紙に保存してよい字体の key をこの一覧から読む
const FALLBACK = 'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif';

export const TYPEFACES = [
  { key: 'system', label: 'ふつう', family: null },
  { key: 'zenmaru', label: 'まるゴシック', family: 'Zen Maru Gothic' },
  { key: 'klee', label: 'てがき風', family: 'Klee One' },
  { key: 'kiwi', label: 'ぽってり丸', family: 'Kiwi Maru' },
];
export const TYPEFACE_KEYS = TYPEFACES.map((t) => t.key);
export const DEFAULT_TYPEFACE = 'system';

const find = (key) => TYPEFACES.find((t) => t.key === key) || TYPEFACES[0];

// CSS の font-family にそのまま入れられる形（入っていない文字は、ふだんの字体で出る）
export function fontStack(key) {
  const t = find(key);
  return t.family ? `"${t.family}", ${FALLBACK}` : FALLBACK;
}

// canvas に描く前に、字体のファイルを読み込み終えておく（読み込む前に描くと、ふだんの字体になる）
export async function loadTypeface(key) {
  const t = find(key);
  if (!t.family || typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.load(`40px "${t.family}"`, 'あ漢A');
  } catch { /* 読み込めなければ、ふだんの字体で描く */ }
}
