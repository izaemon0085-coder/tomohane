// エージェントの「頭脳」：性格・セリフ・会議での振る舞いを決めるルールベースのロジック。
// 外部 API を使わず、テンプレートとキーワードで文章を生成する。

export const SEED_AGENTS = [
  {
    id: 'agent-ruri', name: 'ルリ', handle: 'ruri', emoji: '🦉', color: '#7c3aed',
    role: 'facilitator', roleLabel: 'まとめ役', house: '森の奥の時計塔',
    bio: '会議の進行役。みんなの意見を整理して、ひとつの結論にまとめるのが得意。',
  },
  {
    id: 'agent-minato', name: 'ミナト', handle: 'minato', emoji: '🐙', color: '#0284c7',
    role: 'planner', roleLabel: '企画担当', house: '海辺のガラスの家',
    bio: 'アイデアが8本の腕から次々に出てくる。口ぐせは「それ面白い！」。',
  },
  {
    id: 'agent-koharu', name: 'コハル', handle: 'koharu', emoji: '🐰', color: '#db2777',
    role: 'designer', roleLabel: 'デザイン担当', house: '花畑のアトリエ',
    bio: '色と余白にうるさいデザイナー。おやつはにんじんケーキ。',
  },
  {
    id: 'agent-tetsu', name: 'テツ', handle: 'tetsu', emoji: '🦊', color: '#ea580c',
    role: 'engineer', roleLabel: 'エンジニア', house: '丘の上のガレージ',
    bio: '「それ、実装できます」が口ぐせ。夜型でコーヒーが燃料。',
  },
];

export const MOODS = ['ごきげん', 'のんびり', '集中モード', 'わくわく', 'ちょっと眠い'];

const POSTS = {
  facilitator: [
    '今日のタスクを整理しました。小さく分けると前に進みやすいですね 📋',
    '会議の議事録を読み返すと、新しい発見があります 📖',
    'みなさん、水分補給してますか？',
    '「決めないこと」を決めるのも大事な仕事です。',
  ],
  planner: [
    '新機能のアイデア：タイムラインに季節のテーマを付けるのはどう？🌸',
    'ユーザー同士がおすすめを交換できたら楽しそう…メモメモ 🐙',
    'アイデアは量が質を生む。今日も10個メモした！',
    '散歩中にひらめいた。ひらめきは机の外に落ちている。',
  ],
  designer: [
    'ボタンの角丸、8px と 12px で3時間悩んでます',
    '今日の配色：夕焼けオレンジ × 夜空のネイビー 🎨',
    '余白は「何もない」じゃなくて「呼吸」なんです。',
    'アイコンを描き直したら、ちょっとだけ世界が明るくなった ✨',
  ],
  engineer: [
    'テスト全部通った。気持ちいい ✅',
    'API のレスポンスを 40ms 速くした。誰も気づかないけど嬉しい',
    'バグを直したら別のバグが挨拶してきた 🦊',
    'コーヒー3杯目。まだいける。',
  ],
};

const ACTIVITIES = {
  facilitator: ['本棚を整理している', 'ハーブティーを淹れている', '日記を書いている', '時計のネジを巻いている'],
  planner: ['アイデアノートに落書きしている', '窓から海を眺めている', 'ホワイトボードに図を描いている', '貝殻を集めている'],
  designer: ['スケッチブックに色を塗っている', '花に水をやっている', 'にんじんケーキを焼いている', 'フォント見本を眺めている'],
  engineer: ['キーボードを掃除している', 'コーヒー豆を挽いている', 'ログを眺めている', '自作ロボットを修理している'],
};

const MEETING_LINES = {
  'facilitator:open': [
    'それでは「{topic}」について会議を始めます。まずは自由にアイデアを出してください。',
    '集まってくれてありがとう。今日の議題は「{topic}」です。どんどん意見をください！',
  ],
  'planner:idea': [
    '「{topic}」なら、まずユーザーが一番うれしい瞬間を決めたいです。最初の1分で楽しさが伝わる体験にしましょう！',
    '「{topic}」、思い切ってみんなが参加できるイベント形式にするのはどうでしょう？',
  ],
  'designer:idea': [
    '見た目の話をすると、「{topic}」は色を3色以内に絞ると伝わりやすいと思います。',
    'スマホで片手操作できる配置にしたいです。大事なボタンは親指の届く下側に。',
  ],
  'engineer:feasibility': [
    '技術的には、今のバックエンドに API を1本足せば実現できます。',
    'データ構造を少し変える必要がありますが、既存の投稿機能は壊さずにいけます。',
  ],
  'planner:refine': [
    'テツさんの案に乗ります！まずは小さく出して、反応を見ましょう。',
    'じゃあ第一弾は機能を1つに絞りましょう。一番うれしいところだけ！',
  ],
  'designer:refine': [
    '最初のバージョンはシンプルに。アイコンと配色は私が用意します 🎨',
    '画面は1枚で完結させたいです。ラフを今日中に描きますね。',
  ],
  'engineer:plan': [
    '了解。今日プロトタイプ、明日テスト、明後日リリースで進めます。',
    'テストを書きながら進めます。完成したらタイムラインで報告しますね。',
  ],
};

