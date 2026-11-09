// ともはね新聞：毎週月曜日に出す号（weekly）と、大きな知らせのときの号外（extra）
// ・新しい号を ISSUES の先頭に足す。date が来るまでは出ない（先に書いておける）
// ・poll（アンケート）は1人1票。結果は数字やグラフで見せず、キャラの座談会でぼんやり伝える（pollTalk）
//   正確な数は運営だけが見る
// ・出た日に、ともはね新聞社が広場にその号のスレッドを立てる（threadText）。plaza があれば、そのキャラが最初に返事をする
//   スレッドは半年で倉庫へ、1年でパソコン → メモリーカードへ（まだ作っていない。計画はメモ）

export const PAPER_NAME = 'ともはね新聞';
export const MAX_VOTE_COMMENT = 100;
export const TALK_MIN_VOTES = 5; // これより少ないうちは、だれの答えか分かりやすいので、座談会で話さない

// 公式アカウント。新聞が出るたびに、広場にスレッドを立てる
export const SHINBUNSHA_ID = 'official-shinbunsha';
export const OFFICIAL_ACCOUNTS = [
  {
    id: SHINBUNSHA_ID, kind: 'official', name: 'ともはね新聞社', handle: 'shinbunsha', emoji: '📰',
    avatar: '/shared/avatars/shinbunsha.svg', color: '#3b332d', roleLabel: '公式',
  },
];

export const AGENT_NAMES = {
  'agent-yamaneko': 'ヤマネコ', 'agent-usagi': 'ウサギ', 'agent-fukurou': 'フクロウ', 'agent-shiba': 'シバ',
  'agent-kame': 'カメ', 'agent-nezumi': 'ネズミ',
};

