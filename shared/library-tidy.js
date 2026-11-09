// 図書館の「きれいにまとめる」：司書のネズミが、作者に頼まれたときだけ「まとめた案」を出す
// ・お話や文章そのものは変えない。見た目（記号・空白・見出し）だけをそろえる
// ・ルビは「案」だけ。どれを使うかは作者が選ぶ
// ・誤字は直さない。「ここ、誤字かも」と印をつけるだけ
// ・β版は決まりごと（小さな辞書）で見つける。あとで AI に入れかえる
// サーバーと画面で同じものを使う

const TIDY_LABEL = {
  heading: '「第1章」などを、章の見出しにしました',
  indent: '行のはじめの空白をとりました（字下げは、図書館がそろえます）',
  ellipsis: '「...」「…」を「……」にそろえました',
  dash: 'ダッシュを「――」にそろえました',
  mark: '「!」「?」を全角の「！」「？」にしました',
  space: '「！」「？」のあとに、1字あけました',
  kakko: '「。」」の「。」をとりました',
  blank: 'つづいた空の行を、1つにしました',
};

const HEADING = /^(#{1,3}\s*\S|第[0-9０-９一二三四五六七八九十百千]+[章話節幕部]|プロローグ|エピローグ|序章|終章|番外編)/;

// 小説の見た目をそろえる。{ text, changes: [{ id, label, count }] }
export function tidyNovel(raw) {
  const count = {};
  const add = (id, n = 1) => { if (n > 0) count[id] = (count[id] ?? 0) + n; };
  const out = [];
  let blankRun = 0;
  for (const original of String(raw ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    let line = original.replace(/[ \t　]+$/, '');
    const trimmed = line.replace(/^[ \t　]+/, '');
    if (trimmed !== line && trimmed) add('indent');
    line = trimmed;
    if (!line) {
      blankRun += 1;
      if (blankRun === 1) out.push('');
      else add('blank');
      continue;
    }
    blankRun = 0;
    if (!/^[◆◇]/.test(line) && HEADING.test(line) && [...line].length <= 30) {
      line = `◆ ${line.replace(/^#{1,3}\s*/, '')}`;
      add('heading');
    }
    line = line.replace(/\.{2,}|・{3,}|…+/g, (m) => {
      if (/^…+$/.test(m) && m.length % 2 === 0) return m;
      add('ellipsis');
      return '……';
    });
    line = line.replace(/-{2,}|[—―]+/g, (m) => {
      if (/^―+$/.test(m) && m.length % 2 === 0) return m;
      add('dash');
      return '――';
    });
    line = line.replace(/[!?！？]+/g, (m) => {
      const full = m.replace(/!/g, '！').replace(/\?/g, '？');
      if (full !== m) add('mark');
      return full;
    });
    line = line.replace(/([！？]+)(?=[^\s　」』）！？…―])/g, (m) => { add('space'); return `${m}　`; });
    line = line.replace(/。(?=[」』])/g, () => { add('kakko'); return ''; });
    out.push(line);
  }
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  const changes = Object.entries(TIDY_LABEL).filter(([id]) => count[id]).map(([id, label]) => ({ id, label, count: count[id] }));
  return { text: out.join('\n'), changes };
}

// ---- ルビ（ふりがな）の案 ----
// [漢字, よみ]。送りがなのある言葉は、漢字のところだけ（例：囁く → 囁《ささや》く）
// 長い言葉を先に見る（「眩暈」と「眩」など）
export const RUBY_DICT = [
  ['胡散臭', 'うさんくさ'], ['睫毛', 'まつげ'], ['蝋燭', 'ろうそく'], ['提灯', 'ちょうちん'], ['団扇', 'うちわ'], ['浴衣', 'ゆかた'],
  ['憂鬱', 'ゆううつ'], ['薔薇', 'ばら'], ['檸檬', 'れもん'], ['躊躇', 'ちゅうちょ'], ['咄嗟', 'とっさ'], ['刹那', 'せつな'],
  ['邂逅', 'かいこう'], ['黄昏', 'たそがれ'], ['硝子', 'がらす'], ['綺麗', 'きれい'], ['溜息', 'ためいき'], ['眩暈', 'めまい'],
  ['欠伸', 'あくび'], ['嗚咽', 'おえつ'], ['慟哭', 'どうこく'], ['狼狽', 'ろうばい'], ['曖昧', 'あいまい'], ['戦慄', 'せんりつ'],
  ['喧嘩', 'けんか'], ['贔屓', 'ひいき'], ['鬱陶', 'うっとう'], ['億劫', 'おっくう'], ['生憎', 'あいにく'], ['流石', 'さすが'],
  ['項垂', 'うなだ'], ['煎餅', 'せんべい'], ['林檎', 'りんご'], ['葡萄', 'ぶどう'], ['蜜柑', 'みかん'], ['珈琲', 'コーヒー'],
  ['微睡', 'まどろ'], ['煌', 'きら'], ['眩', 'まぶ'], ['囁', 'ささや'], ['呟', 'つぶや'], ['儚', 'はかな'], ['絆', 'きずな'],
  ['紡', 'つむ'], ['頷', 'うなず'], ['蹲', 'うずくま'], ['跪', 'ひざまず'], ['雫', 'しずく'], ['鞄', 'かばん'], ['噂', 'うわさ'],
  ['僅', 'わず'], ['縋', 'すが'], ['俯', 'うつむ'], ['掴', 'つか'], ['撫', 'な'], ['頬', 'ほお'], ['瞼', 'まぶた'], ['踵', 'かかと'],
  ['箒', 'ほうき'], ['苺', 'いちご'], ['嘘', 'うそ'], ['痣', 'あざ'], ['檻', 'おり'], ['稀', 'まれ'], ['掠', 'かす'],
];
export const MAX_RUBY_SUGGESTIONS = 40;

// すでにルビがついているところ（|…《…》・漢字《…》）は見ない
function rubyFreeRanges(text) {
  const taken = [];
  for (const m of text.matchAll(/[|｜][^|｜《\n]+《[^》\n]*》|[一-鿿々〆ヶ]+《[^》\n]*》/g)) taken.push([m.index, m.index + m[0].length]);
  return taken;
}
function firstFree(text, word, taken) {
  let from = 0;
  for (;;) {
    const i = text.indexOf(word, from);
    if (i === -1) return -1;
    const end = i + word.length;
    if (!taken.some(([a, b]) => i < b && end > a)) return i;
    from = i + 1;
  }
}
// ルビの案：はじめて出てくるところに1回だけ。{ kanji, reading, context }
export function rubySuggestions(raw) {
  const text = String(raw ?? '');
  const taken = rubyFreeRanges(text);
  const list = [];
  for (const [kanji, reading] of RUBY_DICT) {
    const i = firstFree(text, kanji, taken);
    if (i === -1) continue;
    taken.push([i, i + kanji.length]);
    const lineStart = text.lastIndexOf('\n', i) + 1;
    const lineEnd = text.indexOf('\n', i);
    const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const at = i - lineStart;
    const context = `${at > 12 ? '…' : ''}${line.slice(Math.max(0, at - 12), at + kanji.length + 12)}${at + kanji.length + 12 < line.length ? '…' : ''}`;
    list.push({ kanji, reading, context, index: i });
    if (list.length >= MAX_RUBY_SUGGESTIONS) break;
  }
  return list.sort((a, b) => a.index - b.index).map(({ index: _i, ...r }) => r);
}
// 作者が選んだルビだけをつける（はじめて出てくるところに1回）
export function applyRuby(raw, kanjiList) {
  let text = String(raw ?? '');
  const want = new Set(kanjiList ?? []);
  for (const [kanji, reading] of RUBY_DICT) {
    if (!want.has(kanji)) continue;
    const i = firstFree(text, kanji, rubyFreeRanges(text));
    if (i === -1) continue;
    text = `${text.slice(0, i)}|${kanji}《${reading}》${text.slice(i + kanji.length)}`;
  }
  return text;
}

// ---- 誤字のお知らせ（直さない。印だけ） ----
const TYPO_WORDS = [
  ['ふいんき', '「ふんいき（雰囲気）」かも'],
  ['こんにちわ', '「こんにちは」かも'],
  ['こんばんわ', '「こんばんは」かも'],
  ['づつ', '「ずつ」かも（ひとつずつ、など）'],
  ['以外と', '「意外と」かも'],
  ['興味心身', '「興味津々」かも'],
  ['汚名挽回', '「汚名返上」か「名誉挽回」かも'],
  ['的を得', '「的を射る」かも'],
  ['始めまして', '「初めまして」かも'],
  ['をを', '「を」が2つ続いています'],
  ['。。', '「。」が2つ続いています'],
  ['、、', '「、」が2つ続いています'],
];
const PAIRS = [['「', '」'], ['『', '』'], ['（', '）']];
export const MAX_TYPO_MARKS = 50;

// { line（何行め）, snippet, note }
export function typoMarks(raw) {
  const marks = [];
  const lines = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, n) => {
    for (const [word, note] of TYPO_WORDS) {
      if (line.includes(word)) marks.push({ line: n + 1, snippet: word, note });
    }
    for (const [open, close] of PAIRS) {
      const o = line.split(open).length - 1;
      const c = line.split(close).length - 1;
      if (o !== c) marks.push({ line: n + 1, snippet: [...line].slice(0, 16).join(''), note: `${open} と ${close} の数が合っていないかも（閉じわすれ？）` });
    }
  });
  return marks.slice(0, MAX_TYPO_MARKS);
}

