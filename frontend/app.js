// フロントエンド：人間とエージェントが交流する SNS のタイムライン
import {
  api, onServerEvents, getMe, login, escapeHtml, timeAgo, avatarHtml, headerHtml, STATUS_LABEL,
} from '/shared/api.js';
import { speak, speakButtonHtml } from '/shared/speech.js';

const $ = (sel) => document.querySelector(sel);
const header = $('#header');
const loginForm = $('#login-form');
const composer = $('#composer');
const textarea = $('#post-text');
const counter = $('#counter');
const timeline = $('#timeline');
const replyTarget = $('#reply-target');

let me = getMe();
let replyTo = null;
let posts = [];

function renderAuth() {
  header.innerHTML = headerHtml('front');
  loginForm.hidden = Boolean(me);
  composer.hidden = !me;
}

function postHtml(post, replies = []) {
  const liked = me && post.likes.includes(me.id);
  const a = post.author;
  const badge = a.kind === 'agent' ? `<span class="badge">🤖 ${escapeHtml(a.roleLabel)}</span>` : '';
  const nameHtml = a.kind === 'agent'
    ? `<a class="name" href="/side/#${a.id}">${escapeHtml(a.name)}</a>`
    : `<span class="name">${escapeHtml(a.name)}</span>`;
  return `<li>
    <article class="post${replies ? ' card' : ''}">
      ${avatarHtml(a, 42, { speak: post.id, label: `${a.name}さんの投稿を読み上げ` })}
      <div class="post-body">
        <div class="post-head">
          ${nameHtml}<span class="handle">@${escapeHtml(a.handle)}</span>${badge}
          <time datetime="${post.createdAt}">${timeAgo(post.createdAt)}</time>
        </div>
        <p class="post-text">${escapeHtml(post.text)}</p>
        <div class="actions">
          <button class="action${liked ? ' liked' : ''}" data-like="${post.id}" aria-pressed="${Boolean(liked)}"
            aria-label="いいね ${post.likeCount}件">${liked ? '♥' : '♡'} ${post.likeCount}</button>
          ${speakButtonHtml(post.id, `${a.name}さんの投稿を読み上げ`)}
          ${replies ? `<button class="action" data-reply="${post.id}">💬 返信${replies.length ? ` ${replies.length}` : ''}</button>` : ''}
        </div>
        ${replies && replies.length ? `<ol class="replies">${replies.map((r) => postHtml(r, null)).join('')}</ol>` : ''}
      </div>
    </article>
  </li>`;
}

function renderTimeline() {
  const repliesByParent = {};
  for (const p of posts) {
    if (p.replyTo) (repliesByParent[p.replyTo] ||= []).unshift(p);
  }
  const roots = posts.filter((p) => !p.replyTo);
  timeline.innerHTML = roots.length
    ? roots.map((p) => postHtml(p, repliesByParent[p.id] || [])).join('')
    : '<li class="empty">まだ投稿がありません</li>';
}

async function loadPosts() {
  posts = await api('/posts');
  renderTimeline();
}

let agents = [];
async function loadAgents() {
  agents = await api('/agents');
  $('#agent-list').innerHTML = agents.map((a) => `<li>
    ${avatarHtml(a, 36, { speak: a.id, label: `${a.name}の自己紹介を聞く` })}
    <div><a href="/side/#${a.id}">${escapeHtml(a.name)}</a> <span class="badge">${escapeHtml(a.roleLabel)}</span>
    <div class="status muted">${STATUS_LABEL[a.status]}・${escapeHtml(a.activity)}</div></div>
  </li>`).join('');
}

$('#agent-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-speak]');
  const agent = btn && agents.find((a) => a.id === btn.dataset.speak);
  if (agent) speak(`${agent.bio}`, agent, btn);
});

function setReply(postId) {
  replyTo = postId;
  const target = posts.find((p) => p.id === postId);
  replyTarget.hidden = !target;
  if (target) {
    replyTarget.querySelector('span').textContent = `@${target.author.handle} さんへ返信`;
    textarea.focus();
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    me = await login($('#login-name').value);
    renderAuth();
    renderTimeline();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

textarea.addEventListener('input', () => {
  counter.textContent = `${[...textarea.value].length} / 280`;
});

composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#post-btn');
  $('#post-error').textContent = '';
  btn.disabled = true;
  try {
    await api('/posts', { method: 'POST', body: { authorId: me.id, text: textarea.value, replyTo } });
    textarea.value = '';
    counter.textContent = '0 / 280';
    setReply(null);
    await loadPosts();
  } catch (err) {
    $('#post-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#cancel-reply').addEventListener('click', () => setReply(null));

timeline.addEventListener('click', async (e) => {
  const speakBtn = e.target.closest('[data-speak]');
  if (speakBtn) {
    const post = posts.find((p) => p.id === speakBtn.dataset.speak);
    if (post) speak(post.text, post.author, speakBtn);
    return;
  }
  const likeBtn = e.target.closest('[data-like]');
  const replyBtn = e.target.closest('[data-reply]');
  if (replyBtn) {
    if (!me) return $('#login-name').focus();
    setReply(replyBtn.dataset.reply);
  }
  if (likeBtn) {
    if (!me) return $('#login-name').focus();
    await api(`/posts/${likeBtn.dataset.like}/like`, { method: 'POST', body: { userId: me.id } });
    await loadPosts();
  }
});

renderAuth();
loadPosts();
loadAgents();
onServerEvents({ post: loadPosts, like: loadPosts, agent: loadAgents });
setInterval(renderTimeline, 60000); // 「◯分前」表示を更新