export const ISSUES = [
  {
    id: '2026-11-09-library',
    kind: 'extra',
    date: '2026-11-09',
    headline: '町に図書館ができました',
    lead: 'ガレージの右に「📚 図書館」がオープン。みんなの小説・漫画を、ジャンル別・年齢別の棚に並べます。',
    articles: [
      {
        by: 'agent-shiba',
        title: '図書館、オープンっす！',
        body: [
          '町の地図の、ガレージの右に図書館が建ったっす！ 上のメニューの「📚 図書館」からも行けるっす。',
          '館長はカメさん、司書はネズミさん。ふたりとも図書館の中にいるっす。',
          '図書館の中は「しずかに」がお約束っす。シバたちも、図書館では「🤫」になるっす。感想はカフェで話すっす！',
          'いまは見本の本が、小説3冊・漫画3冊あるっす。シバが出てくるお話もあるっす……ちょっとはずかしいっす。',
        ],
      },
      {
        by: 'agent-yamaneko',
        title: '本の出し方と「きれいにまとめる」',
        body: [
          '棚の下の「✍️ 作家の机へ」から、小説か漫画を書いて出せる。漫画は画像を入れる。',
          '出すときは「図書館の約束」に同意する。自分の作品であること（二次創作もいい）、年齢の棚が中身に合っていること、感想はカフェで、の3つだ。',
          '「ネズミにきれいにまとめてもらう」にチェックすると、ネズミが見た目をそろえた案、ルビの案、誤字かもしれないところの印を出す。漫画ならページの順番をそろえる。',
          '案を使うかどうかは、書いた本人が決める。お話や文章そのものは変えない。むずかしいときは運営も手伝う。',
        ],
      },
      {
        by: 'agent-usagi',
        title: '挿し絵・表紙を描く人、募集中♪',
        body: [
          '「🎨 募集の掲示板」では、作者さんが「表紙や挿し絵を描いてほしい」と募集を出せるよ。',
          '絵を描く人は、絵とひとことで応募してね。「選ばれたら、名前といっしょに本に載せてもいい」に同意してから出すよ。',
          '作者さんが1枚選ぶと、本に「挿絵1：〇〇さん」って名前が出るの。すてきでしょ♪',
        ],
      },
    ],
    greetings: [
      { by: 'agent-kame', text: '館長のカメじゃ。しーっ……ゆっくり読んでいっておくれ。年齢の棚は、入る前にひとこと確かめるからね。' },
      { by: 'agent-nezumi', text: '（ちいさな声で）司書のネズミです。本をきれいにまとめるお手伝い、がんばります……。' },
    ],
    talk: {
      title: '座談会「図書館で、どんな本を読みたい？」',
      lines: [
        { by: 'agent-kame', text: 'せっかくだから、どんな本が並ぶとうれしいか、話してみようかね。……小さな声でね。' },
        { by: 'agent-usagi', text: '推しのライブに行った日のお話！ 読むと、また行きたくなるやつ♪' },
        { by: 'agent-shiba', text: 'シバは漫画がいいっす！ 4コマなら、すぐ読めるっす！' },
        { by: 'agent-nezumi', text: '（ちいさな声で）わたしは……みなさんが、はじめて書いたお話が読みたいです。' },
        { by: 'agent-kame', text: 'うまく書けなくても大丈夫。ネズミくんと運営が手伝うからね。' },
        { by: 'agent-shiba', text: 'みんなの本、待ってるっす！ ……あっ、しずかにだったっす。' },
      ],
    },
    plaza: { by: 'agent-shiba', text: '号外っす！ 図書館ができたっす！ 感想や「こんな本が読みたい」は、このスレッドで待ってるっす！' },
  },
  {
    id: '2026-11-07-no1',
    kind: 'weekly',
    no: 1,
    date: '2026-11-07',
    headline: 'ともはね、はじまりました',
    lead: '推し活SNS「ともはね」の運営を始めました。創刊号は、ごあいさつ号です。',
    articles: [
      {
        by: 'operator',
        title: '運営からのごあいさつ',
        body: [
          'はじめまして。ともはね は、推しの「好き」を安心して語りあえる町をめざす SNS です。',
          'いまはβ版で、足りないところもたくさんあります。みなさんの声を聞きながら、少しずつ育てていきます。',
          'お金を払うもの（課金）と広告はありません。町にはキャラたちが住んでいて、話しかけたり、いっしょに遊んだりできます。',
          'この新聞は毎週月曜日に出します。大きな知らせがあるときは、号外も出します。どうぞよろしくお願いします。',
        ],
        sign: 'ともはね 運営',
      },
      {
        by: 'agent-yamaneko',
        title: 'はじめての人への案内スライド',
        body: [
          'はじめて登録した人に、使い方をスライドで案内する。案内役は確率で決まり、確率は毎週月曜日に変わる。',
          'めったに出ない「エンマ大王フクロウ」もいる。もう登録している人は、アカウントのページの「🪶 ともはね の案内をもう一度見る」から見られる。',
        ],
      },
    ],
    greetings: [
      { by: 'agent-yamaneko', text: '山の上のサーバー小屋にいる。仕組みのことなら、なんでも聞いてくれ。' },
      { by: 'agent-usagi', text: '花畑のステージで歌ってるよ♪ みんなの推し語り、いっぱい聞かせてね！' },
      { by: 'agent-fukurou', text: '森の見張り台から、夜も見守っております。安心して「好き」を語ってくだされ。ほう。' },
      { by: 'agent-shiba', text: '広場のとなりの赤い屋根の家にいるっす！ はじめての人には、一番に会いに行くっす！' },
    ],
    talk: {
      title: '座談会「ともはね を、どんな町にしたい？」',
      lines: [
        { by: 'agent-yamaneko', text: '創刊号だから、どんな町にしたいか話しておこう。' },
        { by: 'agent-usagi', text: '好きなものを好きって言うと、楽しくなる町がいいな♪' },
        { by: 'agent-fukurou', text: 'ほう。そのためには、だれかを傷つける言葉が少ないことが大切ですな。' },
        { by: 'agent-shiba', text: 'それと、だれも一人ぼっちにならない町っす！' },
        { by: 'agent-yamaneko', text: '仕組みは、みんなの声で決める。数の多さだけで決めず、少ない声もちゃんと聞く。' },
        { by: 'agent-usagi', text: 'だから、下のアンケートにも答えてね♪' },
      ],
    },
    poll: {
      id: 'guide-chara',
      question: 'みんなが描いたオリジナルのキャラも、案内役として出られるようにしたら、どう思いますか？',
      notes: [
        '描いたキャラを応募 → 運営が見てから出す',
        'オリジナルのキャラだけ（二次創作・実在の人の写真はなし）',
        '出たときは「〇〇さんが作ったキャラです」と名前を出す',
        '子どもは、おうちの人とつながっているときだけ応募できる',
      ],
      choices: [
        { id: 'draw', label: '✏️ 描いて応募してみたい', talk: '描いて応募してみたい' },
        { id: 'see', label: '👀 描かないけど、見てみたい', talk: '見てみたい' },
        { id: 'no', label: '🙅 いまのキャラだけでいい', talk: 'いまのキャラだけでいい' },
        { id: 'unsure', label: '🤔 まだわからない', talk: 'まだわからない' },
      ],
    },
    plaza: { by: 'agent-shiba', text: '創刊号が出たっす！ シバも記者として、ここでみんなの感想を待ってるっす！' },
  },
];

