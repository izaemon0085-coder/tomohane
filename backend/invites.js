// ✉️ 招待状（クローズドβ）：招待コード＋人数の上限
// ・運営が「招待状モード」をオンにすると、登録には招待コードが要り、人数は上限（はじめは50人）まで
// ・50人には人間のユーザーを数える（子どもも数える。運営とキャラは数えない）
// ・コードを出せるのは、運営（席が残っているぶんだけ）と、入った人（1人1枚）。子ども（12歳まで）は出せない
// ・コードは1回だけ・14日で切れる。コードそのものは保存せず、ハッシュだけを持つ
// ・使われたら、出した人に 🔔 で知らせる
import { HttpError } from './store.js';

export const INVITE_DAYS = 14;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;
export const MEMBER_INVITES = 1; // 入った人が出せる数

export function createInviteStore({ state, now, clockMs, emit, newId, userById, ageGroupOf, isPractice, newCode, hashCode, notify }) {
  state.invites ??= []; // { id, hash, by, at, expiresAt, usedBy, usedAt }
  const settings = () => ({ on: false, limit: DEFAULT_LIMIT, ...(state.meta.invite ?? {}) });
  const isOperator = (u) => u?.role === 'admin';
  // 数える人：人間のユーザー（パスワードで登録した人）。運営は数えない
  const members = () => state.users.filter((u) => u.kind === 'human' && u.passHash && !isOperator(u)).length;
  const live = (i) => !i.usedBy && Date.parse(i.expiresAt) > clockMs();
  const seatsLeft = () => Math.max(0, settings().limit - members());

  function view(i) {
    return { id: i.id, at: i.at, expiresAt: i.expiresAt, used: Boolean(i.usedBy), usedName: i.usedBy ? (userById(i.usedBy)?.name ?? '（退会した人）') : null, expired: !i.usedBy && !live(i) };
  }

  return {
    inviteSettings: settings,
    inviteSummary(userId) {
      const u = userById(userId);
      const s = settings();
      const mine = state.invites.filter((i) => i.by === userId).map(view).reverse();
      return {
        on: s.on, limit: s.limit, members: members(), seatsLeft: seatsLeft(),
        pending: state.invites.filter(live).length,
        canIssue: canIssue(u).ok, reason: canIssue(u).reason, mine,
      };
    },
    // 登録の画面用（ログインしていない人にも出す）：招待コードが要るか・席がいっぱいか
    inviteStatus: () => ({ on: settings().on, full: settings().on && seatsLeft() === 0 }),
    setInviteSettings(adminId, { on, limit }) {
      if (!isOperator(userById(adminId))) throw new HttpError(403, '運営（管理者）だけができます');
      const s = settings();
      const next = { on: typeof on === 'boolean' ? on : s.on, limit: s.limit };
      if (limit !== undefined) {
        const n = Number(limit);
        if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw new HttpError(400, `人数の上限は1〜${MAX_LIMIT}人にしてください`);
        next.limit = n;
      }
      state.meta.invite = next;
      emit('invite', { id: null });
      return settings();
    },
    issueInvite(userId) {
      const u = userById(userId);
      const c = canIssue(u);
      if (!c.ok) throw new HttpError(403, c.reason);
      const code = newCode();
      const at = clockMs();
      const invite = { id: newId('i'), hash: hashCode(code), by: userId, at: new Date(at).toISOString(), expiresAt: new Date(at + INVITE_DAYS * 86400000).toISOString(), usedBy: null, usedAt: null };
      state.invites.push(invite);
      emit('invite', { id: invite.id });
      return { code, ...view(invite) }; // コードを見せるのは、このときだけ
    },
    cancelInvite(userId, id) {
      const i = state.invites.find((x) => x.id === id);
      if (!i || (i.by !== userId && !isOperator(userById(userId)))) throw new HttpError(404, '招待状が見つかりません');
      if (i.usedBy) throw new HttpError(400, 'もう使われた招待状です');
      state.invites.splice(state.invites.indexOf(i), 1);
      emit('invite', { id });
      return { ok: true };
    },
    // 登録のとき（register の中で呼ぶ）。招待状モードでなければ、何もしない
    checkInviteForRegister(code, { firstUser }) {
      const s = settings();
      if (!s.on || firstUser) return null;
      if (seatsLeft() === 0) throw new HttpError(403, `いまは${s.limit}人でいっぱいです。席があいたら、また来てください`);
      const raw = String(code ?? '').trim();
      if (!raw) throw new HttpError(400, 'いまは招待状がある人だけ登録できます。招待コードを入れてください');
      const i = state.invites.find((x) => x.hash === hashCode(raw));
      if (!i || !live(i)) throw new HttpError(403, '招待コードがちがうか、もう使われたか、14日すぎています');
      return i;
    },
    useInvite(invite, newUser) {
      if (!invite) return;
      invite.usedBy = newUser.id;
      invite.usedAt = now();
      newUser.invitedBy = invite.by;
      notify(invite.by, { kind: 'invite', text: `あなたの招待状で、${newUser.name}さんが ともはね に来たよ。よろしくね`, link: `/profile.html?id=${encodeURIComponent(newUser.id)}` });
    },
  };

  function canIssue(u) {
    if (!u || u.kind !== 'human') return { ok: false, reason: 'ログインしてください' };
    if (!settings().on) return { ok: false, reason: 'いまは招待状モードではありません（だれでも登録できます）' };
    if (isOperator(u)) {
      return seatsLeft() - state.invites.filter(live).length > 0
        ? { ok: true, reason: null } : { ok: false, reason: '席がいっぱいです（まだ使われていない招待状もふくめて）' };
    }
    if (ageGroupOf(u) === 'child') return { ok: false, reason: '招待状を出せるのは、13歳からです' };
    if (isPractice(u)) return { ok: false, reason: 'おうちの人とつながってから出せます' };
    const mine = state.invites.filter((i) => i.by === u.id && (i.usedBy || live(i)));
    if (mine.length >= MEMBER_INVITES) return { ok: false, reason: `招待状は1人${MEMBER_INVITES}枚までです` };
    if (seatsLeft() - state.invites.filter(live).length <= 0) return { ok: false, reason: '席がいっぱいです' };
    return { ok: true, reason: null };
  }
}
