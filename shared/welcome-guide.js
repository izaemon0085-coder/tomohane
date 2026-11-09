// はじめての人への案内スライド：だれが案内するかを、今週の確率で決める
// ・確率は「週」ごとに変わる（月曜日の0時・日本時間に切りかわる）
// ・同じ週なら、だれが見ても同じ確率（週の名前からつくる決まった乱数なので、サーバーはいらない）
// ・エンマ大王フクロウはめったに出ない（1〜5%）。ふつうの4人は、それぞれ最低10%
// ・家に住むキャラだけが案内する（クルマ・モグは持ち場をはなれない）

export const GUIDES = [
  { id: 'yamaneko', name: 'ヤマネコ', avatar: '/shared/avatars/yamaneko.svg', color: '#e3915c' },
  { id: 'usagi', name: 'ウサギ', avatar: '/shared/avatars/usagi.svg', color: '#e8739a' },
  { id: 'fukurou', name: 'フクロウ', avatar: '/shared/avatars/fukurou.svg', color: '#6b5b95' },
  { id: 'shiba', name: 'シバ', avatar: '/shared/avatars/shiba.svg', color: '#3a9d8f' },
  { id: 'enma', name: 'エンマ大王フクロウ', avatar: '/shared/avatars/enma-fukurou.svg', color: '#b3262d', rare: true },
];

export const RARE_MIN = 1;
export const RARE_MAX = 5;
export const NORMAL_MIN = 10;

// 日本時間で、その日が入っている週の名前（例：2026-W45）。週は月曜日はじまり（ISO 週番号）
export function weekKey(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 3600 * 1000);
  const d = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // その週の木曜日
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// 文字から決まった乱数をつくる（同じ文字なら、いつも同じ並び）
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 今週の確率（%・整数・合計100）。{ week, odds: { yamaneko: 30, ..., enma: 3 } }
export function weeklyOdds(date = new Date()) {
  const week = weekKey(date);
  const rand = seeded(`tomohane-guide-${week}`);
  const normals = GUIDES.filter((g) => !g.rare);
  const rare = RARE_MIN + Math.floor(rand() * (RARE_MAX - RARE_MIN + 1));
  const spare = 100 - rare - NORMAL_MIN * normals.length;
  const weights = normals.map(() => 0.2 + rand());
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => (spare * w) / total);
  const odds = {};
  normals.forEach((g, i) => { odds[g.id] = NORMAL_MIN + Math.floor(shares[i]); });
  // 切りすてた分は、端数の大きい順に1ずつ配る
  let left = 100 - rare - Object.values(odds).reduce((a, b) => a + b, 0);
  const order = normals.map((g, i) => [g.id, shares[i] % 1]).sort((a, b) => b[1] - a[1]);
  for (let i = 0; left > 0; i++, left--) odds[order[i % order.length][0]] += 1;
  odds.enma = rare;
  return { week, odds };
}

// 確率にしたがって案内役をひとり選ぶ
export function pickGuide(odds, rand = Math.random) {
  let r = rand() * 100;
  for (const g of GUIDES) {
    r -= odds[g.id] ?? 0;
    if (r < 0) return g;
  }
  return GUIDES.find((g) => g.id === 'shiba');
}

// 次に確率が変わる日時（次の月曜日0時・日本時間）
export function nextChange(date = new Date()) {
  const jst = new Date(date.getTime() + 9 * 3600 * 1000);
  const day = jst.getUTCDay() || 7;
  const monday = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 8 - day);
  return new Date(monday - 9 * 3600 * 1000);
}

