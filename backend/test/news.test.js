import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISSUES, publishedIssues, latestIssueId, issueLabel, pollTalk, todayJst, TALK_MIN_VOTES } from '../../shared/news.js';

const poll = ISSUES.find((i) => i.poll).poll;
const counts = (o) => Object.fromEntries(poll.choices.map((c) => [c.id, o[c.id] ?? 0]));

test('新聞：日付が来た号だけ出る（日本時間）', () => {
  assert.equal(todayJst(new Date('2026-11-06T15:00:00Z')), '2026-11-07');
  assert.deepEqual(publishedIssues(new Date('2026-11-06T14:59:00Z')), [], '創刊号の前の日は、まだ出ない');
  assert.equal(latestIssueId(new Date('2026-11-07T03:00:00Z')), '2026-11-07-no1');
  assert.equal(issueLabel({ kind: 'weekly', no: 1 }), '第1号');
  assert.equal(issueLabel({ kind: 'extra' }), '号外');
  for (const i of ISSUES) assert.ok(i.kind === 'extra' || Number.isInteger(i.no), i.id);
});

test('座談会：答えが少ないうちは話さない', () => {
  const lines = pollTalk(poll, counts({ draw: TALK_MIN_VOTES - 1 }));
  assert.ok(lines.every((l) => !l.text.includes('描いて応募')), 'どの答えかを言わない');
});

test('座談会：数字は出さず、1人でも答えた選択肢は必ず話す（多い順にはしない）', () => {
  const lines = pollTalk(poll, counts({ draw: 40, see: 12, no: 1, unsure: 0 }));
  const text = lines.map((l) => l.text).join('\n');
  assert.ok(!/\d|％|%/.test(text), text);
  for (const id of ['draw', 'see', 'no']) assert.ok(text.includes(poll.choices.find((c) => c.id === id).talk), id);
  assert.ok(!text.includes('まだわからない'), 'だれも答えていない選択肢は話さない');
  const order = ['draw', 'see', 'no'].map((id) => text.indexOf(poll.choices.find((c) => c.id === id).talk));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'アンケートの並びのまま');
  // 多い・少ないで言い方が変わる
  const many = pollTalk(poll, counts({ draw: 40, no: 1 })).find((l) => l.text.includes('描いて応募')).text;
  const few = pollTalk(poll, counts({ draw: 1, no: 40 })).find((l) => l.text.includes('描いて応募')).text;
  assert.notEqual(many, few);
});

test('座談会：同じキャラが続けて話さない', () => {
  for (const o of [{ draw: 9 }, { draw: 3, see: 3 }, { draw: 2, see: 2, no: 2 }, { draw: 2, see: 2, no: 2, unsure: 2 }]) {
    const lines = pollTalk(poll, counts(o));
    lines.slice(1).forEach((l, i) => assert.notEqual(l.by, lines[i].by, JSON.stringify(o)));
  }
});
