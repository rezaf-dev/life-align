import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { manualTimeDays, sessionLedgerIssues, plannedWorkMinutes, workSessionSchema } from '@workspace/api-zod';
import { buildTimeReport } from './time-report';
import { emptyWorkspace, hydrateState, getState, setWorkspaceWriter } from './store/store';
import { addGoal, addTask, deleteTask } from './store/actions';
import { logWorkSession, recordUnplannedSession, saveWorkSession } from './store/sessions';
import { editLoggedWorkSession, startWorkTimer, pauseWorkTimer, resumeWorkTimer, saveWorkTimer, recordManualWork } from './store/time-tracking';
import { stateSchema } from '../../../api-server/src/lib/planner-state';

const day = '2024-01-15';
let gid: string, mid: string, taskId: string, now: number;
const state = () => getState();
const draft = (goalId = gid) => ({ title: 'Work', goalId, metricId: goalId ? mid : undefined, plannedMinutes: 0, recurrence: 'none' as const, taskIds: [], notes: '' });
const result = (actualMinutes = 60) => ({ date: day, actualMinutes, allocations: [] });
beforeEach(() => {
  hydrateState(emptyWorkspace()); setWorkspaceWriter(() => {});
  gid = addGoal({ title: 'Client project', outcome: '', area: 'business', priority: 'medium', targetDate: '2035-01-01',
    metric: { name: 'Hours', unit: 'hours', kind: 'leading', baseline: 0, target: 30 } });
  mid = state().goals[0].metrics[0].id;
  taskId = addTask({ title: 'Email setup', goalId: gid });
  now = Date.parse(`${day}T08:00:00Z`);
  mock.method(Date, 'now', () => now);
});
afterEach(() => mock.restoreAll());

test('global totals count ledger entries once, not allocations or measure credits, with zero days and honest averages', () => {
  recordUnplannedSession(draft(), { ...result(60), allocations: [{ taskId, minutes: 40 }] });
  recordUnplannedSession(draft(''), { ...result(30), date: '2024-01-14' });
  const report = buildTimeReport(state(), day, '2024-01-17', '2024-01-16');
  assert.equal(report.totalMinutes, 60);
  assert.equal(report.allTimeMinutes, 90);
  assert.equal(report.todayMinutes, 0);
  assert.equal(report.weekMinutes, 60);
  assert.equal(report.averageDailyMinutes, 30);
  assert.equal(report.activeDays, 1);
  assert.deepEqual(report.daily.map((d) => d.minutes), [60, 0, 0]);
  assert.equal(report.tasks[0].minutes, 40);
  assert.equal(report.goals[0].minutes, 60);
  assert.equal(report.unknownTimeMinutes, 60);
  assert.equal(state().goals[0].metrics[0].entries.reduce((sum, e) => sum + e.value, 0), 1);
});

test('general tasks and no-goal timers/manual entries work without inventing a goal or measure', () => {
  const generalTask = addTask({ title: 'Admin email', effort: 30, plannedDate: day });
  startWorkTimer({ title: 'Admin email', goalId: '', taskId: generalTask });
  assert.ok(stateSchema.safeParse(state()).success);
  now += 30 * 60000; pauseWorkTimer();
  const timer = state().activeTimer!;
  const workDate = new Intl.DateTimeFormat('en-CA', { timeZone: timer.timezone }).format(new Date(now));
  saveWorkTimer(timer.id, { title: 'Admin email', goalId: '', notes: '', days: [{ date: workDate, actualMinutes: 30, allocations: [{ taskId: generalTask, minutes: 30 }] }] });
  recordUnplannedSession(draft(''), result(15));
  const report = buildTimeReport(state(), day, day, day);
  assert.equal(report.totalMinutes, 45);
  assert.equal(report.goals[0].title, 'General work');
  assert.equal(report.tasks[0].title, 'Admin email');
  assert.equal(state().goals.length, 1);
  assert.equal(state().goals[0].metrics[0].entries.length, 0);
  assert.equal(state().tasks.find((t) => t.id === generalTask)!.status, 'open');
  assert.deepEqual(sessionLedgerIssues(state()), []);
  assert.ok(stateSchema.safeParse(state()).success);
});

