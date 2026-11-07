// 広場（フロントエンド）：人間とキャラのおしゃべり。タイムラインを LINE のような会話の形で見せる
import {
  api, onServerEvents, refreshMe, escapeHtml, timeAgo, avatarHtml, headerHtml, toast,
} from '/shared/api.js';
import { speak } from '/shared/speech.js';
import { sendPost, getOutbox, flushOutbox } from '/shared/outbox.js';
import { precheck } from '/shared/precheck.js';
import { REPORT_REASONS, APOLOGY_CHOICES, MAX_APOLOGY } from '/shared/report.js';

const $ = (sel) => document.querySelector(sel);
const header = $('#header');
const loginForm = $('#login-form');
const composer = $('#composer');
const textarea = $('#post-text');
const log = $('#chat-log');
const replyTarget = $('#reply-target');

let me = await refreshMe();
let replyTo = null;
// ?thread=投稿のID：ともはね新聞のスレッドを開いているとき
const threadId = new URLSearchParams(location.search).get('thread');
// カフェ（cafe.html）：テーブルごとのタイムライン。?table=ID でテーブルをえらぶ（なければフリーテーブル）
const cafeMode = document.body.hasAttribute('data-cafe');
let table = cafeMode ? (new URLSearchParams(location.search).get('table') || 'free') : null;
let tables = [];
let posts = [];
let agentsById = {};
let checkedText = null; // キャラたちが声をかけたあと「このまま送る」を選んだ文面

function renderAuth() {
  header.innerHTML = headerHtml(cafeMode ? 'cafe' : 'plaza');
  loginForm.hidden = Boolean(me);
  composer.hidden = !me;
}

function snippet(text, n = 20) {
  const t = [...text];
  return t.length > n ? `${t.slice(0, n).join('')}…` : text;
}

// 1つの吹き出し。自分の発言は右、ほかの人とキャラは左
function bubbleHtml(post) {
  const a = post.author;
  const mine = me && a.id === me.id;
  const liked = me && post.likes.includes(me.id);
  const parent = post.replyTo && posts.find((p) => p.id === post.replyTo);
  const name = a.kind === 'agent'
    ? `<a href="${a.place === 'cafe' ? '/cafe.html' : `/side/#${a.id}`}">${escapeHtml(a.name)}</a>`
    : a.kind === 'official' ? `<a href="/news.html">${escapeHtml(a.name)}</a> <span class="official-badge">公式</span>` : escapeHtml(a.name);
  // 広場の一覧では、スレッドのはじまりに「スレッドを開く」を出す（スレッドの中の返信は一覧に出さない）
  const threadLink = post.thread && !threadId
    ? `<a class="thread-link" href="?thread=${encodeURIComponent(post.id)}">💬 スレッドを読む・話す（${post.replyCount ?? 0}件）</a>` : '';
  return `<li class="msg${mine ? ' mine' : ''}">
    ${mine ? '' : avatarHtml(a, 40, { speak: post.id, label: `${a.name}さんの発言を読み上げ` })}
    <div class="msg-body">
      ${mine ? '' : `<span class="msg-name">${name}</span>`}
      <div class="bubble">
        ${parent ? `<span class="quote">↩ ${escapeHtml(parent.author.name)}「${escapeHtml(snippet(parent.text))}」</span>` : ''}
        <p>${escapeHtml(post.text)}</p>
        ${threadLink}
        ${mine && post.orphaned ? '<span class="held-note">↩ 元の投稿は消えました（あなたにだけ見えています）</span>' : ''}
        ${mine && post.hidden ? `<span class="held-note">🔒 ${post.hidden === 'admin' ? '運営が止めました。' : '運営が見るまで、'}ほかの人には見えていません</span>` : ''}
      </div>
      <div class="msg-meta">
        <time datetime="${post.createdAt}">${timeAgo(post.createdAt)}</time>
        <button type="button" class="msg-act${liked ? ' liked' : ''}" data-like="${post.id}" aria-pressed="${Boolean(liked)}"
          aria-label="いいね ${post.likeCount}件">${liked ? '♥' : '♡'} ${post.likeCount || ''}</button>
        <button type="button" class="msg-act" data-reply="${post.id}">返信</button>
        ${mine ? `<button type="button" class="msg-act" data-speak="${post.id}" aria-label="読み上げ">🔊</button>
          <button type="button" class="msg-act" data-delete="${post.id}" aria-label="この投稿を消す">🗑</button>` : ''}
        ${me && !mine && a.kind === 'human' ? `<button type="button" class="msg-act" data-report="${post.id}" aria-label="この投稿を通報">🚩</button>
          <button type="button" class="msg-act" data-block="${a.id}" aria-label="${escapeHtml(a.name)}さんをミュート・ブロック">🚫</button>` : ''}
      </div>
    </div>
  </li>`;
}

