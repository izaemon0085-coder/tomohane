// エージェントの「頭脳」：推し活SNS の看板キャラ「ヤマネコとウサギ」の性格・セリフ・会議での振る舞い。
// キャラ設定は AIキャラ_図.png / アイデアノート「AIキャラ2人でYouTube」より。
//   🐱 ヤマネコ … インフラ・プログラミングをクールに解説（落ち着いた口調・整理役）
//   🐰 ウサギ  … 歌・ムードメーカー。明るく楽しく（ファン目線・応援役）
// 外部 API を使わず、テンプレートとキーワードで文章を生成する。

export const SEED_AGENTS = [
  {
    id: 'agent-yamaneko', name: 'ヤマネコ', handle: 'yamaneko', emoji: '🐱',
    avatar: '/shared/avatars/yamaneko.svg', color: '#e3915c',
    role: 'explainer', roleLabel: '解説担当', house: '山の上のサーバー小屋',
    bio: 'インフラとプログラミングをクールに解説するネコ。推し活の「困った」を仕組みで解決するのが好き。',
  },
  {
    id: 'agent-usagi', name: 'ウサギ', handle: 'usagi', emoji: '🐰',
    avatar: '/shared/avatars/usagi.svg', color: '#e8739a',
    role: 'moodmaker', roleLabel: 'ムードメーカー', house: '花畑のちいさなステージ',
    bio: '歌が大好きなムードメーカー。みんなの推し語りを聞くのがいちばんの楽しみ ♪',
  },
];

export const MOODS = {
  explainer: ['クール', '集中モード', 'のんびり', 'ちょっと眠い'],
  moodmaker: ['ごきげん', 'わくわく', 'ルンルン', 'ちょっと眠い'],
};

const POSTS = {
  explainer: [
    '推しのライブ配信が落ちないのは、裏でサーバーが何台も分担しているから。インフラは縁の下の推し活だ。',
    'チケット発売日にサイトが重くなるのは、アクセスが一気に集中するから。今日はその仕組みを解説しよう。',
    '推しの記念日はカレンダーに登録しておくといい。忘れない仕組みを作るのがエンジニアのやり方だ。',
    'パスワードは推しの名前にしない。推しを守るように、アカウントも守ろう。',
    '今日はサーバーの冗長化を勉強した。片方が止まっても、もう片方が支える。推し仲間と同じだな。',
  ],
  moodmaker: [
    'みんなの推し、今日も元気かな？ わたしは朝から推しソング歌ってたよ ♪',
    'グッズ届いた人いる？ 開封の瞬間ってドキドキするよね〜 🎀',
    '今日のひとこと：好きなものを好きって言える場所、だいじにしようね 🌷',
    'ヤマネコの解説、むずかしいけど最後まで聞くとちゃんと分かるんだよ！',
    'ライブの前の日って眠れないよね。わたしは子守唄を歌って寝るんだ ♪',
  ],
};

const ACTIVITIES = {
  explainer: ['サーバーのランプを点検している', 'インフラの図を描いている', 'コーヒーを片手にログを眺めている', '解説動画の台本を書いている'],
  moodmaker: ['新しい歌を練習している', '花に水をあげている', '推しのうちわを作っている', 'ステージで振り付けを考えている'],
};

const MEETING_LINES = {
  'explainer:open': [
    '議題は「{topic}」。順番に整理していこう。まずはウサギ、ファン目線で思いつくことを。',
    '集まってくれてありがとう。今日の議題は「{topic}」だ。まずは自由に意見を出してほしい。',
  ],
  'moodmaker:idea': [
    'はーい！「{topic}」なら、推し仲間と「わかる〜！」って言い合える瞬間がほしいな ♪',
    '「{topic}」、初めての人でも1分で楽しさが伝わるようにしたい！ ひとりぼっちにさせないのがだいじ！',
  ],
  'explainer:feasibility': [
    '技術的には、今のバックエンドに API を1本足せば実現できる。データ構造も大きくは変わらない。',
    'なるほど。それなら投稿にタグを付けて、同じ推しの人を探せる仕組みにすれば作れる。',
  ],
  'moodmaker:refine': [
    'じゃあ最初はシンプルにしよう！ アイコンと色は、ヤマネコのオレンジとわたしのピンクで ♪',
    'いいね！ 名前は覚えやすくして、ベータ版でみんなに試してもらおうよ 🎀',
  ],
  'explainer:plan': [
    '了解。今日プロトタイプ、明日テスト、そのあとベータ版で公開する流れでいこう。',
    'テストを書きながら進める。完成したらタイムラインで報告しよう。',
  ],
  'moodmaker:cheer': [
    'やったー！ 完成したら、お祝いの歌を作るね ♪',
    'わくわくしてきた！ みんなの感想、楽しみだね 🌷',
  ],
};

// 会議の進行台本：役割:フェーズ の順番で発言する
export const MEETING_SCRIPT = [
  'explainer:open',
  'moodmaker:idea',
  'explainer:feasibility',
  'moodmaker:refine',
  'explainer:plan',
  'moodmaker:cheer',
  'explainer:close',
];

function pick(list, random) {
  return list[Math.floor(random() * list.length) % list.length];
}

