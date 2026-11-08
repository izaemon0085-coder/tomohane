// ともはね新聞。アンケートの結果は数字を出さず、キャラの座談会で見せる（正確な数とひとことは運営だけ）
import { api, refreshMe, getMe, headerHtml, escapeHtml, toast, timeAgo, onServerEvents, markNewsSeen } from '/shared/api.js';
import { PAPER_NAME, MAX_VOTE_COMMENT, AGENT_NAMES, issueLabel } from '/shared/news.js';
import { SUGGEST_TOPICS, topicLabel, MAX_SUMMARY, MAX_ANSWER } from '/shared/suggest.js';

const $ = (sel) => document.querySelector(sel);
const AGE = { child: '子ども', teen: '中高生', adult: '大人' };
const fmtDate = (d) => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' })
  .format(new Date(`${d}T00:00:00+09:00`));
const face = (by) => `/shared/avatars/${escapeHtml(by.replace('agent-', ''))}.svg`;
let issues = [];

const talkHtml = (lines) => `<ul class="talk">${lines.map((l) => `<li>
    <img src="${face(l.by)}" alt="" width="36" height="36">
    <p><strong>${escapeHtml(AGENT_NAMES[l.by] ?? '')}</strong>${escapeHtml(l.text)}</p></li>`).join('')}</ul>`;

