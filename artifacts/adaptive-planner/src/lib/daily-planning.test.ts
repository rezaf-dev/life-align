import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { stateSchema } from '../../../api-server/src/lib/planner-state';
import { getGoalPaceFeedback } from './goal-pace';
import { buildCategoryDistribution } from './goal-categories';
import { addDaysIso, todayIso, weekStartIso } from './dates';
import { emptyWorkspace, getState, hydrateState, setWorkspaceWriter } from './store/store';
import { addGoal, addTask, editGoalBasics, saveReview } from './store/actions';
import { logWorkSession, saveWorkSession } from './store/sessions';
import { replanMissedSession } from './store/missed-work';
import { generateInsights } from './store/insights';
import type { Goal, ReviewAnswers } from './store/types';

beforeEach(() => { hydrateState(emptyWorkspace()); setWorkspaceWriter(() => {}); });
const goal = (category?: Goal['category']) => addGoal({
  title: 'Useful project', outcome: 'Deliver useful work', area: 'business', category,
  priority: 'medium', targetDate: '2035-12-31',
});
const answers: ReviewAnswers = { wins: 'Shipped', misses: 'One task', learned: 'Keep scope small', change: '', focus: 'Deliver the next version' };
const review = (taskId?: string) => ({
  type: 'weekly' as const, periodStart: weekStartIso(todayIso()), periodEnd: addDaysIso(weekStartIso(todayIso()), 6),
  answers: { ...answers, carryoverTaskIds: taskId ? [taskId] : [], mondayCommitment: 'Ship a small improvement' },
  snapshot: { committed: 1, committedDone: 0, extraDone: 0, overdue: 1, metrics: [] },
});

test('goal categories are optional for legacy data, editable and preserved on server reload', () => {
  const id = goal();
  const existing = getState().goals[0];
  editGoalBasics(id, { title: existing.title, area: existing.area, priority: existing.priority, outcome: existing.outcome, category: 'client-work' });
  assert.equal(stateSchema.parse(getState()).goals[0].category, 'client-work');
  assert.equal(stateSchema.safeParse({ ...getState(), goals: [{ ...existing, category: 'invalid' }] }).success, false);
});

test('category distribution counts actual time once, and classifies legacy/general work explicitly', () => {
  const id = goal('client-work');
  const legacy = goal();
  const day = todayIso();
  const tid = addTask({ title: 'Client action', goalId: id, plannedDate: day });
  for (const [gid, minutes] of [[id, 30], [legacy, 15], ['', 10]] as const) {
    const sid = saveWorkSession({ title: 'Worked', goalId: gid, plannedDate: day, plannedMinutes: minutes, recurrence: 'none', taskIds: gid === id ? [tid] : [], notes: '' });
    logWorkSession(sid, { date: day, actualMinutes: minutes, allocations: gid === id ? [{ taskId: tid, minutes }] : [] });
  }
  saveWorkSession({ title: 'Not worked', goalId: id, plannedDate: day, plannedMinutes: 60, recurrence: 'none', taskIds: [], notes: '' });
  const result = buildCategoryDistribution(getState(), day, day);
  assert.equal(result.find((r) => r.category === 'client-work')!.minutes, 30);
  assert.equal(result.find((r) => r.category === 'client-work')!.tasks, 1);
  assert.equal(result.find((r) => r.category === 'other')!.minutes, 15);
  assert.equal(result.find((r) => r.category === 'unassigned')!.minutes, 10);
  assert.equal(result.reduce((sum, r) => sum + r.minutes, 0), 55);
  assert.equal(buildCategoryDistribution(getState(), '2001-01-01', '2001-01-02').reduce((sum, r) => sum + r.tasks + r.minutes, 0), 0);
});

test('missed session rescheduling retains local planned time through edit and server reload', () => {
  const id = goal();
  const input = { title: 'Focus', goalId: id, plannedDate: todayIso(), plannedMinutes: 60, recurrence: 'weekly' as const, taskIds: [], notes: '' };
  const sid = saveWorkSession(input);
  replanMissedSession(sid, addDaysIso(todayIso(), 1), '14:30');
  let session = getState().sessions![0];
  assert.equal(session.plannedTime, '14:30');
  saveWorkSession({ ...input, plannedDate: session.plannedDate, plannedTime: session.plannedTime, title: 'Renamed' }, sid);
  session = stateSchema.parse(getState()).sessions![0];
  assert.equal(session.plannedTime, '14:30');
  assert.equal(session.status, 'planned');
  assert.equal(session.actualMinutes, undefined);
  assert.throws(() => replanMissedSession(sid, todayIso(), '25:00'), /valid time/);
  replanMissedSession(sid, todayIso(), '');
  assert.equal(getState().sessions![0].plannedTime, undefined);
});

