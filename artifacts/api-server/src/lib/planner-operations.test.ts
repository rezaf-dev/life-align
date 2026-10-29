import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations } from './planner-operations';
import { operationSchema, type Operation, type Workspace } from './planner-state';

function empty(): Workspace {
  return {
    version: 1, settings: { name: 'Test', theme: 'light', sidebarCollapsed: false, onboardedFresh: true },
    goals: [], tasks: [], weekPlans: {}, reviews: [], periodNotes: {},
  };
}
const initial: Operation[] = [
  { key: 'g', type: 'create_goal', title: 'Portfolio', area: 'personal', summary: 'Publish selected work', targetDate: '2026-12-20' },
  { key: 'm', type: 'create_milestone', goalId: 'g', title: 'Choose work', dueDate: '2026-11-06' },
  { key: 't', type: 'create_task', title: 'Launch website', goalId: 'g', milestoneId: 'm', effort: 60, plannedDate: '2026-11-02' },
  { key: 'c', type: 'create_task', title: 'Select photographs', parentTaskId: 't', plannedDate: '2026-11-02' },
];
function seed() { return applyOperations(empty(), initial, 'seed-transaction').state; }

test('AI measured observations can create recurring metrics and snapshots retain their dated period', () => {
  const state = seed();
  const goalId = state.goals[0].id;
  const configured = applyOperations(state, [{
    key: 'monthly-hours', type: 'record_metric', goalId, name: 'Project hours', unit: 'hours', kind: 'leading', frequency: 'monthly',
    baseline: 0, target: 30, value: 20, date: '2024-01-31',
  }], 'monthly-config').state;
  const metric = configured.goals[0].metrics.at(-1)!;
  const feb = applyOperations(configured, [
    { key: 'feb-hours', type: 'record_metric', goalId, metricId: metric.id, value: 6, date: '2024-02-10' },
    { key: 'feb-review', type: 'create_review', reviewType: 'weekly', periodStart: '2024-02-05', periodEnd: '2024-02-11' },
  ], 'monthly-review').state;
  const snapshot = feb.reviews[0].snapshot.metrics.find((m) => m.metricId === metric.id)!;
  assert.equal(snapshot.value, 6);
  assert.equal(snapshot.frequency, 'monthly');
  assert.equal(snapshot.periodStart, '2024-02-01');
  assert.equal(snapshot.periodEnd, '2024-02-29');
  assert.throws(() => applyOperations(feb, [
    { key: 'unsafe-change', type: 'record_metric', goalId, metricId: metric.id, frequency: 'weekly', value: 3, date: '2024-02-11' },
  ], 'unsafe-frequency-change'));
});
test('recurring metric definitions fail atomically when their period target or baseline is invalid', () => {
  const state = seed();
  for (const [baseline, target] of [[5, 30], [0, 0], [0, -1]]) {
    assert.throws(() => applyOperations(state, [{
      key: 'invalid-hours', type: 'record_metric', goalId: state.goals[0].id, name: 'Hours', frequency: 'weekly', baseline, target, value: 3, date: '2024-01-01',
    }], `invalid-${baseline}-${target}`));
  }
  assert.equal(state.goals[0].metrics.length, 0);
});

