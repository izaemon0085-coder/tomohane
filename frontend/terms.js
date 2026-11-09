// 利用規約・プライバシー（ともはね の約束）。おとなむけ／こどもむけを切りかえる。
// ?agree=1 で開いたとき（まだ同意していない・規約が新しくなった）は、上に同意のボタンを出す
import { api, refreshMe, rememberMe, headerHtml, safeNext } from '/shared/api.js';
import { TERMS_VERSION } from '/shared/terms.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

function showTab(id) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const on = tab.id === `tab-${id}`;
    tab.setAttribute('aria-selected', String(on));
    $(`#${tab.getAttribute('aria-controls')}`).hidden = !on;
  }
}
document.querySelector('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[role="tab"]');
  if (tab) showTab(tab.id.replace('tab-', ''));
});

$('#terms-version').textContent = TERMS_VERSION;
$('#header').innerHTML = headerHtml('terms');
const me = await refreshMe();
$('#header').innerHTML = headerHtml('terms');
// 子どもが開くと、はじめから こどもむけ
if (me?.ageGroup === 'child' || params.get('for') === 'child') showTab('child');

if (me && me.termsVersion !== TERMS_VERSION) {
  $('#agree-box').hidden = false;
  $('#agree-text').textContent = me.termsVersion
    ? 'ともはね の約束が新しくなったっす！ 下を読んで、同意してほしいっす。'
    : 'ともはね の約束を、まだ読んでもらってないっす！ 下を読んで、同意してほしいっす。';
}
$('#agree-check').addEventListener('change', (e) => { $('#agree-btn').disabled = !e.target.checked; });
$('#agree-btn').addEventListener('click', async () => {
  $('#agree-error').textContent = '';
  try {
    const r = await api('/auth/agree', { method: 'POST', body: { version: TERMS_VERSION } });
    rememberMe(r.me);
    location.href = safeNext(params.get('next'));
  } catch (x) {
    $('#agree-error').textContent = x.offline ? 'つながっていません。つながってから、もう一度どうぞ' : x.message;
  }
});
