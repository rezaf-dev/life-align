import { beforeEach, afterEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { activeWorkTimerSchema, timerElapsedSeconds, splitTimerDays, manualTimeDays, formatElapsed } from '@workspace/api-zod';
import { emptyWorkspace, hydrateState, getState, setWorkspaceWriter } from './store';
import { addGoal, addTask, deleteGoal } from './actions';
import { startWorkTimer, pauseWorkTimer, resumeWorkTimer, saveWorkTimer, discardWorkTimer, editLoggedWorkSession, recordManualWork } from './time-tracking';
import { saveWorkSession } from './sessions';
import { metricValueAt } from './selectors';
import { buildTimesheet, formatMinutes } from '../reports';
import { stateSchema } from '../../../../api-server/src/lib/planner-state';
let goalId: string, metricId: string, taskId: string, now: number;
const state = () => getState();
const metric = () => state().goals.find((g) => g.id === goalId)!.metrics[0];
const timer = () => state().activeTimer!;
const input = () => ({ title: 'Client work', goalId, metricId, taskId });
const day = (date: string, seconds: number) => ({ date, actualMinutes: seconds / 60, allocations: [{ taskId, minutes: seconds / 60 }] });
const review = (days = [day('2024-01-15', 61)]) => ({ title: 'Actual work', goalId, metricId, notes: '', days });
beforeEach(() => {
  hydrateState(emptyWorkspace()); setWorkspaceWriter(() => {});
  goalId = addGoal({ title: 'Project', outcome: '', area: 'business', priority: 'medium', targetDate: '2030-01-01',
    metric: { name: 'Hours', unit: 'hours', kind: 'leading', baseline: 0, target: 30, frequency: 'monthly', startDate: '2024-01-01' } });
  metricId = metric().id;
  taskId = addTask({ title: 'Email setup', goalId, effort: 60 });
  now = Date.parse('2024-01-15T12:00:00Z');
  mock.method(Date, 'now', () => now);
});
afterEach(() => mock.restoreAll());
test('one timer stores timestamps, not credits or task completion, and rejects a second timer', () => {
  startWorkTimer(input());
  assert.equal(timer().status, 'running');
  assert.equal(metric().entries.length, 0);
  assert.equal(state().tasks[0].status, 'open');
  const before = structuredClone(state());
  assert.throws(() => startWorkTimer(input()));
  assert.deepEqual(state(), before);
  assert.throws(() => deleteGoal(goalId));
  assert.ok(stateSchema.safeParse(state()).success);
});
test('elapsed time survives hydration, excludes pauses, and retains seconds', () => {
  startWorkTimer(input()); now += 61000;
  assert.equal(timerElapsedSeconds(timer()), 61);
  hydrateState(structuredClone(state()));
  pauseWorkTimer(); now += 600000;
  assert.equal(timerElapsedSeconds(timer()), 61);
  resumeWorkTimer(); now += 2000; pauseWorkTimer();
  assert.equal(timerElapsedSeconds(timer()), 63);
  assert.equal(formatElapsed(3661), '01:01:01');
  assert.equal(formatMinutes(61 / 60), '1m 1s');
});
test('saving is atomic and idempotent, exact seconds flow into measurements and timesheets once', () => {
  const id = startWorkTimer(input()); now += 61000; pauseWorkTimer();
  let writes = 0; setWorkspaceWriter(() => { writes++; });
  const ids = saveWorkTimer(id, review());
  assert.equal(writes, 1);
  assert.equal(state().activeTimer, undefined);
  assert.ok(Math.abs(metricValueAt(metric(), '2024-01-31') - 61 / 3600) < 1e-12);
  assert.equal(state().tasks[0].status, 'open');
  assert.equal(buildTimesheet(state(), state().goals[0], metricId, '2024-01-01', '2024-01-31').totalMinutes, 61 / 60);
  assert.deepEqual(saveWorkTimer(id, review()), ids);
  assert.throws(() => saveWorkTimer(id, { ...review(), title: 'Different work from another device' }));
  assert.equal(state().sessions!.length, 1);
  assert.ok(stateSchema.safeParse(state()).success);
});
test('a bad review or failed writer leaves paused work intact and publishes no partial credit', () => {
  const id = startWorkTimer(input()); now += 61000; pauseWorkTimer();
  const before = structuredClone(state());
  assert.throws(() => saveWorkTimer(id, review([{ ...day('2024-01-15', 61), actualMinutes: 0 }])));
  assert.deepEqual(state(), before);
  setWorkspaceWriter(() => { throw new Error('Save unavailable'); });
  assert.throws(() => saveWorkTimer(id, review()));
  assert.deepEqual(state(), before);
});
test('paused/discarded timers never imply measured progress', () => {
  startWorkTimer(input()); now += 5000; pauseWorkTimer();
  assert.equal(metric().entries.length, 0);
  discardWorkTimer();
  assert.equal(state().activeTimer, undefined); assert.equal(metric().entries.length, 0);
});
test('midnight and month boundaries split into exact dated contributions', () => {
  now = Date.parse('2024-01-31T23:59:00Z');
  const id = startWorkTimer(input()); timer().timezone = 'UTC';
  now += 180000; pauseWorkTimer();
  const parts = splitTimerDays(timer());
  assert.deepEqual(parts, [{ date: '2024-01-31', seconds: 60 }, { date: '2024-02-01', seconds: 120 }]);
  saveWorkTimer(id, review(parts.map((p) => day(p.date, p.seconds))));
  assert.equal(metricValueAt(metric(), '2024-01-31'), 1 / 60);
  assert.equal(metricValueAt(metric(), '2024-02-29'), 2 / 60);
  assert.equal(state().sessions!.length, 2);
  assert.ok(stateSchema.safeParse(state()).success);
});
test('planned timers consume their reservation and schedule recurrence after the final work date', () => {
  const sessionId = saveWorkSession({ title: 'Daily work', goalId, metricId, plannedDate: '2024-01-31', plannedMinutes: 60,
    recurrence: 'daily', taskIds: [taskId], notes: '' });
  now = Date.parse('2024-01-31T23:59:00Z');
  const id = startWorkTimer({ ...input(), sessionId }); timer().timezone = 'UTC';
  now += 180000; pauseWorkTimer();
  saveWorkTimer(id, review(splitTimerDays(timer()).map((p) => day(p.date, p.seconds))));
  assert.equal(state().sessions!.find((s) => s.id === sessionId)!.status, 'logged');
  assert.equal(state().sessions!.find((s) => s.status === 'planned')!.plannedDate, '2024-02-02');
});
test('manual clock ranges split at local midnight and daylight-saving days preserve actual elapsed seconds', () => {
  assert.deepEqual(manualTimeDays('2024-01-31T23:50', '2024-02-01T00:10', 'Europe/Istanbul'),
    [{ date: '2024-01-31', seconds: 600 }, { date: '2024-02-01', seconds: 600 }]);
  assert.deepEqual(manualTimeDays('2024-03-10T00:00', '2024-03-11T00:00', 'America/New_York'),
    [{ date: '2024-03-10', seconds: 23 * 3600 }]);
  assert.deepEqual(manualTimeDays('2024-11-03T00:00', '2024-11-04T00:00', 'America/New_York'),
    [{ date: '2024-11-03', seconds: 25 * 3600 }]);
  assert.throws(() => manualTimeDays('2024-03-10T02:30', '2024-03-10T04:00', 'America/New_York'));
  assert.throws(() => manualTimeDays('2024-11-03T01:30', '2024-11-03T04:00', 'America/New_York'));
  assert.throws(() => manualTimeDays('2024-01-15T13:00', '2024-01-15T12:00', 'UTC'));
  assert.throws(() => manualTimeDays('2024-02-30T12:00', '2024-03-01T12:00', 'UTC'));
});
test('manual ranges and full corrections use the same ledger and can move to another goal/measure', () => {
  const ids = recordManualWork({ title: 'Manual work', goalId, metricId, plannedMinutes: 0, recurrence: 'none', taskIds: [], notes: '' },
    [day('2024-01-15', 61), day('2024-01-16', 120)]);
  assert.equal(state().sessions!.length, 2);
  const other = addGoal({ title: 'Other project', outcome: '', area: 'business', priority: 'medium', targetDate: '2030-01-01',
    metric: { name: 'Time', unit: 'minutes', kind: 'leading', baseline: 0, target: 100 } });
  const otherMetric = state().goals.find((g) => g.id === other)!.metrics[0];
  editLoggedWorkSession(ids[0], { title: 'Fixed description', goalId: other, metricId: otherMetric.id, date: '2024-01-17',
    actualMinutes: 1.5, notes: 'Corrected', allocations: [] });
  assert.equal(metricValueAt(metric(), '2024-01-31'), 2 / 60);
  assert.equal(metricValueAt(state().goals.find((g) => g.id === other)!.metrics[0]), 1.5);
  assert.equal(state().sessions!.find((s) => s.id === ids[0])!.title, 'Fixed description');
  assert.ok(stateSchema.safeParse(state()).success);
});
test('timer schema rejects overlapping intervals, invalid time zones and multiple running segments', () => {
  startWorkTimer(input());
  const snapshot = structuredClone(timer());
  snapshot.segments.push({ start: snapshot.segments[0].start });
  assert.ok(!activeWorkTimerSchema.safeParse(snapshot).success);
  assert.ok(!activeWorkTimerSchema.safeParse({ ...timer(), timezone: 'Not/AZone' }).success);
});
