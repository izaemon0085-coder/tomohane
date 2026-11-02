// キャラの遊び場：ヤマネコ・ウサギ・フクロウ・シバが画面の下を歩き回って遊ぶ。
// ・歩く／休む／ジャンプする／近くにいると一緒に遊ぶ
// ・タイムラインに投稿すると、吹き出しでその内容をしゃべる
// ・クリックすると反応して声を出す（【仮】読み上げ機能）
// ・寝ているときはその場でお昼寝、会議中（秘密基地にいる）は画面からいなくなる
import { api, onServerEvents } from '/shared/api.js';
import { speak } from '/shared/speech.js';

const LINES = {
  'agent-yamaneko': {
    idle: ['……日向ぼっこ中だ', 'ふむ、いい天気だ', '遊んでいるわけじゃない。巡回だ', 'サーバーの音が恋しい', 'ウサギ、走ると転ぶぞ'],
    play: ['やれやれ…少しだけだぞ', 'つかまらないぞ', '……楽しくなんかないぞ'],
    click: ['なんだ？ 撫でても何も出ないぞ', '……ゴロゴロ。いや、今のは聞かなかったことに', '用があるなら投稿で言ってくれ'],
  },
  'agent-usagi': {
    idle: ['るんるん ♪', 'ぴょーん！', 'ラララ〜 ♪', 'みんなの推し、なにかな？', 'おなかすいた〜'],
    play: ['ヤマネコ〜 あそぼ！', 'つかまえた〜！', 'おにごっこしよ ♪'],
    click: ['えへへ、くすぐったい〜 ♪', 'わっ！ びっくりした〜', 'いっしょに歌う？ ラララ ♪'],
  },
  'agent-fukurou': {
    idle: ['ほう…', '今日も町は平和ですな', '首は270度まわりますぞ', '見張り、見張り…', 'ほう、良い風だ'],
    play: ['ほう、若いのは元気ですな', 'では、少しだけ', 'わたしは見守り役ですぞ…ほう'],
    click: ['ほう、何かご用かな？', 'わたしを見つけるとは、なかなかの目ですな', 'ほっほう。くすぐったいですぞ'],
  },
  'agent-shiba': {
    idle: ['パトロール中っす！', 'わふっ！', 'しっぽが止まらないっす', 'だれか来ないかなーっす', 'ボールどこいったっす？'],
    play: ['いっしょに走るっす！', 'まてまてーっす！', 'あそぶっす！ あそぶっす！'],
    click: ['なでてくれるっすか！？ うれしいっす！', 'わんっ！ 呼んだっすか？', 'おやつっすか！？'],
  },
};
// 寝ているときにクリックしたとき・会議（秘密基地）から帰ってきたときのセリフ
const SLEEP_TALK = {
  'agent-yamaneko': '……zzz（起きる気はなさそうだ）',
  'agent-usagi': 'むにゃ… あと5分〜',
  'agent-fukurou': 'ほう…zzz…（昼は寝る番のようだ）',
  'agent-shiba': 'わふ…ボール…zzz',
};
const BACK_HOME = {
  'agent-yamaneko': '……戻った',
  'agent-usagi': 'ただいま〜 ♪',
  'agent-fukurou': 'ほう、ただいま戻りました',
  'agent-shiba': 'ただいまっす！',
};

const SPEED = { 'agent-yamaneko': 45, 'agent-usagi': 75, 'agent-fukurou': 30, 'agent-shiba': 95 }; // px/秒
const HIDE_KEY = 'agent-sns:playground-hidden';
const SIZE_KEY = 'agent-sns:playground-size';
// キャラの大きさ（px）。スマホなど狭い画面では 0.75 倍にする
const SIZES = [
  { key: 's', label: '小', px: 44 },
  { key: 'm', label: '中', px: 68 },
  { key: 'l', label: '大', px: 96 },
  { key: 'xl', label: '特大', px: 128 },
];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const now = () => performance.now();

function readHidden() {
  try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
}
function saveHidden(v) {
  try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch { /* 保存できなくても続行 */ }
}

const stage = document.createElement('div');
stage.className = 'playground';
stage.setAttribute('aria-label', 'キャラの遊び場');

