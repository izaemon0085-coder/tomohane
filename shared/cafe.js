// カフェのテーブル（サーバーと画面で同じものを使う）
// ・ジャンルは、まずこの6つ。あとはユーザーの声（リクエスト）を見て、運営が足していく
// ・β版では、どのテーブルも「だれでも」（年齢の決まりは、イラスト掲示板を作るときに考える）
export const FREE_TABLE = { id: 'free', kind: 'free', name: 'フリーテーブル', emoji: '☕', note: 'なんでも話せる席' };
export const GENRE_TABLES = [
  { id: 'idol', kind: 'genre', name: 'アイドル', emoji: '🎤', note: 'アイドルの話をする席' },
  { id: 'anime', kind: 'genre', name: 'アニメ・マンガ', emoji: '📺', note: 'アニメやマンガの話をする席' },
  { id: 'game', kind: 'genre', name: 'ゲーム', emoji: '🎮', note: 'ゲームの推しの話をする席' },
  { id: 'vtuber', kind: 'genre', name: '歌い手・VTuber', emoji: '🎧', note: '歌い手さんや VTuber の話をする席' },
  { id: 'sports', kind: 'genre', name: 'スポーツ', emoji: '⚽', note: '選手やチームの話をする席' },
  { id: 'other', kind: 'genre', name: 'そのほか', emoji: '🌈', note: 'ほかのジャンルの推しの話をする席' },
];
export const MAX_TABLE_NAME = 12;
export const MAX_TABLE_REQUEST = 30;
export const MAX_OPEN_REQUESTS = 3; // 1人が同時に出せるリクエストの数

// 推しのテーブル：同じ推しの人がこの人数になったら、マスターのタヌキが開く
export const OSHI_TABLE_MIN = 3;
export const GENRE_IDS = GENRE_TABLES.map((g) => g.id);

// 店員さんのペンギンが、似た名前をそろえる（全角・半角、カタカナ・ひらがな、大文字・小文字、空白や「・」のちがい）
export function normalizeOshi(name) {
  return String(name ?? '').normalize('NFKC').toLowerCase()
    .replace(/[\s・･·.\-ー_~〜!！?？'"’”]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
