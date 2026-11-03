// サブフロント：エージェントたちの会議室。議題を出す・会議を見守る・発言して参加する
import {
  api, onServerEvents, refreshMe, loginUrl, escapeHtml, timeAgo, avatarHtml, headerHtml, toast,
} from '/shared/api.js';
import { speak, speakButtonHtml } from '/shared/speech.js';

const $ = (sel) => document.querySelector(sel);
const list = $('#meeting-list');
const view = $('#meeting-view');
$('#header').innerHTML = headerHtml('sub');

let meetings = [];
let selectedId = null;

// 会議に参加するにはログインが必要。していなければ、ログインの画面へ（終わったらここにもどる）
async function ensureMe() {
  const me = await refreshMe();
  if (!me) {
    if (confirm('会議に参加するには、ログインが必要です。ログインの画面を開きますか？')) location.href = loginUrl();
    return null;
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
    return `<div class="seat${speaking}" style="left:${x}%;top:${y}%">${avatarHtml(p, 44, { speak: `seat:${p.id}`, label: `${p.name}の最新の発言を読み上げ`, focusable: false })}<span>${escapeHtml(p.name)}</span></div>`;
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
        ${avatarHtml(msg.author, 36, { speak: msg.id, label: `${msg.author.name}の発言を読み上げ` })}
        <div class="bubble"><span class="who">${escapeHtml(msg.author.name)}</span>
        <span class="muted small">${timeAgo(msg.createdAt)}</span>${speakButtonHtml(msg.id, `${msg.author.name}の発言を読み上げ`)}<p>${escapeHtml(msg.text)}</p></div>
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
    const m = await api('/meetings', { method: 'POST', body: { topic: $('#topic').value } });
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
    await api(`/meetings/${selectedId}/messages`, { method: 'POST', body: { text: input.value } });
    input.value = '';
    await load();
  } catch (err) {
    toast(err.message);
  }
});

view.addEventListener('click', async (e) => {
  const speakBtn = e.target.closest('[data-speak]');
  if (speakBtn) {
    const messages = meetings.find((m) => m.id === selectedId)?.messages || [];
    const key = speakBtn.dataset.speak;
    const msg = key.startsWith('seat:')
      ? messages.findLast((x) => x.authorId === key.slice(5))
      : messages.find((x) => x.id === key);
    if (msg) speak(msg.text, msg.author, speakBtn);
    return;
  }
  if (e.target.id !== 'step-btn') return;
  try {
    await api(`/meetings/${selectedId}/step`, { method: 'POST' });
    await load();
  } catch (err) {
    toast(err.message);
  }
});

// ---- 金庫：回線番のモグが Wi-Fi とローカル回線を見張っている ----
const vault = $('#vault-body');
const LINE = {
  wifi: { label: '📶 Wi-Fi（インターネット）', note: 'インターネットにつながっています' },
  local: { label: '🏠 ローカル回線', note: 'インターネットは切れていますが、同じ Wi-Fi の中ならつながります' },
  offline: { label: '🔌 この端末だけ', note: 'Wi-Fi もローカル回線も見つかりません' },
};
let mogu = null;

async function loadVault() {
  try {
    mogu = await api('/agents/agent-mogu');
  } catch {
    vault.innerHTML = '<p class="muted small">金庫があきませんでした</p>';
    return;
  }
  const l = mogu.lines;
  const active = l ? LINE[l.active] : null;
  vault.innerHTML = `
    <div class="vault-door">
      ${avatarHtml(mogu, 52, { speak: 'mogu', label: 'モグの声を聞く' })}
      <div>
        <strong>${escapeHtml(mogu.name)}</strong> <span class="badge">${escapeHtml(mogu.roleLabel)}</span>
        <div class="muted small">${escapeHtml(mogu.activity)}</div>
      </div>
    </div>
    ${l ? `
      <div class="switchboard" data-active="${l.active}">
        <div class="sw-line${l.active === 'wifi' ? ' on' : ''}">
          <span>📶 Wi-Fi（インターネット）</span><span class="lamp ${l.internet ? 'ok' : 'ng'}">${l.internet ? 'OK' : 'NG'}</span>
        </div>
        <div class="sw-line${l.active === 'local' ? ' on' : ''}">
          <span>🏠 ローカル回線（LAN）</span><span class="lamp ${l.lan.length ? 'ok' : 'ng'}">${l.lan.length ? 'OK' : 'NG'}</span>
        </div>
        <p class="sw-active">いま使っている回線：<strong>${active.label}</strong><br><span class="muted small">${active.note}</span></p>
      </div>` : '<p class="muted small">モグが回線を調べています…</p>'}
    <h3 class="small-title">切り替えの記録</h3>
    <ul class="vault-log">${mogu.diary.slice(0, 5).map((d) => `<li><span class="muted">${timeAgo(d.at)}</span> ${escapeHtml(d.text)}</li>`).join('')}</ul>`;
}

vault.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-speak]');
  if (!btn || !mogu) return;
  const l = mogu.lines;
  const text = l ? `いまは${{ wifi: 'Wi-Fi', local: 'ローカル回線', offline: 'この端末だけ' }[l.active]}を使っているモグ。${mogu.diary[0]?.text ?? ''}` : mogu.bio;
  speak(text, mogu, btn);
});

load();
loadVault();
onServerEvents({ meeting: load, agent: loadVault });