// ローカル回線：オフラインでためた「送信待ち」の自分の発言
function pendingHtml() {
  if (!me) return '';
  return getOutbox().filter((x) => x.authorId === me.id && (x.table ?? null) === table).map((x) => `<li class="msg mine pending">
    <div class="msg-body">
      <div class="bubble"><p>${escapeHtml(x.text)}</p></div>
      <div class="msg-meta"><span class="pending-badge">📮 送信待ち</span></div>
    </div>
  </li>`).join('');
}

function render() {
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  // 会話なので、古い順に上から並べる
  const ordered = [...posts].reverse();
  log.innerHTML = (ordered.length ? ordered.map(bubbleHtml).join('') : '<li class="empty">まだだれも話していません</li>')
    + pendingHtml();
  if (nearBottom || !render.done) log.scrollTop = log.scrollHeight;
  render.done = true;
}

async function loadPosts() {
  try {
    if (cafeMode) {
      posts = (await api(`/posts?table=${encodeURIComponent(table)}`)).slice(0, 100);
    } else if (threadId) {
      const t = await api(`/threads/${encodeURIComponent(threadId)}`);
      posts = [...t.posts].reverse(); // 画面は新しい順の配列を古い順に並べなおして出す
    } else {
      // オフラインなら、この端末に保存しておいた投稿が返る
      posts = (await api('/posts')).filter((p) => !p.threadId || p.thread).slice(0, 100);
    }
  } catch (err) {
    if (err.status === 404 && threadId) {
      toast('スレッドが見つかりません。広場にもどります');
      setTimeout(() => { location.href = '/plaza.html'; }, 1500);
      return;
    }
    if (!err.offline) throw err;
  }
  render();
}

async function loadMembers() {
  try {
    const all = await api('/agents');
    agentsById = Object.fromEntries(all.map((a) => [a.id, a]));
    const agents = all.filter((a) => (a.place ?? 'house') === (cafeMode ? 'cafe' : 'house'));
    const here = agents.filter((a) => a.status === 'home')
      .map((a) => (cafeMode && a.roleLabel ? `${a.roleLabel.replace(/^カフェの/, '')}の${a.name}` : a.name));
    $('#chat-members').textContent = here.length ? `${here.join('・')} がいます` : (cafeMode ? 'マスターも店員さんも、ひと休み中です' : 'キャラたちはお出かけ中です');
  } catch { /* noop */ }
}

function setReply(postId) {
  replyTo = postId;
  const target = posts.find((p) => p.id === postId);
  replyTarget.hidden = !target;
  if (target) {
    replyTarget.querySelector('span').textContent = `↩ ${target.author.name}「${snippet(target.text)}」に返信`;
    textarea.focus();
  }
}


// Enter で送信、Shift+Enter で改行
textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

// ---- 送る前のチェック ----
const precheckBox = $('#precheck');
const KIND_LABEL = { warning: '注意', question: '質問', opinion: '意見', comfort: 'よりそい' };

