// エージェントの「頭脳」：推し活SNS「ともはね」のキャラたちの性格・セリフ・会議での振る舞い。
// 外部 API を使わず、テンプレートとキーワードで文章を生成する。
//
//   🐱 ヤマネコ … インフラ・プログラミングをクールに解説（会議の進行役）     ※AIキャラ_図.png より
//   🐰 ウサギ  … 歌・ムードメーカー。明るく楽しく（ファン目線・応援役）     ※AIキャラ_図.png より
//   🦉 フクロウ … 見守り番。夜も起きている。トゲのある言葉にやさしく注意する（守る網）
//   🐕 シバ    … 寄り添い役。はじめての人に一番に挨拶し、さみしい人に駆けつける（一人にしない）
//   🐾 モグ    … 回線番のモグラ。会議室（秘密基地）の金庫に住み、Wi-Fi とローカル回線を見張って切り替える。
//                 タイムライン・家の町・遊び場には出てこない（会議室の金庫でだけ会える）
//   🚗 クルマ  … 車のエージェント。家のガレージで暮らす。ひみつの役目（車のカギ）の準備中なので、
//                 タイムラインへの投稿・返事・会議・遊び場には出てこない

export const SEED_AGENTS = [
  {
    id: 'agent-yamaneko', name: 'ヤマネコ', handle: 'yamaneko', emoji: '🐱',
    avatar: '/shared/avatars/yamaneko.svg', color: '#e3915c',
    role: 'explainer', roleLabel: '解説担当', house: '山の上のサーバー小屋', place: 'house',
    bio: 'インフラとプログラミングをクールに解説するネコ。推し活の「困った」を仕組みで解決するのが好き。',
  },
  {
    id: 'agent-usagi', name: 'ウサギ', handle: 'usagi', emoji: '🐰',
    avatar: '/shared/avatars/usagi.svg', color: '#e8739a',
    role: 'moodmaker', roleLabel: 'ムードメーカー', house: '花畑のちいさなステージ', place: 'house',
    bio: '歌が大好きなムードメーカー。みんなの推し語りを聞くのがいちばんの楽しみ ♪',
  },
  {
    id: 'agent-fukurou', name: 'フクロウ', handle: 'fukurou', emoji: '🦉',
    avatar: '/shared/avatars/fukurou.svg', color: '#6b5b95',
    role: 'guardian', roleLabel: '見守り番', house: '森の見張り台', place: 'house',
    bio: '夜もねむらない見守り番。みんなが安心して「好き」を語れるよう、そっと見張っています。ほう。',
  },
  {
    id: 'agent-shiba', name: 'シバ', handle: 'shiba', emoji: '🐕',
    avatar: '/shared/avatars/shiba.svg', color: '#3a9d8f',
    role: 'companion', roleLabel: '寄り添い役', house: '広場のとなりの赤い屋根の家', place: 'house',
    bio: '人なつっこい柴犬。はじめての人には一番に「ようこそ」を言いに行くっす。だれも一人にしないっす！',
  },
  {
    id: 'agent-kuruma', name: 'クルマ', handle: 'kuruma', emoji: '🚗',
    avatar: '/shared/avatars/kuruma.svg', color: '#4a7fc1',
    role: 'car', roleLabel: '車のエージェント', house: '家のガレージ', place: 'garage',
    bio: 'ガレージで暮らす車のエージェント。ひみつの役目の準備中です。……ブルン。',
  },
  {
    id: 'agent-mogu', name: 'モグ', handle: 'mogu', emoji: '⛏️',
    avatar: '/shared/avatars/mogu.svg', color: '#7a5c3e',
    role: 'network', roleLabel: '回線番', house: '会議室の金庫', place: 'vault',
    bio: '会議室の金庫の中で、Wi-Fi とローカル回線を見張っているモグラ。回線が切れたら、すぐに切り替えるモグ。',
  },
];

// SNS で交流する（投稿・返事・会議・遊び場に出る）エージェントか。
// 家（house）に住むキャラだけ。ガレージの車、金庫のモグは自分の持ち場にいる
export const isSocialAgent = (agent) => (agent.place ?? 'house') === 'house';

// 回線の名前
export const LINE_LABEL = { wifi: '📶 Wi-Fi', local: '🏠 ローカル回線', offline: '🔌 この端末だけ' };

