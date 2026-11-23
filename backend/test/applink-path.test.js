// 同じ場所の下に置いたアプリ（本番の https://tomohane-sns.jp/gochitomo など）への「ともはねでログイン」
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';
import { createStore } from '../store.js';
import { createSimulation } from '../simulation.js';
import { createGameLink } from '../gamelink.js';
import { isComingSoon } from '../../shared/soon.js';

let server; let base;
before(async () => {
  const store = createStore();
  const sim = createSimulation(store, { random: () => 0, replyDelayMs: null, checkInternet: async () => true, lanAddresses: () => ['192.168.0.10'] });
  const gochitomoLink = createGameLink({ app: 'gochitomo', gameUrl: 'https://tomohane.test/gochitomo/' });
  server = http.createServer(createApp({ store, sim, gochitomoLink }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('ごちとも：/gochitomo の下に置いても、そこの /auth/callback にもどす・アップデート予定から外した', async () => {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: 'pathcheck1', password: 'pass-word-1', name: 'パス', birthdate: '1990-01-01', agreeTerms: true }),
  });
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  const r = await fetch(`${base}/api/link/gochitomo-start`, { redirect: 'manual', headers: { Cookie: cookie } });
  const loc = new URL(r.headers.get('location'));
  assert.equal(`${loc.origin}${loc.pathname}`, 'https://tomohane.test/gochitomo/auth/callback');
  assert.ok(loc.searchParams.get('ticket'));
  assert.equal(isComingSoon('gochitomo'), false);
});
