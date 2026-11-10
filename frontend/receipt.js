// 🧾 領収書（本人と運営だけ。運営が通帳で確かめたものだけ）
import { api } from '/shared/api.js';

const $ = (s) => document.querySelector(s);
const id = new URLSearchParams(location.search).get('id') ?? '';
const day = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

try {
  const r = await api(`/donations/${encodeURIComponent(id)}/receipt`);
  $('#r-no').textContent = r.receiptNo;
  $('#r-date').textContent = day(r.date);
  $('#r-to').value = r.addressee;
  $('#r-amount').textContent = `¥${Number(r.amount).toLocaleString('ja-JP')}-`;
  $('#r-purpose').textContent = r.purpose;
  $('#r-issuer').textContent = r.issuer;
  $('#state').hidden = true;
  $('#receipt').hidden = false;
  $('#tools').hidden = false;
} catch (x) {
  $('#state').textContent = x.message;
}
$('#print').addEventListener('click', () => window.print());
