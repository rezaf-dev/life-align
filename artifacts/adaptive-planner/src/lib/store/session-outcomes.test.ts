import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedWorkMinutes, sessionLedgerIssues } from '@workspace/api-zod';
import { todayIso, addDaysIso } from '../dates';
import { dayAgenda } from '../day-agenda';
import { buildTimesheet } from '../reports';
import { emptyWorkspace, hydrateState, getState, setWorkspaceWriter } from './store';
import { addGoal, addTask } from './actions';
import { logWorkSession, saveWorkSession } from './sessions';
import { startWorkTimer, pauseWorkTimer, saveWorkTimer, editLoggedWorkSession } from './time-tracking';
import { stateSchema } from '../../../../api-server/src/lib/planner-state';

let goalId: string, metricId: string, taskId: string;
const today = todayIso();
const tomorrow = addDaysIso(today, 1);
const state = () => getState();
const sessions = () => state().sessions!;
const plan = (recurrence: 'none' | 'daily' = 'none') => saveWorkSession({
  title: 'Client focus', goalId, metricId, plannedDate: today, plannedMinutes: 60,
  recurrence, taskIds: [taskId], notes: '',
});
const result = (actualMinutes = 30) => ({
  date: today, actualMinutes, allocations: [{ taskId, minutes: actualMinutes }], workDone: ['Configured email'],
});
beforeEach(() => {
  hydrateState(emptyWorkspace()); setWorkspaceWriter(() => {});
  goalId = addGoal({ title: 'Client website', outcome: '', area: 'business', priority: 'medium', targetDate: '2035-12-31',
    metric: { name: 'Hours', unit: 'hours', kind: 'leading', baseline: 0, target: 30 } });
  metricId = state().goals[0].metrics[0].id;
  taskId = addTask({ title: 'Email provider', goalId, effort: 60 });
});

test('continue records only actual work and keeps one linked remainder in today’s remaining sessions', () => {
  const id = plan();
  logWorkSession(id, { ...result(), outcome: 'continue' });
  const logged = sessions().find((s) => s.id === id)!;
  const remainder = sessions().find((s) => s.id === logged.remainderSessionId)!;
  assert.equal(logged.status, 'logged');
  assert.equal(logged.actualMinutes, 30);
  assert.equal(logged.originalPlannedMinutes, 60);
  assert.equal(logged.plannedMinutes, 30);
  assert.equal(remainder.status, 'planned');
  assert.equal(remainder.plannedDate, today);
  assert.equal(remainder.plannedMinutes, 30);
  assert.equal(remainder.continuationOfId, id);
  assert.deepEqual(remainder.taskIds, [taskId]);
  assert.equal(remainder.actualMinutes, undefined);
  assert.equal(remainder.workDone, undefined);
  assert.equal(plannedWorkMinutes(state(), today, today), 60);
  assert.deepEqual(dayAgenda(state(), today).remainingSessions.map((s) => s.id), [remainder.id]);
  assert.equal(state().tasks[0].status, 'open');
  assert.deepEqual(sessionLedgerIssues(state()), []);
  assert.equal(buildTimesheet(state(), state().goals[0], metricId, today, today).totalMinutes, 30);
  hydrateState(stateSchema.parse(structuredClone(state())));
  assert.equal(sessions().find((s) => s.id === remainder.id)!.continuationOfId, id);
});

test('finish short closes without creating remaining work or crediting the unused time', () => {
  const id = plan();
  logWorkSession(id, { ...result(), outcome: 'finish' });
  assert.equal(sessions().length, 1);
  assert.equal(sessions()[0].plannedMinutes, 60);
  assert.equal(sessions()[0].actualMinutes, 30);
  assert.equal(sessions()[0].sessionOutcome, 'finish');
  assert.equal(dayAgenda(state(), today).remainingSessions.length, 0);
  assert.equal(state().goals[0].metrics[0].entries.reduce((n, e) => n + e.value, 0), 0.5);
});

test('replan requires a valid date and invalid choices publish neither time nor remainder', () => {
  const id = plan();
  for (const remainingDate of [undefined, '2027-02-30', addDaysIso(today, -1)]) {
    assert.throws(() => logWorkSession(id, { ...result(), outcome: 'replan', remainingDate }), /today or a future/);
    assert.equal(sessions()[0].status, 'planned');
    assert.equal(state().goals[0].metrics[0].entries.length, 0);
  }
  logWorkSession(id, { ...result(), outcome: 'replan', remainingDate: tomorrow });
  const remainder = sessions().find((s) => s.status === 'planned')!;
  assert.equal(remainder.plannedDate, tomorrow);
  assert.equal(remainder.plannedMinutes, 30);
  assert.equal(dayAgenda(state(), today).remainingSessions.length, 0);
  assert.equal(dayAgenda(state(), tomorrow).remainingSessions[0].id, remainder.id);
});