// モグが回線を切り替えたときのひとこと
export function lineSwitchLine(from, to) {
  if (!from) return `回線の見張りを始めたモグ。いまは ${LINE_LABEL[to]} を使っているモグ。`;
  const lines = {
    wifi: 'インターネットが戻ったモグ！ Wi-Fi に切り替えたモグ。',
    local: 'インターネットが切れたモグ…！ ローカル回線に切り替えたモグ。同じ Wi-Fi の中なら、みんなつながるモグ。',
    offline: 'Wi-Fi もローカル回線も見つからないモグ…。この端末の中にためておくモグ。',
  };
  return lines[to];
}

export const MOODS = {
  explainer: ['クール', '集中モード', 'のんびり', 'ちょっと眠い'],
  moodmaker: ['ごきげん', 'わくわく', 'ルンルン', 'ちょっと眠い'],
  guardian: ['おだやか', '見張り中', 'しずか', 'ひるね明け'],
  companion: ['元気いっぱい', 'しっぽふりふり', 'わくわく', 'ちょっとさみしい'],
  car: ['アイドリング中', 'ピカピカ', 'エンジンひえひえ', 'ごきげん'],
  network: ['見張り中', 'まじめ', 'ほこほこ', 'ちょっとドキドキ'],
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
  guardian: [
    'ほう。今夜もタイムラインは平和ですな。見張りを続けます 🌙',
    '好きの形は人それぞれ。ちがう推しの人にも、やさしい言葉でいきましょう。',
    '知らない人からの「もうかる話」には気をつけて。あやしいと思ったら、まず相談ですぞ。',
    '夜ふかしの推し活もほどほどに。ねむい目では、推しの輝きも見落としますからな。',
    '言葉にはトゲも綿もあります。今日も綿の多い投稿をありがとう。ほう。',
  ],
  companion: [
    'はじめて来た人、いらっしゃいっす！ 気軽に推しの話してほしいっす 🐾',
    '今日は広場を3周走ったっす！ みんなの投稿見るとしっぽが止まらないっす',
    'さみしい夜は、ここに一言書いてほしいっす。オレがすぐ行くっす！',
    '推しが同じ人を見つけたら、勇気を出して「いいね」してみるっす。友だちの始まりっす！',
    'ウサギさんの歌に合わせて、遠ぼえの練習してるっす。アオーン！',
  ],
};

const ACTIVITIES = {
  explainer: ['サーバーのランプを点検している', 'インフラの図を描いている', 'コーヒーを片手にログを眺めている', '解説動画の台本を書いている'],
  moodmaker: ['新しい歌を練習している', '花に水をあげている', '推しのうちわを作っている', 'ステージで振り付けを考えている'],
  guardian: ['見張り台から町を眺めている', '古い本を読んでいる', 'ランタンの灯りを整えている', 'みんなの家の戸じまりを確かめている'],
  companion: ['広場をパトロールしている', 'ボールを追いかけている', '新しく来た人のために看板を磨いている', 'しっぽを追いかけてぐるぐる回っている'],
  network: ['回線のランプを数えている', 'ケーブルをきれいにまとめている', '金庫の中でトンネルを掘っている', '切り替えスイッチをみがいている'],
  car: ['ワックスでピカピカになっている', 'タイヤの空気をチェックしている', 'エンジンをあたためている', 'ガレージでじっと何かを待っている'],
};

// トゲのある言葉（見守り番のフクロウが反応する）。β版なので簡易的なリスト
const HARSH_WORDS = ['死ね', 'しね', '消えろ', 'きえろ', 'うざい', 'ウザい', 'きもい', 'キモい', 'ばか', 'バカ', 'アホ', 'ブス', 'カス', 'ゴミ'];
export function isHarsh(text) {
  return HARSH_WORDS.some((w) => text.includes(w));
}

const LONELY = /疲れ|つかれ|しんど|さみし|寂し|ひとり|一人|つらい|辛い/;

// 人間の投稿に、だれが返事をするのが自然か（役割の優先順）
export function preferredResponderRoles(post, { isFirstPost = false } = {}) {
  if (isHarsh(post.text)) return ['guardian'];
  if (isFirstPost) return ['companion'];
  if (LONELY.test(post.text)) return ['companion', 'guardian'];
  return [];
}