function showPrecheck(result) {
  $('#precheck-lines').innerHTML = result.lines.map((l) => {
    const a = agentsById[l.agentId];
    const face = a?.avatar ? `<img src="${a.avatar}" alt="" width="32" height="32">` : '';
    return `<li class="precheck-line" data-kind="${l.kind}">${face}
      <div><span class="precheck-who">${escapeHtml(a?.name ?? '')}<span class="precheck-kind">${KIND_LABEL[l.kind]}</span></span>
      <p>${escapeHtml(l.text)}</p></div></li>`;
  }).join('');
  precheckBox.dataset.level = result.level;
  $('#precheck-send').hidden = result.level === 'block'; // 犯罪につながるものは送れない
  $('#precheck-title').textContent = result.level === 'block' ? 'この内容は送れません' : '送る前に、みんなから';
  precheckBox.hidden = false;
  (result.level === 'block' ? precheckBox.querySelector('[data-precheck="edit"]') : $('#precheck-send')).focus();
  // 遊び場のキャラも、同じことを吹き出しで言う
  const [first] = result.lines;
  if (first) window.dispatchEvent(new CustomEvent('agent-say', { detail: { agentId: first.agentId, text: first.text } }));
}
function hidePrecheck() {
  precheckBox.hidden = true;
}

precheckBox.addEventListener('click', (e) => {
  const action = e.target.closest('[data-precheck]')?.dataset.precheck;
  if (!action) return;
  hidePrecheck();
  if (action === 'send') {
    checkedText = textarea.value.trim();
    composer.requestSubmit();
  } else if (action === 'edit') {
    textarea.focus();
  } else {
    textarea.value = '';
    setReply(null);
    textarea.focus();
  }
});
// 書き直したら、もう一度チェックする
textarea.addEventListener('input', () => {
  checkedText = null;
  if (!precheckBox.hidden) hidePrecheck();
});

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#post-btn');
  $('#post-error').textContent = '';
  const text = textarea.value.trim();
  if (!text) return;
  const check = precheck(text);
  if (check.level === 'block' || (check.level === 'notice' && checkedText !== text)) {
    showPrecheck(check);
    return;
  }
  checkedText = null;
  btn.disabled = true;
  try {
    // スレッドを開いているときは、返信を選んでいなくてもスレッドに書く
    const result = await sendPost({ authorId: me.id, text: textarea.value.trim(), replyTo: replyTo ?? (threadId || null), ...(cafeMode && !replyTo ? { table } : {}) }); // authorId は送信待ちの表示用。サーバーはログインしている本人として扱う
    textarea.value = '';
    setReply(null);
    if (result.queued) {
      toast('📮 オフラインなので送信待ちにためました。つながったら自動で送ります');
      render();
    } else {
      await loadPosts();
    }
    log.scrollTop = log.scrollHeight;
  } catch (err) {
    $('#post-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#cancel-reply').addEventListener('click', () => setReply(null));

// ---- ミュート・ブロック（どちらにするかは本人が選ぶ） ----
// ブロックで理由を書かずに押したときだけ、シバがさびしそうに1回だけ聞く（押しまちがい・携帯が変わった・家族がさわった、のため）
const blockDialog = $('#block-dialog');
const blockForm = $('#block-form');
const KIND_NAME = { mute: 'ミュート', block: 'ブロック' };
let blockTarget = null;
let blockAsked = false;

const chosenKind = () => blockForm.kind.value || 'block';

function setBlockStep(asking) {
  blockAsked = asking;
  const kind = KIND_NAME[chosenKind()];
  $('#block-reason-box').hidden = asking;
  $('#block-say').textContent = asking
    ? '……まちがえてないっすか？　押しまちがいや、おうちの人がさわっちゃったこともあるっす。'
    : `${blockTarget.name}さんをどうするっすか？　どっちも相手には知らせないから、安心してほしいっす。`;
  $('#block-cancel').textContent = asking ? 'まちがえた' : 'やめる';
  $('#block-ok').textContent = `${kind}する`;
}

function openBlock(author) {
  blockTarget = author;
  blockForm.reset();
  $('#block-error').textContent = '';
  $('#block-title').textContent = `${author.name}さんをミュート・ブロック`;
  setBlockStep(false);
  blockDialog.showModal();
}

blockDialog.addEventListener('click', (e) => {
  if (e.target === blockDialog || e.target.closest('[data-close]')) blockDialog.close();
});
blockForm.addEventListener('change', (e) => { if (e.target.name === 'kind') setBlockStep(false); });

blockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = blockForm.reason.value.trim();
  const kind = chosenKind();
  if (kind === 'block' && !reason && !blockAsked) {
    setBlockStep(true);
    $('#block-ok').focus();
    return;
  }
  $('#block-ok').disabled = true;
  try {
    await api(`/blocks/${encodeURIComponent(blockTarget.id)}`, { method: 'PUT', body: { reason, kind } });
    blockDialog.close();
    toast(`🐕 ${blockTarget.name}さんを${KIND_NAME[kind]}したっす。外したくなったら、アカウントのページからいつでもできるっす`);
    if (replyTo && posts.find((p) => p.id === replyTo)?.author.id === blockTarget.id) setReply(null);
    await loadPosts();
  } catch (err) {
    $('#block-error').textContent = err.offline ? '📴 オフラインなので、つながってからにしてほしいっす' : err.message;
  } finally {
    $('#block-ok').disabled = false;
  }
});

