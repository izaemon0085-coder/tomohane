// 呼び方（キャラが呼ぶときの「さん」「さま」など）と、名前の下につくコード
// ・呼び方は本人がえらべる（あとから何度でも変えられる）。はじめは「さん」
// ・コードは登録したときに1回だけ決まり、本人も運営も変えられない（同じ名前の人・なりすましと見分けるため）
//   長さは 6〜12 文字のランダム。まぎらわしい文字（0 と O、1 と I・L）は使わない
export const HONORS = [
  { id: 'san', text: 'さん', label: '〇〇さん' },
  { id: 'sama', text: 'さま', label: '〇〇さま' },
  { id: 'kun', text: 'くん', label: '〇〇くん' },
  { id: 'chan', text: 'ちゃん', label: '〇〇ちゃん' },
  { id: 'dono', text: 'どの', label: '〇〇どの' },
  { id: 'none', text: '', label: '〇〇（呼びすて）' },
];
export const DEFAULT_HONOR = 'san';
export const isHonor = (id) => HONORS.some((h) => h.id === id);
export const honorText = (id) => (HONORS.find((h) => h.id === id) ?? HONORS[0]).text;

// キャラが呼ぶときの名前（例：「みかん」＋「ちゃん」→「みかんちゃん」）
export function callName(user) {
  if (!user) return '';
  return `${user.name ?? ''}${honorText(user.honor ?? DEFAULT_HONOR)}`;
}

export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 0・O・1・I・L は使わない
export const CODE_MIN = 6;
export const CODE_MAX = 12;
export const isUserCode = (s) => typeof s === 'string' && new RegExp(`^[${CODE_CHARS}]{${CODE_MIN},${CODE_MAX}}$`).test(s);
// 画面に出すときの形（名前の下に小さく）：#K7Q2MX
export const codeLabel = (code) => (code ? `#${code}` : '');
