// 🚪 カフェの「仲間内だけの個室」（サーバーと画面で同じものを使う）
// ・ジャンルのテーブルごとに、ユーザーが作れる。作る人（主）が入り方と年齢を選ぶ
//   入り方：invite＝主が招待した人だけ（さがしても出ない）／apply＝申しこんで、主が OK した人
//   年齢  ：same＝主と同じ年齢の区分だけ（中高生どうし・大人どうし）／adult＝大人（18歳から）だけ
// ・12歳までの人は使えない（子どもには 🧸こどもテーブルがある）
// ・キャラは入らない（トゲのある言葉のときだけ、フクロウなどが声をかける）
export const MAX_ROOM_NAME = 12;
export const MAX_ROOMS_PER_OWNER = 3;
export const MAX_ROOM_MEMBERS = 30;
export const ROOM_ENTRIES = [
  { id: 'invite', label: '✉️ 招待した人だけ', note: 'カフェの一覧には出ません。名前の下のコード（#…）で招待します' },
  { id: 'apply', label: '🙋 申しこんで、主が OK', note: 'カフェの一覧に出て、入りたい人が申しこめます' },
];
export const ROOM_AGES = [
  { id: 'same', label: '同じ年齢の区分だけ', note: '中高生は中高生どうし、大人は大人どうし' },
  { id: 'adult', label: '大人（18歳から）だけ', note: '大人の主だけが作れます' },
];
export const isRoomId = (id) => typeof id === 'string' && id.startsWith('room_');
export const roomAgeLabel = (room) => (room.age === 'adult' ? '大人だけ' : room.ageGroup === 'teen' ? '中高生どうし' : '大人どうし');
// 名前の下のコード（#abc123 / abc123）を、くらべやすい形に
export const cleanCode = (s) => String(s ?? '').trim().replace(/^#/, '').toLowerCase();