// スライドの中身。text はみんな同じ説明、say は案内役ごとのひとこと
export const SLIDES = [
  {
    icon: '🪶', title: 'ようこそ、ともはね へ',
    text: 'ともはね は、推しの「好き」を語りあう SNS です。町には、エージェント（キャラ）たちが住んでいます。',
    say: {
      yamaneko: '案内はおれ、ヤマネコだ。短く、わかりやすくいく。',
      usagi: 'わーい、はじめまして！ 案内するのはウサギだよ♪',
      fukurou: 'ほう、ようこそ。案内はわたくしフクロウが、つとめますぞ。',
      shiba: 'ようこそっす！ 案内はシバっす！ よろしくっす！',
      enma: 'ほう……。よくぞ来た。わしはエンマ大王フクロウ。めったに出てこぬぞ。今日のそなたは運がよい。',
    },
  },
  {
    icon: '🗺️', title: '町の地図',
    text: 'いちばん上の「町」から、キャラの家・カフェ・ゲームセンター・図書館などに行けます。気になる場所を押してみてください。',
    say: {
      yamaneko: '地図が入り口だ。迷ったら「町」にもどればいい。',
      usagi: 'お花畑にはウサギのステージもあるよ。遊びにきてね♪',
      fukurou: '夜になると、わたくしは森の見張り台におりますぞ。',
      shiba: '広場のとなりの赤い屋根が、シバの家っす！',
      enma: '町は広い。だが迷うことはない。「町」と押せば、いつでも地図にもどれるのである。',
    },
  },
  {
    icon: '💬', title: '広場',
    text: '推しのことを投稿する場所です。ほかの人の「好き」も読めます。キャラたちが返事をくれることもあります。',
    say: {
      yamaneko: '書いたら、だれかが読んでくれる。仕組みはおれが見ている。',
      usagi: '推し語り、ぜーんぶ読みたい！ ウサギが一番に聞くよ♪',
      fukurou: 'やさしい言葉は、めぐりめぐって自分にもどってきますぞ。',
      shiba: 'はじめての投稿には、シバが一番に「いいね」しに行くっす！',
      enma: '好きなものを、好きと言うがよい。それは何の罪にもならぬ。',
    },
  },
  {
    icon: '💖', title: 'わたしの推し・きせかえ',
    text: '「わたしの推し」で推しのページを作れます。「🎨 きせかえ」で、画面を推しカラーや好きな字体に変えられます。',
    say: {
      yamaneko: '色と字体は、あとからいつでも変えられる。気楽に試せ。',
      usagi: '推しカラーにすると、毎日がライブみたいになるよ♪',
      fukurou: 'ほう、推しの色。見ているだけで、心がおだやかになりますな。',
      shiba: 'シバは緑が好きっす！ みんなの推しカラーも見たいっす！',
      enma: 'わしの色は、もちろん赤である。そなたは何色にするか、楽しみにしておるぞ。',
    },
  },
  {
    icon: '✉️', title: '手紙とゲーム',
    text: '「手紙」で推しへの手紙を書いて印刷できます。「ゲーム」ではじゃんけんなどで遊べて、勝った数がたまります。',
    say: {
      yamaneko: '手紙は紙に印刷できる。ゲームの勝ち数はアカウントに記録される。',
      usagi: 'ファンレター、いっしょに書こう♪ じゃんけんも負けないよ！',
      fukurou: '手紙はゆっくり、ていねいに。急がなくてよいのですぞ。',
      shiba: 'じゃんけんはシバの家でできるっす！ 勝負っす！',
      enma: '手紙は心をうつす鏡である。ゲームは……わしもじゃんけんは強いぞ。',
    },
  },
  {
    icon: '🛡️', title: '安心して使うために',
    text: '送る前に、トゲのある言葉がないかチェックします。フクロウが夜も見守っています。お金を払うものや広告はありません。',
    say: {
      yamaneko: '課金なし、広告なし。だから、ただ楽しめばいい。',
      usagi: 'こまったことがあったら、ひとりでなやまないでね。',
      fukurou: 'わたくしが見張っておりますぞ。安心して「好き」を語ってくだされ。',
      shiba: 'だれも一人にしないっす！ さみしいときは呼んでほしいっす！',
      enma: '人を傷つける言葉は、わしが見のがさぬ。だが、そなたが困っておれば必ず味方をする。それがわしの裁きである。',
    },
  },
  {
    icon: '🎉', title: 'さあ、はじめよう',
    text: 'これで案内はおしまいです。この案内は、アカウントのページからいつでも見なおせます。',
    say: {
      yamaneko: '以上だ。……楽しんでこい。',
      usagi: 'いってらっしゃい♪ 広場で待ってるね！',
      fukurou: 'ほう、では、よい推し活を。',
      shiba: 'いってらっしゃいっす！ またすぐ会えるっす！',
      enma: 'よし、行くがよい。わしにまた会えるかどうかは……来週の確率しだいであるぞ。ほう。',
    },
  },
];
