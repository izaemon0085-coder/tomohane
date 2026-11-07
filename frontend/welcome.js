// はじめての人への案内スライド。案内役は今週の確率で決まる（shared/welcome-guide.js）
import { refreshMe, headerHtml, escapeHtml, safeNext } from '/shared/api.js';
import { GUIDES, SLIDES, weeklyOdds, pickGuide, nextChange } from '/shared/welcome-guide.js';

const $ = (sel) => document.querySelector(sel);
const next = safeNext(new URLSearchParams(location.search).get('next'));
const { odds } = weeklyOdds();

// ?guide=enma のように指定すると、その案内役で見られる（ためし用）
const asked = GUIDES.find((g) => g.id === new URLSearchParams(location.search).get('guide'));
const guide = asked ?? pickGuide(odds);
let index = 0;

document.documentElement.style.setProperty('--guide', guide.color);
$('#welcome').classList.toggle('is-rare', Boolean(guide.rare));
$('#rare-badge').hidden = !guide.rare;
$('#guide-face').src = guide.avatar;
$('#guide-name').textContent = `${guide.name}から`;
$('#start').href = next;
$('#skip').href = next;

$('#dots').innerHTML = SLIDES.map((s, i) =>
  `<button type="button" role="tab" class="dot" data-i="${i}" aria-label="${i + 1}まいめ：${escapeHtml(s.title)}"></button>`).join('');

const fmt = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' });
$('#odds-list').innerHTML = GUIDES.map((g) => `<li class="${g.id === guide.id ? 'is-me' : ''}">
  <img src="${g.avatar}" alt="" width="28" height="28"><span>${escapeHtml(g.name)}</span>
  <span class="bar" style="--p:${odds[g.id]}%"></span><strong>${odds[g.id]}%</strong></li>`).join('');
$('#odds-next').textContent = `確率は毎週かわります。つぎは ${fmt.format(nextChange())} の0時から。`;

function show(i) {
  index = Math.max(0, Math.min(SLIDES.length - 1, i));
  const s = SLIDES[index];
  const last = index === SLIDES.length - 1;
  $('#slide-icon').textContent = s.icon;
  $('#slide-title').textContent = s.title;
  $('#slide-text').textContent = s.text;
  $('#guide-say').textContent = s.say[guide.id];
  $('#odds').hidden = !last;
  $('#prev').disabled = index === 0;
  $('#next').hidden = last;
  $('#start').hidden = !last;
  $('#skip').parentElement.hidden = last;
  for (const d of document.querySelectorAll('.dot')) d.setAttribute('aria-selected', String(Number(d.dataset.i) === index));
  $('#slide').classList.remove('enter');
  void $('#slide').offsetWidth;
  $('#slide').classList.add('enter');
}

$('#prev').addEventListener('click', () => show(index - 1));
$('#next').addEventListener('click', () => show(index + 1));
$('#dots').addEventListener('click', (e) => {
  const d = e.target.closest('.dot');
  if (d) show(Number(d.dataset.i));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(index + 1);
  if (e.key === 'ArrowLeft') show(index - 1);
});
// スマホ：左右にスワイプ
let touchX = null;
$('#slide').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('#slide').addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
  touchX = null;
});

show(0);
$('#header').innerHTML = headerHtml('welcome');
await refreshMe().catch(() => null);
$('#header').innerHTML = headerHtml('welcome');
