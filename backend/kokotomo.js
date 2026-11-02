// 移動サポートのアプリ「こことも」との連結：ライブ会場のバリアフリーメモを読むだけ。
// ともはねから こことも へ送るのは会場の名前だけ。おたすけカードや位置情報は、こことも の中から出てこない
export const KOKOTOMO_URL = (process.env.KOKOTOMO_URL || 'http://localhost:3100/').replace(/\/+$/, '');

const MAX_ITEMS = 6;
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
const text = (v, max) => (typeof v === 'string' ? [...v].slice(0, max).join('') : '');

// こことも の返事を、ともはねで使う形にそろえる（変な値が来ても画面をこわさない）
function tidy(memo, name, baseUrl) {
  const searchUrl = `${baseUrl}/venues.html#q=${encodeURIComponent(name)}`;
  if (!memo?.found) return { linked: true, found: false, url: isHttpUrl(memo?.searchUrl) ? memo.searchUrl : searchUrl };
  return {
    linked: true,
    found: true,
    venue: { name: text(memo.venue?.name, 40), updatedAt: text(memo.venue?.updatedAt, 30) },
    summary: (Array.isArray(memo.summary) ? memo.summary : []).slice(0, MAX_ITEMS).map((s) => ({
      label: text(s.label, 20), text: text(s.text, 200), createdAt: text(s.createdAt, 30),
    })),
    url: isHttpUrl(memo.url) ? memo.url : searchUrl,
  };
}

export function createKokotomoClient({ baseUrl = KOKOTOMO_URL, fetchImpl = fetch, timeoutMs = 2000 } = {}) {
  return {
    baseUrl,
    // こことも が起動していない・おそいときは { linked: false }
    async venueMemo(name) {
      try {
        const res = await fetchImpl(`${baseUrl}/api/link/venue?name=${encodeURIComponent(name)}`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error();
        return tidy(await res.json(), name, baseUrl);
      } catch {
        return { linked: false, url: `${baseUrl}/venues.html#q=${encodeURIComponent(name)}` };
      }
    },
  };
}
