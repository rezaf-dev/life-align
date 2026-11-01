import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedWorkMinutes, sessionLedgerIssues, workSessionSchema } from '@workspace/api-zod';
import { addDaysIso, addMonthsIso, todayIso } from '../dates';
import { missedWork } from '../missed-work';
import { dayAgenda } from '../day-agenda';
import { sessionMatchesTaskView } from '../task-views';
import { hydrateState, emptyWorkspace, getState, setWorkspaceWriter } from './store';
import { addGoal, addTask, archiveTask } from './actions';
import { generateInsights } from './insights';
import { isOverdue } from './selectors';
import { saveWorkSession, logWorkSession } from './sessions';
import { replanMissedSession, replanMissedTask, skipMissedSession, skipMissedTask } from './missed-work';
import { stateSchema } from '../../../../api-server/src/lib/planner-state';

const today = todayIso();
const yesterday = addDaysIso(today, -1);
let goalId: string;
beforeEach(() => {
  hydrateState(emptyWorkspace());
  setWorkspaceWriter(() => {});
  goalId = addGoal({ title: 'Client project', outcome: '', area: 'business', priority: 'medium', targetDate: '2035-12-31',
    metric: { name: 'Hours', unit: 'hours', kind: 'leading', baseline: 0, target: 30 } });
});
const session = (patch = {}) => saveWorkSession({
  title: 'Project focus', goalId, plannedDate: yesterday, plannedMinutes: 60,
  recurrence: 'none' as const, taskIds: [], notes: '', ...patch,
});

test('missed work includes past open tasks and sessions, never future/replanned/done/archived work', () => {
  const taskId = addTask({ title: 'Missed task', goalId, plannedDate: yesterday });
  addTask({ title: 'Explicit new plan', goalId, plannedDate: addDaysIso(today, 2), dueDate: yesterday });
  addTask({ title: 'Today', plannedDate: today });
  const archived = addTask({ title: 'Archived', plannedDate: yesterday });
  archiveTask(archived);
  const sessionId = session();
  session({ plannedDate: today });
  session({ plannedDate: undefined });
  assert.deepEqual(missedWork(getState(), today).tasks.map((t) => t.id), [taskId]);
  assert.deepEqual(missedWork(getState(), today).sessions.map((s) => s.id), [sessionId]);
});

test('replan resolves missed state, adjusts stale due dates and reminder while preserving task result state', () => {
  const id = addTask({ title: 'Overdue', plannedDate: yesterday, dueDate: yesterday, reminder: `${yesterday}T09:30` });
  const future = addDaysIso(today, 3);
  replanMissedTask(id, future);
  const task = getState().tasks.find((t) => t.id === id)!;
  assert.equal(task.plannedDate, future);
  assert.equal(task.dueDate, future);
  assert.equal(task.reminder, `${future}T09:30`);
  assert.equal(task.status, 'open');
  assert.equal(isOverdue(task, today), false);
  assert.equal(missedWork(getState(), today).tasks.length, 0);
  const sid = session();
  replanMissedSession(sid, today);
  assert.equal(missedWork(getState(), today).sessions.length, 0);
  assert.deepEqual(dayAgenda(getState(), today).remainingSessions.map((s) => s.id), [sid]);
  assert.throws(() => replanMissedSession(sid, yesterday), /today or a future/);
  assert.throws(() => replanMissedTask(id, '2027-02-30'), /today or a future/);
});

test('skipping a recurring task retains open archived history and spawns just one next occurrence, including today', () => {
  const id = addTask({ title: 'Daily work', plannedDate: addDaysIso(today, -5), recurrence: 'daily' });
  skipMissedTask(id);
  skipMissedTask(id);
  const state = getState();
  const original = state.tasks.find((t) => t.id === id)!;
  const next = state.tasks.find((t) => t.id === original.spawnedNextId)!;
  assert.equal(original.archived, true);
  assert.ok(original.skippedAt);
  assert.equal(original.status, 'open');
  assert.equal(original.completedAt, undefined);
  assert.equal(next.plannedDate, today);
  assert.equal(next.archived, false);
  assert.equal(next.skippedAt, undefined);
  assert.equal(state.tasks.length, 2);
  assert.equal(dayAgenda(state, today).doneTasks.length, 0);
  assert.equal(missedWork(state, today).tasks.length, 0);
  archiveTask(id, false);
  assert.equal(getState().tasks.find((t) => t.id === id)!.skippedAt, undefined);
});

