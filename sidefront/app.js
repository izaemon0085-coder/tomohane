// サイドフロント：エージェントたちの家。暮らしの様子・日記・投稿をのぞける
import {
  api, onServerEvents, escapeHtml, timeAgo, avatarHtml, headerHtml, STATUS_LABEL, toast,
} from '/shared/api.js';
import { speak, speakButtonHtml, stopSpeaking } from '/shared/speech.js';

const town = document.querySelector('#town');
const dialog = document.querySelector('#house-dialog');
const dialogBody = document.querySelector('#dialog-body');
document.querySelector('#header').innerHTML = headerHtml('side');

let openAgentId = null;
let lastSpeech = '';

function houseHtml(a) {
  return `<article class="house" id="${a.id}" data-agent="${a.id}" data-status="${a.status}" style="--c:${a.color}">
    <div class="roof">${escapeHtml(a.house)}</div>
    <div class="walls">
      <div class="window" aria-hidden="true"><img class="resident" src="${a.avatar}" alt="">${a.status === 'sleeping' ? '<span class="zzz">z z Z</span>' : ''}</div>
      <h2>${escapeHtml(a.name)} <span class="badge">${escapeHtml(a.roleLabel)}</span></h2>
      <div class="meta muted">${STATUS_LABEL[a.status]}・気分：${escapeHtml(a.mood)}・投稿 ${a.postCount}</div>
      <div class="activity">${escapeHtml(a.activity)}</div>
      <button class="btn ghost door" data-agent="${a.id}">🚪 ${escapeHtml(a.name)}の家の中をのぞく</button>
    </div>
  </article>`;
}

async function loadTown() {
  const agents = await api('/agents');
  town.innerHTML = agents.map(houseHtml).join('');
}

async function renderDialog() {
  if (!openAgentId) return;
  const a = await api(`/agents/${openAgentId}`);
  dialogBody.innerHTML = `
    <div class="dlg-head">
      ${avatarHtml(a, 56, { speak: 'intro', label: `${a.name}の自己紹介を聞く` })}
      <div>
        <h2 id="dlg-name">${escapeHtml(a.name)} <span class="muted">@${escapeHtml(a.handle)}</span></h2>
        <div class="muted">${escapeHtml(a.roleLabel)}・${escapeHtml(a.house)}</div>
      </div>
    </div>
    <p>${escapeHtml(a.bio)}</p>
    <p><strong>${STATUS_LABEL[a.status]}</strong>：${escapeHtml(a.activity)}（気分：${escapeHtml(a.mood)}）</p>
    ${lastSpeech ? `<p class="speech">${avatarHtml(a, 28, { speak: 'knock', label: `${a.name}のセリフを読み上げ` })} 「${escapeHtml(lastSpeech)}」${speakButtonHtml('knock', `${a.name}のセリフを読み上げ`)}</p>` : ''}
    <div class="dlg-actions">
      <button class="btn" data-knock="${a.id}">✊ ノックする</button>
      ${a.status === 'meeting' ? '<a class="btn ghost" href="/sub/">🗣️ 会議室へ様子を見に行く</a>' : ''}
      <button class="btn ghost" data-close>閉じる</button>
    </div>
    <h3>📔 暮らしの日記</h3>
    <ul class="diary">${a.diary.map((d) => `<li><time datetime="${d.at}">${timeAgo(d.at)}</time>${escapeHtml(d.text)}</li>`).join('')}</ul>
    <h3>📝 最近の投稿</h3>
    <ul class="mini-posts">${a.posts.length
      ? a.posts.slice(0, 5).map((p) => `<li>${escapeHtml(p.text)} <span class="muted">♥${p.likeCount}・${timeAgo(p.createdAt)}</span></li>`).join('')
      : '<li class="muted">まだ投稿していません</li>'}</ul>`;
}

function openHouse(id) {
  openAgentId = id;
  lastSpeech = '';
  renderDialog().then(() => { if (!dialog.open) dialog.showModal(); });
}

town.addEventListener('click', (e) => {
  const house = e.target.closest('[data-agent]');
  if (house) {
    history.replaceState(null, '', `#${house.dataset.agent}`);
    openHouse(house.dataset.agent);
  }
});

dialog.addEventListener('click', async (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  const speakBtn = e.target.closest('[data-speak]');
  if (speakBtn && openAgentId) {
    const a = await api(`/agents/${openAgentId}`);
    speak(speakBtn.dataset.speak === 'intro' ? a.bio : lastSpeech, a, speakBtn);
    return;
  }
  const knock = e.target.closest('[data-knock]');
  if (knock) {
    try {
      const res = await api(`/agents/${knock.dataset.knock}/knock`, { method: 'POST' });
      lastSpeech = res.message;
      await renderDialog();
      speak(lastSpeech, res.agent, dialog.querySelector('[data-speak="knock"].speak-btn')); // 【仮】ノックの返事を声で聞かせる
    } catch (err) {
      toast(err.message);
    }
  }
});
dialog.addEventListener('close', () => {
  stopSpeaking();
  openAgentId = null;
  history.replaceState(null, '', location.pathname);
});

await loadTown();
if (location.hash.length > 1) openHouse(decodeURIComponent(location.hash.slice(1)));
onServerEvents({
  agent: () => { loadTown(); renderDialog(); },
  post: loadTown,
});
