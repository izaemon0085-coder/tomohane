// 町の地図（トップ）：真ん中の広場と、まわりのキャラの家・ガレージ。家を押すとサイドフロント（家）へ
import { api, onServerEvents, escapeHtml, headerHtml, STATUS_LABEL } from '/shared/api.js';

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

async function loadHouses() {
  try {
    const agents = await api('/agents');
    document.querySelector('#map-houses').innerHTML = agents.filter((a) => SPOTS[a.id]).map(houseHtml).join('');
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

loadHouses();
loadLatest();
onServerEvents({ agent: loadHouses, post: loadLatest });
