// 🔍 さがす（サーバーと画面で同じものを使う）
// ・投稿・図書館の本・人・#タグ。見てよいものだけ（サーバーがしぼる）
// ・全角／半角、大文字／小文字、カタカナ／ひらがなのちがいは気にしない

export const MAX_QUERY = 30;
export const LIMITS = { posts: 30, books: 20, people: 20 };

// くらべるための形にそろえる
export function normalizeText(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// #タグ：# のあとに、空白や記号が来るまで（20文字まで）
export const TAG_RE = /[#＃]([^\s#＃、。，．,.!！?？「」『』（）()\[\]【】<>＜＞"'`]{1,20})/g;
export function tagsOf(text) {
  return [...String(text ?? '').matchAll(TAG_RE)].map((m) => normalizeText(m[1]));
}

// 画面用：エスケープずみの文の中の #タグ を、さがすページへのリンクにする
export function linkifyTags(escapedHtml) {
  return escapedHtml.replace(TAG_RE, (all, tag) => `<a class="tag-link" href="/search.html?q=${encodeURIComponent(`#${tag}`)}">${all}</a>`);
}
