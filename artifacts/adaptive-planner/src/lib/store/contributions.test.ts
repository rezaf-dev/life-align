import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, getState, hydrateState, setWorkspaceWriter } from './store';
import { deleteMilestone, deleteTask, editContribution, logMetric, recordContribution, toggleTask, updateTask, deleteMetricEntry } from './actions';
import { contributionAmount, metricValueAt } from './selectors';
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
const metric = () => getState().goals[0].metrics[0];
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
