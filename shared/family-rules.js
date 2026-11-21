// 👪 おうちの人との決まり（子ども＝12歳まで）。サーバーと画面で同じものを使う
// おうちの人と子どもが「家族の話しあいの案内」（/family-guide.html）を見ながら話しあって決める。
// 決めたものを、つながっているおうちの人がアカウントのページで設定し、子どもが「話しあった・わかった」を押す。
//   A カギ        ：書くのを全部お休み（読む・いいねはできる）
//   C 子どもの部屋：カフェの「こどもテーブル」（子どもとキャラだけが書ける。おうちの人は見守りで読むだけ）
//   D スイッチ    ：書く場所・使う場所を1つずつ、オン／オフ
//   夜9時         ：夜9時から朝6時までは書けない（読むのはできる）
// 目安箱・通報・🔔お知らせは、こまったときの道なので、どの決まりでも止めない。
import { jstHour } from './arcade.js';

export const NIGHT_FROM = 21;
export const NIGHT_TO = 6;
export const KIDS_TABLE = { id: 'kids', kind: 'kids', name: 'こどもテーブル', emoji: '🧸', note: '12歳までの人とキャラの席（おうちの人は見守り）' };

// D のスイッチ（書く場所・使う場所）
export const FAMILY_SWITCHES = [
  { id: 'plaza', label: '💬 広場に書く（新聞への投書も）' },
  { id: 'cafe', label: '☕ カフェで話す' },
  { id: 'meeting', label: '🦉 会議室で話す' },
  { id: 'games', label: '🎮 ゲームセンターのゲーム（ともはねでログイン）' },
  { id: 'letters', label: '✉️ 手紙キット' },
];
export const SWITCH_IDS = FAMILY_SWITCHES.map((s) => s.id);

// まだ話しあっていないときの決まり（いままでどおり使える＋夜9時のまもり＋子どもの部屋）
export const DEFAULT_FAMILY_RULES = Object.freeze({
  lock: false,
  kidsRoom: true,
  night: true,
  switches: Object.freeze(Object.fromEntries(SWITCH_IDS.map((id) => [id, true]))),
});

export const isNightJst = (date = new Date()) => {
  const h = jstHour(date);
  return h >= NIGHT_FROM || h < NIGHT_TO;
};

// 送られてきた決まりを、決まった形にそろえる
export function normalizeRules(input) {
  const r = input && typeof input === 'object' ? input : {};
  const sw = r.switches && typeof r.switches === 'object' ? r.switches : {};
  return {
    lock: r.lock === true,
    kidsRoom: r.kidsRoom !== false,
    night: r.night !== false,
    switches: Object.fromEntries(SWITCH_IDS.map((id) => [id, sw[id] !== false])),
  };
}

// what：'plaza' | 'cafe' | 'kids' | 'meeting' | 'games' | 'letters'
// 書いてよければ null、だめなら シバのことば（理由）を返す
export function familyStop(rules, what, date = new Date()) {
  const r = normalizeRules(rules ?? DEFAULT_FAMILY_RULES);
  if (r.lock && what !== 'games') return 'いまは、おうちの人との決まりで「カギ」がかかっているっす。読むのといいねはできるっす！';
  if (what === 'kids') {
    if (!r.kidsRoom) return 'こどもテーブルは、おうちの人との決まりで、いまはお休みっす';
  } else if (r.switches[what] === false) {
    const label = FAMILY_SWITCHES.find((s) => s.id === what)?.label.replace(/^\S+\s/, '') ?? '';
    return `「${label}」は、おうちの人との決まりで、いまはお休みっす。おうちの人と話してみてほしいっす`;
  }
  if (r.night && what !== 'games' && isNightJst(date)) return `夜${NIGHT_FROM}時から朝${NIGHT_TO}時までは、書くのはお休みっす。読むのはできるっす。また朝にね！`;
  return null;
}
