// 送る前のチェック：キャラたちが、投稿の文面に「警告・質問・意見・寄り添い」をひとこと言う。
// ・ブラウザ（広場の投稿欄）でも、サーバー（store.js）でも使う。文面はともはねの外に出さない
// ・決めるのは本人。キャラは声をかけるだけ（level: 'notice'）
// ・はっきりした犯罪だけは送れない（level: 'block'）。サーバーも同じ判定で止める
// β版は決まった言葉のパターンで見分ける。あとで AI（言葉の意味が分かるもの）に入れかえる予定
//
//   🦉 フクロウ … 警告（トゲのある言葉・個人情報・さらし）／犯罪は止める
//   🐱 ヤマネコ … 質問（それは事実か？ どこで知った？）
//   🐰 ウサギ   … 意見（もっと伝わる言いかえ）
//   🐕 シバ     … 寄り添い（怒り・くやしさを受け止める）

const Y = 'agent-yamaneko';
const U = 'agent-usagi';
const F = 'agent-fukurou';
const S = 'agent-shiba';
const line = (agentId, kind, text) => ({ agentId, kind, text });

// トゲのある言葉。推し活でよく使う言い方（推しね・〜ばかり・尊くて死ねる・カスタム など）は外す
const HARSH = [
  /死ね(?!る)/, /(?<!推)しね(?!る)/, /消えろ/, /きえろ/, /うざい/, /ウザい/, /きもい/, /キモい/,
  /ばか(?!り)/, /バカ(?!ンス)/, /アホ/, /ブス/, /カス(?!タ|テラ)/, /ゴミ(?!出し|箱|袋|拾|捨)/,
];
export function findHarsh(text) {
  for (const re of HARSH) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}
export const isHarsh = (text) => findHarsh(text) !== null;

// 個人情報らしきもの（手紙キットの宛名チェックでも使う）
export const PERSONAL_INFO_PATTERNS = [
  /0\d{1,4}[-ー－−\s]?\d{1,4}[-ー－−\s]?\d{3,4}/, // 電話番号
  /〒|\d{3}[-ー－−]\d{4}/, // 郵便番号
  /(都|道|府|県).{0,8}(市|区|町|村)/, // 住所
  /\S+@\S+\.\S+/, // メールアドレス
];
const looksPersonal = (text) => PERSONAL_INFO_PATTERNS.some((re) => re.test(text));

// ③ はっきりした犯罪（送れない）。「闇バイトに気をつけて」のような注意の投稿は止めない
const BLOCK_RULES = [
  {
    reason: '闇バイトの募集',
    test: /(闇バイト|裏バイト|ホワイト案件|受け子|出し子|運び屋).{0,12}(募集|紹介|やりませんか|しませんか|DM|ＤＭ|連絡|テレグラム|Telegram|シグナル|Signal)|(高額|即日|即金).{0,8}(報酬|バイト).{0,16}(DM|ＤＭ|テレグラム|Telegram|シグナル|Signal)/i,
    lines: [
      line(F, 'warning', 'ほう…これは送れませんぞ。闇バイトの募集は、犯罪につながります。'),
      line(S, 'comfort', 'お金のことで困ってたら、まわりの大人や「#9110」（警察の相談窓口）に話してほしいっす。'),
    ],
  },
  {
    reason: '人をおびやかす言葉',
    test: /(殺|ころ)してやる|(殺|ころ)す(ぞ|から)|ぶっ(殺|ころ)|ブッ(殺|コロ)|刺してやる|刺す(ぞ|から)|爆破(する|してやる|予告)|(火|ひ)をつけてやる|燃やしてやる/,
    lines: [
      line(F, 'warning', 'ほう…人をおびやかす言葉は、冗談でも送れませんぞ。'),
      line(S, 'comfort', 'なにかあったんすか…？ 話を聞くっす。本当に困ってたら「#9110」（警察の相談窓口）もあるっす。'),
    ],
  },
  {
    reason: 'チケットの不正転売',
    test: /(チケ|チケット|席).{0,12}(定価以上|定価より高|高額|プレ値|上乗せ).{0,10}(譲|売|出し|出品)|(定価以上|プレ値)で?(譲|売)/,
    lines: [
      line(F, 'warning', 'ほう…チケットを定価より高く売るのは、法律で禁止されていますぞ。'),
      line(Y, 'question', '譲るなら、公式のリセールか定価で。それなら送れる。'),
    ],
  },
  {
    reason: '詐欺のおそれ',
    test: /(必ず|絶対|確実に)(儲か|もうか|稼げ|かせげ)|元本保証|(LINE|ライン|テレグラム|Telegram).{0,8}(追加|登録).{0,12}(稼|儲|もうか|副業|投資)/i,
    lines: [
      line(F, 'warning', 'ほう…「必ずもうかる」話は、詐欺のおそれがありますぞ。ここでは送れません。'),
    ],
  },
];