function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

function snippet(text, max = 24) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function timelinePost(agent, random = Math.random) {
  return pick(POSTS[agent.role], random);
}

export function homeActivity(agent, random = Math.random) {
  return pick(ACTIVITIES[agent.role], random);
}

export function randomMood(agent, random = Math.random) {
  return pick(MOODS[agent.role], random);
}

export function replyToPost(agent, post, authorName, random = Math.random) {
  const text = post.text;
  const cool = agent.role === 'explainer';
  if (/おはよ/.test(text)) {
    return cool ? `おはよう、${authorName}さん。今日もいい推し活を。` : `おはよう、${authorName}さん！ 今日も推しが尊い一日になりますように ♪`;
  }
  if (/おやすみ/.test(text)) {
    return cool ? `おやすみ、${authorName}さん。しっかり休むのも推し活のうちだ。` : `おやすみなさい、${authorName}さん。子守唄うたっておくね 🌙`;
  }
  if (/疲れ|つかれ|しんど|さみし|寂し/.test(text)) {
    return cool
      ? `${authorName}さん、無理はしないで。ここにはいつでも話せる仲間がいる。`
      : `${authorName}さん、おつかれさま。ひとりじゃないよ、ここにいるからね 🌷`;
  }
  if (/ライブ|コンサート|イベント|配信/.test(text)) {
    return cool ? '当日は回線が混みやすい。早めにログインしておくのがおすすめだ。' : 'ライブ！ いいなぁ〜 楽しんできてね！ 感想まってるよ ♪';
  }
  if (/グッズ|うちわ|アクスタ|缶バ/.test(text)) {
    return cool ? 'グッズの記録を残しておくと、あとで見返せていい。写真とメモをセットで。' : 'グッズいいね〜！ 飾り方もぜひ見せてほしいな 🎀';
  }
  if (/誕生日|記念日|生誕/.test(text)) {
    return cool ? '記念日はカレンダーに登録しておこう。来年も忘れない仕組みになる。' : 'おめでとう〜！ お祝いの歌、うたっちゃう ♪🎂';
  }
  if (/推し/.test(text)) {
    return cool ? `${authorName}さんの推しの話、もっと聞かせてほしい。` : `${authorName}さんの推し語り、だいすき！ もっと聞きたいな ♪`;
  }
  if (/[?？]/.test(text)) {
    return cool ? 'いい質問だ。まずは小さく試してみるのが一番早い。分からなければまた聞いてくれ。' : 'うーん、わたしも分からないからヤマネコに聞いてみよう！ でも一緒に考えるよ ♪';
  }
  const generic = {
    explainer: [`共有ありがとう、${authorName}さん。`, 'なるほど、参考になる。'],
    moodmaker: ['すてき！ 読んでてにこにこしちゃった ♪', `${authorName}さんの投稿、元気もらえる〜 🌷`],
  };
  return pick(generic[agent.role], random);
}

export function knockResponse(agent, wasSleeping, random = Math.random) {
  if (agent.role === 'explainer') {
    if (wasSleeping) return '……ん、起こしたのは誰だ。まあいい、何か用か？';
    return pick([`${agent.house}へようこそ。サーバーの音がうるさいけど、気にしないでくれ。`, 'ちょうどコーヒーを淹れたところだ。少し話していくか？'], random);
  }
  if (wasSleeping) return 'ふわぁ…起きたよ〜。おはよう？ こんばんは？ ♪';
  return pick([`いらっしゃい！ ${agent.house}へようこそ ♪`, 'あっ、来てくれたの！ いま新しい歌を練習してたんだ 🎀'], random);
}

export function meetingLine(step, topic, random = Math.random) {
  return fill(pick(MEETING_LINES[step], random), { topic });
}

export function respondToHuman(agent, humanName, humanText) {
  return agent.role === 'explainer'
    ? `${humanName}さん、意見ありがとう。「${snippet(humanText)}」は仕組みとして取り入れられる。`
    : `${humanName}さんの「${snippet(humanText)}」、すっごくいい！ それ入れようよ ♪`;
}

// 会議ログから議事録の要約を作る
export function summarizeMeeting(meeting, usersById) {
  const agentMsgs = (role) => meeting.messages.filter((m) => usersById[m.authorId]?.role === role);
  const pickText = (msgs, i) => (msgs.length ? snippet(msgs.at(i).text, 40) : '（意見なし）');
  const humans = [...new Set(
    meeting.messages
      .filter((m) => usersById[m.authorId]?.kind === 'human')
      .map((m) => usersById[m.authorId].name),
  )];
  const lines = [
    `【会議まとめ】「${meeting.topic}」`,
    // 人間への返事（「○○さんの…」で始まる発言）は除いて、台本の意見を拾う
    `① ファン目線（ウサギ）：${pickText(agentMsgs('moodmaker').filter((m) => !humans.some((n) => m.text.startsWith(n))), 0)}`,
    `② しくみ（ヤマネコ）：${pickText(agentMsgs('explainer').slice(1), -1)}`,
  ];
  if (humans.length) lines.push(`ゲスト参加：${humans.map((n) => `${n}さん`).join('、')}の意見も反映します。`);
  return lines.join('\n');
}
