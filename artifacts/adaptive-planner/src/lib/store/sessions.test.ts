import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedWorkMinutes, sessionLedgerIssues } from '@workspace/api-zod';
import { hydrateState, emptyWorkspace, getState, setWorkspaceWriter } from './store';
import { addGoal, addTask, completeTaskWithResult, deleteTask, deleteMetric, deleteGoal, editContribution, deleteMetricEntry, logMetric, recordContribution } from './actions';
import { saveWorkSession, logWorkSession, recordUnplannedSession, deleteWorkSession, convertTaskToWorkSession, type SessionDraft } from './sessions';
import { contributionAmount, metricValueAt } from './selectors';
import { stateSchema } from '../../../../api-server/src/lib/planner-state';

let goalId: string; let metricId: string; let task1: string; let task2: string;
const state = () => getState();
const metric = () => state().goals.find((g) => g.id === goalId)!.metrics[0];
const session = (id: string) => state().sessions!.find((s) => s.id === id)!;
const draft = (patch: Partial<SessionDraft> = {}): SessionDraft => ({
  title: 'Project focus', goalId, metricId, plannedDate: '2024-01-15',
  plannedMinutes: 60, recurrence: 'none', taskIds: [], notes: '', ...patch,
});
beforeEach(() => {
  hydrateState(emptyWorkspace()); setWorkspaceWriter(() => {});
  goalId = addGoal({ title: 'Project', outcome: '', area: 'business', priority: 'medium', targetDate: '2030-01-01',
    metric: { name: 'Project hours', unit: 'hours', kind: 'leading', baseline: 0, target: 30, frequency: 'monthly', startDate: '2024-01-01' } });
  metricId = metric().id;
  task1 = addTask({ title: 'Set up email', goalId, effort: 40, plannedDate: '2024-01-15' });
  task2 = addTask({ title: 'Unexpected deployment fix', goalId, effort: 20, plannedDate: '2024-01-15' });
});
test('planned sessions reserve time without recording actuals; task estimates inside the reservation count once', () => {
  saveWorkSession(draft({ taskIds: [task1, task2] }));
  assert.equal(metric().entries.length, 0);
  assert.equal(plannedWorkMinutes(state(), '2024-01-15', '2024-01-15'), 60);
  saveWorkSession(draft({ title: 'Extra work', plannedMinutes: 30 }));
  assert.equal(plannedWorkMinutes(state(), '2024-01-15', '2024-01-15'), 90);
});
test('one hour split across two unfinished tasks credits exactly one hour and keeps task attribution', () => {
  const id = saveWorkSession(draft({ taskIds: [task1, task2] }));
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 60, allocations: [{ taskId: task1, minutes: 40 }, { taskId: task2, minutes: 20 }] });
  assert.equal(metricValueAt(metric(), '2024-01-31'), 1);
  assert.equal(contributionAmount(metric(), { taskId: task1 }, '2024-01-31'), 40 / 60);
  assert.equal(metric().entries.length, 2);
  assert.ok(state().tasks.every((t) => t.status === 'open'));
  completeTaskWithResult(task1);
  assert.equal(metricValueAt(metric(), '2024-01-31'), 1);
  assert.deepEqual(sessionLedgerIssues(state()), []);
});
test('unplanned sessions and unallocated project work count once and can exceed the planned duration', () => {
  const id = saveWorkSession(draft({ plannedDate: undefined, plannedMinutes: 0 }));
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 90, allocations: [{ taskId: task1, minutes: 30 }] });
  assert.equal(metricValueAt(metric(), '2024-01-31'), 1.5);
  assert.equal(metric().entries.find((e) => !e.source?.taskId)?.value, 1);
  assert.equal(session(id).actualMinutes, 90);
});
test('session retries are idempotent, and correcting duration replaces rather than adds credits', () => {
  const id = saveWorkSession(draft({ recurrence: 'daily' }));
  const result = { date: '2024-01-15', actualMinutes: 60, allocations: [{ taskId: task1, minutes: 40 }] };
  logWorkSession(id, result);
  const entryIds = metric().entries.map((e) => e.id);
  logWorkSession(id, result);
  assert.equal(metricValueAt(metric(), '2024-01-31'), 1);
  assert.deepEqual(metric().entries.map((e) => e.id), entryIds);
  assert.equal(state().sessions!.length, 2);
  assert.equal(session(session(id).spawnedNextId!).plannedDate, '2024-01-16');
  assert.equal(session(session(id).spawnedNextId!).actualMinutes, undefined);
  logWorkSession(id, { ...result, actualMinutes: 45 });
  assert.equal(metricValueAt(metric(), '2024-01-31'), 0.75);
  assert.equal(state().sessions!.length, 2);
});
test('correcting the work date moves time to the correct month without leaking past credit', () => {
  const id = saveWorkSession(draft());
  logWorkSession(id, { date: '2024-01-31', actualMinutes: 60, allocations: [] });
  logWorkSession(id, { date: '2024-02-01', actualMinutes: 60, allocations: [] });
  assert.equal(metricValueAt(metric(), '2024-01-31'), 0);
  assert.equal(metricValueAt(metric(), '2024-02-29'), 1);
});
test('late recurring work schedules the next future slot instead of creating a backlog of missed sessions', () => {
  const id = saveWorkSession(draft({ recurrence: 'daily' }));
  logWorkSession(id, { date: '2024-01-20', actualMinutes: 60, allocations: [] });
  assert.equal(session(session(id).spawnedNextId!).plannedDate, '2024-01-21');
});
test('editing a session preserves its position relative to a same-day absolute checkpoint', () => {
  const id = saveWorkSession(draft());
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 60, allocations: [] });
  logMetric(goalId, metricId, 5, '2024-01-15');
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 45, allocations: [] });
  assert.equal(metricValueAt(metric(), '2024-01-31'), 5);
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 45, allocations: [{ taskId: task1, minutes: 45 }] });
  assert.equal(metricValueAt(metric(), '2024-01-31'), 5);
});
test('minutes measures convert directly, while unrelated metrics cannot receive session time', () => {
  const m = metric();
  m.unit = 'minutes';
  const id = saveWorkSession(draft());
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 45, allocations: [] });
  assert.equal(metricValueAt(metric(), '2024-01-31'), 45);
  metric().unit = 'customers';
  assert.throws(() => saveWorkSession(draft()), /hours or minutes/);
});
test('allocation overflow, duplicates, wrong-goal tasks, future dates and malformed durations fail atomically', () => {
  const otherGoal = addGoal({ title: 'Other', outcome: '', area: 'personal', priority: 'medium', targetDate: '2030-01-01' });
  const otherTask = addTask({ title: 'Other task', goalId: otherGoal });
  const id = saveWorkSession(draft());
  const before = structuredClone(state());
  for (const input of [
    { date: '2024-01-15', actualMinutes: 30, allocations: [{ taskId: task1, minutes: 40 }] },
    { date: '2024-01-15', actualMinutes: 60, allocations: [{ taskId: task1, minutes: 20 }, { taskId: task1, minutes: 20 }] },
    { date: '2024-01-15', actualMinutes: 60, allocations: [{ taskId: otherTask, minutes: 20 }] },
    { date: '2099-01-01', actualMinutes: 60, allocations: [] },
    { date: '2024-02-30', actualMinutes: 60, allocations: [] },
    { date: '2024-01-15', actualMinutes: 0, allocations: [] },
  ]) {
    assert.throws(() => logWorkSession(id, input));
    assert.deepEqual(state(), before);
  }
});
test('logged sessions survive server validation and reload; duplicate/mismatched credits are rejected', () => {
  const id = saveWorkSession(draft());
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 60, allocations: [{ taskId: task1, minutes: 40 }] });
  hydrateState(stateSchema.parse(state()));
  assert.equal(metricValueAt(metric(), '2024-01-31'), 1);
  const duplicate = structuredClone(state());
  duplicate.goals[0].metrics[0].entries.push({ ...duplicate.goals[0].metrics[0].entries[0], id: 'duplicate' });
  assert.equal(stateSchema.safeParse(duplicate).success, false);
  const missing = structuredClone(state());
  missing.goals[0].metrics[0].entries.pop();
  assert.equal(stateSchema.safeParse(missing).success, false);
});
test('corrections are owned by sessions, and deleting a session removes its credit exactly once', () => {
  const id = saveWorkSession(draft());
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 60, allocations: [] });
  const entry = metric().entries[0];
  assert.throws(() => editContribution(goalId, metricId, entry.id, { amount: 2, date: entry.date }), /Work sessions/);
  assert.throws(() => deleteMetricEntry(goalId, metricId, entry.id), /work session/);
  deleteWorkSession(id); deleteWorkSession(id);
  assert.equal(metric().entries.length, 0);
});
test('task deletion preserves attributed session time; logged corrections still retain source snapshots', () => {
  const id = saveWorkSession(draft());
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 60, allocations: [{ taskId: task1, minutes: 40 }] });
  deleteTask(task1);
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 60, allocations: [{ taskId: task1, minutes: 40 }] });
  assert.equal(metric().entries.find((e) => e.source?.taskId === task1)?.source?.taskTitle, 'Set up email');
  assert.deepEqual(sessionLedgerIssues(state()), []);
});
test('converting a recurring reminder is explicit, idempotent and preserves its prior results', () => {
  state().tasks[0].recurrence = 'daily';
  const original = state().tasks[0];
  recordContribution(goalId, metricId, { taskId: original.id, amount: 0.5, date: '2024-01-14' });
  const id = convertTaskToWorkSession(original.id, metricId);
  assert.equal(convertTaskToWorkSession(original.id, metricId), id);
  assert.equal(state().tasks.find((t) => t.id === original.id)?.archived, true);
  assert.equal(session(id).recurrence, 'daily');
  assert.equal(session(id).sourceTaskId, original.id);
  assert.equal(metric().entries.length, 1);
  assert.equal(metricValueAt(metric(), '2024-01-31'), 0.5);
});
test('deleting a time measure keeps time-only history; deleting its goal removes dependent sessions', () => {
  const id = saveWorkSession(draft());
  logWorkSession(id, { date: '2024-01-15', actualMinutes: 60, allocations: [] });
  deleteMetric(goalId, metricId);
  assert.equal(session(id).metricId, undefined);
  assert.equal(stateSchema.safeParse(state()).success, true);
  deleteGoal(goalId);
  assert.equal(state().sessions?.length, 0);
});
test('a failed workspace write publishes neither a session nor partially recorded progress', () => {
  const id = saveWorkSession(draft());
  const before = structuredClone(state());
  setWorkspaceWriter(() => { throw new Error('simulated unavailable writer'); });
  assert.throws(() => logWorkSession(id, { date: '2024-01-15', actualMinutes: 60, allocations: [] }));
  assert.deepEqual(state(), before);
});
test('unexpected work is created and credited in a single write, or not created on invalid results', () => {
  let writes = 0; setWorkspaceWriter(() => { writes++; });
  const id = recordUnplannedSession(draft(), { date: '2024-01-15', actualMinutes: 30, allocations: [] });
  assert.equal(writes, 1);
  assert.equal(session(id).plannedDate, undefined);
  assert.equal(session(id).plannedMinutes, 0);
  assert.equal(metricValueAt(metric(), '2024-01-31'), 0.5);
  const before = structuredClone(state());
  assert.throws(() => recordUnplannedSession(draft(), { date: '2024-02-30', actualMinutes: 30, allocations: [] }));
  assert.deepEqual(state(), before);
});
test('capturing unexpected tasks is atomic, stays unscheduled, and never adds planned capacity or duplicate time', () => {
  let writes = 0; setWorkspaceWriter(() => { writes++; });
  const id = recordUnplannedSession(draft(), { date: '2024-01-15', actualMinutes: 60, allocations: [],
    newTasks: [{ key: 'unexpected', title: 'Fix deployment', minutes: 20 }] });
  assert.equal(writes, 1);
  const task = state().tasks.find((t) => t.title === 'Fix deployment')!;
  assert.equal(task.status, 'open');
  assert.equal(task.plannedDate, undefined);
  assert.equal(task.effort, 0);
  assert.equal(metricValueAt(metric(), '2024-01-31'), 1);
  assert.equal(session(id).allocations[0].minutes, 20);
  const before = structuredClone(state());
  assert.throws(() => recordUnplannedSession(draft(), { date: '2024-01-15', actualMinutes: 20, allocations: [],
    newTasks: [{ key: 'too-much', title: 'Must not be created', minutes: 30 }] }));
  assert.deepEqual(state(), before);
});