test('weekly review saves carryover, focus, Monday commitment and snapshot in one write', () => {
  const id = goal();
  const tid = addTask({ title: 'Carry me', goalId: id, plannedDate: todayIso(), dueDate: todayIso(), reminder: `${todayIso()}T09:00` });
  const monday = addDaysIso(weekStartIso(todayIso()), 7);
  let writes = 0;
  setWorkspaceWriter(() => { writes++; });
  saveReview(review(tid), [], { applyFocus: true, nextWeekStart: monday });
  assert.equal(writes, 1);
  const parsed = stateSchema.parse(getState());
  assert.equal(parsed.tasks[0].plannedDate, monday);
  assert.equal(parsed.tasks[0].status, 'open');
  assert.equal(parsed.weekPlans[monday].focus, answers.focus);
  assert.equal(parsed.reviews[0].answers.mondayCommitment, 'Ship a small improvement');
  assert.deepEqual(parsed.reviews[0].answers.carryoverTaskIds, [tid]);
  assert.equal(parsed.reviews[0].snapshot.committed, 1);
});

test('invalid review selection or adjustment leaves all records unchanged', () => {
  const id = goal();
  const before = structuredClone(getState());
  assert.throws(() => saveReview(review('missing'), [{ kind: 'pause', goalId: id, reason: 'Smaller focus' }]), /no longer open/);
  assert.deepEqual(getState(), before);
  assert.throws(() => saveReview(review(), [
    { kind: 'pause', goalId: id, reason: 'Smaller focus' },
    { kind: 'milestone', goalId: id, milestoneId: 'missing', date: todayIso(), reason: 'Move it' },
  ]), /no longer exists/);
  assert.deepEqual(getState(), before);
});

test('pace forecast follows measured progress and never invents progress from sessions', () => {
  const id = goal();
  const g = getState().goals[0];
  const sample: Goal = { ...g, id, createdAt: '2026-10-01T10:00', targetDate: '2026-11-30', metrics: [
    { id: 'hours', name: 'Hours', unit: 'h', kind: 'leading', baseline: 0, target: 100, entries: [{ id: 'e', date: '2026-10-11', value: 10 }] },
  ] };
  const feedback = getGoalPaceFeedback(sample, '2026-10-11');
  assert.match(feedback.current, /10 h of 100 h/);
  assert.match(feedback.forecast, /Jan 9, 2027/);
  assert.match(feedback.expected, /Even-pace reference/);
  assert.match(feedback.recommendation, /Plan .* today/);
  assert.match(getGoalPaceFeedback({ ...sample, metrics: [{ ...sample.metrics[0], entries: [] }] }, '2026-10-11').forecast, /Not enough/);
});

test('partial first periods and decreasing-result goals get honest friendly guidance', () => {
  const g = getState().goals[0] ?? (goal(), getState().goals[0]);
  const recurring: Goal = { ...g, createdAt: '2026-10-30T10:00', metrics: [
    { id: 'hours', name: 'Hours', unit: 'h', kind: 'leading', baseline: 0, target: 30, frequency: 'monthly', startDate: '2026-10-30', entries: [] },
  ] };
  const first = getGoalPaceFeedback(recurring, '2026-10-30');
  assert.match(first.current, /1.94 h/);
  assert.match(first.expected, /0 h/);
  assert.match(first.forecast, /Not enough/);
  assert.match(getGoalPaceFeedback(recurring, '2026-10-29').expected, /Starts/);
  const decreasing: Goal = { ...g, createdAt: '2026-10-01T10:00', targetDate: '2026-11-30', metrics: [
    { id: 'weight', name: 'Weight', unit: 'kg', kind: 'outcome', baseline: 100, target: 90, entries: [{ id: 'e', date: '2026-10-11', value: 98 }] },
  ] };
  assert.match(getGoalPaceFeedback(decreasing, '2026-10-11').forecast, /Nov 20, 2026/);
  assert.match(getGoalPaceFeedback(decreasing, '2026-10-11').recommendation, /reduction/);
});

test('planning a session prevents false nothing-planned insight', () => {
  const id = goal();
  saveWorkSession({ title: 'Today', goalId: id, plannedDate: todayIso(), plannedMinutes: 30, recurrence: 'none', taskIds: [], notes: '' });
  assert.ok(!generateInsights(getState()).some((i) => i.id === `noplan-${id}`));
});
