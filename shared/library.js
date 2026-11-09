// 図書館（サーバーと画面で同じものを使う）
// ・ユーザーが書いた小説・漫画を、ジャンル別・年齢別の棚に置く（ジャンルはカフェのテーブルと同じ）
// ・年齢の棚：だれでも／中高生から（13歳から）／大人だけ（18歳から）。大人だけの棚は仲間内だけ（広場には出さない）
// ・年齢の棚に入るときは、読む人が同意してから
// ・図書館の中は「しずかに」：本のページではおしゃべりしない。感想はカフェで
// ・いまはサンプル（運営が置いた見本）だけ。ユーザーが本を出すのは、このあとの段階で作る
import { GENRE_TABLES } from './cafe.js';

export const LIBRARY_GENRES = GENRE_TABLES.map(({ id, name, emoji }) => ({ id, name, emoji }));
export const AGE_SHELVES = [
  { id: 'child', name: 'だれでも', note: 'だれでも読める本' },
  { id: 'teen', name: '中高生から', note: '13歳から読める本' },
  { id: 'adult', name: '大人だけ', note: '18歳から。仲間内だけで読む本' },
];
const AGE_ORDER = { child: 0, teen: 1, adult: 2 };
// ログインしていない人は、こどもと同じ（ゲームセンターと同じ考え）
export const shelfAllows = (minAge, group) => AGE_ORDER[group ?? 'child'] >= AGE_ORDER[minAge ?? 'child'];

