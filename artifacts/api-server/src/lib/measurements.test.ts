import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contributionAmount, contributionPercent, measurementEntrySchema, measurementTimeline, measurementValueAt, measurementPeriod, measurementPeriods, measurementEntries, measurementTargetAt, measurementActivePeriod, nextMeasurementStart, type MeasurementEvent } from '@workspace/api-zod';

test('first monthly target uses fixed active days, resets normally, and never shrinks as days pass', () => {
  const m = { frequency: 'monthly' as const, startDate: '2026-10-30', target: 30, baseline: 0 };
  assert.equal(measurementTargetAt(m, '2026-10-29'), 60 / 31);
  assert.equal(measurementTargetAt(m, '2026-10-30'), 60 / 31);
  assert.equal(measurementTargetAt(m, '2026-10-31'), 60 / 31);
  assert.equal(measurementTargetAt(m, '2026-11-01'), 30);
  assert.equal(measurementTargetAt(m, '2026-09-30'), 0);
  assert.ok(Math.abs(contributionPercent(m, 1, '2026-10-30')! - 100 / (60 / 31)) < 1e-10);
  assert.equal(measurementActivePeriod(m, '2026-10-30')?.activeDays, 2);
});
test('weekly partials use Monday weeks and include Sunday and year boundaries', () => {
  const m = { frequency: 'weekly' as const, startDate: '2026-12-31', target: 7 };
  assert.equal(measurementTargetAt(m, '2026-12-31'), 4);
  assert.equal(measurementTargetAt(m, '2027-01-03'), 4);
  assert.equal(measurementTargetAt(m, '2027-01-04'), 7);
  assert.equal(measurementTargetAt({ ...m, startDate: '2027-01-03' }, '2027-01-03'), 1);
});
test('next-period starts and leap February preserve full commitments', () => {
  assert.equal(nextMeasurementStart('monthly', '2026-10-30'), '2026-11-01');
  assert.equal(nextMeasurementStart('weekly', '2026-10-30'), '2026-11-02');
  assert.equal(nextMeasurementStart('monthly', '2026-12-31'), '2027-01-01');
  const m = { frequency: 'monthly' as const, target: 29, startDate: '2024-02-29' };
  assert.equal(measurementTargetAt(m, '2024-02-29'), 1);
  assert.equal(measurementTargetAt(m, '2024-03-01'), 29);
  assert.equal(measurementTargetAt({ ...m, startDate: '2024-03-01' }, '2024-02-29'), 0);
});
test('dated target changes retain the original first-period adjustment', () => {
  const m = { frequency: 'monthly' as const, target: 40, startDate: '2026-10-30',
    targetHistory: [{ start: '0001-01-01', target: 30 }, { start: '2026-11-01', target: 40 }] };
  assert.equal(measurementTargetAt(m, '2026-10-31'), 60 / 31);
  assert.equal(measurementTargetAt(m, '2026-11-30'), 40);
  assert.equal(measurementTargetAt(JSON.parse(JSON.stringify(m)), '2026-10-31'), 60 / 31);
  assert.equal(measurementTargetAt({ frequency: 'cumulative', target: 30, startDate: '2026-10-30' }, '2026-10-01'), 30);
  assert.equal(measurementTargetAt({ frequency: 'monthly', target: 30 }, '2026-10-30'), 30);
});

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

