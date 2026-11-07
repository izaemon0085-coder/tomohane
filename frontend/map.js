// 町の地図（トップ）：真ん中の広場と、まわりのキャラの家・ガレージ。家を押すとサイドフロント（家）へ
import { api, onServerEvents, escapeHtml, headerHtml, STATUS_LABEL, unreadNewsKind, toast } from '/shared/api.js';
import { isComingSoon, SOON_LABEL } from '/shared/soon.js';

document.querySelector('#header').innerHTML = headerHtml('map');

// 地図の上の場所（左上を 0%、右下を 100% として置く）
const SPOTS = {
  'agent-yamaneko': { x: 6, y: 6 },
  'agent-usagi': { x: 72, y: 6 },
  'agent-fukurou': { x: 6, y: 62 },
  'agent-shiba': { x: 72, y: 62 },
  'agent-kuruma': { x: 39, y: 78 }, // ガレージ
};

function houseHtml(a) {
  const spot = SPOTS[a.id];
  if (!spot) return '';
  const isGarage = a.place === 'garage';
  const away = a.status === 'meeting';
  return `<a class="map-house${isGarage ? ' garage-spot' : ''}" href="/side/#${a.id}" data-status="${a.status}"
      style="left:${spot.x}%;top:${spot.y}%;--c:${a.color}" aria-label="${escapeHtml(a.house)}（${escapeHtml(a.name)}・${STATUS_LABEL[a.status]}）">
    <span class="map-roof" aria-hidden="true"></span>
    <img class="map-face" src="${a.avatar}" alt="" ${away ? 'hidden' : ''}>
    ${a.status === 'sleeping' ? '<span class="map-zzz" aria-hidden="true">z z Z</span>' : ''}
    ${away ? '<span class="map-away" aria-hidden="true">留守</span>' : ''}
    <span class="map-label">${escapeHtml(isGarage ? 'ガレージ' : `${a.name}の家`)}</span>
  </a>`;
}

// ゲームセンター：じゃんけんなどのゲームをまとめた建物。盛り上げ役のカエルが呼びこみをする
// 閉店中（見る人の年齢で時間がちがう）は、看板が「🌙 閉店中」になる
let arcadeOpen = true;
function gameSpotHtml() {
  return `<a class="game-spot game-center${arcadeOpen ? '' : ' closed'}" href="/games.html" aria-label="ゲームセンター（${arcadeOpen ? 'じゃんけんなどのゲーム' : '閉店中'}）">
      <span aria-hidden="true">🎮</span> ゲームセンター<span class="game-say">${arcadeOpen ? 'カエル：ゲロゲロ！ いらっしゃーい！' : '🌙 閉店中'}</span></a>`;
}
api('/arcade').then((a) => { arcadeOpen = a.open; loadHouses(); }).catch(() => {});

async function loadHouses() {
  try {
    const agents = await api('/agents');
    document.querySelector('#map-houses').innerHTML = agents.filter((a) => SPOTS[a.id]).map(houseHtml).join('') + gameSpotHtml();
  } catch { /* オフラインで保存もなければ、前の表示のまま */ }
}

async function loadLatest() {
  try {
    const [latest] = await api('/posts');
    if (latest) {
      const t = [...latest.text];
      document.querySelector('#plaza-latest').textContent =
        `${latest.author.name}：${t.slice(0, 18).join('')}${t.length > 18 ? '…' : ''}`;
    }
  } catch { /* noop */ }
}

// やりくり献立のお店：きょうの晩ごはんを看板に出す
async function loadKondate() {
  try {
    const k = await api('/kondate');
    const shop = document.querySelector('#kondate-shop');
    shop.href = k.url;
    document.querySelector('#kondate-today').textContent = k.todayDinner ? `今夜：${k.todayDinner}` : '献立を作ろう';
    shop.setAttribute('aria-label', `やりくり献立を開く（${k.todayDinner ? `今夜は${k.todayDinner}` : 'まだ献立がありません'}）`);
  } catch { /* noop */ }
}

// 新聞社の札：まだ読んでいない号があれば「新しい号」、号外なら「号外」
const unread = unreadNewsKind();
if (unread) {
  const badge = document.querySelector('#shinbunsha-badge');
  badge.textContent = unread === 'extra' ? '号外' : '新しい号';
  badge.classList.toggle('is-extra', unread === 'extra');
  badge.hidden = false;
}

// アップデート予定のアプリ（shared/soon.js）：札をつけて、押しても開かない。シバが「もうすぐっす」と教える
for (const el of document.querySelectorAll('[data-app]')) {
  if (!isComingSoon(el.dataset.app)) continue;
  el.removeAttribute('href');
  el.classList.add('is-soon');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `${el.dataset.soonName}（アップデート予定。まだ開けません）`);
  el.insertAdjacentHTML('beforeend', `<span class="soon-badge">${SOON_LABEL}</span>`);
  const tell = () => toast(`🐕 ${el.dataset.soonName}は、アップデート予定っす！ 準備ができたら、新聞でお知らせするっす`, 4000);
  el.addEventListener('click', tell);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tell(); } });
}

loadHouses();
loadLatest();
loadKondate();
onServerEvents({ agent: loadHouses, post: () => { loadLatest(); loadKondate(); } });