test('manual clock ranges preserve local day intervals and distribute time across day parts, with old duration entries unspecified', () => {
  const days = manualTimeDays(`${day}T11:30`, `${day}T13:00`, 'Europe/Istanbul');
  const ids = recordManualWork(draft(), days.map((d) => ({ date: d.date, actualMinutes: d.seconds / 60, allocations: [], timeIntervals: d.intervals, timezone: d.timezone })));
  recordUnplannedSession(draft(), result(30));
  hydrateState(stateSchema.parse(structuredClone(state())));
  const report = buildTimeReport(state(), day, day, day);
  assert.equal(report.totalMinutes, 120);
  assert.equal(report.knownTimeMinutes, 90);
  assert.equal(report.unknownTimeMinutes, 30);
  assert.equal(report.dayParts.find((d) => d.name === 'Morning')!.minutes, 30);
  assert.equal(report.dayParts.find((d) => d.name === 'Afternoon')!.minutes, 60);
  assert.equal(report.intervals[0].timezone, 'Europe/Istanbul');
  assert.equal(report.intervals[0].sessionId, ids[0]);
});

test('unchanged timer review preserves pauses as separate intervals, retries once, while duration edits do not fabricate a schedule', () => {
  startWorkTimer({ title: 'Focus', goalId: gid, metricId: mid });
  now += 30 * 60000; pauseWorkTimer();
  now += 15 * 60000; resumeWorkTimer();
  now += 30 * 60000; pauseWorkTimer();
  const timer = state().activeTimer!;
  const input = { title: 'Focus', goalId: gid, metricId: mid, notes: '', days: [result()] };
  saveWorkTimer(timer.id, input);
  const saved = state().sessions![0];
  assert.equal(saved.timeIntervals!.length, 2);
  assert.deepEqual(saveWorkTimer(timer.id, input), [saved.id]);
  const report = buildTimeReport(state(), day, day, day);
  assert.equal(report.knownTimeMinutes, 60);
  assert.equal(report.intervals.length, 2);
  startWorkTimer({ title: 'Adjusted', goalId: '' }); now += 60000; pauseWorkTimer();
  saveWorkTimer(state().activeTimer!.id, { title: 'Adjusted', goalId: '', notes: '', days: [result(20)] });
  assert.equal(state().sessions![1].timeIntervals, undefined);
  assert.equal(buildTimeReport(state(), day, day, day).unknownTimeMinutes, 20);
});

test('correcting descriptions keeps intervals, correcting actual time clears them, old timesheets and task snapshots stay intact', () => {
  const days = manualTimeDays(`${day}T09:00`, `${day}T10:00`, 'UTC');
  const [id] = recordManualWork(draft(), days.map((d) => ({ ...result(), allocations: [{ taskId, minutes: 60 }], timeIntervals: d.intervals, timezone: d.timezone })));
  editLoggedWorkSession(id, { ...result(), title: 'Corrected title', goalId: gid, metricId: mid, allocations: [{ taskId, minutes: 60 }] });
  assert.equal(state().sessions![0].timeIntervals!.length, 1);
  deleteTask(taskId);
  assert.equal(buildTimeReport(state(), day, day, day).tasks[0].title, 'Email setup');
  editLoggedWorkSession(id, { ...result(45), title: 'Corrected title', goalId: gid, metricId: mid, allocations: [{ taskId, minutes: 45 }] });
  assert.equal(state().sessions![0].timeIntervals, undefined);
  assert.equal(state().sessions![0].timezone, undefined);
  assert.equal(buildTimeReport(state(), day, day, day).unknownTimeMinutes, 45);
  assert.deepEqual(sessionLedgerIssues(state()), []);
});