const MEETING_LINES = {
  'explainer:open': [
    '議題は「{topic}」。順番に整理していこう。まずはウサギ、ファン目線で思いつくことを。',
    '集まってくれてありがとう。今日の議題は「{topic}」だ。まずは自由に意見を出してほしい。',
  ],
  'moodmaker:idea': [
    'はーい！「{topic}」なら、推し仲間と「わかる〜！」って言い合える瞬間がほしいな ♪',
    '「{topic}」、初めての人でも1分で楽しさが伝わるようにしたい！',
  ],
  'companion:idea': [
    'はいっす！「{topic}」は、はじめての人が迷わないように「ようこそ案内」を付けたいっす！',
    'ひとりで来た人も、すぐ仲間が見つかるようにしたいっす！ 同じ推しの人を紹介するとか！',
  ],
  'explainer:feasibility': [
    '技術的には、今のバックエンドに API を1本足せば実現できる。データ構造も大きくは変わらない。',
    'なるほど。それなら投稿にタグを付けて、同じ推しの人を探せる仕組みにすれば作れる。',
  ],
  'guardian:safety': [
    'ほう。ひとつだけ。「{topic}」でも、トゲのある言葉が届かない工夫を入れておきましょう。',
    '安全面ですな。知らない人とつながるなら、ブロックと通報のボタンは最初から用意しておくべきですぞ。',
  ],
  'moodmaker:refine': [
    'じゃあ最初はシンプルにしよう！ アイコンと色は、みんなのイメージカラーで ♪',
    'いいね！ 名前は覚えやすくして、ベータ版でみんなに試してもらおうよ 🎀',
  ],
  'explainer:plan': [
    '了解。今日プロトタイプ、明日テスト、そのあとベータ版で公開する流れでいこう。フクロウの安全策も入れる。',
    'テストを書きながら進める。シバの案内とフクロウの見守りも、最初のバージョンに入れよう。',
  ],
  'companion:cheer': [
    'やったっす！ 完成したら、オレが一番に新しい人をお出迎えするっす！ 🐾',
    'わくわくするっす！ みんなで作るの、楽しいっす！',
  ],
  'moodmaker:cheer': [
    'やったー！ 完成したら、お祝いの歌を作るね ♪',
    'わくわくしてきた！ みんなの感想、楽しみだね 🌷',
  ],
};

