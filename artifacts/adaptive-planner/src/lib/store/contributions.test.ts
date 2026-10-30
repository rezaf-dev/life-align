import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, getState, hydrateState, setWorkspaceWriter } from './store';
import { updateMetric, completeTaskWithResult, deleteMilestone, deleteTask, editContribution, logMetric, recordContribution, toggleTask, updateTask, deleteMetricEntry, addMetric, changeMetricTarget } from './actions';
import { contributionAmount, metricValueAt, metricProgress, goalHealth, measurementTargetAt } from './selectors';
import type { Goal, Task } from './types';
import { applyOperations } from '../../../../api-server/src/lib/planner-operations';

beforeEach(() => {
  const state = emptyWorkspace();
  const goal: Goal = {
    id: 'goal', title: 'Grow customers', outcome: '50 customers', area: 'business', priority: 'high',
    targetDate: '2030-01-01', status: 'active', strategy: { summary: '', rationale: '', updatedAt: '2024-01-01' },
    milestones: [{ id: 'milestone', title: 'First launch', dueDate: '2024-01-01', done: false }],
    metrics: [{ id: 'metric', name: 'Customers', unit: 'customers', kind: 'outcome', baseline: 0, target: 50, entries: [] }],
    history: [], createdAt: '2024-01-01', isDemo: false,
  };
  const task: Task = { id: 'task', title: 'Customer interviews', goalId: goal.id, milestoneId: 'milestone', priority: 'medium', effort: 30, notes: '', recurrence: 'none', status: 'open', archived: false, createdAt: '2024-01-01', isDemo: false };
  state.goals = [goal]; state.tasks = [task];
  hydrateState(state); setWorkspaceWriter(() => {});
});