test('recurring short sessions keep the full next occurrence and a nonrecurring remainder', () => {
  const id = plan('daily');
  logWorkSession(id, { ...result(), outcome: 'continue' });
  const logged = sessions().find((s) => s.id === id)!;
  const next = sessions().find((s) => s.id === logged.spawnedNextId)!;
  const remainder = sessions().find((s) => s.id === logged.remainderSessionId)!;
  assert.equal(next.plannedMinutes, 60);
  assert.equal(next.plannedDate, tomorrow);
  assert.equal(remainder.recurrence, 'none');
  logWorkSession(remainder.id, { ...result(30), outcome: 'finish' });
  assert.equal(sessions().length, 3);
  assert.equal(state().goals[0].metrics[0].entries.reduce((sum, e) => sum + e.value, 0), 1);
  assert.deepEqual(sessionLedgerIssues(state()), []);
});

test('subminute timer work preserves exact remaining seconds, retries do not create duplicate records', () => {
  const id = plan();
  startWorkTimer({ goalId, metricId, sessionId: id, title: 'Client focus' });
  pauseWorkTimer();
  const timerId = state().activeTimer!.id;
  const input = { title: 'Client focus', goalId, metricId, notes: '', outcome: 'continue' as const, days: [result(30.5)] };
  const ids = saveWorkTimer(timerId, input);
  const logged = sessions().find((s) => s.id === id)!;
  assert.equal(logged.actualMinutes, 30.5);
  assert.equal(sessions().find((s) => s.id === logged.remainderSessionId)!.plannedMinutes, 29.5);
  assert.equal(state().activeTimer, undefined);
  assert.deepEqual(saveWorkTimer(timerId, input), ids);
  assert.equal(sessions().length, 2);
  assert.equal(buildTimesheet(state(), state().goals[0], metricId, today, today).totalMinutes, 30.5);
  assert.throws(() => saveWorkTimer(timerId, { ...input, outcome: 'finish' }), /changed elsewhere/);
  assert.deepEqual(sessionLedgerIssues(state()), []);
  assert.ok(stateSchema.safeParse(state()).success);
});

test('multiday timer compares the total worked against the plan, not only the first date', () => {
  const id = plan();
  startWorkTimer({ goalId, metricId, sessionId: id, title: 'Client focus' });
  pauseWorkTimer();
  const timerId = state().activeTimer!.id;
  saveWorkTimer(timerId, { title: 'Client focus', goalId, metricId, notes: '', outcome: 'replan', remainingDate: tomorrow,
    days: [{ ...result(10), date: addDaysIso(today, -1) }, result(20)] });
  const logged = sessions().find((s) => s.id === id)!;
  assert.equal(sessions().find((s) => s.id === logged.remainderSessionId)!.plannedMinutes, 30);
  assert.equal(sessions().filter((s) => s.status === 'logged').reduce((n, s) => n + s.actualMinutes!, 0), 30);
  assert.deepEqual(sessionLedgerIssues(state()), []);
});

test('full or longer sessions never create phantom remaining work', () => {
  for (const minutes of [60, 75]) {
    const id = plan();
    logWorkSession(id, { ...result(minutes), outcome: 'continue' });
    assert.equal(sessions().find((s) => s.id === id)!.remainderSessionId, undefined);
  }
  assert.equal(sessions().filter((s) => s.status === 'planned').length, 0);
});

test('failed save retains the original plan, and correcting a log never duplicates its remainder', () => {
  const id = plan();
  setWorkspaceWriter(() => { throw new Error('Offline'); });
  assert.throws(() => logWorkSession(id, { ...result(), outcome: 'continue' }), /Offline/);
  assert.equal(sessions().length, 1);
  assert.equal(sessions()[0].status, 'planned');
  setWorkspaceWriter(() => {});
  logWorkSession(id, { ...result(), outcome: 'continue' });
  editLoggedWorkSession(id, { ...result(25), title: 'Client focus', goalId, metricId });
  assert.equal(sessions().length, 2);
  assert.equal(sessions().find((s) => s.status === 'planned')!.plannedMinutes, 30);
  assert.equal(buildTimesheet(state(), state().goals[0], metricId, today, today).totalMinutes, 25);
  assert.deepEqual(sessionLedgerIssues(state()), []);
});
