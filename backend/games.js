// ゲーム一覧：ともはねで遊べるゲーム（もとからある4つ＋インディーズ・個人の作ったゲーム）と、おすすめ
// ・おすすめは「推し活の人」が一言つきで言える。シバが広場で「おすすめは？」に答える
// ・インディーズや個人のゲームは、キットをダウンロードして「ともはねでログイン」をつなぐ。運営が見てから一覧に出す
// ・ともあい（お金のゲーム）は公開しないので、ここには入れない
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { GAME_URL, GHOST_URL, KOROTOMO_URL, SORATOMO_URL } from './gamelink.js';

// もとからあるゲーム（start は ともはね の入り口）
export const BUILTIN_GAMES = [
  {
    id: 'tomojan', name: 'ともじゃん（じゃんけん）', maker: 'ともはね', url: GAME_URL, start: '/api/link/game-start',
    description: 'シバの家でじゃんけん。勝ち数でグッズの割引券がもらえる', tags: ['すぐ遊べる', 'ひとり'], minAge: 'child', ads: false, purchases: false,
  },
  {
    id: 'ghost', name: 'ゴーストエージェント', maker: 'ともはね', url: GHOST_URL, start: '/api/link/ghost-start',
    description: '昨日の自分（ゴースト）と競う。毎日つづける', tags: ['つづける', 'ひとり'], minAge: 'child', ads: false, purchases: false,
  },
  {
    id: 'korotomo', name: 'ころとも', maker: 'ともはね', url: KOROTOMO_URL, start: '/api/link/korotomo-start',
    description: 'ラジコンの小さなロボットで星を集める', tags: ['ロボット', 'ひとり'], minAge: 'child', ads: false, purchases: false,
  },
  {
    id: 'soratomo', name: 'そらとも', maker: 'ともはね', url: SORATOMO_URL, start: '/api/link/soratomo-start',
    description: '小さな人工衛星を運用する。友だちと協力できる', tags: ['宇宙', '協力'], minAge: 'child', ads: false, purchases: false,
  },
];

const AGE_ORDER = { child: 0, teen: 1, adult: 2 };
export const ageAllows = (minAge, group) => AGE_ORDER[group ?? 'adult'] >= AGE_ORDER[minAge ?? 'child'];
// 子どもには、広告・課金のあるゲームは出さない
export const visibleFor = (game, group) => ageAllows(game.minAge, group) && !((group === 'child') && (game.ads || game.purchases));

export const SLUG = /^[a-z0-9-]{3,24}$/;
export const hashSecret = (s) => createHash('sha256').update(String(s)).digest('hex');
export const newGameSecret = () => `tg_${randomBytes(24).toString('base64url')}`;
export function secretMatches(given, hash) {
  if (!hash) return false;
  const a = Buffer.from(hashSecret(given ?? ''), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// 広場で「おすすめのゲームは？」と聞かれたか
export function isGameQuestion(text) {
  return /ゲーム/.test(text) && /おすすめ|オススメ|お勧め|教えて|なにか|何か|ある[?？]|ない[?？]/.test(text);
}

// その人へのおすすめを1つ選ぶ。同じ推しの人のおすすめ → みんなのおすすめ → 一覧のはじめ の順
// games は、呼ぶ側で年齢の区分に合わせてしぼってから渡す
export function recommendFor({ games, recs, usersById, user }) {
  if (!games.length) return null;
  const count = (gameId, filter = () => true) => recs.filter((r) => r.gameId === gameId && filter(r)).length;
  const oshi = user?.oshi?.name?.trim();
  if (oshi) {
    const sameOshi = (r) => r.userId !== user.id && usersById[r.userId]?.oshi?.name?.trim() === oshi;
    const best = [...games].sort((a, b) => count(b.id, sameOshi) - count(a.id, sameOshi))[0];
    if (count(best.id, sameOshi) > 0) {
      const r = recs.find((x) => x.gameId === best.id && sameOshi(x) && x.comment);
      return { game: best, reason: `${oshi}推しの人が、${count(best.id, sameOshi)}人おすすめしてる`, comment: r?.comment ?? null };
    }
  }
  const best = [...games].sort((a, b) => count(b.id) - count(a.id))[0];
  if (count(best.id) > 0) {
    const r = recs.find((x) => x.gameId === best.id && x.comment);
    return { game: best, reason: `みんなのおすすめが${count(best.id)}件ある`, comment: r?.comment ?? null };
  }
  return { game: games[0], reason: 'すぐ遊べる', comment: null };
}

export function gameRecommendReply(rec, authorName) {
  if (!rec) return `${authorName}さん、いまは遊べるゲームがないっす…。ゲーム一覧（/games.html）をのぞいてみてほしいっす！`;
  const said = rec.comment ? `「${rec.comment}」って声もあるっす！` : '';
  return `${authorName}さんには「${rec.game.name}」がおすすめっす！ ${rec.reason}っす。${said} ゲーム一覧（/games.html）から遊べるっす 🎮`;
}

// 見る人の年齢の区分に合わせたゲーム一覧（ログインしていない人には、子どもと同じものだけ）
export function gamesFor(extGames, group = 'child') {
  const ext = extGames.filter((g) => g.status === 'listed').map((g) => ({ ...g, start: `/api/link/x/${g.id}/start` }));
  return [...BUILTIN_GAMES.map((g) => ({ ...g, builtin: true })), ...ext].filter((g) => visibleFor(g, group));
}