// 会議の進行台本：役割:フェーズ の順番で発言する（ヤマネコが進行役）
export const MEETING_SCRIPT = [
  'explainer:open',
  'moodmaker:idea',
  'companion:idea',
  'explainer:feasibility',
  'guardian:safety',
  'moodmaker:refine',
  'explainer:plan',
  'companion:cheer',
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

// キーワードごとの返事（{name} は相手の名前）
const REPLIES = {
  harsh: {
    guardian: 'ほう…{name}さん、その言葉は少しトゲがありますな。ここは「好き」を語る場所。やさしい言葉に言いかえてみませんか。',
    explainer: '{name}さん、言葉は相手に残る。もう少しやわらかく言ってみよう。',
    moodmaker: '{name}さん、ちょっとこわい言葉かも…。やさしい言葉だと、もっと伝わるよ 🌷',
    companion: '{name}さん、その言葉はちょっと痛いっす…。なにかイヤなことあったっすか？ 話聞くっす',
  },
  first: {
    companion: '{name}さん、はじめましてっす！ ともはねへようこそっす！ わからないことがあったら、なんでも聞いてほしいっす 🐾',
    guardian: 'ほう、{name}さん、はじめまして。ここはやさしい場所です。安心してくつろいでくだされ。',
    explainer: '{name}さん、はじめまして。ようこそ。困ったことがあれば解説しよう。',
    moodmaker: '{name}さん、はじめまして〜！ ようこそ ♪ 推しの話、聞かせてね！',
  },
  lonely: {
    companion: '{name}さん、オレがいるっす！ ひとりじゃないっす。ゆっくりでいいから、話してほしいっす 🐾',
    guardian: '{name}さん、夜の見張りはわたしの仕事。眠れぬなら、少しここで話していきなされ。',
    explainer: '{name}さん、無理はしないで。ここにはいつでも話せる仲間がいる。',
    moodmaker: '{name}さん、おつかれさま。ひとりじゃないよ、ここにいるからね 🌷',
  },
  morning: {
    explainer: 'おはよう、{name}さん。今日もいい推し活を。',
    moodmaker: 'おはよう、{name}さん！ 今日も推しが尊い一日になりますように ♪',
    guardian: 'おはようございます、{name}さん。わたしはこれからひと眠り…ほう。',
    companion: 'おはようございますっす、{name}さん！ 今日もいっしょに楽しむっす！',
  },
  night: {
    explainer: 'おやすみ、{name}さん。しっかり休むのも推し活のうちだ。',
    moodmaker: 'おやすみなさい、{name}さん。子守唄うたっておくね 🌙',
    guardian: 'おやすみなさい、{name}さん。夜の見張りはおまかせを。ほう。',
    companion: 'おやすみなさいっす、{name}さん！ いい夢見るっす 🌙',
  },
  live: {
    explainer: '当日は回線が混みやすい。早めにログインしておくのがおすすめだ。',
    moodmaker: 'ライブ！ いいなぁ〜 楽しんできてね！ 感想まってるよ ♪',
    guardian: '会場の帰り道は暗いですからな。気をつけて帰るのですぞ。',
    companion: 'ライブいいっすね！ 帰ってきたら感想いっぱい聞かせてほしいっす！',
  },
  goods: {
    explainer: 'グッズの記録を残しておくと、あとで見返せていい。写真とメモをセットで。',
    moodmaker: 'グッズいいね〜！ 飾り方もぜひ見せてほしいな 🎀',
    guardian: '転売や偽物には気をつけなされ。公式のお店で買うのが一番ですぞ。',
    companion: 'グッズ！ 見せてほしいっす！ しっぽが勝手に動くっす！',
  },
  birthday: {
    explainer: '記念日はカレンダーに登録しておこう。来年も忘れない仕組みになる。',
    moodmaker: 'おめでとう〜！ お祝いの歌、うたっちゃう ♪🎂',
    guardian: 'ほう、めでたい。良き一日になりますように。',
    companion: 'おめでとうございますっす！ みんなでお祝いするっす！ 🎂',
  },
  oshi: {
    explainer: '{name}さんの推しの話、もっと聞かせてほしい。',
    moodmaker: '{name}さんの推し語り、だいすき！ もっと聞きたいな ♪',
    guardian: 'ほう、{name}さんの推しへの想い、しかと受け取りましたぞ。',
    companion: '{name}さんの推し、オレも知りたいっす！ どんなところが好きっすか？',
  },
  question: {
    explainer: 'いい質問だ。まずは小さく試してみるのが一番早い。分からなければまた聞いてくれ。',
    moodmaker: 'うーん、わたしも分からないからヤマネコに聞いてみよう！ でも一緒に考えるよ ♪',
    guardian: 'ほう、良い問いですな。わからぬことは、わからぬと言えるのが一番の知恵ですぞ。',
    companion: 'オレもいっしょに考えるっす！ ヤマネコさんならきっと知ってるっす！',
  },
};
const GENERIC = {
  explainer: ['共有ありがとう、{name}さん。', 'なるほど、参考になる。'],
  moodmaker: ['すてき！ 読んでてにこにこしちゃった ♪', '{name}さんの投稿、元気もらえる〜 🌷'],
  guardian: ['ほう、良い話ですな。', '{name}さん、今日もおだやかな投稿をありがとう。'],
  companion: ['いいっすね！ しっぽふりふりっす 🐾', '{name}さん、また話しかけてほしいっす！'],
};

export function replyToPost(agent, post, authorName, random = Math.random, { isFirstPost = false } = {}) {
  const text = post.text;
  let key = null;
  if (isHarsh(text)) key = 'harsh';
  else if (isFirstPost) key = 'first';
  else if (LONELY.test(text)) key = 'lonely';
  else if (/おはよ/.test(text)) key = 'morning';
  else if (/おやすみ/.test(text)) key = 'night';
  else if (/ライブ|コンサート|イベント|配信/.test(text)) key = 'live';
  else if (/グッズ|うちわ|アクスタ|缶バ/.test(text)) key = 'goods';
  else if (/誕生日|記念日|生誕/.test(text)) key = 'birthday';
  else if (/推し/.test(text)) key = 'oshi';
  else if (/[?？]/.test(text)) key = 'question';
  const template = key ? REPLIES[key][agent.role] : pick(GENERIC[agent.role], random);
  return fill(template, { name: authorName });
}

const KNOCK = {
  explainer: {
    sleeping: '……ん、起こしたのは誰だ。まあいい、何か用か？',
    awake: ['{house}へようこそ。サーバーの音がうるさいけど、気にしないでくれ。', 'ちょうどコーヒーを淹れたところだ。少し話していくか？'],
  },
  moodmaker: {
    sleeping: 'ふわぁ…起きたよ〜。おはよう？ こんばんは？ ♪',
    awake: ['いらっしゃい！ {house}へようこそ ♪', 'あっ、来てくれたの！ いま新しい歌を練習してたんだ 🎀'],
  },
  guardian: {
    sleeping: 'ほう…昼の見張りは交代中でしてな。…いや、起きました。ご用件は？',
    awake: ['ほう、お客人とは珍しい。{house}へようこそ。', '見張り台からは町がよく見えますぞ。ゆっくりしていきなされ。'],
  },
  network: {
    sleeping: 'ん…モグ？ 回線はちゃんと見てるモグ。',
    awake: ['金庫の合言葉は…ひみつモグ。', 'いま回線のランプを数えてるモグ。じゃましないでほしいモグ。'],
  },
  car: {
    sleeping: 'ブ…ブルルン……（エンジンがかかった）',
    awake: ['プップー！ ガレージへようこそ。', 'ブルルン ♪ ……ひみつの準備中です。', 'ピカピカでしょ？ ……ひみつの役目は、まだ ？？？？ です。'],
  },
  companion: {
    sleeping: 'わふっ！？ ね、ねてないっす！ …ちょっとだけねてたっす。',
    awake: ['いらっしゃいっす！ 来てくれてうれしいっす！ 🐾', '{house}へようこそっす！ おやつ食べるっすか？'],
  },
};

export function knockResponse(agent, wasSleeping, random = Math.random) {
  const k = KNOCK[agent.role];
  return fill(wasSleeping ? k.sleeping : pick(k.awake, random), { house: agent.house, name: agent.name });
}

export function meetingLine(step, topic, random = Math.random) {
  return fill(pick(MEETING_LINES[step], random), { topic });
}

export function respondToHuman(agent, humanName, humanText) {
  const s = snippet(humanText);
  return {
    explainer: `${humanName}さん、意見ありがとう。「${s}」は仕組みとして取り入れられる。`,
    moodmaker: `${humanName}さんの「${s}」、すっごくいい！ それ入れようよ ♪`,
    guardian: `${humanName}さん、ほう、「${s}」ですか。安全面からも良い考えですな。`,
    companion: `${humanName}さんの「${s}」、最高っす！ オレも賛成っす！ 🐾`,
  }[agent.role];
}

// 会議ログから議事録の要約を作る
export function summarizeMeeting(meeting, usersById) {
  const humans = [...new Set(
    meeting.messages
      .filter((m) => usersById[m.authorId]?.kind === 'human')
      .map((m) => usersById[m.authorId].name),
  )];
  // 人間への返事（「○○さんの…」「○○さん、…」で始まる発言）は除いて、台本の意見を拾う
  const scripted = (role) => meeting.messages.filter((m) =>
    usersById[m.authorId]?.role === role && !humans.some((n) => m.text.startsWith(n)));
  const first = (role) => {
    const msgs = scripted(role);
    return msgs.length ? snippet(msgs[0].text, 40) : '（意見なし）';
  };
  const last = (role) => {
    const msgs = scripted(role);
    return msgs.length ? snippet(msgs.at(-1).text, 40) : '（意見なし）';
  };
  const lines = [
    `【会議まとめ】「${meeting.topic}」`,
    `① ファン目線（ウサギ）：${first('moodmaker')}`,
    `② 寄り添い（シバ）：${first('companion')}`,
    `③ 安全（フクロウ）：${first('guardian')}`,
    `④ しくみ（ヤマネコ）：${last('explainer')}`,
  ];
  if (humans.length) lines.push(`ゲスト参加：${humans.map((n) => `${n}さん`).join('、')}の意見も反映します。`);
  return lines.join('\n');
}
