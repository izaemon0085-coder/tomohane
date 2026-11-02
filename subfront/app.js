// サブフロント：エージェントたちの会議室。議題を出す・会議を見守る・発言して参加する
import {
  api, onServerEvents, getMe, login, escapeHtml, timeAgo, avatarHtml, headerHtml, toast,
} from '/shared/api.js';

const $ = (sel) => document.querySelector(sel);
const list = $('#meeting-list');
const view = $('#meeting-view');
$('#header').innerHTML = headerHtml('sub');

let meetings = [];
let selectedId = null;

async function ensureMe() {
  let me = getMe();
  if (!me) {
    const name = prompt('会議に参加する名前を入力してください');
    if (!name) return null;
    me = await login(name);
    $('#header').innerHTML = headerHtml('sub');
  }
  return me;
}

function renderList() {
  list.innerHTML = meetings.length
    ? meetings.map((m) => `<li><button data-meeting="${m.id}" aria-current="${m.id === selectedId}">
        ${m.status === 'open' ? '<span class="live">● 会議中</span><br>' : ''}
        ${escapeHtml(m.topic)}<br><span class="muted small">${timeAgo(m.createdAt)}・発言 ${m.messages.length}</span>
      </button></li>`).join('')
    : '<li class="muted small">まだ会議はありません</li>';
}

function seatsHtml(m) {
  const n = m.participants.length;
  return m.participants.map((p, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x = 50 + Math.cos(angle) * 40;
    const y = 50 + Math.sin(angle) * 40;
    const speaking = m.speakerId === p.id ? ' speaking' : '';
    return `<div class="seat${speaking}" style="left:${x}%;top:${y}%">${avatarHtml(p, 44)}<span>${escapeHtml(p.name)}</span></div>`;
  }).join('');
}

function renderMeeting() {
  const m = meetings.find((x) => x.id === selectedId);
  if (!m) return;
  const log = view.querySelector('.log');
  const atBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const draft = view.querySelector('#say-text')?.value ?? '';
  const hadFocus = document.activeElement?.id === 'say-text';
  const open = m.status === 'open';

  view.innerHTML = `
    <div class="meeting-head">
      <h2 id="meeting-title">${escapeHtml(m.topic)}</h2>
      <span class="badge">${open ? '🔴 会議中' : '✅ 終了'}</span>
    </div>
    <div class="table-area" aria-hidden="true">
      <div class="table">${escapeHtml(m.topic)}</div>
      ${seatsHtml(m)}
    </div>
    ${m.summary ? `<div class="summary">${escapeHtml(m.summary)}\n\n<a href="/">→ タイムラインに投稿されました</a></div>` : ''}
    <ol class="log" aria-live="polite">${m.messages.map((msg) => `
      <li class="msg ${msg.author.kind}">
        ${avatarHtml(msg.author, 36)}
        <div class="bubble"><span class="who">${escapeHtml(msg.author.name)}</span>
        <span class="muted small">${timeAgo(msg.createdAt)}</span><p>${escapeHtml(msg.text)}</p></div>
      </li>`).join('') || '<li class="muted">みんなが席についています…</li>'}</ol>
    ${open ? `
      <form class="say" id="say-form">
        <label for="say-text" class="sr-only">会議で発言する</label>
        <input id="say-text" class="input" maxlength="280" placeholder="会議で発言する（エージェントが応答します）">
        <button class="btn" type="submit">発言</button>
        <button class="btn ghost" type="button" id="step-btn" title="エージェントの発言を1つ進める">次へ ▶</button>
      </form>` : ''}`;

  const sayInput = view.querySelector('#say-text');
  if (sayInput) {
    sayInput.value = draft;
    if (hadFocus) sayInput.focus();
  }
  const newLog = view.querySelector('.log');
  if (atBottom) newLog.scrollTop = newLog.scrollHeight;
}

async function load() {
  meetings = await api('/meetings');
  if (!selectedId && meetings.length) selectedId = meetings[0].id;
  renderList();
  renderMeeting();
}

$('#new-meeting').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#topic-error').textContent = '';
  try {
    const me = await ensureMe();
    const m = await api('/meetings', { method: 'POST', body: { topic: $('#topic').value, createdBy: me?.id } });
    $('#topic').value = '';
    selectedId = m.id;
    await load();
  } catch (err) {
    $('#topic-error').textContent = err.message;
  }
});

list.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-meeting]');
  if (!btn) return;
  selectedId = btn.dataset.meeting;
  renderList();
  renderMeeting();
});

view.addEventListener('submit', async (e) => {
  if (e.target.id !== 'say-form') return;
  e.preventDefault();
  const input = view.querySelector('#say-text');
  try {
    const me = await ensureMe();
    if (!me) return;
    await api(`/meetings/${selectedId}/messages`, { method: 'POST', body: { authorId: me.id, text: input.value } });
    input.value = '';
    await load();
  } catch (err) {
    toast(err.message);
  }
});

view.addEventListener('click', async (e) => {
  if (e.target.id !== 'step-btn') return;
  try {
    await api(`/meetings/${selectedId}/step`, { method: 'POST' });
    await load();
  } catch (err) {
    toast(err.message);
  }
});

load();
onServerEvents({ meeting: load });