// ---- 投稿を消す ----
const FAREWELLS = ['ありがとう', '頑張ります', '応援してください'];
const deleteDialog = $('#delete-dialog');
const deleteForm = $('#delete-form');
let deletePost = null;
$('#farewell-choices').insertAdjacentHTML('beforeend', [...FAREWELLS, ''].map((t, i) => `<label class="block-kind">
  <input type="radio" name="farewell" value="${escapeHtml(t)}"${i === 0 ? ' checked' : ''}>
  <span><strong>${t ? `「${escapeHtml(t)}」` : '✏️ 自分のことばで'}</strong></span></label>`).join(''));
deleteForm.addEventListener('change', (e) => {
  if (e.target.name === 'farewell') $('#farewell-own-box').hidden = e.target.value !== '';
});

// 画面に出ている返信のうち、ほかの人が書いたもの（返信の返信もふくむ）
function othersReplied(postId) {
  const ids = new Set([postId]);
  let found = false;
  for (let changed = true; changed;) {
    changed = false;
    for (const p of posts) {
      if (p.replyTo && ids.has(p.replyTo) && !ids.has(p.id)) {
        ids.add(p.id);
        changed = true;
        if (p.author.kind === 'human' && p.author.id !== me?.id) found = true;
      }
    }
  }
  return found;
}

function openDelete(post) {
  deletePost = post;
  deleteForm.reset();
  $('#farewell-own-box').hidden = true;
  $('#delete-error').textContent = '';
  $('#delete-quote').textContent = `「${snippet(post.text, 40)}」`;
  $('#delete-farewell').hidden = !othersReplied(post.id);
  deleteDialog.showModal();
}
deleteDialog.addEventListener('click', (e) => {
  if (e.target === deleteDialog || e.target.closest('[data-close]')) deleteDialog.close();
});
deleteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  // 画面に出ていない返信（ブロックした人など）があるかもしれないので、ひとことはいつも送る（返信した人がいなければ使われない）
  const picked = deleteForm.farewell.value;
  const farewell = picked || deleteForm.own.value.trim();
  if (!farewell) {
    $('#delete-error').textContent = '自分のことばを入れてね！';
    return;
  }
  if (!picked && precheck(farewell).level === 'block') {
    $('#delete-error').textContent = `この内容は送れません（${precheck(farewell).reason}）`;
    return;
  }
  $('#delete-ok').disabled = true;
  try {
    const r = await api(`/posts/${encodeURIComponent(deletePost.id)}/delete`, { method: 'POST', body: { farewell } });
    deleteDialog.close();
    if (replyTo === deletePost.id) setReply(null);
    toast(r.told
      ? `🐰 消したよ！ 返信してくれた人に「${farewell}」を届けたよ。また待ってるよ〜！`
      : '🐰 消したよ！ また待ってるよ〜！', 5000);
    await loadPosts();
    await loadNotices();
  } catch (err) {
    $('#delete-error').textContent = err.offline ? '📴 オフラインだから、つながってからにしてね' : err.message;
  } finally {
    $('#delete-ok').disabled = false;
  }
});