// ---- 漫画のページ ----
// ファイルの名前の数字でならべる（p1, p2, …, p10 の順。名前に数字がなければ、出した順のまま）
const numberIn = (name) => {
  const all = String(name ?? '').normalize('NFKC').match(/\d+/g);
  return all ? Number(all[all.length - 1]) : null;
};
export function tidyPages(pages) {
  const idx = pages.map((p, i) => ({ i, n: numberIn(p.name) }));
  const order = idx.every((x) => x.n !== null)
    ? [...idx].sort((a, b) => a.n - b.n || a.i - b.i).map((x) => x.i)
    : idx.map((x) => x.i);
  const changes = [];
  if (order.some((v, i) => v !== i)) changes.push({ id: 'order', label: 'ページの順番を、ファイルの名前の数字でならべました', count: 1 });
  changes.push({ id: 'cover', label: '1ページめを表紙にしました', count: 1 });
  changes.push({ id: 'size', label: 'ページの大きさは、読むときに同じはばにそろえます', count: 1 });
  return { order, cover: 0, changes };
}

// ネズミのまとめた案（小説・漫画）
export function nezumiSuggestion(book) {
  if (book.kind === 'manga') return { kind: 'manga', ...tidyPages(book.pages ?? []) };
  const tidy = tidyNovel(book.text);
  return { kind: 'novel', text: tidy.text, changes: tidy.changes, ruby: rubySuggestions(tidy.text), typos: typoMarks(tidy.text) };
}
