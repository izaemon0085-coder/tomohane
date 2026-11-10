// 💝 応援（寄付）：新聞社の募金箱（決まりは shared/donation.js）
// ・振込先は運営が画面から入れる（data/ に保存。GitHub には送らない）。見えるのは、ログインした大人だけ
// ・「振り込みました」→ 運営が通帳で確かめる（確認）→ ハトがキャラたちのお礼を届ける・領収書が出せる
// ・金額は、領収書と運営の帳簿のためだけに持つ。ほかの人には見せない（新聞には、のせたい人の名前だけ）
import { HttpError } from './store.js';
import {
  MIN_AMOUNT, MAX_AMOUNT, MAX_PAYER, MAX_PENDING, MAX_ACCOUNT_TEXT, MAX_ISSUER, MAX_ADDRESSEE,
  RECEIPT_PURPOSE, donateRule, receiptNo,
} from '../shared/donation.js';

const clip = (v, max, label) => {
  const s = String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if ([...s].length > max) throw new HttpError(400, `${label}は${max}文字までです`);
  return s;
};

export function createDonationStore({ state, now, clockMs, emit, newId, userById, ageGroupOf, notify }) {
  state.donations ??= []; // { id, userId, amount, payerName, showName, status（pending/confirmed/cancelled）, createdAt, doneAt, receiptNo }
  const settings = () => ({ on: false, account: '', supportUrl: '', issuer: '', ...(state.meta.donation ?? {}) });
  const isOperator = (u) => u?.role === 'admin';
  const needOperator = (id) => { if (!isOperator(userById(id))) throw new HttpError(403, '運営（管理者）だけができます'); };
  const mine = (d) => ({ id: d.id, amount: d.amount, payerName: d.payerName, showName: d.showName, status: d.status, createdAt: d.createdAt, doneAt: d.doneAt, receiptNo: d.receiptNo });
  const monthOf = (iso) => iso.slice(0, 7);
  // 新聞にのせてよい人の名前（今月、確かめがすんだ人だけ。金額は出さない）
  function supporters() {
    const month = monthOf(now());
    const names = new Set();
    for (const d of state.donations) {
      if (d.status !== 'confirmed' || !d.showName || !d.doneAt || monthOf(d.doneAt) !== month) continue;
      const u = userById(d.userId);
      if (u) names.add(u.name);
    }
    return { month, names: [...names] };
  }

  return {
    // 募金箱のページ用：見る人によって出すものを変える（振込先は、大人で、運営がオンにしたときだけ）
    donationInfo(userId) {
      const s = settings();
      const u = userId ? userById(userId) : null;
      const base = { on: s.on, supportUrl: s.on ? s.supportUrl : '', supporters: supporters() };
      if (!u || u.kind !== 'human') return { ...base, login: false };
      const rule = donateRule(ageGroupOf(u));
      return {
        ...base, login: true, canDonate: s.on && rule.ok, reason: s.on ? rule.reason : 'いまは募金箱をお休みしています',
        account: s.on && rule.ok ? s.account : '',
        mine: state.donations.filter((d) => d.userId === u.id).map(mine).reverse(),
        thanked: state.donations.some((d) => d.userId === u.id && d.status === 'confirmed'),
      };
    },
    donationSupporters: supporters,
    // 「振り込みました」：運営に知らせる
    reportDonation(userId, { amount, payerName, showName } = {}) {
      const u = userById(userId);
      if (!u || u.kind !== 'human') throw new HttpError(401, 'ログインしてください');
      if (!settings().on) throw new HttpError(403, 'いまは募金箱をお休みしています');
      const rule = donateRule(ageGroupOf(u));
      if (!rule.ok) throw new HttpError(403, rule.reason);
      const n = Number(amount);
      if (!Number.isInteger(n) || n < MIN_AMOUNT || n > MAX_AMOUNT) throw new HttpError(400, `金額は${MIN_AMOUNT}円から${MAX_AMOUNT.toLocaleString('ja-JP')}円まで（1円単位）にしてください`);
      const payer = clip(payerName, MAX_PAYER, '振込のお名前');
      if (!payer) throw new HttpError(400, '振込のお名前（通帳にのる名前）を入れてください。運営が通帳と見くらべます');
      if (state.donations.filter((d) => d.userId === userId && d.status === 'pending').length >= MAX_PENDING) {
        throw new HttpError(429, `確かめ待ちが${MAX_PENDING}件あります。運営が確かめるまで、少し待ってね`);
      }
      const d = { id: newId('g'), userId, amount: n, payerName: payer, showName: Boolean(showName), status: 'pending', createdAt: now(), doneAt: null, receiptNo: null };
      state.donations.push(d);
      emit('donation', { id: d.id });
      return mine(d);
    },
    // 本人：確かめ待ちのものを取り消す（まちがえて押したとき）
    withdrawDonation(userId, id) {
      const d = state.donations.find((x) => x.id === id && x.userId === userId);
      if (!d) throw new HttpError(404, '見つかりません');
      if (d.status !== 'pending') throw new HttpError(400, 'もう運営が確かめたものは、取り消せません');
      state.donations.splice(state.donations.indexOf(d), 1);
      emit('donation', { id });
      return { ok: true };
    },

    // ---- 運営 ----
    donationAdmin(adminId) {
      needOperator(adminId);
      const months = {};
      for (const d of state.donations) {
        if (d.status !== 'confirmed') continue;
        const m = monthOf(d.doneAt);
        months[m] ??= { month: m, count: 0, total: 0 };
        months[m].count += 1;
        months[m].total += d.amount;
      }
      return {
        settings: settings(),
        items: [...state.donations].reverse().map((d) => ({ ...mine(d), userName: userById(d.userId)?.name ?? '（退会した人）' })),
        months: Object.values(months).sort((a, b) => b.month.localeCompare(a.month)),
      };
    },
    setDonationSettings(adminId, body = {}) {
      needOperator(adminId);
      const s = settings();
      const next = { ...s };
      if (typeof body.on === 'boolean') next.on = body.on;
      if (body.account !== undefined) next.account = clip(body.account, MAX_ACCOUNT_TEXT, '振込先');
      if (body.issuer !== undefined) next.issuer = clip(body.issuer, MAX_ISSUER, '領収書の発行者');
      if (body.supportUrl !== undefined) {
        const url = clip(body.supportUrl, 300, '応援サービスのアドレス');
        if (url && !/^https:\/\/[^\s"'<>]+$/.test(url)) throw new HttpError(400, '応援サービスのアドレスは https:// ではじまるものにしてください');
        next.supportUrl = url;
      }
      if (next.on && !next.account && !next.supportUrl) throw new HttpError(400, '振込先か応援サービスのアドレスを入れてから、オンにしてください');
      if (next.on && !next.issuer) throw new HttpError(400, '領収書の発行者（運営の名前）を入れてから、オンにしてください');
      state.meta.donation = next;
      emit('donation', { id: null });
      return settings();
    },
    // 通帳で確かめた → 領収書の番号をつけて、ハトがキャラたちのお礼を届ける
    confirmDonation(adminId, id) {
      needOperator(adminId);
      const d = state.donations.find((x) => x.id === id);
      if (!d) throw new HttpError(404, '見つかりません');
      if (d.status !== 'pending') throw new HttpError(400, 'もう確かめたものです');
      d.status = 'confirmed';
      d.doneAt = now();
      const year = d.doneAt.slice(0, 4);
      const count = state.donations.filter((x) => x.receiptNo?.startsWith(`TH-${year}-`)).length;
      d.receiptNo = receiptNo(year, count + 1);
      notify(d.userId, { kind: 'donation', text: '応援してくれて、ありがとう！ 町のみんなから「ありがとう」を預かってきたよ。領収書も出せるようになったよ', link: '/donate.html#thanks' });
      emit('donation', { id });
      return mine(d);
    },
    // 通帳で見つからなかった
    cancelDonation(adminId, id) {
      needOperator(adminId);
      const d = state.donations.find((x) => x.id === id);
      if (!d) throw new HttpError(404, '見つかりません');
      if (d.status !== 'pending') throw new HttpError(400, 'もう確かめたものです');
      d.status = 'cancelled';
      d.doneAt = now();
      notify(d.userId, { kind: 'donation', text: '「振り込みました」のお知らせ、ありがとう。でも、まだ通帳で見つけられなかったよ。振込のお名前と金額を、もう一度見てみてね', link: '/donate.html' });
      emit('donation', { id });
      return mine(d);
    },

    // 領収書（本人と運営だけ。確かめがすんだものだけ）
    donationReceipt(userId, id) {
      const u = userById(userId);
      const d = state.donations.find((x) => x.id === id);
      if (!d || !u || (d.userId !== userId && !isOperator(u))) throw new HttpError(404, '見つかりません');
      if (d.status !== 'confirmed') throw new HttpError(400, '運営が確かめてから、領収書が出せます');
      return {
        receiptNo: d.receiptNo, amount: d.amount, date: d.doneAt, purpose: RECEIPT_PURPOSE,
        issuer: settings().issuer, addressee: clip(userById(d.userId)?.name ?? '', MAX_ADDRESSEE, '宛名'),
      };
    },
  };
}