// ---- 通報 ----
const reportDialog = $('#report-dialog');
const reportForm = $('#report-form');
let reportPost = null;
$('#report-reasons').insertAdjacentHTML('beforeend', REPORT_REASONS.map((r) => `<label class="block-kind">
  <input type="radio" name="reason" value="${r.id}" required>
  <span><strong>${escapeHtml(r.label)}</strong><span class="muted small">${r.level === 'heavy' ? '重い' : '軽い'}</span></span></label>`).join(''));

function openReport(post) {
  reportPost = post;
  reportForm.reset();
  $('#report-error').textContent = '';
  $('#report-quote').textContent = `${post.author.name}「${snippet(post.text, 40)}」`;
  reportDialog.showModal();
}
reportDialog.addEventListener('click', (e) => {
  if (e.target === reportDialog || e.target.closest('[data-close]')) reportDialog.close();
});
reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = reportForm.reason.value;
  if (!reason) return;
  $('#report-ok').disabled = true;
  try {
    const r = await api(`/posts/${encodeURIComponent(reportPost.id)}/report`, { method: 'POST', body: { reason } });
    reportDialog.close();
    toast(r.level === 'heavy'
      ? '🐕 通報したっす。運営が見るっす。こわいときは、おうちの人や近くの大人にも話してほしいっす'
      : '🐕 通報したっす。教えてくれてありがとうっす。その投稿は、もう出さないっす', 6000);
    await loadPosts();
  } catch (err) {
    $('#report-error').textContent = err.offline ? '📴 オフラインなので、つながってからにしてほしいっす' : err.message;
  } finally {
    $('#report-ok').disabled = false;
  }
});

// ---- 自分へのお知らせ（通報された投稿へのキャラの声・届いたあやまり） ----
const noticeBox = $('#report-notices');
let notices = { notices: [], apologies: [] };