test('recurring task results persist frequency, reset by work date, and keep task completion separate', () => {
  addMetric('goal', { name: 'Project hours', unit: 'hours', kind: 'leading', frequency: 'monthly', baseline: 0, target: 30 });
  const id = getState().goals[0].metrics[1].id;
  recordContribution('goal', id, { taskId: 'task', amount: 20, date: '2024-01-31' });
  recordContribution('goal', id, { taskId: 'task', amount: 6, date: '2024-02-01' });
  const saved = structuredClone(getState());
  hydrateState(saved);
  const m = getState().goals[0].metrics[1];
  assert.equal(m.frequency, 'monthly');
  assert.equal(metricValueAt(m, '2024-02-29'), 6);
  assert.equal(metricProgress(m, '2024-02-29'), 0.2);
  assert.equal(contributionAmount(m, { milestoneId: 'milestone' }, '2024-02-29'), 6);
  toggleTask('task');
  assert.equal(metricValueAt(getState().goals[0].metrics[1], '2024-02-29'), 6);
});
test('cadence edits do not reinterpret measurements with history; invalid recurring targets cannot be saved', () => {
  assert.throws(() => addMetric('goal', { name: 'Hours', unit: 'h', kind: 'leading', frequency: 'weekly', baseline: 1, target: 5 }));
  assert.throws(() => addMetric('goal', { name: 'Hours', unit: 'h', kind: 'leading', frequency: 'monthly', baseline: 0, target: 0 }));
  changeMetricTarget('goal', 'metric', 30, 'Measure monthly work', 'monthly');
  recordContribution('goal', 'metric', { taskId: 'task', amount: 5, date: '2024-01-01' });
  assert.throws(() => changeMetricTarget('goal', 'metric', 30, 'Switch frequency', 'weekly'));
  assert.throws(() => changeMetricTarget('goal', 'metric', 0, 'Invalid target'));
  assert.equal(getState().goals[0].metrics[0].frequency, 'monthly');
});
test('recurring goal pace uses the calendar period and never calls a whole goal achieved from hours alone', () => {
  const g = structuredClone(getState().goals[0]);
  g.metrics = [{ id: 'hours', name: 'Hours', unit: 'h', kind: 'leading', baseline: 0, target: 30, frequency: 'monthly', entries: [{ id: 'reading', date: '2024-01-15', value: 30 }] }];
  assert.equal(goalHealth(g, '2024-01-15').status, 'on-track');
  assert.equal(goalHealth(g, '2024-01-15').expected, 15 / 31);
  assert.equal(goalHealth(g, '2024-02-01').progress, 0);
  assert.equal(g.status, 'active');
});
test('target edits keep previous periods intact through server validation and account reload', () => {
  changeMetricTarget('goal', 'metric', 30, 'Monthly hours', 'monthly');
  recordContribution('goal', 'metric', { taskId: 'task', amount: 15, date: '2024-01-01' });
  changeMetricTarget('goal', 'metric', 40, 'More time this month');
  const saved = applyOperations(getState(), [{ key: 'preserve-config', type: 'update_task', taskId: 'task', notes: 'Preserve metric configuration' }], 'recurring-preservation').state;
  hydrateState(saved);
  const m = getState().goals[0].metrics[0];
  assert.equal(m.frequency, 'monthly');
  assert.equal(measurementTargetAt(m, '2024-01-31'), 30);
  assert.equal(metricProgress(m, '2024-01-31'), 0.5);
  assert.equal(measurementTargetAt(m), 40);
});
const metric = () => getState().goals[0].metrics[0];
test('correcting a measure type and name keeps results, dated targets and source attribution', () => {
  changeMetricTarget('goal', 'metric', 30, 'Monthly work', 'monthly');
  recordContribution('goal', 'metric', { amount: 2, date: '2024-01-02', taskId: 'task' });
  changeMetricTarget('goal', 'metric', 40, 'More work');
  const before = structuredClone(metric());
  updateMetric('goal', 'metric', { name: 'Project hours', kind: 'leading', unit: before.unit, baseline: before.baseline });
  assert.equal(metric().kind, 'leading');
  assert.equal(metric().name, 'Project hours');
  assert.equal(metric().id, before.id);
  assert.equal(metric().frequency, before.frequency);
  assert.deepEqual(metric().entries, before.entries);
  assert.deepEqual(metric().targetHistory, before.targetHistory);
  assert.equal(metric().target, before.target);
  assert.equal(contributionAmount(metric(), { taskId: 'task' }, '2024-01-31'), 2);
  const saved = applyOperations(getState(), [{ key: 'preserve-edit', type: 'update_task', taskId: 'task', notes: 'Keep corrected measure' }], 'measure-edit-preservation').state;
  hydrateState(saved);
  assert.equal(metric().kind, 'leading');
  assert.equal(metric().name, 'Project hours');
  assert.deepEqual(metric().entries, before.entries);
  assert.ok(getState().goals[0].history.some((event) => event.summary === 'Measure updated: Project hours'));
});
test('measure corrections can switch both directions and edit an empty definition without changing its target', () => {
  updateMetric('goal', 'metric', { name: 'Time', kind: 'leading', unit: 'hours', baseline: 2 });
  assert.equal(metric().baseline, 2);
  assert.equal(metric().unit, 'hours');
  assert.equal(metric().target, 50);
  updateMetric('goal', 'metric', { name: 'Time', kind: 'outcome', unit: 'hours', baseline: 2 });
  assert.equal(metric().kind, 'outcome');
});
test('measure edits reject invalid input and reinterpretation of recorded units or baseline atomically', () => {
  recordContribution('goal', 'metric', { amount: 2, date: '2024-01-02', taskId: 'task' });
  const before = structuredClone(getState());
  const valid = { name: 'Customers', kind: 'outcome' as const, unit: 'customers', baseline: 0 };
  for (const patch of [{ ...valid, name: ' ' }, { ...valid, unit: 'hours' }, { ...valid, baseline: 1 }]) {
    assert.throws(() => updateMetric('goal', 'metric', patch));
    assert.deepEqual(getState(), before);
  }
  assert.throws(() => updateMetric('goal', 'missing', valid));
  assert.throws(() => updateMetric('missing', 'metric', valid));
});
test('recurring starting values stay zero and empty measures reject nonfinite values', () => {
  const valid = { name: 'Hours', kind: 'leading' as const, unit: 'hours', baseline: 0 };
  assert.throws(() => updateMetric('goal', 'metric', { ...valid, baseline: Infinity }));
  changeMetricTarget('goal', 'metric', 30, 'Weekly hours', 'weekly');
  assert.throws(() => updateMetric('goal', 'metric', { ...valid, baseline: 2 }));
  updateMetric('goal', 'metric', valid);
  assert.equal(metric().baseline, 0);
  assert.equal(metric().frequency, 'weekly');
});
test('finishing with a result publishes completion and attribution in one workspace write', () => {
  let writes = 0;
  setWorkspaceWriter((next) => {
    writes++;
    assert.equal(next.tasks.find((t) => t.id === 'task')?.status, 'done');
    assert.equal(next.goals[0].metrics[0].entries.length, 1);
  });
  completeTaskWithResult('task', { metricId: 'metric', amount: 4, date: '2024-01-02', note: 'Actual interviews' });
  assert.equal(writes, 1);
  assert.equal(metricValueAt(metric()), 4);
  assert.equal(contributionAmount(metric(), { milestoneId: 'milestone' }), 4);
  assert.ok(getState().tasks[0].completedAt);
});
test('invalid result leaves task, recurring occurrence and ledger untouched', () => {
  updateTask('task', { recurrence: 'weekly', plannedDate: '2024-01-01' });
  const before = structuredClone(getState());
  for (const patch of [
    { metricId: 'missing', amount: 3, date: '2024-01-02' },
    { metricId: 'metric', amount: 0, date: '2024-01-02' },
    { metricId: 'metric', amount: NaN, date: '2024-01-02' },
    { metricId: 'metric', amount: 3, date: '2099-01-02' },
  ]) {
    assert.throws(() => completeTaskWithResult('task', patch));
    assert.deepEqual(getState(), before);
  }
});
test('completion retries never duplicate measured results or recurring work', () => {
  updateTask('task', { recurrence: 'weekly', plannedDate: '2024-01-01' });
  const result = { metricId: 'metric', amount: 2, date: '2024-01-02' };
  assert.equal(completeTaskWithResult('task', result).spawned, '2024-01-08');
  const saved = structuredClone(getState());
  completeTaskWithResult('task', result);
  assert.deepEqual(getState(), saved);
  assert.equal(getState().tasks.length, 2);
  assert.equal(getState().tasks.find((t) => t.status === 'open')?.completedAt, undefined);
});
test('reopening retains prior results and completing without a new result does not add credit', () => {
  completeTaskWithResult('task', { metricId: 'metric', amount: 5, date: '2024-01-02' });
  toggleTask('task');
  assert.equal(metricValueAt(metric()), 5);
  completeTaskWithResult('task');
  assert.equal(metricValueAt(metric()), 5);
  assert.equal(metric().entries.length, 1);
});
test('no-result completion works without goal measurements or a linked goal', () => {
  updateTask('task', { goalId: undefined, milestoneId: undefined });
  assert.throws(() => completeTaskWithResult('task', { metricId: 'metric', amount: 1, date: '2024-01-02' }));
  assert.equal(getState().tasks[0].status, 'open');
  completeTaskWithResult('task');
  assert.equal(getState().tasks[0].status, 'done');
  assert.equal(metric().entries.length, 0);
  assert.throws(() => completeTaskWithResult('missing'));
});
test('a rejected workspace write does not partially publish completion or contribution', () => {
  const before = structuredClone(getState());
  setWorkspaceWriter(() => { throw new Error('Account changed'); });
  assert.throws(() => completeTaskWithResult('task', { metricId: 'metric', amount: 1, date: '2024-01-02' }), /Account changed/);
  assert.deepEqual(getState(), before);
});
test('completion can credit a negative measured change and backdated recurring hours', () => {
  completeTaskWithResult('task', { metricId: 'metric', amount: -3, date: '2024-01-02' });
  assert.equal(metricValueAt(metric()), -3);
  toggleTask('task');
  addMetric('goal', { name: 'Hours', unit: 'hours', kind: 'leading', frequency: 'monthly', baseline: 0, target: 30 });
  const mid = getState().goals[0].metrics[1].id;
  completeTaskWithResult('task', { metricId: mid, amount: 1.5, date: '2024-02-29' });
  const hours = getState().goals[0].metrics[1];
  assert.equal(metricValueAt(hours, '2024-02-29'), 1.5);
  assert.equal(metricValueAt(hours, '2024-03-01'), 0);
});
test('a task result is credited once to its task, milestone and goal without completing work', () => {
  recordContribution('goal', 'metric', { amount: 5, date: '2024-01-02', taskId: 'task' });
  assert.equal(metricValueAt(metric()), 5);
  assert.equal(contributionAmount(metric(), { taskId: 'task' }), 5);
  assert.equal(contributionAmount(metric(), { milestoneId: 'milestone' }), 5);
  assert.equal(getState().tasks[0].status, 'open');
  toggleTask('task');
  assert.equal(metricValueAt(metric()), 5);
});
test('direct milestone results and task results aggregate without duplicate credits', () => {
  recordContribution('goal', 'metric', { amount: 5, date: '2024-01-02', taskId: 'task' });
  recordContribution('goal', 'metric', { amount: 2, date: '2024-01-03', milestoneId: 'milestone' });
  assert.equal(contributionAmount(metric()), 7);
  assert.equal(contributionAmount(metric(), { milestoneId: 'milestone' }), 7);
});
test('edit and delete contribution recalculate goal progress and preserve correction history', () => {
  const id = recordContribution('goal', 'metric', { amount: 5, date: '2024-01-02', taskId: 'task' });
  editContribution('goal', 'metric', id, { amount: 3, date: '2024-01-02', note: 'Corrected actual count' });
  assert.equal(metricValueAt(metric()), 3);
  assert.equal(metric().entries[0].source?.taskTitle, 'Customer interviews');
  assert.match(getState().goals[0].history[0].summary, /Corrected/);
  deleteMetricEntry('goal', 'metric', id);
  assert.equal(metricValueAt(metric()), 0);
});
test('source deletion and relinking never erase or reassign historical contributions', () => {
  recordContribution('goal', 'metric', { amount: 5, date: '2024-01-02', taskId: 'task' });
  updateTask('task', { goalId: undefined, milestoneId: undefined, title: 'Changed task' });
  deleteTask('task'); deleteMilestone('goal', 'milestone');
  assert.equal(metric().entries[0].source?.taskTitle, 'Customer interviews');
  assert.equal(metric().entries[0].source?.milestoneTitle, 'First launch');
  assert.equal(contributionAmount(metric()), 5);
  editContribution('goal', 'metric', metric().entries[0].id, { amount: 4, date: '2024-01-02' });
  assert.equal(metricValueAt(metric()), 4);
});
test('invalid amounts, dates and cross-goal sources reject the whole mutation', () => {
  for (const input of [
    { amount: 0, date: '2024-01-02', taskId: 'task' },
    { amount: 5, date: '2024-02-30', taskId: 'task' },
    { amount: 5, date: '4000-01-01', taskId: 'task' },
    { amount: NaN, date: '2024-01-02', taskId: 'task' },
    { amount: 5, date: '2024-01-02', taskId: 'missing' },
    { amount: 5, date: '2024-01-02' },
    { amount: 5, date: '2024-01-02', taskId: 'task', milestoneId: 'wrong' },
  ]) assert.throws(() => recordContribution('goal', 'metric', input));
  assert.equal(metric().entries.length, 0);
});
test('absolute manual readings reconcile recorded deltas instead of double-counting them', () => {
  recordContribution('goal', 'metric', { amount: 5, date: '2024-01-02', taskId: 'task' });
  logMetric('goal', 'metric', 7, '2024-01-03');
  recordContribution('goal', 'metric', { amount: 2, date: '2024-01-04', taskId: 'task' });
  assert.equal(metricValueAt(metric()), 9);
  assert.equal(contributionAmount(metric()), 7);
});
test('AI validation and unrelated approved operations preserve contribution metadata', () => {
  recordContribution('goal', 'metric', { amount: 5, date: '2024-01-02', taskId: 'task' });
  const result = applyOperations(getState(), [
    { key: 'new-task', type: 'create_task', title: 'An unrelated action', goalId: 'goal', effort: 30 },
  ], 'preserve-contributions');
  const restored = result.state.goals[0].metrics[0];
  assert.equal(metricValueAt(restored), 5);
  assert.equal(restored.entries[0].mode, 'contribution');
  assert.equal(restored.entries[0].source?.taskTitle, 'Customer interviews');
  assert.equal(restored.entries[0].source?.milestoneTitle, 'First launch');
});