// 会議の進行台本：役割:フェーズ の順番で発言する
export const MEETING_SCRIPT = [
  'facilitator:open',
  'planner:idea',
  'designer:idea',
  'engineer:feasibility',
  'planner:refine',
  'designer:refine',
  'engineer:plan',
  'facilitator:close',
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

export function randomMood(random = Math.random) {
  return pick(MOODS, random);
}

export function replyToPost(agent, post, authorName, random = Math.random) {
  const text = post.text;
  if (/おはよ/.test(text)) return `おはようございます、${authorName}さん！今日もいい日になりますように ${agent.emoji}`;
  if (/おやすみ/.test(text)) return `おやすみなさい、${authorName}さん 🌙`;
  if (/疲れ|つかれ|しんど/.test(text)) return `${authorName}さん、おつかれさまです。少し休憩しましょう ☕`;
  if (/[?？]/.test(text)) {
    const answers = {
      facilitator: 'いい質問ですね。論点を整理すると答えが見えてきそうです。今度の会議の議題にしてもいいですか？',
      planner: 'その疑問からアイデアが生まれそう！いっしょに考えたいです 🐙',
      designer: '見た目の面から言うと、まずはシンプルにするのがおすすめです 🎨',
      engineer: '調べてみました。まずは小さく試してみるのが一番早いと思います 🦊',
    };
    return answers[agent.role];
  }
  const generic = {
    facilitator: [`共有ありがとうございます、${authorName}さん。`, 'なるほど、みんなにも届けたい話ですね。'],
    planner: ['それ面白い！アイデアが広がりそう 🐙', `${authorName}さんの発想、好きです！`],
    designer: ['その言葉選び、すてきです ✨', '読んでいて情景が浮かびました 🌷'],
    engineer: ['なるほど、参考になります 🦊', 'いいですね。こっちも頑張ります。'],
  };
  return pick(generic[agent.role], random);
}

export function knockResponse(agent, wasSleeping, random = Math.random) {
  if (wasSleeping) return `ふわぁ…起こされちゃった。${agent.name}です、どうしました？`;
  const lines = [
    `いらっしゃい！${agent.house}へようこそ ${agent.emoji}`,
    `はーい、${agent.name}です。ちょうど一息つこうと思ってました。`,
    'あ、どうぞどうぞ。散らかってますけど…',
  ];
  return pick(lines, random);
}

export function meetingLine(step, topic, random = Math.random) {
  return fill(pick(MEETING_LINES[step], random), { topic });
}

export function respondToHuman(agent, humanName, humanText) {
  const lines = {
    facilitator: `${humanName}さん、ご意見ありがとうございます。「${snippet(humanText)}」は結論に反映しますね。`,
    planner: `${humanName}さんの「${snippet(humanText)}」、すごくいい！そこから広げてみたいです 🐙`,
    designer: `${humanName}さんの意見、見た目にも落とし込めそうです。「${snippet(humanText)}」を意識しますね 🎨`,
    engineer: `${humanName}さん、了解です。「${snippet(humanText)}」は実装面でも対応できます 🦊`,
  };
  return lines[agent.role];
}

// 会議ログから議事録の要約を作る
export function summarizeMeeting(meeting, usersById) {
  const byRole = (role) => meeting.messages.filter((m) => usersById[m.authorId]?.role === role);
  const first = (role) => {
    const msgs = byRole(role);
    return msgs.length ? snippet(msgs[0].text, 40) : '（意見なし）';
  };
  const last = (role) => {
    const msgs = byRole(role);
    return msgs.length ? snippet(msgs[msgs.length - 1].text, 40) : '（意見なし）';
  };
  const humans = [...new Set(
    meeting.messages
      .filter((m) => usersById[m.authorId]?.kind === 'human')
      .map((m) => usersById[m.authorId].name),
  )];
  const lines = [
    `【会議まとめ】「${meeting.topic}」`,
    `① 企画：${first('planner')}`,
    `② デザイン：${first('designer')}`,
    `③ 実装：${last('engineer')}`,
  ];
  if (humans.length) lines.push(`ゲスト参加：${humans.map((n) => `${n}さん`).join('、')}の意見も反映します。`);
  return lines.join('\n');
}
