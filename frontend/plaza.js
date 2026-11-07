// 広場（フロントエンド）：人間とキャラのおしゃべり。タイムラインを LINE のような会話の形で見せる
import {
  api, onServerEvents, refreshMe, escapeHtml, timeAgo, avatarHtml, headerHtml, toast,
} from '/shared/api.js';
import { speak } from '/shared/speech.js';
import { sendPost, getOutbox, flushOutbox } from '/shared/outbox.js';
import { precheck } from '/shared/precheck.js';

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
let posts = [];
let agentsById = {};
let checkedText = null; // キャラたちが声をかけたあと「このまま送る」を選んだ文面

function renderAuth() {
  header.innerHTML = headerHtml('plaza');
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
    ? `<a href="/side/#${a.id}">${escapeHtml(a.name)}</a>`
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
      </div>
      <div class="msg-meta">
        <time datetime="${post.createdAt}">${timeAgo(post.createdAt)}</time>
        <button type="button" class="msg-act${liked ? ' liked' : ''}" data-like="${post.id}" aria-pressed="${Boolean(liked)}"
          aria-label="いいね ${post.likeCount}件">${liked ? '♥' : '♡'} ${post.likeCount || ''}</button>
        <button type="button" class="msg-act" data-reply="${post.id}">返信</button>
        ${mine ? `<button type="button" class="msg-act" data-speak="${post.id}" aria-label="読み上げ">🔊</button>` : ''}
        ${me && !mine && a.kind === 'human' ? `<button type="button" class="msg-act" data-block="${a.id}" aria-label="${escapeHtml(a.name)}さんをミュート・ブロック">🚫</button>` : ''}
      </div>
    </div>
  </li>`;
}

// ローカル回線：オフラインでためた「送信待ち」の自分の発言
function pendingHtml() {
  if (!me) return '';
  return getOutbox().filter((x) => x.authorId === me.id).map((x) => `<li class="msg mine pending">
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
    if (threadId) {
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
    const agents = all.filter((a) => (a.place ?? 'house') === 'house');
    const here = agents.filter((a) => a.status === 'home').map((a) => a.name);
    $('#chat-members').textContent = here.length ? `${here.join('・')} がいます` : 'キャラたちはお出かけ中です';
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
    const result = await sendPost({ authorId: me.id, text: textarea.value.trim(), replyTo: replyTo ?? (threadId || null) }); // authorId は送信待ちの表示用。サーバーはログインしている本人として扱う
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
if (!threadId) loadMembers();
onServerEvents({ post: loadPosts, like: loadPosts, agent: loadMembers });
window.addEventListener('outbox-change', render);
window.addEventListener('outbox-sent', loadPosts);
flushOutbox();
setInterval(render, 60000); // 「◯分前」表示を更新
