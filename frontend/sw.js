// ローカル回線（オフライン対応）：Service Worker
// ・画面のファイルと、最後に見たタイムライン・家・会議の情報をこの端末に保存しておく
// ・つながっているときは、いつも最新をサーバーから取る（ネットワーク優先）
// ・つながらないときは、保存しておいたものを見せる（前に見た投稿が見られる）
// ※ Service Worker は「安全な接続」（localhost か https）のときだけ動く
const CACHE = 'tomohane-v25';

const SHELL = [
  '/', '/style.css', '/map.js', '/plaza.html', '/plaza.js', '/cafe.html', '/oshi.html', '/oshi.js',
  '/letter.html', '/letter.js', '/shared/qrcode.js', '/login.html', '/login.js', '/welcome.html', '/welcome.js', '/shared/welcome-guide.js', '/news.html', '/news.js', '/shared/news.js', '/games.html', '/games.js',
  '/side/', '/side/style.css', '/side/app.js',
  '/sub/', '/sub/style.css', '/sub/app.js',
  '/shared/base.css', '/shared/api.js', '/shared/speech.js',
  '/terms.html', '/terms.js', '/shared/terms.js', '/shared/leave.js', '/shared/suggest.js',
  '/shared/playground.js', '/shared/playground.css',
  '/shared/customize.js', '/shared/customize.css', '/shared/kisekae-opinions.js',
  '/shared/outbox.js', '/shared/network.js', '/shared/network.css',
  '/shared/typefaces.js', '/shared/fonts.css', '/shared/precheck.js', '/shared/report.js', '/shared/soon.js', '/shared/cafe.js', '/shared/arcade.js', '/shared/library.js', '/library.html', '/library.js', '/library-write.html', '/library-write.js', '/library-board.html', '/library-board.js', '/notices.html', '/notices.js', '/profile.html', '/profile.js', '/shared/library-tidy.js',
  '/shared/avatars/yamaneko.svg', '/shared/avatars/usagi.svg', '/shared/avatars/fukurou.svg',
  '/shared/avatars/shiba.svg', '/shared/avatars/kuruma.svg', '/shared/avatars/mogu.svg', '/shared/avatars/enma-fukurou.svg', '/shared/avatars/shinbunsha.svg', '/shared/avatars/tanuki.svg', '/shared/avatars/penguin.svg', '/shared/avatars/kitsune.svg', '/shared/avatars/kaeru.svg', '/shared/avatars/kame.svg', '/shared/avatars/nezumi.svg', '/shared/avatars/hato.svg',
];

// 保存しておく API（読むだけのもの）。リアルタイム通知・死活確認は保存しない
const CACHEABLE_API = /^\/api\/(posts|threads\/[\w-]+|news|agents(\/[\w-]+)?|meetings(\/[\w-]+)?|users|network)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isApi = url.pathname.startsWith('/api/');
  if (isApi && !CACHEABLE_API.test(url.pathname)) return; // /api/events や /api/health はそのまま

  event.respondWith((async () => {
    try {
      const res = await fetch(request);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    } catch {
      const cached = await caches.match(request, { ignoreSearch: !isApi });
      if (cached) return cached;
      if (isApi) {
        return new Response(JSON.stringify({ error: 'オフラインです', offline: true }), {
          status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      return new Response('オフラインです。つながったらもう一度開いてください。', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
