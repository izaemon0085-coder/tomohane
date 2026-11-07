import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDES, SLIDES, weekKey, weeklyOdds, pickGuide, nextChange, RARE_MIN, RARE_MAX, NORMAL_MIN } from '../../shared/welcome-guide.js';

test('案内役：週の名前は月曜日0時（日本時間）で切りかわる', () => {
  // 2026-11-08 は日曜日。日本時間の 23:59 はまだ同じ週、月曜 0:00 から次の週
  assert.equal(weekKey(new Date('2026-11-08T23:59:00+09:00')), weekKey(new Date('2026-11-02T00:00:00+09:00')));
  assert.notEqual(weekKey(new Date('2026-11-08T23:59:00+09:00')), weekKey(new Date('2026-11-09T00:00:00+09:00')));
  assert.equal(weekKey(new Date('2026-11-07T12:00:00+09:00')), '2026-W45');
  assert.equal(nextChange(new Date('2026-11-07T12:00:00+09:00')).toISOString(), '2026-11-08T15:00:00.000Z');
});

test('案内役：今週の確率は合計100%、エンマ大王フクロウは1〜5%、ほかは最低10%', () => {
  const seen = new Set();
  for (let w = 0; w < 200; w++) {
    const { week, odds } = weeklyOdds(new Date(Date.UTC(2026, 0, 5) + w * 7 * 86400000));
    assert.equal(Object.values(odds).reduce((a, b) => a + b, 0), 100, week);
    assert.ok(odds.enma >= RARE_MIN && odds.enma <= RARE_MAX, week);
    for (const g of GUIDES.filter((x) => !x.rare)) assert.ok(odds[g.id] >= NORMAL_MIN, `${week} ${g.id}`);
    seen.add(JSON.stringify(odds));
  }
  assert.ok(seen.size > 100, '週ごとに確率が変わる');
  // 同じ週なら、だれが計算しても同じ
  assert.deepEqual(weeklyOdds(new Date('2026-11-03T10:00:00+09:00')), weeklyOdds(new Date('2026-11-07T22:00:00+09:00')));
});

test('案内役：確率どおりに選ばれる', () => {
  const odds = { yamaneko: 20, usagi: 30, fukurou: 25, shiba: 22, enma: 3 };
  assert.equal(pickGuide(odds, () => 0).id, 'yamaneko');
  assert.equal(pickGuide(odds, () => 0.2).id, 'usagi');
  assert.equal(pickGuide(odds, () => 0.97).id, 'enma');
  assert.equal(pickGuide(odds, () => 0.9999).id, 'enma');
  assert.equal(pickGuide(odds, () => 0.969).id, 'shiba');
});

test('案内役：どのスライドにも、案内役みんなのセリフがある', () => {
  for (const s of SLIDES) for (const g of GUIDES) assert.ok(s.say[g.id], `${s.title} ${g.id}`);
});