// ---- 号の名前・出たかどうか ----
export const issueLabel = (issue) => (issue.kind === 'extra' ? '号外' : `第${issue.no}号`);

// 日本時間の「きょう」（YYYY-MM-DD）
export function todayJst(date = new Date()) {
  return new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
// もう出た号（新しい順）
export const publishedIssues = (date = new Date()) => ISSUES.filter((i) => i.date <= todayJst(date));
export const latestIssueId = (date = new Date()) => publishedIssues(date)[0]?.id ?? null;
export const findPoll = (pollId, date = new Date()) =>
  publishedIssues(date).map((i) => i.poll).find((p) => p && p.id === pollId) ?? null;

// 広場に立てるスレッドの最初の投稿
export function threadText(issue) {
  const head = issue.kind === 'extra' ? `📰【号外】${PAPER_NAME}` : `📰 ${PAPER_NAME} ${issueLabel(issue)}`;
  return `${head}「${issue.headline}」が出ました。上の「📰 新聞」から読めます。感想や質問は、このスレッドへどうぞ。記者のキャラたちも読んでいます。`;
}

// ---- 座談会：アンケートの結果を、数字を使わずに話す ----
const LEVEL_LINES = {
  'agent-usagi': {
    many: (x) => `「${x}」って人、けっこういるみたい♪`,
    some: (x) => `「${x}」って声も、ちゃんと届いてるよ♪`,
    few: (x) => `「${x}」って人もいたよ。聞かせてくれて、うれしいな♪`,
  },
  'agent-yamaneko': {
    many: (x) => `「${x}」が目立つな。`,
    some: (x) => `「${x}」という意見も、それなりにある。`,
    few: (x) => `少しだが「${x}」という声もあった。忘れずに考える。`,
  },
  'agent-fukurou': {
    many: (x) => `ほう、「${x}」という方が多いようですな。`,
    some: (x) => `「${x}」という方も、おられますぞ。`,
    few: (x) => `「${x}」という声も、ひとつひとつ大切に聞きますぞ。`,
  },
  'agent-shiba': {
    many: (x) => `「${x}」って人、いっぱいいるっす！`,
    some: (x) => `「${x}」って人もいるっす！`,
    few: (x) => `「${x}」って人もいたっす！ ちゃんと聞いてるっす！`,
  },
};
const SPEAKERS = Object.keys(LEVEL_LINES);

function level(share) {
  if (share >= 0.4) return 'many';
  if (share >= 0.15) return 'some';
  return 'few';
}

// counts：{ choiceId: 人数 }。返すのはセリフだけ（数字は入れない）
// ・答えが少ないうちは「まだ少ない」で止める
// ・1人でも答えた選択肢は、必ずだれかが話す。話す順はアンケートの並びのまま（多い順にしない）
export function pollTalk(poll, counts) {
  const total = poll.choices.reduce((a, c) => a + (counts[c.id] ?? 0), 0);
  if (total < TALK_MIN_VOTES) {
    return [
      { by: 'agent-usagi', text: 'まだ声が少ないから、もう少し待ってみよう♪' },
      { by: 'agent-fukurou', text: 'ほう。数が少ないうちは、どなたの答えか分かってしまうかもしれませぬ。集まってから話しましょうぞ。' },
    ];
  }
  let seed = 0;
  for (const ch of poll.id) seed = (seed * 31 + ch.codePointAt(0)) % 997;
  const lines = [{ by: 'agent-yamaneko', text: '集まった声を、みんなで話そう。' }];
  // 同じキャラが続けて話さないように、前の人とちがうキャラにする
  let turn = seed;
  for (const c of poll.choices.filter((x) => (counts[x.id] ?? 0) > 0)) {
    let by = SPEAKERS[turn++ % SPEAKERS.length];
    if (by === lines.at(-1).by) by = SPEAKERS[turn++ % SPEAKERS.length];
    lines.push({ by, text: LEVEL_LINES[by][level(counts[c.id] / total)](c.talk ?? c.label) });
  }
  lines.push(lines.at(-1).by === 'agent-shiba'
    ? { by: 'agent-fukurou', text: 'どの声も、大切に聞きますぞ。まだの方も、いつでも答えてくだされ。' }
    : { by: 'agent-shiba', text: 'どの声も大事っす！ まだの人も、いつでも答えてほしいっす！' });
  return lines;
}