test('skipped sessions preserve history, never count as time/completion, and survive server validation', () => {
  const id = session({ recurrence: 'weekly' });
  skipMissedSession(id);
  skipMissedSession(id);
  const state = getState();
  const original = state.sessions!.find((s) => s.id === id)!;
  const next = state.sessions!.find((s) => s.id === original.spawnedNextId)!;
  assert.equal(original.status, 'skipped');
  assert.ok(original.skippedAt);
  assert.equal(original.actualMinutes, undefined);
  assert.equal(next.status, 'planned');
  assert.equal(next.plannedDate, addDaysIso(yesterday, 7));
  assert.equal(state.sessions!.length, 2);
  assert.equal(plannedWorkMinutes(state, yesterday, today), 0);
  assert.equal(dayAgenda(state, yesterday).doneSessions.length, 0);
  assert.equal(sessionMatchesTaskView(original, 'done', today), false);
  assert.equal(sessionMatchesTaskView(original, 'open', today), false);
  assert.equal(sessionMatchesTaskView(original, 'archived', today), true);
  assert.equal(state.goals[0].metrics[0].entries.length, 0);
  assert.deepEqual(sessionLedgerIssues(state), []);
  assert.equal(stateSchema.safeParse(state).success, true);
  assert.throws(() => logWorkSession(id, { date: today, actualMinutes: 20, allocations: [] }), /Skipped sessions/);
  assert.equal(workSessionSchema.safeParse({ ...original, actualMinutes: 30 }).success, false);
});

test('monthly skip preserves the original month-end cadence after several missed periods', () => {
  const base = `${Number(today.slice(0, 4)) - 1}-01-31`;
  const id = session({ recurrence: 'monthly', plannedDate: base });
  skipMissedSession(id);
  const original = getState().sessions!.find((s) => s.id === id)!;
  let months = 1;
  while (addMonthsIso(base, months) < today) months++;
  assert.equal(getState().sessions!.find((s) => s.id === original.spawnedNextId)!.plannedDate, addMonthsIso(base, months));
});

test('failed persistence publishes neither the skip nor its recurring successor', () => {
  const id = session({ recurrence: 'daily' });
  const before = structuredClone(getState());
  setWorkspaceWriter(() => { throw new Error('Unavailable'); });
  assert.throws(() => skipMissedSession(id), /Unavailable/);
  assert.deepEqual(getState(), before);
});

test('logged sessions cannot be skipped or replanned and their time remains intact', () => {
  const id = session();
  logWorkSession(id, { date: today, actualMinutes: 30, allocations: [] });
  assert.throws(() => skipMissedSession(id), /Logged work/);
  assert.throws(() => replanMissedSession(id, today), /no longer planned/);
  assert.equal(getState().sessions!.find((s) => s.id === id)!.actualMinutes, 30);
});

test('goal-linked attention insights carry the goal name and identifier, including ambiguous measure names', () => {
  const state = structuredClone(getState());
  const goal = state.goals[0];
  goal.createdAt = `${addDaysIso(today, -10)}T09:00`;
  goal.targetDate = addDaysIso(today, 1);
  const metric = goal.metrics[0];
  metric.startDate = addDaysIso(today, -10);
  metric.entries = [{ id: 'entry', date: today, value: 1 }];
  const pace = generateInsights(state, today).find((i) => i.id === `pace-${goal.id}`);
  assert.ok(pace);
  assert.equal(pace.goalId, goal.id);
  assert.equal(pace.goalTitle, 'Client project');
  for (const insight of generateInsights(state, today).filter((i) => i.goalId)) {
    assert.equal(insight.goalTitle, 'Client project');
  }
});
