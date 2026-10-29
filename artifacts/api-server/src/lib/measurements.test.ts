import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contributionAmount, contributionPercent, measurementEntrySchema, measurementTimeline, measurementValueAt, type MeasurementEvent } from '@workspace/api-zod';

const observation = (id: string, value: number, date = '2024-01-01'): MeasurementEvent => ({ id, date, value });
const result = (id: string, value: number, date = '2024-01-02', taskId = 'task', milestoneId = 'milestone'): MeasurementEvent => ({
  id, value, date, mode: 'contribution', source: { taskId, taskTitle: 'Original task', milestoneId, milestoneTitle: 'Original milestone' },
});
test('legacy absolute measurements are unchanged', () => {
  assert.equal(measurementValueAt({ baseline: 10, entries: [observation('a', 12), observation('b', 15, '2024-02-01')] }), 15);
});
test('measured contributions add to baseline and retain absolute checkpoints', () => {
  const m = { baseline: 10, entries: [result('a', 5), result('b', 3, '2024-01-03')] };
  assert.equal(measurementValueAt(m), 18);
  m.entries.push(observation('checkpoint', 20, '2024-01-04'), result('c', 2, '2024-01-05'));
  assert.equal(measurementValueAt(m), 22);
  assert.equal(contributionAmount(m), 10);
});
test('backdated contributions do not double-count against a later absolute observation', () => {
  const m = { baseline: 0, entries: [observation('checkpoint', 12, '2024-02-01'), result('earlier', 5)] };
  assert.equal(measurementValueAt(m), 12);
  assert.equal(measurementValueAt(m, '2024-01-31'), 5);
  assert.equal(contributionAmount(m), 5);
});
test('same-day event order remains stable across JSON reload', () => {
  const m = { baseline: 0, entries: [result('first', 5), observation('checkpoint', 8, '2024-01-02'), result('last', 2)] };
  assert.deepEqual(measurementTimeline(m).map((x) => x.value), [5, 8, 10]);
  assert.equal(measurementValueAt(JSON.parse(JSON.stringify(m))), 10);
});
test('task contributions roll up to milestone and goal once per result, not twice', () => {
  const direct: MeasurementEvent = { id: 'direct', date: '2024-01-03', value: 2, mode: 'contribution', source: { milestoneId: 'milestone', milestoneTitle: 'Milestone' } };
  const m = { baseline: 0, entries: [result('a', 5), result('b', 3, '2024-01-02', 'other'), direct] };
  assert.equal(contributionAmount(m, { taskId: 'task' }), 5);
  assert.equal(contributionAmount(m, { milestoneId: 'milestone' }), 10);
  assert.equal(contributionAmount(m), 10);
  assert.equal(measurementValueAt(m), 10);
});
test('percentage uses target minus baseline, supports decreasing and zero-span targets', () => {
  assert.equal(contributionPercent({ baseline: 10, target: 60 }, 5), 10);
  assert.equal(contributionPercent({ baseline: 90, target: 80 }, -2), 20);
  assert.equal(contributionPercent({ baseline: 90, target: 80 }, 2), -20);
  assert.equal(contributionPercent({ baseline: 5, target: 5 }, 2), null);
  assert.equal(contributionPercent({ baseline: 0, target: 10 }, 12), 120);
});
test('date cutoff excludes later results and source snapshots survive absent tasks', () => {
  const m = { baseline: 0, entries: [result('a', 5), result('b', 3, '2024-01-05')] };
  assert.equal(contributionAmount(m, { taskId: 'task' }, '2024-01-03'), 5);
  assert.equal(measurementValueAt(m, '2024-01-03'), 5);
  assert.equal(measurementEntrySchema.parse(m.entries[0]).source?.taskTitle, 'Original task');
});
test('malformed contribution records fail the server workspace validation boundary', () => {
  for (const invalid of [
    { ...result('a', 1), value: 0 }, { ...result('a', 1), value: Infinity },
    { ...result('a', 1), date: '2024-02-30' }, { ...result('a', 1), source: {} },
    { ...result('a', 1), source: { taskId: 'task' } },
  ]) assert.equal(measurementEntrySchema.safeParse(invalid).success, false);
  assert.equal(measurementEntrySchema.safeParse(observation('legacy', 0)).success, true);
});