test('general reservations cover general task estimates once; planned vs unplanned records are distinct', () => {
  const generalTask = addTask({ title: 'Administration', plannedDate: day, effort: 60 });
  const id = saveWorkSession({ ...draft(''), plannedDate: day, plannedMinutes: 60, taskIds: [generalTask] });
  assert.equal(plannedWorkMinutes(state(), day, day), 60);
  logWorkSession(id, { ...result(30), allocations: [{ taskId: generalTask, minutes: 30 }], outcome: 'finish' });
  recordUnplannedSession(draft(''), result(20));
  const report = buildTimeReport(state(), day, day, day);
  assert.equal(report.plannedMinutes, 60);
  assert.equal(report.plannedLoggedMinutes, 30);
  assert.equal(report.unplannedMinutes, 20);
  assert.equal(report.totalMinutes, 50);
});

test('invalid ranges, wrong interval duration/date/zone and goal-less metric credit are rejected without partial writes', () => {
  assert.throws(() => buildTimeReport(state(), '2024-02-30', day), /valid/);
  assert.throws(() => buildTimeReport(state(), '2024-02-01', day), /after/);
  assert.throws(() => recordUnplannedSession({ ...draft(''), metricId: mid }, result()));
  const intervals = [{ start: `${day}T09:00:00Z`, end: `${day}T10:00:00Z` }];
  assert.throws(() => recordUnplannedSession(draft(), { ...result(30), timeIntervals: intervals, timezone: 'UTC' }));
  assert.throws(() => recordUnplannedSession(draft(), { ...result(), timeIntervals: intervals, timezone: 'badzone' }));
  assert.equal(state().sessions?.length ?? 0, 0);
  const valid = recordUnplannedSession(draft(''), result());
  const saved = state().sessions!.find((s) => s.id === valid)!;
  assert.equal(workSessionSchema.safeParse({ ...saved, timeIntervals: intervals, timezone: 'UTC', date: '2024-01-16' }).success, false);
});

test('DST manual days retain real elapsed time and exact intervals on 23/25-hour dates', () => {
  for (const [start, end, hours] of [['2024-03-10', '2024-03-11', 23], ['2024-11-03', '2024-11-04', 25]] as const) {
    const days = manualTimeDays(`${start}T00:00`, `${end}T00:00`, 'America/New_York');
    recordManualWork(draft(''), days.map((d) => ({ date: d.date, actualMinutes: d.seconds / 60, allocations: [], timeIntervals: d.intervals, timezone: d.timezone })));
    const report = buildTimeReport(state(), start, start, start);
    assert.equal(report.totalMinutes, hours * 60);
    assert.equal(report.knownTimeMinutes, hours * 60);
    assert.ok(Math.abs(report.dayParts.reduce((sum, p) => sum + p.minutes, 0) - hours * 60) < 1e-8);
  }
});

test('goals without time measures still report invested time, and result-only goals do not disappear', () => {
  const goal = addGoal({ title: 'Get first client', outcome: '', area: 'business', priority: 'medium', targetDate: '2035-01-01',
    metric: { name: 'Clients won', unit: 'clients', kind: 'lagging', baseline: 0, target: 1 } });
  recordUnplannedSession({ ...draft(goal), metricId: undefined }, result(45));
  const report = buildTimeReport(state(), day, day, day);
  const row = report.goals.find((r) => r.goalId === goal)!;
  assert.equal(row.minutes, 45);
  assert.equal(row.measures[0].unit, 'clients');
  assert.equal(state().goals.find((g) => g.id === goal)!.metrics[0].entries.length, 0);
  const updated = structuredClone(state());
  const resultGoal = updated.goals.find((g) => g.id === gid)!;
  resultGoal.createdAt = '2024-01-01T00:00';
  resultGoal.metrics[0].startDate = '2024-01-01';
  resultGoal.metrics[0].entries.push({ id: 'result-only', date: day, value: 2, mode: 'contribution', note: '' });
  hydrateState(updated);
  const resultOnly = buildTimeReport(state(), day, day, day).goals.find((g) => g.goalId === gid)!;
  assert.equal(resultOnly.minutes, 0);
  assert.equal(resultOnly.measures[0].periods[0].endValue, 2);
});
