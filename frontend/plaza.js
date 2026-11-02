// 広場（フロントエンド）：人間とキャラのおしゃべり。タイムラインを LINE のような会話の形で見せる
import {
  api, onServerEvents, getMe, login, escapeHtml, timeAgo, avatarHtml, headerHtml, toast,
} from '/shared/api.js';
import { speak } from '/shared/speech.js';
import { sendPost, getOutbox, flushOutbox } from '/shared/outbox.js';

const $ = (sel) => document.querySelector(sel);
const header = $('#header');
const loginForm = $('#login-form');
const composer = $('#composer');
const textarea = $('#post-text');
const log = $('#chat-log');
const replyTarget = $('#reply-target');

let me = getMe();
let replyTo = null;
let posts = [];

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
    : escapeHtml(a.name);
  return `<li class="msg${mine ? ' mine' : ''}">
    ${mine ? '' : avatarHtml(a, 40, { speak: post.id, label: `${a.name}さんの発言を読み上げ` })}
    <div class="msg-body">
      ${mine ? '' : `<span class="msg-name">${name}</span>`}
      <div class="bubble">
        ${parent ? `<span class="quote">↩ ${escapeHtml(parent.author.name)}「${escapeHtml(snippet(parent.text))}」</span>` : ''}
        <p>${escapeHtml(post.text)}</p>
      </div>
      <div class="msg-meta">
        <time datetime="${post.createdAt}">${timeAgo(post.createdAt)}</time>
        <button type="button" class="msg-act${liked ? ' liked' : ''}" data-like="${post.id}" aria-pressed="${Boolean(liked)}"
          aria-label="いいね ${post.likeCount}件">${liked ? '♥' : '♡'} ${post.likeCount || ''}</button>
        <button type="button" class="msg-act" data-reply="${post.id}">返信</button>
        ${mine ? `<button type="button" class="msg-act" data-speak="${post.id}" aria-label="読み上げ">🔊</button>` : ''}
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
    posts = (await api('/posts')).slice(0, 100); // オフラインなら、この端末に保存しておいた投稿が返る
  } catch (err) {
    if (!err.offline) throw err;
  }
  render();
}

async function loadMembers() {
  try {
    const agents = (await api('/agents')).filter((a) => (a.place ?? 'house') === 'house');
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

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    me = await login($('#login-name').value);
    renderAuth();
    render();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

// Enter で送信、Shift+Enter で改行
textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    composer.requestSubmit();
  }
});

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#post-btn');
  $('#post-error').textContent = '';
  if (!textarea.value.trim()) return;
  btn.disabled = true;
  try {
    const result = await sendPost({ authorId: me.id, text: textarea.value.trim(), replyTo });
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

log.addEventListener('click', async (e) => {
  const speakBtn = e.target.closest('[data-speak]');
  if (speakBtn) {
    const post = posts.find((p) => p.id === speakBtn.dataset.speak);
    if (post) speak(post.text, post.author, speakBtn);
    return;
  }
  const replyBtn = e.target.closest('[data-reply]');
  if (replyBtn) {
    if (!me) return $('#login-name').focus();
    return setReply(replyBtn.dataset.reply);
  }
  const likeBtn = e.target.closest('[data-like]');
  if (likeBtn) {
    if (!me) return $('#login-name').focus();
    try {
      await api(`/posts/${likeBtn.dataset.like}/like`, { method: 'POST', body: { userId: me.id } });
      await loadPosts();
    } catch (err) {
      toast(err.offline ? '📴 オフラインなので、いいねはつながってからにしてね' : err.message);
    }
  }
});

renderAuth();
loadPosts();
loadMembers();
onServerEvents({ post: loadPosts, like: loadPosts, agent: loadMembers });
window.addEventListener('outbox-change', render);
window.addEventListener('outbox-sent', loadPosts);
flushOutbox();
setInterval(render, 60000); // 「◯分前」表示を更新
