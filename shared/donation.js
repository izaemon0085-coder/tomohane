// 💝 応援（寄付）：新聞社の募金箱（β版は個人として受け取る）
// ・運営費（サーバー・ドメイン・メール・バックアップ）の分だけ。1円から1,000円まで（1円単位）
// ・払っても、使える機能は何も変わらない（有利にならない）。お礼は町のキャラたちの「ありがとう」だけ
// ・金額で言葉を変えない（1円でも1,000円でも同じ「ありがとう」）
// ・振込先が見えるのは、ログインした大人（18歳から）だけ。子ども・中高生は「おうちの人に」
// ・振り込んだら「振り込みました」で運営に知らせる → 運営が通帳で確かめる → ハトがお礼を届けて、領収書が出せる

export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 1000;
export const QUICK_AMOUNTS = [100, 300, 500, 1000];
export const MAX_PAYER = 30; // 振込のお名前（カナ）
export const MAX_PENDING = 3; // 確かめ待ちは1人3件まで
export const MAX_ACCOUNT_TEXT = 300; // 振込先の説明
export const MAX_ISSUER = 40; // 領収書の発行者
export const MAX_ADDRESSEE = 40; // 領収書の宛名
export const RECEIPT_PURPOSE = 'ともはね への寄付（応援）として';

// 町のキャラたちからの「ありがとう」（全員から一言ずつ。金額で変えない）
export const THANKS = [
  { by: 'agent-hato', text: 'クルックー！ 町のみんなから「ありがとう」を預かってきたよ。ひとつずつ読んでね。' },
  { by: 'agent-shiba', text: '応援、ほんとうにありがとうっす！ だれも一人にしない町、これからも守るっす！' },
  { by: 'agent-usagi', text: 'ありがとう♪ うれしくて、思わず一曲歌っちゃった〜！' },
  { by: 'agent-yamaneko', text: 'ありがとう。もらった応援は、サーバーやバックアップの運営費にだけ使う。約束する。' },
  { by: 'agent-fukurou', text: 'ほう、ありがたいことですぞ。今夜も安心して語れるよう、しっかり見守りますぞ。' },
  { by: 'agent-tanuki', text: 'ありがとさん。カフェにきたら、ゆっくりしていきなよ。' },
  { by: 'agent-penguin', text: 'ありがとうございますっ！ テーブル、ぴかぴかにみがいておきますね！' },
  { by: 'agent-kitsune', text: 'ありがとうございます。ゲームセンター一同、心からお礼申し上げます。' },
  { by: 'agent-kaeru', text: 'ケロケロ〜！ ありがとう！ 今日はお祭りだケロ！' },
  { by: 'agent-nezumi', text: 'ありがとうございます。図書館の本棚も、ていねいに守っていきますね。' },
  { by: 'agent-mogu', text: '回線、しっかり見張るモグ！ ありがとうモグ！' },
];

// 寄付するときの説明（キャラのひとこと）
export const ASK_LINE = { by: 'agent-shiba', text: '無理をしないで、気持ちだけで十分っす！ 1円からでも、うれしいっす。' };

// 年齢の区分ごとに、できること
export function donateRule(ageGroup) {
  if (ageGroup === 'adult') return { ok: true, reason: null };
  if (ageGroup === 'teen') return { ok: false, reason: '中学生・高校生は、まずおうちの人と話してね。応援してくれるときは、おうちの人のアカウントからお願いするっす。' };
  return { ok: false, reason: '12歳までの人は、寄付はできないっす。その気持ちだけで、とってもうれしいっす！' };
}

// 領収書の番号（年ごとの通し番号）：TH-2026-0001
export const receiptNo = (year, n) => `TH-${year}-${String(n).padStart(4, '0')}`;