function noticeHtml(n) {
  const g = n.guide;
  const apology = n.apologized
    ? '<p class="muted small">あやまりは届けたっす。</p>'
    : `<details class="apology"><summary class="link-btn">あやまる</summary>
        <div class="apology-choices">${APOLOGY_CHOICES.map((c) => `<button type="button" class="btn ghost" data-apology="${n.postId}" data-text="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</div>
        <form class="row" data-apology-form="${n.postId}">
          <label class="sr-only" for="apology-${n.postId}">自分のことば</label>
          <input class="input" id="apology-${n.postId}" name="text" maxlength="${MAX_APOLOGY}" placeholder="自分のことばで（${MAX_APOLOGY}文字まで）">
          <button class="btn" type="submit">届ける</button>
        </form>
        <p class="muted small">あやまりは、通報した人が「読む」をえらんだときだけ届きます。だれが通報したかは、わかりません。</p>
      </details>`;
  return `<article class="report-notice" data-stage="${n.stage}">
    <div class="say-line"><img src="${g.avatar}" alt="" width="44" height="44">
      <div><p class="precheck-who">${escapeHtml(g.name)}${g.note ? `<span class="precheck-kind">${escapeHtml(g.note)}</span>` : ''}</p>
      <p>${escapeHtml(g.text)}</p></div></div>
    <p class="report-quote">あなたの投稿「${escapeHtml(snippet(n.text, 40))}」</p>
    ${n.stage === 'stopped' ? '' : apology}
    <div class="row end">
      <button type="button" class="btn ghost" data-notice-delete="${n.postId}" data-text="${escapeHtml(n.text)}">🗑 消す</button>
      <button type="button" class="btn ghost" data-seen="${n.postId}">わかった</button>
    </div>
  </article>`;
}
function apologyAskHtml(a) {
  return `<article class="report-notice" data-stage="apology">
    <div class="say-line"><img src="/shared/avatars/shiba.svg" alt="" width="44" height="44">
      <p>${escapeHtml(a.from)}さんから、あやまりが届いているっす。読むっすか？ 読まなくても大丈夫っす。</p></div>
    <div class="row end" data-apology-ask="${a.id}">
      <button type="button" class="btn ghost" data-read="0">読まない</button>
      <button type="button" class="btn" data-read="1">読む</button>
    </div>
  </article>`;
}
function farewellHtml(f) {
  return `<article class="report-notice" data-stage="farewell">
    <div class="say-line"><img src="/shared/avatars/usagi.svg" alt="" width="44" height="44">
      <p>${escapeHtml(f.from)}さんが、あなたが返信した投稿を消したよ。返信も一緒に見えなくなったんだ。${escapeHtml(f.from)}さんから、あなたへ：「${escapeHtml(f.text)}」</p></div>
    <div class="row end"><button type="button" class="btn ghost" data-farewell="${f.id}">わかった</button></div>
  </article>`;
}
function renderNotices() {
  const html = notices.notices.map(noticeHtml).join('') + (notices.farewells ?? []).map(farewellHtml).join('')
    + notices.apologies.map(apologyAskHtml).join('');
  noticeBox.innerHTML = html;
  noticeBox.hidden = !html;
}
async function loadNotices() {
  if (!me) return;
  try { notices = await api('/reports/mine'); } catch { return; }
  renderNotices();
}
async function sendApology(postId, text) {
  try {
    await api(`/posts/${encodeURIComponent(postId)}/apology`, { method: 'POST', body: { text } });
    toast('🐕 あやまりを届けたっす。勇気を出してえらいっす');
    await loadNotices();
  } catch (err) {
    toast(err.message, 5000);
  }
}
noticeBox.addEventListener('click', async (e) => {
  const seen = e.target.closest('[data-seen]');
  if (seen) {
    await api(`/reports/notices/${encodeURIComponent(seen.dataset.seen)}/seen`, { method: 'POST' }).catch(() => {});
    return loadNotices();
  }
  const fw = e.target.closest('[data-farewell]');
  if (fw) {
    await api(`/farewells/${encodeURIComponent(fw.dataset.farewell)}/seen`, { method: 'POST' }).catch(() => {});
    return loadNotices();
  }
  const nd = e.target.closest('[data-notice-delete]');
  if (nd) return openDelete(posts.find((p) => p.id === nd.dataset.noticeDelete) ?? { id: nd.dataset.noticeDelete, text: nd.dataset.text });
  const pick = e.target.closest('[data-apology]');
  if (pick) return sendApology(pick.dataset.apology, pick.dataset.text);
  const ans = e.target.closest('[data-read]');
  if (ans) {
    const box = ans.closest('[data-apology-ask]');
    try {
      const r = await api(`/reports/${encodeURIComponent(box.dataset.apologyAsk)}/apology`, { method: 'POST', body: { read: ans.dataset.read === '1' } });
      if (r.text) box.outerHTML = `<p class="apology-text">「${escapeHtml(r.text)}」</p>`;
      else await loadNotices();
    } catch (err) {
      toast(err.message, 5000);
    }
  }
});
noticeBox.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-apology-form]');
  if (!form) return;
  e.preventDefault();
  const text = form.text.value.trim();
  if (!text) return;
  const check = precheck(text);
  if (check.level === 'block') return toast(`この内容は送れません（${check.reason}）`, 5000);
  sendApology(form.dataset.apologyForm, text);
});

log.addEventListener('click', async (e) => {
  const speakBtn = e.target.closest('[data-speak]');
  if (speakBtn) {
    const post = posts.find((p) => p.id === speakBtn.dataset.speak);
    if (post) speak(post.text, post.author, speakBtn);
    return;
  }
  const replyBtn = e.target.closest('[data-reply]');
  if (replyBtn) {
    if (!me) return loginForm.querySelector('a').focus();
    return setReply(replyBtn.dataset.reply);
  }
  const deleteBtn = e.target.closest('[data-delete]');
  if (deleteBtn) {
    const post = posts.find((p) => p.id === deleteBtn.dataset.delete);
    if (post) openDelete(post);
    return;
  }
  const reportBtn = e.target.closest('[data-report]');
  if (reportBtn) {
    const post = posts.find((p) => p.id === reportBtn.dataset.report);
    if (post) openReport(post);
    return;
  }
  const blockBtn = e.target.closest('[data-block]');
  if (blockBtn) {
    const post = posts.find((p) => p.author.id === blockBtn.dataset.block);
    if (post) openBlock(post.author);
    return;
  }
  const likeBtn = e.target.closest('[data-like]');
  if (likeBtn) {
    if (!me) return loginForm.querySelector('a').focus();
    try {
      await api(`/posts/${likeBtn.dataset.like}/like`, { method: 'POST', body: { userId: me.id } });
      await loadPosts();
    } catch (err) {
      toast(err.offline ? '📴 オフラインなので、いいねはつながってからにしてね' : err.message);
    }
  }
});

// ---- カフェのテーブル ----
async function loadTables() {
  try { tables = await api('/cafe/tables'); } catch { return; }
  if (!tables.some((t) => t.id === table)) table = tables[0]?.id ?? 'free';
  $('#cafe-tables').innerHTML = tables.map((t) => `<button type="button" class="cafe-table" data-table="${escapeHtml(t.id)}"
    aria-pressed="${t.id === table}">${escapeHtml(t.emoji)} ${escapeHtml(t.name)}<span class="cafe-count">${t.postCount}</span></button>`).join('');
  const cur = tables.find((t) => t.id === table);
  if (cur) $('#cafe-guide-text').textContent = `いらっしゃいませ。こちら「${cur.name}」です。${cur.note ? `${cur.note}。` : ''}ごゆっくりどうぞ。`;
}
if (cafeMode) {
  $('#cafe-request').hidden = !me;
  $('#cafe-request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    try {
      await api('/cafe/requests', { method: 'POST', body: { text } });
      e.target.reset();
      $('#cafe-request').open = false;
      toast(`🐧 「${text}」のリクエスト、うけたまわりました。マスターと運営に、きちんとお伝えします`, 5000);
    } catch (err) {
      toast(err.offline ? '📴 オフラインなので、つながってからお願いします' : err.message, 5000);
    }
  });
  $('#cafe-tables').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-table]');
    if (!btn || btn.dataset.table === table) return;
    table = btn.dataset.table;
    history.replaceState(null, '', `?table=${encodeURIComponent(table)}`);
    setReply(null);
    render.done = false;
    loadTables();
    loadPosts();
  });
  loadTables();
}

renderAuth();
if (threadId) {
  $('#chat-title').textContent = '📰 ともはね新聞のスレッド';
  $('#chat-members').innerHTML = '<a href="/news.html">新聞を読む</a>・記者のキャラたちも読んでいます';
  const back = document.querySelector('.back-link');
  back.href = '/plaza.html';
  back.setAttribute('aria-label', '広場にもどる');
  textarea.placeholder = 'この号の感想や質問を書こう';
}
// ゴーストエージェントなどから「広場で知らせる」で来たとき：下書きを入れるだけ。送るかどうかは本人が決める
const draft = new URLSearchParams(location.search).get('draft');
if (draft && me) {
  textarea.value = draft.slice(0, 280);
  history.replaceState(null, '', location.pathname);
  textarea.focus();
}
loadPosts();
loadNotices();
if (!threadId) loadMembers();
onServerEvents({ post: () => { loadPosts(); if (cafeMode) loadTables(); }, like: loadPosts, agent: loadMembers, table: () => { if (cafeMode) loadTables(); } });
window.addEventListener('outbox-change', render);
window.addEventListener('outbox-sent', loadPosts);
flushOutbox();
setInterval(render, 60000); // 「◯分前」表示を更新