function pollHtml(p) {
  const me = getMe();
  const form = me
    ? `<form class="vote-form" data-poll="${escapeHtml(p.id)}">
        <fieldset><legend class="sr-only">答え</legend>
          ${p.choices.map((c) => `<label class="choice"><input type="radio" name="choice" value="${escapeHtml(c.id)}"${p.myVote?.choice === c.id ? ' checked' : ''} required> ${escapeHtml(c.label)}</label>`).join('')}
        </fieldset>
        <label class="field">ひとこと（なくてもOK・${MAX_VOTE_COMMENT}文字まで。運営だけが読みます。新聞にはのりません）
          <textarea class="input" name="comment" maxlength="${MAX_VOTE_COMMENT}" rows="2">${escapeHtml(p.myVote?.comment ?? '')}</textarea></label>
        <p class="error" role="alert"></p>
        <div class="row wrap">
          <button class="btn" type="submit">${p.myVote ? '答えを変える' : '答える'}</button>
          ${p.myVote ? '<button class="btn ghost" type="button" data-cancel>答えを取り消す</button>' : ''}
        </div>
      </form>`
    : '<p><a href="/login.html?next=/news.html">ログイン</a>すると答えられます。</p>';
  const admin = p.counts
    ? `<details class="admin-box" data-voices="${escapeHtml(p.id)}"><summary>運営だけ：正確な数とひとこと</summary>
        <p class="small">${p.choices.map((c) => `${escapeHtml(c.label)} ${p.counts[c.id]}人`).join('／')}（合計 ${p.total}人）</p><ul></ul></details>`
    : '';
  return `<section class="paper-box poll" aria-labelledby="poll-q">
      <h3 class="paper-kicker">みんなに聞きたいこと</h3>
      <p class="poll-q" id="poll-q">${escapeHtml(p.question)}</p>
      ${p.notes?.length ? `<ul class="poll-notes">${p.notes.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
      ${form}
      <h4>座談会「みんなの声を聞いて」</h4>
      ${talkHtml(p.talk)}
      ${admin}
    </section>`;
}

function articleHtml(a) {
  const who = a.by === 'operator'
    ? ''
    : `<p class="byline"><img src="${face(a.by)}" alt="" width="28" height="28"> ${escapeHtml(AGENT_NAMES[a.by] ?? '')} 記者</p>`;
  return `<section class="paper-article">
      <h3>${escapeHtml(a.title)}</h3>${who}
      ${a.body.map((t) => `<p>${escapeHtml(t)}</p>`).join('')}
      ${a.sign ? `<p class="sign">${escapeHtml(a.sign)}</p>` : ''}
    </section>`;
}

function render() {
  if (!issues.length) {
    $('#paper').innerHTML = `<p class="muted">まだ新聞は出ていません。</p>`;
    return;
  }
  const wanted = new URLSearchParams(location.search).get('id');
  const issue = issues.find((i) => i.id === wanted) ?? issues[0];
  const extra = issue.kind === 'extra';
  $('#paper').className = `paper${extra ? ' is-extra' : ''}`;
  $('#paper').innerHTML = `
    <header class="masthead">
      ${extra ? '<p class="extra-band">号 外</p>' : ''}
      <h1>${escapeHtml(PAPER_NAME)}</h1>
      <p class="paper-meta"><span>${escapeHtml(issueLabel(issue))}</span><span>${escapeHtml(fmtDate(issue.date))}</span><span>発行：ともはね 運営</span></p>
    </header>
    <section class="front">
      <h2 class="headline">${escapeHtml(issue.headline)}</h2>
      ${issue.lead ? `<p class="lead">${escapeHtml(issue.lead)}</p>` : ''}
    </section>
    <div class="paper-cols">
      ${(issue.articles ?? []).map(articleHtml).join('')}
      ${issue.greetings?.length ? `<section class="paper-article"><h3>町のみんなから、ひとこと</h3>${talkHtml(issue.greetings)}</section>` : ''}
    </div>
    ${issue.talk ? `<section class="paper-box"><h3 class="paper-kicker">${escapeHtml(issue.talk.title)}</h3>${talkHtml(issue.talk.lines)}</section>` : ''}
    ${issue.poll ? pollHtml(issue.poll) : ''}
    ${issue.threadPostId
    ? `<p class="to-thread"><a class="btn" href="/plaza.html?thread=${encodeURIComponent(issue.threadPostId)}">💬 この号のスレッドで話す →</a></p>`
    : ''}`;
  $('#backnumbers').innerHTML = issues.map((i) => `<li><a href="?id=${encodeURIComponent(i.id)}"${i.id === issue.id ? ' aria-current="page"' : ''}>
      ${i.kind === 'extra' ? '<span class="extra-chip">号外</span>' : escapeHtml(issueLabel(i))}
      ${escapeHtml(fmtDate(i.date))}・${escapeHtml(i.headline)}</a></li>`).join('');
}

async function load() {
  issues = await api('/news');
  render();
}

$('#paper').addEventListener('submit', async (e) => {
  const form = e.target.closest('.vote-form');
  if (!form) return;
  e.preventDefault();
  const err = form.querySelector('.error');
  err.textContent = '';
  try {
    await api(`/news/${form.dataset.poll}/vote`, {
      method: 'PUT', body: { choice: form.elements.choice.value, comment: form.elements.comment.value.trim() },
    });
    toast('答えました。ありがとう！');
    await load();
  } catch (x) {
    err.textContent = x.offline ? 'つながっていません。つながってから、もう一度どうぞ' : x.message;
  }
});
$('#paper').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-cancel]');
  if (!btn) return;
  try {
    await api(`/news/${btn.closest('.vote-form').dataset.poll}/vote`, { method: 'DELETE' });
    toast('答えを取り消しました');
    await load();
  } catch (x) {
    toast(x.message, 5000);
  }
});
// 運営だけ：ひとことを開いたときに読みこむ
$('#paper').addEventListener('toggle', async (e) => {
  const box = e.target.closest?.('[data-voices]');
  if (!box?.open) return;
  try {
    const voices = await api(`/news/${box.dataset.voices}/voices`);
    box.querySelector('ul').innerHTML = voices.length
      ? voices.map((v) => `<li><strong>${escapeHtml(v.name)}</strong> <span class="muted small">${escapeHtml(AGE[v.age] ?? '')}・${escapeHtml(v.choice)}・${escapeHtml(timeAgo(v.at))}</span><br>${escapeHtml(v.comment)}</li>`).join('')
      : '<li class="muted">まだありません</li>';
  } catch (x) {
    toast(x.message, 5000);
  }
}, true);

// ---- 📮 目安箱 ----
const AGE_LABEL = { child: '子ども', teen: '中高生', adult: '大人' };
const STATUS_LABEL = { new: '🆕 新しい', picked: '📰 新聞でとりあげた', done: '片づけた' };
$('#meyasu-topic').innerHTML = SUGGEST_TOPICS.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');

async function loadMeyasu() {
  const me = getMe();
  $('#meyasu-form').hidden = !me;
  $('#meyasu-login').hidden = Boolean(me);
  try {
    const talk = await api('/suggestions/talk');
    $('#meyasu-talk').innerHTML = talk.length
      ? talk.map((t) => `<div class="meyasu-item">${t.mine ? '<p class="mine-chip">📮 あなたの声がのっています</p>' : ''}${talkHtml(t.lines)}</div>`).join('')
      : talkHtml([{ by: 'agent-shiba', text: 'まだ、とりあげた声はないっす。下の目安箱に、なんでも入れてほしいっす！' }]);
  } catch { /* オフラインなど */ }
  $('#meyasu-admin').hidden = me?.role !== 'admin';
  if (me?.role === 'admin' && $('#meyasu-admin').open) await loadMeyasuAdmin();
}
async function loadMeyasuAdmin() {
  const list = await api('/suggestions');
  $('#meyasu-admin-list').innerHTML = list.length ? list.map((x) => `<li data-id="${escapeHtml(x.id)}">
      <p class="small muted">${escapeHtml(topicLabel(x.topic))}・${escapeHtml(AGE_LABEL[x.age] ?? '')}・${escapeHtml(timeAgo(x.at))}・${STATUS_LABEL[x.status] ?? ''}</p>
      <p>${escapeHtml(x.text)}</p>
      ${x.picked ? `<p class="small">要約「${escapeHtml(x.picked.summary)}」／答え「${escapeHtml(x.picked.answer)}」</p>` : ''}
      ${x.status === 'done' ? '' : `<form class="meyasu-pick">
        <label class="field">要約（${MAX_SUMMARY}文字まで・本人と分からない言い方で）<input class="input" name="summary" maxlength="${MAX_SUMMARY}" value="${escapeHtml(x.picked?.summary ?? '')}" required></label>
        <label class="field">運営の答え（${MAX_ANSWER}文字まで）<textarea class="input" name="answer" maxlength="${MAX_ANSWER}" rows="2" required>${escapeHtml(x.picked?.answer ?? '')}</textarea></label>
        <div class="row wrap"><button class="btn" type="submit">${x.picked ? '直す' : '新聞でとりあげる'}</button>
        <button class="btn ghost" type="button" data-close>片づける</button></div></form>`}
    </li>`).join('') : '<li class="muted small">まだ届いていません</li>';
}
$('#meyasu-admin').addEventListener('toggle', () => { if ($('#meyasu-admin').open) loadMeyasuAdmin().catch((x) => toast(x.message, 5000)); });
$('#meyasu-admin-list').addEventListener('submit', async (e) => {
  e.preventDefault();
  const li = e.target.closest('[data-id]');
  try {
    await api(`/suggestions/${encodeURIComponent(li.dataset.id)}/pick`, { method: 'POST', body: { summary: e.target.elements.summary.value.trim(), answer: e.target.elements.answer.value.trim() } });
    toast('📰 新聞の「目安箱から」にのせました');
    await loadMeyasu();
    await loadMeyasuAdmin();
  } catch (x) {
    toast(x.message, 5000);
  }
});
$('#meyasu-admin-list').addEventListener('click', async (e) => {
  if (!e.target.closest('[data-close]')) return;
  const li = e.target.closest('[data-id]');
  if (!confirm('この声を片づけますか？（新聞にのっていたら、外れます）')) return;
  try {
    await api(`/suggestions/${encodeURIComponent(li.dataset.id)}/close`, { method: 'POST' });
    await loadMeyasu();
    await loadMeyasuAdmin();
  } catch (x) {
    toast(x.message, 5000);
  }
});
$('#meyasu-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const err = e.target.querySelector('.error');
  err.textContent = '';
  try {
    const { reply } = await api('/suggestions', { method: 'POST', body: { topic: f.topic.value, text: f.text.value.trim() } });
    e.target.reset();
    $('#meyasu-reply').innerHTML = `<img src="${face(reply.by)}" alt="" width="40" height="40"><p><strong>${escapeHtml(AGENT_NAMES[reply.by] ?? '')} 記者</strong>：${escapeHtml(reply.text)}</p>`;
    $('#meyasu-reply').hidden = false;
  } catch (x) {
    err.textContent = x.offline ? 'つながっていません。つながってから、もう一度どうぞ' : x.message;
  }
});

markNewsSeen();
$('#header').innerHTML = headerHtml('news');
await refreshMe().catch(() => null);
$('#header').innerHTML = headerHtml('news');
await load();
await loadMeyasu();
// 書いている途中で紙面が作りなおされないように、入力中は待つ
onServerEvents({
  news: () => {
    if (!document.activeElement?.closest('.vote-form')) load();
    if (!document.activeElement?.closest('.meyasu-pick')) loadMeyasu();
  },
});
