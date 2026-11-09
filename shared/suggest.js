// 📮 目安箱（ユーザーの声）。新聞社の前に置いて、記者のキャラが受け取る
// ・だれが書いたかは、運営にも見せない（年齢の区分だけ）
// ・運営が「新聞でとりあげる」ときは、要約と答えを運営が書く（書いた人の言い回しで、本人と分からないように）
// ・答えは新聞の「目安箱から」の座談会で。書いた本人にだけ「あなたの声がのっています」と出る

export const MAX_SUGGESTION = 200;
export const MAX_PER_DAY = 3;
export const MAX_SUMMARY = 60;
export const MAX_ANSWER = 150;
export const TALK_SHOW = 6; // 座談会に出す数（新しい順）

export const SUGGEST_TOPICS = [
  { id: 'cafe', label: '☕ カフェ' },
  { id: 'arcade', label: '🎮 ゲームセンター' },
  { id: 'chara', label: '🐾 キャラ' },
  { id: 'safety', label: '🛡️ 安全（通報・ブロックなど）' },
  { id: 'news', label: '📰 新聞' },
  { id: 'privacy', label: '🔒 個人情報（見せて・直して・消して など）', named: true },
  { id: 'other', label: '💬 そのほか' },
];
export const topicLabel = (id) => SUGGEST_TOPICS.find((t) => t.id === id)?.label ?? '💬 そのほか';

// 記者（受け取るキャラ）。書いた日で順番に入れかわる
const REPORTERS = ['agent-shiba', 'agent-usagi', 'agent-yamaneko', 'agent-fukurou'];
const THANKS = {
  'agent-shiba': '受け取ったっす！ ちゃんと運営に届けるっす。新聞で答えるかもしれないっす！',
  'agent-usagi': 'ありがとう♪ 大事に運営に届けるね！ 新聞にのったら教えるよ〜',
  'agent-yamaneko': '受け取った。だれが書いたかは、運営にも伝えない。新聞で答えることがある。',
  'agent-fukurou': 'ほう、たしかに受け取りましたぞ。運営に届けますぞ。答えは新聞で。',
};
export function reporterFor(date = new Date()) {
  const by = REPORTERS[Math.floor(date.getTime() / 86400000) % REPORTERS.length];
  return { by, text: THANKS[by] };
}

// 座談会：記者が要約を読み、ほかのキャラが運営の答えを伝える
const READ = {
  'agent-shiba': (t, s) => `${t}について、こんな声が届いたっす：「${s}」`,
  'agent-usagi': (t, s) => `${t}のことで、こんな声がきてるよ♪「${s}」`,
  'agent-yamaneko': (t, s) => `${t}について、こういう声があった。「${s}」`,
  'agent-fukurou': (t, s) => `ほう、${t}について、こんな声ですぞ。「${s}」`,
};
const ANSWER = {
  'agent-shiba': (a) => `運営に聞いてきたっす！「${a}」だそうっす！`,
  'agent-usagi': (a) => `運営さんの答えはね…「${a}」だって♪`,
  'agent-yamaneko': (a) => `運営の答えだ。「${a}」`,
  'agent-fukurou': (a) => `運営からの答えですぞ。「${a}」`,
};
export function suggestionTalk(item, i) {
  const reader = REPORTERS[i % REPORTERS.length];
  const answerer = REPORTERS[(i + 1) % REPORTERS.length];
  return [
    { by: reader, text: READ[reader](topicLabel(item.topic).replace(/^\S+\s/, ''), item.summary) },
    { by: answerer, text: ANSWER[answerer](item.answer) },
  ];
}
