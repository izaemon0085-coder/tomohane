// 工房のゲームを出す：工房の親方が #code=<ゲームコード> つきで開く → 中身を見せる → ログインして運営に送る
// ゲームコードは、ログインの行き来でなくならないよう、このタブの sessionStorage にだけ一時的に置く
import { api, refreshMe, headerHtml, escapeHtml, toast } from '/shared/api.js';
import { fromCode, checkPlayable, missions, ruleText } from '/shared/kobo/game.js';
import { drawBoard } from '/shared/kobo/board.js';
import { renderChibi } from '/shared/kobo/parts.js';

const $ = (s) => document.querySelector(s);
const KEY = 'kobo_submit_code';
const store = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch { /* しまえない */ } },
};

async function chara(look) {
  const im = new Image();
  im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderChibi(look, { dir: 'down', frame: 0 }))}`;
  await im.decode();
  return im;
}

const me = await refreshMe();
$('#header').innerHTML = headerHtml('games');
const hash = new URLSearchParams(location.hash.slice(1)).get('code');
if (hash) { store.set(hash); history.replaceState(null, '', location.pathname); }
const code = store.get();
const r = code ? fromCode(code) : { ok: false };
if (!r.ok) {
  $('#none').hidden = false;
  if (code) $('#none').textContent = `${r.error}。工房でもう一度「🎮 ゲームセンターに出す」を押してください。`;
} else {
  const game = r.game;
  const c = checkPlayable(game);
  $('#preview').hidden = false;
  $('#game-title').textContent = game.title;
  drawBoard($('#board'), game, { chara: await chara(game.look) });
  const ms = missions(game);
  $('#facts').innerHTML = [
    `🗺️ 地図 ${game.map[0].length}×${game.map.length} マス・★ 星 ${game.stars.length}こ`,
    game.rules.length ? `⚙️ しかけ ${game.rules.length}こ（${game.rules.slice(0, 3).map((x) => escapeHtml(ruleText(x, game.npcs))).join('／')}${game.rules.length > 3 ? '…' : ''}）` : null,
    game.npcs.length ? `💬 村の人 ${game.npcs.length}人（${game.npcs.map((n) => escapeHtml(n.name)).join('・')}）` : null,
    ms.length ? `✅ ミッション：${ms.map((m) => escapeHtml(m.text)).join('／')}` : null,
  ].filter(Boolean).map((t) => `<li>${t}</li>`).join('');
  $('#check').className = `small ${c.ok ? 'ok' : 'error'}`;
  $('#check').textContent = c.ok ? '🗺️ 地図係のチェック：最後まで遊べます。' : `🗺️ まだ遊べないところがあります：${c.problems.map((p) => p.text).join('／')}。工房で直してから出してください。`;
  $('#send-box').hidden = !c.ok;
  $('#need-login').hidden = Boolean(me);
  $('#send-area').hidden = !me;
}

$('#send').addEventListener('click', async () => {
  $('#send-err').textContent = '';
  $('#send').disabled = true;
  try {
    await api('/kobo', { method: 'POST', body: { code: store.get() } });
    store.set(null);
    $('#send-box').innerHTML = '<p class="ok">🦉 運営にとどけました。遊んで確かめたら、ゲームセンターに並びます。<a href="/games.html">ゲームセンターで見る</a></p>';
    $('#kitsune').textContent = 'とどいたよ！ 並んだら「もう一回！」って言いたくなる台になるといいね。';
    toast('運営にとどけました', 4000);
  } catch (e) {
    $('#send-err').textContent = e.message;
    $('#send').disabled = false;
  }
});
