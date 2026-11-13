// アップデート予定のアプリ（まだ本物の機械・お店では動かしていないもの）。
// 町の地図・ゲーム一覧・アカウントのページでは「🛠 アップデート予定」の札をつけて、押しても開かない。
// 出すときは、ここから消すだけでよい（サーバーのつなぎ口は残してあるので、テストや試しには使える）
export const COMING_SOON = {
  misetomo: 'お店のアプリ',
  soratomo: 'そらとも',
  korotomo: 'ころとも',
  haatomo: 'はーとも美術館',
  tomoru: 'ともーるアリーナ',
};
export const isComingSoon = (id) => Object.hasOwn(COMING_SOON, id);
export const SOON_LABEL = '🛠 アップデート予定';