test('calendar months and Monday weeks have stable leap-year and year-crossing boundaries', () => {
  assert.deepEqual(measurementPeriod({ frequency: 'monthly' }, '2024-02-15'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(measurementPeriod({ frequency: 'monthly' }, '2025-02-15'), { start: '2025-02-01', end: '2025-02-28' });
  assert.deepEqual(measurementPeriod({ frequency: 'weekly' }, '2026-10-25'), { start: '2026-10-19', end: '2026-10-25' });
  assert.deepEqual(measurementPeriod({ frequency: 'weekly' }, '2026-10-26'), { start: '2026-10-26', end: '2026-11-01' });
  assert.deepEqual(measurementPeriod({ frequency: 'weekly' }, '2025-01-01'), { start: '2024-12-30', end: '2025-01-05' });
  assert.equal(measurementPeriod({}, '2024-01-01'), null);
});
test('monthly hours start fresh without carrying excess or deficits into another month', () => {
  const m = { baseline: 0, target: 30, frequency: 'monthly' as const, entries: [result('jan', 35, '2024-01-31'), result('feb', 5, '2024-02-01')] };
  assert.equal(measurementValueAt(m, '2024-01-31'), 35);
  assert.equal(measurementValueAt(m, '2024-02-29'), 5);
  assert.equal(measurementValueAt(m, '2024-03-01'), 0);
  assert.equal(contributionAmount(m, undefined, '2024-02-29'), 5);
  assert.equal(contributionPercent(m, 6), 20);
  assert.deepEqual(measurementEntries(m, '2024-02-29').map((e) => e.id), ['feb']);
});
test('weekly work uses its work date, including Sunday and Monday at a month boundary', () => {
  const m = { baseline: 0, frequency: 'weekly' as const, entries: [
    result('sun', 4, '2024-03-31'), result('mon', 2, '2024-04-01'), result('tue', 3, '2024-04-02'),
  ] };
  assert.equal(measurementValueAt(m, '2024-03-31'), 4);
  assert.equal(measurementValueAt(m, '2024-04-01'), 2);
  assert.equal(measurementValueAt(m, '2024-04-07'), 5);
  assert.equal(measurementValueAt(m, '2024-04-08'), 0);
});
test('period-to-date observations reconcile only that period, with stable same-day deltas', () => {
  const m = { baseline: 0, frequency: 'monthly' as const, entries: [
    observation('jan-total', 30, '2024-01-31'),
    result('feb-before', 4, '2024-02-02'), observation('feb-reading', 10, '2024-02-03'),
    result('feb-after', 2, '2024-02-03'), result('late-jan', 3, '2024-01-15'),
  ] };
  assert.equal(measurementValueAt(m, '2024-02-29'), 12);
  assert.equal(measurementValueAt(m, '2024-01-31'), 30);
  assert.equal(contributionAmount(m, undefined, '2024-02-29'), 6);
  assert.deepEqual(measurementTimeline(m, '2024-02-29').map((p) => p.value), [4, 10, 12]);
});
test('historical corrections do not leak into the next period and remain source-attributed once', () => {
  const m = { baseline: 0, frequency: 'monthly' as const, entries: [result('jan', 6, '2024-01-31'), result('feb', 2, '2024-02-01')] };
  m.entries[0].value = 8;
  assert.equal(measurementValueAt(m, '2024-01-31'), 8);
  assert.equal(measurementValueAt(m, '2024-02-29'), 2);
  assert.equal(contributionAmount(m, { milestoneId: 'milestone' }, '2024-01-31'), 8);
  assert.equal(contributionAmount(m, { taskId: 'task' }, '2024-01-31'), 8);
  assert.equal(contributionAmount(m, undefined, '2024-01-31'), 8);
  m.entries.shift();
  assert.equal(measurementValueAt(m, '2024-01-31'), 0);
  assert.equal(measurementValueAt(m, '2024-02-29'), 2);
});
test('history preserves recorded periods and includes a new current period with zero results', () => {
  const m = { baseline: 0, frequency: 'monthly' as const, entries: [result('jan', 5, '2024-01-12'), result('jan2', 3, '2024-01-15'), result('mar', 4, '2024-03-02')] };
  assert.deepEqual(measurementPeriods(m, '2024-04-01').map((p) => p.start), ['2024-04-01', '2024-03-01', '2024-01-01']);
  assert.equal(measurementValueAt(m, '2024-02-29'), 0);
});
test('explicit cumulative frequency preserves legacy values across all periods', () => {
  const entries = [result('jan', 3, '2024-01-31'), result('feb', 2, '2024-02-01')];
  assert.equal(measurementValueAt({ baseline: 10, frequency: 'cumulative', entries }, '2024-02-29'), 15);
  assert.equal(contributionAmount({ frequency: 'cumulative', entries }, undefined, '2024-02-29'), 5);
});
test('new recurring targets never rewrite past period percentages', () => {
  const m = { baseline: 0, target: 40, frequency: 'monthly' as const, entries: [],
    targetHistory: [{ start: '0001-01-01', target: 30 }, { start: '2024-02-01', target: 40 }],
  };
  assert.equal(measurementTargetAt(m, '2024-01-31'), 30);
  assert.equal(measurementTargetAt(m, '2024-02-01'), 40);
  assert.equal(contributionPercent(m, 15, '2024-01-31'), 50);
  assert.equal(contributionPercent(m, 20, '2024-02-29'), 50);
});