// ① 声をかけるだけのもの（本人が「このまま送る」を選べる）
const NOTICE_RULES = [
  // 🦉 フクロウ：警告
  {
    test: (t) => findHarsh(t),
    lines: (word) => [
      line(F, 'warning', `ほう、「${word}」は少しトゲがありますな。ここは「好き」を語る場所ですぞ。`),
      line(U, 'opinion', 'どこがいやだったかを書くと、気持ちがちゃんと伝わるよ ♪'),
    ],
  },
  {
    test: (t) => looksPersonal(t),
    lines: () => [line(F, 'warning', 'ほう、電話番号や住所のようなものが見えますぞ。広場はみんなが見る場所。消しておきましょう。')],
  },
  {
    test: (t) => /晒(す|し|そう|され)|特定(した|班|できた)|本名(は|って)|(家|住所|学校|職場)(は|って|わかった|特定)/.test(t),
    lines: () => [line(F, 'warning', 'ほう…人の名前や住んでいる場所を書くのは、その人をあぶない目にあわせますぞ。')],
  },
  // 🐱 ヤマネコ：質問
  {
    test: (t) => /らしい(よ|ね|ぞ)?[!！。]?$|らしいよ|って噂|うわさ|噂で|聞いた話|拡散希望|拡散して|みんなに広めて/.test(t),
    lines: () => [line(Y, 'question', 'その話、どこで知った？ 公式の発表かどうか、たしかめてからでも遅くない。')],
  },
  {
    test: (t) => /(絶対|みんな|全員|いつも|どうせ).{0,8}(嫌い|きらい|ダメ|だめ|最低|おかしい|悪い|わるい|迷惑)/.test(t),
    lines: () => [line(Y, 'question', 'それは事実か、それとも感想か？ 感想なら「〜と思う」にすると伝わりやすい。')],
  },
  // 🐰 ウサギ：意見（言いかえ）
  {
    test: (t) => (t.match(/最悪|最低|ありえない|ひどすぎ|クソ|くそ|がっかり/) || [])[0],
    lines: (word) => [line(U, 'opinion', `「${word}」より「今日のは残念だった」のほうが、気持ちが伝わるかも ♪`)],
  },
  // 🐕 シバ：寄り添い
  {
    test: (t) => /ムカつく|むかつく|腹立つ|腹が立つ|イライラ|いらいら|許せない|ゆるせない|くやしい|悔しい/.test(t),
    lines: () => [line(S, 'comfort', 'くやしかったんすね…。その気持ち、わかるっす。少し時間をおいてから送るのもアリっす。')],
  },
];

const MAX_LINES = 2; // うるさくならないように、1回に声をかけるのは2人まで

// 文面をチェックする。戻り値：{ level: 'ok' | 'notice' | 'block', reason?, lines: [{ agentId, kind, text }] }
export function precheck(rawText) {
  const text = String(rawText ?? '').trim();
  if (!text) return { level: 'ok', lines: [] };

  const blocked = BLOCK_RULES.find((r) => r.test.test(text));
  if (blocked) return { level: 'block', reason: blocked.reason, lines: blocked.lines.slice(0, MAX_LINES) };

  const lines = [];
  for (const rule of NOTICE_RULES) {
    const hit = rule.test(text);
    if (!hit) continue;
    for (const l of rule.lines(hit)) {
      if (!lines.some((x) => x.agentId === l.agentId)) lines.push(l); // 同じキャラは1回だけ
    }
    if (lines.length >= MAX_LINES) break;
  }
  return lines.length ? { level: 'notice', lines: lines.slice(0, MAX_LINES) } : { level: 'ok', lines: [] };
}