const controls = document.createElement('div');
controls.className = 'playground-controls';
const sizeGroup = document.createElement('div');
sizeGroup.className = 'pg-sizes';
sizeGroup.setAttribute('role', 'group');
sizeGroup.setAttribute('aria-label', 'キャラの大きさ');
sizeGroup.innerHTML = SIZES.map((s) =>
  `<button type="button" data-size="${s.key}" aria-pressed="false" title="キャラの大きさ：${s.label}">${s.label}</button>`).join('');
const toggle = document.createElement('button');
toggle.type = 'button';
toggle.className = 'playground-toggle';
controls.append(sizeGroup, toggle);
document.body.append(stage, controls);

let sizeKey = (() => {
  try { return localStorage.getItem(SIZE_KEY) || 'm'; } catch { return 'm'; }
})();
if (!SIZES.some((s) => s.key === sizeKey)) sizeKey = 'm';

// 大きさに合わせて、遊び場の帯の高さも変える
function applySize() {
  const px = size();
  document.documentElement.style.setProperty('--pg-size', `${px}px`);
  document.documentElement.style.setProperty('--pg-height', `${px + 52}px`);
  for (const btn of sizeGroup.querySelectorAll('[data-size]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.size === sizeKey));
  }
}
sizeGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-size]');
  if (!btn) return;
  sizeKey = btn.dataset.size;
  try { localStorage.setItem(SIZE_KEY, sizeKey); } catch { /* 保存できなくても続行 */ }
  applySize();
});
window.addEventListener('resize', applySize);

let hidden = readHidden();
function applyHidden() {
  stage.hidden = hidden;
  document.body.classList.toggle('has-playground', !hidden);
  sizeGroup.hidden = hidden;
  toggle.textContent = hidden ? '🐾 キャラを呼ぶ' : '🐾';
  toggle.title = hidden ? 'キャラを画面に呼ぶ' : 'キャラを隠す';
  toggle.setAttribute('aria-label', toggle.title);
}
toggle.addEventListener('click', () => {
  hidden = !hidden;
  saveHidden(hidden);
  applyHidden();
});
applyHidden();

const chars = new Map(); // id → 状態

function size() {
  const px = (SIZES.find((s) => s.key === sizeKey) || SIZES[1]).px;
  return Math.round(window.innerWidth < 600 ? px * 0.75 : px);
}

function createChar(agent) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pg-char';
  el.dataset.id = agent.id;
  el.setAttribute('aria-label', `${agent.name}（クリックすると話します）`);
  el.innerHTML = `<span class="pg-bubble" hidden></span>
    <span class="pg-body"><img src="${agent.avatar}" alt=""></span>
    <span class="pg-zzz" aria-hidden="true">z z Z</span>
    <span class="pg-shadow" aria-hidden="true"></span>`;
  stage.append(el);
  const maxX = Math.max(0, document.documentElement.clientWidth - size());
  const c = {
    agent, el,
    x: maxX * (0.1 + 0.8 * Math.random()), // ばらけて登場
    target: null, facing: 1, action: 'idle', until: now() + 1500 + Math.random() * 2000,
    bubbleTimer: null,
  };
  el.addEventListener('click', () => onClick(c));
  return c;
}

function say(c, text, ms = 3500) {
  const bubble = c.el.querySelector('.pg-bubble');
  const t = [...text].length > 34 ? `${[...text].slice(0, 34).join('')}…` : text;
  bubble.textContent = t;
  bubble.hidden = false;
  clearTimeout(c.bubbleTimer);
  c.bubbleTimer = setTimeout(() => { bubble.hidden = true; }, ms);
}

function setAction(c, action, durationMs) {
  c.action = action;
  c.until = now() + durationMs;
  c.el.dataset.action = action;
}

function jump(c) {
  c.el.classList.remove('pg-jump');
  void c.el.offsetWidth; // アニメーションをやり直す
  c.el.classList.add('pg-jump');
}

function onClick(c) {
  if (c.agent.status === 'sleeping') {
    const line = SLEEP_TALK[c.agent.id] || 'zzz…';
    say(c, line);
    speak(line, c.agent, c.el);
    return;
  }
  const line = pick(LINES[c.agent.id]?.click || ['こんにちは！']);
  jump(c);
  setAction(c, 'idle', 1800);
  say(c, line);
  speak(line, c.agent, c.el);
}

