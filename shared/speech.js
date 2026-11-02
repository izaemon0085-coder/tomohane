// 【仮】読み上げ機能：ブラウザ標準の Web Speech API（speechSynthesis）で文章を読み上げる。
// 外部サービスは使わない。キャラごとに声の高さ・速さを変える。
// ※本番ではキャラ専用の音声（AI 音声合成など）に差し替える予定。

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

// キャラごとの声の設定（pitch: 0〜2, rate: 0.1〜10）
const VOICE_STYLE = {
  'agent-yamaneko': { pitch: 0.75, rate: 0.95 }, // 落ち着いた低め・クール
  'agent-usagi': { pitch: 1.6, rate: 1.1 },      // 明るい高め
};
const DEFAULT_STYLE = { pitch: 1, rate: 1 };

function japaneseVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'ja-JP') || voices.find((v) => v.lang?.startsWith('ja')) || null;
}

// 絵文字や記号は読み上げると不自然なので取り除く
function cleanForSpeech(text) {
  return text
    .replace(/\p{Extended_Pictographic}|[\u{FE0F}\u{200D}♪♡♥]/gu, '')
    .replace(/https?:\/\/\S+/g, 'リンク')
    .replace(/\s+/g, ' ')
    .trim();
}

let currentButton = null;

function setPlaying(button, playing) {
  if (!button) return;
  button.classList.toggle('speaking', playing);
  button.setAttribute('aria-pressed', String(playing));
  button.textContent = playing ? '⏹' : '🔊';
}

export function stopSpeaking() {
  if (!speechSupported) return;
  speechSynthesis.cancel();
  setPlaying(currentButton, false);
  currentButton = null;
}

// text を author（ユーザー/エージェント）の声で読み上げる。button を渡すと再生中の表示を切り替える
export function speak(text, author = {}, button = null) {
  if (!speechSupported) return;
  const sameButton = button && button === currentButton;
  stopSpeaking();
  if (sameButton) return; // 再生中のボタンをもう一度押したら停止だけ

  const clean = cleanForSpeech(author.name ? `${author.name}。${text}` : text);
  if (!clean) return;
  const utter = new SpeechSynthesisUtterance(clean);
  const style = VOICE_STYLE[author.id] || DEFAULT_STYLE;
  utter.lang = 'ja-JP';
  utter.pitch = style.pitch;
  utter.rate = style.rate;
  const voice = japaneseVoice();
  if (voice) utter.voice = voice;

  currentButton = button;
  setPlaying(button, true);
  utter.onend = utter.onerror = () => {
    if (currentButton === button) {
      setPlaying(button, false);
      currentButton = null;
    }
  };
  speechSynthesis.speak(utter);
}

// 読み上げボタンの HTML。対応していないブラウザでは何も出さない
export function speakButtonHtml(id, label = '読み上げ') {
  if (!speechSupported) return '';
  return `<button type="button" class="speak-btn" data-speak="${id}" aria-pressed="false" aria-label="${label}" title="${label}（仮）">🔊</button>`;
}

if (speechSupported) {
  speechSynthesis.getVoices(); // 声の一覧を先に読み込んでおく（Chrome は非同期）
  window.addEventListener('pagehide', () => speechSynthesis.cancel());
}
