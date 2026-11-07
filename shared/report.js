// 通報の決まり（サーバーと画面で同じものを使う）。セリフや理由は、あとでユーザーの声で直していく
// ・通報した人の名前は、だれにも出さない（通報された人にも、ほかの人にも）
// ・通報された人には、本人の画面にだけキャラが声をかける。軽いものはシバかウサギがやさしく、
//   重いものはフクロウが段階で変身する（どれも本物ではないと書く）
// ・止める・警察に知らせる、を決めるのは人（運営）。AI は決めない

// 通報の理由。level：light（軽い）/ heavy（重い）。hold：運営が見るまで、ほかの人に見えなくする
export const REPORT_REASONS = [
  { id: 'rude', label: 'いやな言い方', level: 'light' },
  { id: 'pester', label: 'しつこい', level: 'light' },
  { id: 'repeat', label: 'くり返しのいやがらせ', level: 'heavy' },
  { id: 'expose', label: 'さらし（名前・住所・写真など）', level: 'heavy', hold: true },
  { id: 'crime', label: '犯罪・おどし', level: 'heavy', hold: true },
];
export const findReason = (id) => REPORT_REASONS.find((r) => r.id === id) ?? null;

// 軽い通報でも、ちがう人からこの数だけ来たら「くり返し」（お巡りさん）にする
export const REPEAT_REPORTERS = 3;

// 本人に声をかけるキャラ。gentle はシバとウサギが交代で
export const STAGES = {
  gentle: [
    {
      agentId: 'agent-shiba', avatar: '/shared/avatars/shiba.svg', name: 'シバ',
      text: 'この投稿で、いやな気持ちになった人がいるみたいっす。言い方を直すか、消すか、あやまるか、えらんでほしいっす。シバはずっと味方っす。',
    },
    {
      agentId: 'agent-usagi', avatar: '/shared/avatars/usagi.svg', name: 'ウサギ',
      text: 'ねえねえ、この投稿で、ちょっとチクッとした人がいたみたい！ 直す？ 消す？ あやまる？ どれをえらんでも、ウサギは応援するよ！',
    },
  ],
  police: {
    agentId: 'agent-fukurou', avatar: '/shared/avatars/fukurou.svg', name: '👮 お巡りさんフクロウ',
    note: '本物のお巡りさんではありません',
    text: 'ほう、同じような声がいくつも届いておる。くり返すと、運営が投稿を止めることがあるぞ。いまなら、直す・消す・あやまる、がえらべる。',
  },
  lawyer: {
    agentId: 'agent-fukurou', avatar: '/shared/avatars/fukurou.svg', name: '⚖ 弁護士フクロウ',
    note: '本物の弁護士ではありません',
    text: '人の名前・住所・写真などをのせると、その人を深く傷つけることがある。運営が見るまで、この投稿はほかの人に見えなくしておる。消すこともできるぞ。',
  },
  enma: {
    agentId: 'agent-fukurou', avatar: '/shared/avatars/enma-fukurou.svg', name: '👹 エンマ大王もどき',
    note: '本物のエンマ大王ではありません',
    text: '犯罪やおどしにつながる言葉は、ともはねでは許されぬ。運営が見るまで、この投稿はほかの人に見えなくしておる。',
  },
  stopped: {
    agentId: 'agent-fukurou', avatar: '/shared/avatars/fukurou.svg', name: 'フクロウ',
    text: '運営が見て、この投稿を止めた。ほかの人には見えない。わからないことがあれば、運営にたずねてくだされ。',
  },
};

// 通報の理由（いくつか）と、ちがう人の数から、本人に出す段階を決める
export function stageOf(reasonIds, reporterCount) {
  if (reasonIds.includes('crime')) return 'enma';
  if (reasonIds.includes('expose')) return 'lawyer';
  if (reasonIds.includes('repeat') || reporterCount >= REPEAT_REPORTERS) return 'police';
  return 'gentle';
}

// あやまるときの、えらべることば（自分のことばも 50 文字まで書ける）
export const APOLOGY_CHOICES = [
  'ごめんなさい。言い方がよくなかったです',
  'いやな気持ちにさせてしまって、ごめんなさい',
  'これから気をつけます',
];
export const MAX_APOLOGY = 50;