// ---- 小説を「きれいにまとめる」 ----
// 書き方（作者はこれだけ覚えればよい）
//   ◆ 見出し      … 章の見出し
//   |漢字《かんじ》 … ルビ（ふりがな）。「|」は省いてもよい（漢字のすぐあとに《》）
//   空の行        … 場面の切りかわり（少し間をあける）
//   「」で始まる行 … 会話（字下げしない）
// それ以外の行は、段落の頭を1字下げる
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function ruby(line) {
  return escapeHtml(line)
    .replace(/[|｜]([^|｜《]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>')
    .replace(/([一-鿿々〆ヶ]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');
}
export function formatNovel(text) {
  const out = [];
  let gap = false;
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { gap = out.length > 0; continue; }
    if (/^[◆◇]/.test(line)) { out.push(`<h3>${ruby(line.replace(/^[◆◇]\s*/, ''))}</h3>`); gap = false; continue; }
    const cls = [/^[「『（]/.test(line) ? 'talk' : '', gap ? 'scene' : ''].filter(Boolean).join(' ');
    gap = false;
    out.push(`<p${cls ? ` class="${cls}"` : ''}>${ruby(line)}</p>`);
  }
  return out.join('\n');
}
// ルビや記号をのぞいた文字の数（本の長さの目安）
export const novelLength = (text) => [...String(text ?? '').replace(/《[^》]*》|[|｜◆◇\s]/g, '')].length;

// ---- サンプルの本（運営が置いた見本） ----
// 漫画のサンプルは、絵のファイルではなくコマのデータ（4コマ）。ユーザーの漫画は、あとで画像を貼る形にする
//   face：キャラの絵（/shared/avatars/〇〇.svg の名前）か、絵文字
const SAMPLE_AUTHOR = 'ともはね図書館（サンプル）';

export const SAMPLE_BOOKS = [
  {
    id: 'sample-penlight', kind: 'novel', title: 'はじめてのペンライト', genre: 'idol', minAge: 'child',
    author: SAMPLE_AUTHOR, cover: { emoji: '🎤✨', color: '#e86a92' },
    blurb: 'はじめてのライブ。ペンライトの色を、ちゃんと合わせられるかな。',
    text: `◆ 一 ポケットの中の光
ミオのポケットには、まだ一度も光ったことのないペンライトが入っている。
お年玉の残りで買った、推しの色――あさい水色に光るはずのペンライトだ。
「本番で電池が切れたらどうしよう」
そう言うと、となりのおねえちゃんが笑った。
「予備の電池、三本も持ってきたでしょ」
会場の前には、同じ水色のタオルを首にかけた人たちが、何人も並んでいた。

◆ 二 曲がはじまる
暗くなった会場に、最初の音が鳴った。
ミオはあわてて|親指《おやゆび》でスイッチを押した。……光らない。
もう一度。もう一度。
「逆さま」
となりの知らないおねえさんが、そっとペンライトの向きを直してくれた。
カチッ。
手の中に、小さな水色の星が生まれた。
「ありがとうございます！」
声は曲にかき消されたけれど、おねえさんは、ペンライトを一回ふって返事をしてくれた。

◆ 三 帰り道の星
帰りの電車で、ミオはペンライトを消さずに、ひざの上にのせていた。
「電池、もったいないよ」
「あと一駅だけ」
窓の外は暗くて、ガラスに水色の光がうつっている。
会場で光っていた何千もの星のうちの、ひとつ。
それが自分の手の中にあることが、ミオには、なんだかとてもうれしかった。`,
  },
  {
    id: 'sample-shiba-letter', kind: 'novel', title: 'シバとなくした手紙', genre: 'other', minAge: 'child',
    author: SAMPLE_AUTHOR, cover: { emoji: '🐕✉️', color: '#e8873a' },
    blurb: 'ポストのそばに落ちていた、あて名のない手紙。シバは町じゅうを走りまわる。',
    text: `◆ 一 あて名のない手紙
朝のさんぽの帰り道、シバはポストの横で、白い|封筒《ふうとう》を見つけた。
「落とし物っす！」
封筒には、あて名が書いていない。かわりに、すみっこに小さな星のシールがはってあった。
「これじゃ、だれに届ければいいか、わからないっす……」

◆ 二 町のききこみ
シバはまず、カフェに行った。
「星のシール？ うーん、まあ、ゆっくり考えてみなよ」
タヌキのマスターは、コーヒーをいれながら、のんびり首をかしげた。
次はゲームセンター。
「ゲロゲロ！ 星なら、ころともが集めてるよ！」
カエルはそう言ったけれど、ころとものところに行っても、星はぜんぶ、ゲームの中の星だった。
最後に、シバは図書館のドアを、そっと開けた。
「しーっ」
カメの館長が、メガネの奥で目を細めた。
「星のシールなら、きのうネズミくんが、しおりにはっていたねえ」

◆ 三 手紙のゆくえ
ネズミの司書は、封筒を見ると、耳まで赤くなった。
「（ちいさな声で）そ、それ……ぼくが、館長に書いた手紙です。お礼を言いたくて……でも、わたす勇気がなくて」
シバはしっぽをぶんぶんふった。
「だったら、いま、わたすっす！」
カメの館長は、手紙をゆっくり読んで、それから、ゆっくり笑った。
「ありがとう。……でも、ここは図書館だからね。うれしい声は、しずかに、ね」
三人は顔を見あわせて、声を出さずに笑った。`,
  },
  {
    id: 'sample-savepoint', kind: 'novel', title: '放課後のセーブポイント', genre: 'game', minAge: 'teen',
    author: SAMPLE_AUTHOR, cover: { emoji: '🎮🌇', color: '#3b7dc4' },
    blurb: '転校していく友だちと、最後に一緒にクリアしたかったゲーム。',
    text: `◆ 一 残り三日
「ラスボスの前で、セーブしたままなんだよな」
放課後の教室で、ハルトが言った。
来週の月曜日、ハルトは遠くの町へ引っ越す。ぼくらが中学に入ってからずっと、二人で少しずつ進めてきたゲームは、まだ終わっていない。
「金曜までに、クリアしよう」
ぼくがそう言うと、ハルトは少しだけ、困ったように笑った。

◆ 二 負けつづける
水曜日、ぼくらは三回負けた。
木曜日、ぼくらは五回負けた。
「レベル、もう少し上げてからにする？」
「そんな時間、ないだろ」
ハルトのコントローラーを持つ手が、かすかにふるえているのに、ぼくは気づかないふりをした。
クリアしたら、本当におしまいになる。
たぶん、ぼくらは二人とも、それがこわかったんだと思う。

◆ 三 セーブポイント
金曜日。最後の一撃は、ハルトだった。
エンディングの音楽が流れて、画面に、知らない人たちの名前が下から上へ流れていく。
ぼくらは何も言わなかった。
曲が終わると、画面に「セーブしますか？」と出た。
「……する」
ハルトがボタンを押した。
「向こうに行っても、ここから続きができるように」
クリアしたゲームに、続きなんてない。ぼくもハルトも、知っていた。
それでも、ぼくはうなずいた。
セーブポイントは、また会うための、約束の場所だから。`,
  },
  {
    id: 'sample-rainy-cafe', kind: 'manga', title: '雨の日のカフェ', genre: 'other', minAge: 'child',
    author: SAMPLE_AUTHOR, cover: { emoji: '🦝☔', color: '#8a6a4a' },
    blurb: 'お客さんが来ない雨の日。マスターとペンギンの、のんびり4コマ。',
    pages: [
      { panels: [
        { bg: '#dfe9f3', face: ['penguin'], narr: '雨の日のカフェ', say: [{ who: 'ペンギン', text: 'マスター、きょうはお客さん、来ませんね……' }], sfx: 'ザーー' },
        { bg: '#f6ecdf', face: ['tanuki'], say: [{ who: 'タヌキ', text: 'まあ、ゆっくりしていきなよ' }] },
        { bg: '#f6ecdf', face: ['penguin'], say: [{ who: 'ペンギン', text: 'わたし、店員なんですけど！？' }], sfx: 'ガーン' },
        { bg: '#f6ecdf', face: ['tanuki', 'penguin'], say: [{ who: 'ふたり', text: '……（ずずー）' }], narr: 'けっきょく、二人でお茶をした' },
      ] },
      { panels: [
        { bg: '#dfe9f3', face: ['🐸'], say: [{ who: 'カエル', text: 'ゲロゲロ！ 雨の日、さいこう！' }], sfx: 'カランコロン' },
        { bg: '#f6ecdf', face: ['penguin'], say: [{ who: 'ペンギン', text: 'いらっしゃいませ！ お席までご案内します！' }], sfx: 'シャキーン' },
        { bg: '#f6ecdf', face: ['🐸'], say: [{ who: 'カエル', text: '外の席でいいよ！ 雨にあたりたいから！' }] },
        { bg: '#dfe9f3', face: ['tanuki'], say: [{ who: 'タヌキ', text: 'まあ、すきにしていきなよ' }], narr: 'おしまい' },
      ] },
    ],
  },
  {
    id: 'sample-kaeru-highscore', kind: 'manga', title: 'カエル、ハイスコアにいどむ', genre: 'game', minAge: 'child',
    author: SAMPLE_AUTHOR, cover: { emoji: '🐸🕹️', color: '#4caf50' },
    blurb: 'キツネ店長のハイスコアを、カエルはぬけるのか。ゲームセンターの4コマ。',
    pages: [
      { panels: [
        { bg: '#1b2140', face: ['kitsune'], say: [{ who: 'キツネ', text: 'ハイスコアは、いまぼくがいちばん！' }], sfx: 'ピコーン', dark: true },
        { bg: '#1b2140', face: ['🐸'], say: [{ who: 'カエル', text: 'ゲロ！ ぬいてみせる！' }], dark: true },
        { bg: '#1b2140', face: ['🐸'], say: [{ who: 'カエル', text: '……あと1点だったゲロ……' }], sfx: 'ゲームオーバー', dark: true },
        { bg: '#1b2140', face: ['kitsune'], say: [{ who: 'キツネ', text: 'もう一回！ ……って、ぼくのセリフなんだけど！' }], dark: true },
      ] },
      { panels: [
        { bg: '#1b2140', face: ['🐸'], narr: '99回目', sfx: 'ピコピコ', dark: true },
        { bg: '#1b2140', face: ['🐸'], say: [{ who: 'カエル', text: 'ぬいたーーー！！' }], sfx: 'ファンファーレ', dark: true },
        { bg: '#1b2140', face: ['kitsune'], say: [{ who: 'キツネ', text: 'く、くやしい……！ もう一回！' }], dark: true },
        { bg: '#2a2140', face: ['kitsune', '🐸'], say: [{ who: 'キツネ', text: '……と思ったけど、閉店の時間だ。また明日！' }], narr: 'ゲームセンターは、時間をきっちり守ります', dark: true },
      ] },
    ],
  },
  {
    id: 'sample-stream-5min', kind: 'manga', title: '推しの配信、5分前', genre: 'vtuber', minAge: 'teen',
    author: SAMPLE_AUTHOR, cover: { emoji: '🎧⏰', color: '#7e5bb5' },
    blurb: 'テスト前日の夜。推しの配信と、終わらない宿題。中高生の4コマ。',
    pages: [
      { panels: [
        { bg: '#eee8f8', face: ['🧑‍🎓'], narr: 'テストの前の夜', say: [{ who: 'ユイ', text: '推しの配信まで、あと5分……！' }], sfx: 'カチ、カチ' },
        { bg: '#eee8f8', face: ['📚'], say: [{ who: 'ユイ', text: '宿題、あと3ページ……' }], sfx: 'ドーン' },
        { bg: '#eee8f8', face: ['🧑‍🎓'], say: [{ who: 'ユイ', text: '5分で3ページ……いける！' }], sfx: 'シャカシャカシャカ' },
        { bg: '#e2d8f5', face: ['🎧'], say: [{ who: '推し', text: 'こんばんは〜！ みんな、テスト前の人は宿題おわった？' }], narr: '配信スタート' },
      ] },
      { panels: [
        { bg: '#eee8f8', face: ['🧑‍🎓'], say: [{ who: 'ユイ', text: '（ぎくっ）' }] },
        { bg: '#e2d8f5', face: ['🎧'], say: [{ who: '推し', text: 'おわってない人は、アーカイブで見てね〜！ ちゃんと残しておくから！' }] },
        { bg: '#eee8f8', face: ['🧑‍🎓'], say: [{ who: 'ユイ', text: '推しが言うなら……！' }], sfx: 'カリカリカリ' },
        { bg: '#fdf6dc', face: ['🧑‍🎓', '🎧'], narr: '次の日', say: [{ who: 'ユイ', text: 'テストも配信も、ぜんぶ見た！' }], sfx: 'キラーン' },
      ] },
    ],
  },
];

// 棚に並べるときの情報（本文・コマは入れない）
export function bookCard(b) {
  const { text, pages, ...card } = b;
  return { ...card, sample: true, length: b.kind === 'novel' ? novelLength(text) : pages.length };
}
export const findBook = (id) => SAMPLE_BOOKS.find((b) => b.id === id) ?? null;

// 館長のカメのひとこと
export function kameLine(group) {
  return group === 'child' || !group
    ? 'しーっ。ゆっくり読んでいってね。感想は、カフェで聞かせておくれ。'
    : 'しーっ。年齢の棚は、入る前にひとこと確かめるからね。感想は、カフェで聞かせておくれ。';
}