// 次に何をするか決める
function think(c, others) {
  // いちばん近くにいる、起きている仲間
  const friend = others
    .filter((o) => o !== c && o.agent.status === 'home' && !o.el.hidden)
    .sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
  const maxX = Math.max(0, document.documentElement.clientWidth - size());
  const r = Math.random();
  if (friend && Math.abs(friend.x - c.x) < size() * 1.6 && r < 0.35) {
    // 近くにいたら一緒に遊ぶ
    setAction(c, 'play', 2200);
    setAction(friend, 'play', 2200);
    jump(c);
    setTimeout(() => jump(friend), 250);
    say(c, pick(LINES[c.agent.id].play));
    setTimeout(() => say(friend, pick(LINES[friend.agent.id].play)), 900);
  } else if (r < 0.65 && !reduceMotion) {
    // ときどき友だちのほうへ、ふだんは好きな場所へ歩く
    c.target = friend && Math.random() < 0.3 ? friend.x + (Math.random() < 0.5 ? -1 : 1) * size() : Math.random() * maxX;
    c.target = Math.min(maxX, Math.max(0, c.target));
    setAction(c, 'walk', 8000);
  } else if (r < 0.8) {
    jump(c);
    setAction(c, 'idle', 1500 + Math.random() * 2000);
  } else {
    if (Math.random() < 0.5) say(c, pick(LINES[c.agent.id].idle));
    setAction(c, 'idle', 2500 + Math.random() * 3000);
  }
}

let last = now();
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (!hidden) {
    const list = [...chars.values()];
    const s = size();
    const maxX = Math.max(0, document.documentElement.clientWidth - s);
    for (const c of list) {
      if (c.agent.status !== 'home') continue;
      if (c.action === 'walk' && c.target != null) {
        const dx = c.target - c.x;
        const step = SPEED[c.agent.id] * dt;
        if (Math.abs(dx) <= step) {
          c.x = c.target;
          c.target = null;
          setAction(c, 'idle', 800 + Math.random() * 1500);
        } else {
          c.x += Math.sign(dx) * step;
          c.facing = Math.sign(dx);
        }
      }
      if (t > c.until) think(c, list);
      c.x = Math.min(maxX, Math.max(0, c.x));
    }
    for (const c of list) {
      c.el.style.setProperty('--x', `${c.x}px`);
      c.el.style.setProperty('--size', `${s}px`);
      c.el.style.setProperty('--facing', c.facing);
      // 画面のはしでは吹き出しを内側に寄せる
      c.el.dataset.edge = c.x < 90 ? 'left' : c.x > maxX - 90 ? 'right' : '';
    }
  }
  requestAnimationFrame(frame);
}

async function syncAgents() {
  let agents;
  try {
    agents = await api('/agents');
  } catch {
    return;
  }
  // 車のエージェントはガレージにいるので、遊び場には出てこない
  for (const agent of agents.filter((a) => a.role !== 'car')) {
    const c = chars.get(agent.id) || chars.set(agent.id, createChar(agent)).get(agent.id);
    const wasStatus = c.agent.status;
    c.agent = agent;
    c.el.dataset.status = agent.status;
    // 会議中＝秘密基地にいるので、遊び場には出てこない
    c.el.hidden = agent.status === 'meeting';
    if (wasStatus === 'meeting' && agent.status === 'home') {
      jump(c);
      say(c, BACK_HOME[agent.id] || 'ただいま！');
    }
    if (agent.status !== 'home') setAction(c, agent.status, 1e9);
    else if (c.action === 'sleeping' || c.action === 'meeting') setAction(c, 'idle', 1000);
  }
}

// タイムラインに投稿したら、吹き出しでしゃべる
async function onNewPost() {
  try {
    const [latest] = await api('/posts');
    const c = latest && chars.get(latest.authorId);
    if (c && !c.el.hidden && Date.now() - new Date(latest.createdAt) < 10000 && c.lastPostId !== latest.id) {
      c.lastPostId = latest.id;
      jump(c);
      say(c, latest.text, 5000);
    }
  } catch { /* noop */ }
}

applySize();
await syncAgents();
requestAnimationFrame(frame);
onServerEvents({ agent: syncAgents, post: onNewPost });