test('goal, milestone, task and breakdown are created with valid relationships', () => {
  const s = seed();
  assert.equal(s.goals.length, 1);
  assert.equal(s.goals[0].milestones.length, 1);
  const parent = s.tasks.find((t) => t.title === 'Launch website')!;
  const child = s.tasks.find((t) => t.title === 'Select photographs')!;
  assert.equal(parent.goalId, s.goals[0].id);
  assert.equal(parent.milestoneId, s.goals[0].milestones[0].id);
  assert.equal(child.parentTaskId, parent.id);
  assert.equal(child.goalId, parent.goalId);
});
test('failed dependent selection rolls back the entire transaction', () => {
  const s = empty();
  const before = JSON.stringify(s);
  assert.throws(() => applyOperations(s, [initial[0], { ...initial[2], goalId: 'removed-goal' }], 'bad-id'), /goal no longer/);
  assert.equal(JSON.stringify(s), before);
});
test('retry ledger prevents duplicate writes', () => {
  const first = applyOperations(empty(), initial, 'same-request');
  const retry = applyOperations(first.state, initial, 'same-request');
  assert.equal(retry.alreadyApplied, true);
  assert.deepEqual(first.state, retry.state);
  assert.equal(retry.changes.length, 0);
});
test('goal duplicates and repeated keys are rejected', () => {
  assert.throws(() => applyOperations(seed(), [initial[0]], 'different-request'), /already exists/);
  assert.throws(() => applyOperations(empty(), [initial[0], initial[0]], 'different-request'), /keys must be unique/);
});
test('strategy change preserves reason and before/after history', () => {
  const s = seed();
  const result = applyOperations(s, [{ key: 's', type: 'update_strategy', goalId: s.goals[0].id, summary: 'Publish weekly stories', reason: 'Test a consistent schedule' }], 'strategy');
  const g = result.state.goals[0];
  assert.equal(g.strategy.summary, 'Publish weekly stories');
  assert.equal(g.history[0].from, 'Publish selected work');
  assert.equal(g.history[0].to, 'Publish weekly stories');
  assert.equal(g.history[0].reason, 'Test a consistent schedule');
  assert.equal(g.history[0].source, 'ai');
  assert.equal(s.goals[0].strategy.summary, 'Publish selected work');
});
test('goal, strategy and milestone edits require reasons', () => {
  const s = seed();
  for (const op of [
    { key: 'u', type: 'update_goal', goalId: s.goals[0].id, title: 'Updated' },
    { key: 'u', type: 'create_strategy', goalId: s.goals[0].id, summary: 'Updated' },
    { key: 'u', type: 'update_milestone', goalId: s.goals[0].id, milestoneId: s.goals[0].milestones[0].id, dueDate: '2026-12-01' },
  ] as Operation[]) assert.throws(() => applyOperations(s, [op], 'bad-update'), /Reason/);
});
test('goal and milestone updates preserve unrelated fields', () => {
  const s = seed(); const g = s.goals[0];
  const result = applyOperations(s, [
    { key: 'g2', type: 'update_goal', goalId: g.id, targetDate: '2026-12-25', reason: 'More time' },
    { key: 'm2', type: 'update_milestone', goalId: g.id, milestoneId: g.milestones[0].id, dueDate: '2026-11-13', done: true, reason: 'Completed selection' },
  ], 'updates');
  assert.equal(result.state.goals[0].targetDate, '2026-12-25');
  assert.equal(result.state.goals[0].strategy.summary, g.strategy.summary);
  assert.equal(result.state.goals[0].milestones[0].done, true);
});
test('weekly plan schedules tasks while preserving the original snapshot', () => {
  let s = seed();
  const parent = s.tasks.find((t) => !t.parentTaskId)!;
  s = applyOperations(s, [{ key: 'w', type: 'create_weekly_plan', weekStart: '2026-11-02', taskIds: [parent.id], focus: 'Launch portfolio', capacityMinutes: 240 }], 'week-first').state;
  const original = structuredClone(s.weekPlans['2026-11-02'].commitments);
  const out = applyOperations(s, [
    { key: 'r', type: 'reschedule_task', taskId: parent.id, plannedDate: '2026-11-10' },
    { key: 'w2', type: 'create_weekly_plan', weekStart: '2026-11-02', focus: 'Edit work', reason: 'Changed priority', capacityMinutes: 180 },
  ], 'week-second').state;
  assert.deepEqual(out.weekPlans['2026-11-02'].commitments, original);
  assert.equal(out.tasks.find((t) => t.id === parent.id)?.plannedDate, '2026-11-10');
  assert.equal(out.weekPlans['2026-11-02'].focus, 'Edit work');
});
test('invalid real dates and reminder times fail before mutation', () => {
  for (const op of [
    { key: 't', type: 'create_task', title: 'Test', plannedDate: '2026-02-30' },
    { key: 't', type: 'create_task', title: 'Test', reminder: '2026-11-03T25:00' },
    { key: 'w', type: 'create_weekly_plan', weekStart: '2026-11-03' },
  ] as Operation[]) assert.throws(() => applyOperations(empty(), [op], 'invalid-date'), /date|Monday|time/);
});
test('a saved empty commitment snapshot remains empty after later additions', () => {
  let s = applyOperations(empty(), [{ key: 'w', type: 'create_weekly_plan', weekStart: '2026-11-02', focus: 'Rest' }], 'empty-week').state;
  s = applyOperations(s, [{ key: 't', type: 'create_task', title: 'New work', plannedDate: '2026-11-02' }], 'added-work').state;
  const out = applyOperations(s, [{ key: 'w2', type: 'create_weekly_plan', weekStart: '2026-11-02', focus: 'Rest' }], 'same-week').state;
  assert.deepEqual(out.weekPlans['2026-11-02'].commitments, []);
});
test('task edits, rescheduling and goal links retain the original record', () => {
  const s = seed(); const t = s.tasks[0]; const g = s.goals[0];
  const out = applyOperations(s, [
    { key: 'a', type: 'update_task', taskId: t.id, title: 'Edited action', effort: 45 },
    { key: 'b', type: 'reschedule_task', taskId: t.id, plannedDate: '2026-11-05' },
    { key: 'c', type: 'link_task_to_goal', taskId: t.id, goalId: g.id },
  ], 'task-edit').state;
  const updated = out.tasks.find((x) => x.id === t.id)!;
  assert.equal(updated.title, 'Edited action');
  assert.equal(updated.effort, 45);
  assert.equal(updated.plannedDate, '2026-11-05');
  assert.equal(updated.goalId, g.id);
  assert.equal(out.tasks.length, s.tasks.length);
});
test('wrong-goal milestone links and parent cycles are rejected', () => {
  const s = seed(); const t = s.tasks.find((t) => !t.parentTaskId)!;
  assert.throws(() => applyOperations(s, [{ key: 'l', type: 'update_task', taskId: t.id, milestoneId: 'nonexistent' }], 'bad-link'), /milestone/);
  assert.throws(() => applyOperations(s, [{ key: 'p', type: 'update_task', taskId: t.id, parentTaskId: t.id }], 'bad-parent'), /one level/);
});
test('actual metric logging is separate from task execution', () => {
  const s = seed();
  const out = applyOperations(s, [{ key: 'v', type: 'record_metric', goalId: s.goals[0].id, name: 'Published stories', unit: 'stories', target: 4, value: 1, date: '2026-10-29' }], 'metric').state;
  assert.equal(out.goals[0].metrics[0].entries[0].value, 1);
  assert.equal(out.tasks.every((t) => t.status === 'open'), true);
  assert.throws(() => applyOperations(out, [{ key: 'v2', type: 'record_metric', goalId: s.goals[0].id, metricId: out.goals[0].metrics[0].id, date: '2026-10-29' }], 'missing-value'), /measured value/);
});
test('review snapshots use actual stored execution, not AI-supplied counts', () => {
  const s = seed();
  s.tasks[0].status = 'done'; s.tasks[0].completedAt = '2026-11-03T10:00:00Z';
  const out = applyOperations(s, [{ key: 'rv', type: 'create_review', reviewType: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-08', wins: 'Selected photographs' }], 'review').state;
  assert.equal(out.reviews[0].snapshot.committed, 2);
  assert.equal(out.reviews[0].snapshot.committedDone, 1);
  assert.equal(out.reviews[0].answers.learned, '');
  assert.throws(() => applyOperations(out, [{ key: 'rv', type: 'create_review', reviewType: 'weekly', periodStart: '2026-11-02', periodEnd: '2026-11-08' }], 'review-again'), /already saved/);
});
test('unselected proposals are not applied; task completion cannot bypass recurrence', () => {
  const selected = [initial[0]];
  const s = applyOperations(empty(), selected, 'selected-only').state;
  assert.equal(s.tasks.length, 0);
  assert.equal(s.goals[0].milestones.length, 0);
  const seeded = seed();
  assert.throws(() => applyOperations(seeded, [{ key: 'done', type: 'update_task', taskId: seeded.tasks[0].id, status: 'done' }], 'done-task'), /manually/);
});
test('generated operation boundary rejects malformed types and excessive effort', () => {
  assert.equal(operationSchema.safeParse({ key: 'x', type: 'delete_goal' }).success, false);
  assert.equal(operationSchema.safeParse({ key: 'x', type: 'create_task', effort: -5 }).success, false);
});
