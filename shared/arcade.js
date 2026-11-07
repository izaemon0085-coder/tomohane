// ゲームセンターの営業時間（サーバーと画面で同じものを使う）。あとでユーザーの声でアップデートする
// ・年齢で閉店の時間を分ける（日本時間）。朝6時に開店
// ・ログインしていない人は、こどもと同じ時間
// ・グラウンド（ゴーストエージェント）は運動なので、ゲームセンターの外（いつでも使える）
export const OPEN_HOUR = 6;
export const CLOSE_HOUR = { child: 21, teen: 22, adult: 24 };
export const ARCADE_APPS = ['game', 'korotomo', 'soratomo']; // ゲームセンターの中の台（ともはねの「ともはねでログイン」の入口の名前）

// 日本時間の「時」（0〜23）
export const jstHour = (date = new Date()) => (date.getUTCHours() + 9) % 24;

export function arcadeStatus(ageGroup, date = new Date()) {
  const close = CLOSE_HOUR[ageGroup] ?? CLOSE_HOUR.child;
  const h = jstHour(date);
  const open = h >= OPEN_HOUR && h < close;
  return { open, opensAt: OPEN_HOUR, closesAt: close };
}

// 店長のキツネのひとこと（開いているとき・閉まっているとき）
export function kitsuneLine({ open, opensAt, closesAt }) {
  return open
    ? `いらっしゃい！ 勝負する？ 負けても「もう一回！」だよ。きょうは ${closesAt === 24 ? '夜中の0' : closesAt}時まで開いてるよ。`
    : `きょうはもう閉店！ ${opensAt}時に開けるから、また明日「もう一回！」しよう。……ぼくも寝る！`;
}
