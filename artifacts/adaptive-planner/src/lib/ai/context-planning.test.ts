import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactGoal, buildContext } from './context';
import { emptyWorkspace } from '../store/store';
import type { Goal, Task } from '../store/types';

function fixture() {
  const state = emptyWorkspace();
  const goal: Goal = {
    id: 'goal', title: 'First client', outcome: 'Get a paying client', area: 'business', priority: 'high',
    targetDate: '2026-11-30', status: 'active', strategy: {
      summary: 'Personalized outreach to a narrow customer segment.',
      rationale: 'Validate the offer directly before investing in video or freelance platforms.', updatedAt: '2026-10-30',
    },
    milestones: [
      { id: 'done', title: 'Validate offer', dueDate: '2026-10-20', done: true },
      { id: 'outreach', title: 'Send 100 outreach messages', dueDate: '2026-11-30', done: false },
    ],
    metrics: [{ id: 'messages', name: 'Outreach messages', unit: 'messages', kind: 'leading', baseline: 0, target: 100,
      entries: [{ id: 'actual', date: '2026-10-29', value: 30 }] }],
    history: [], createdAt: '2026-10-01', isDemo: false,
  };
  const task: Task = {
    id: 'existing', title: 'Send 10 personalized messages', goalId: 'goal', milestoneId: 'outreach',
    plannedDate: '2026-11-02', dueDate: '2026-11-02', priority: 'high', effort: 60,
    notes: 'Planned contribution: 10 messages toward Outreach messages. Not yet sent.',
    recurrence: 'none', status: 'open', archived: false, createdAt: '2026-10-30', isDemo: false,
  };
  state.goals = [goal]; state.tasks = [task];
  return { state, goal, task };
}

test('goal planning exposes actual remaining measures, strategy and milestone-linked existing work', () => {
  const { state, goal } = fixture();
  const context = compactGoal(goal, true, state.tasks, '2026-10-30');
  assert.ok('planning' in context);
  assert.equal(context.planning.goalDeadline, '2026-11-30');
  assert.equal(context.planning.daysUntilGoalDeadline, 31);
  assert.equal(context.planning.nextIncompleteMilestoneId, 'outreach');
  assert.equal(context.planning.measures[0].remaining, 70);
  assert.equal(context.planning.measures[0].valueBasis, 'recorded results');
  assert.equal(context.planning.measures[0].periodPlanningDeadline, '2026-11-30');
  assert.deepEqual(context.planning.incompleteMilestones[0].openTaskIds, ['existing']);
  assert.deepEqual(context.planning.existingOpenTaskIds, ['existing']);
  assert.equal(context.strategy.summary, goal.strategy.summary);
  assert.match(context.planning.measurementMilestoneLinks, /No explicit/);
  assert.equal(context.metrics[0].current, 30);
});

test('planning distinguishes missing observations, decreasing targets, reached targets and recurring resets', () => {
  const { goal } = fixture();
  goal.metrics = [
    { id: 'hours', name: 'Project hours', unit: 'hours', kind: 'leading', baseline: 0, target: 30, frequency: 'monthly', entries: [{ id: 'last', date: '2026-10-29', value: 20 }] },
    { id: 'decrease', name: 'Defects', unit: 'defects', kind: 'outcome', baseline: 10, target: 2, entries: [{ id: 'now', date: '2026-10-29', value: 6 }] },
    { id: 'achieved', name: 'Calls', unit: 'calls', kind: 'leading', baseline: 0, target: 5, entries: [{ id: 'more', date: '2026-10-29', value: 7 }] },
  ];
  const context = compactGoal(goal, true, [], '2026-11-02');
  assert.ok('planning' in context);
  const [hours, defects, achieved] = context.planning.measures;
  assert.equal(hours.current, 0);
  assert.equal(hours.remaining, 30);
  assert.match(hours.valueBasis, /no recorded result/);
  assert.deepEqual(hours.period, { start: '2026-11-01', end: '2026-11-30' });
  assert.equal(defects.remaining, 4);
  assert.equal(defects.direction, 'decrease');
  assert.equal(achieved.remaining, 0);
  const october = compactGoal(goal, true, [], '2026-10-30');
  assert.ok('planning' in october);
  assert.equal(october.planning.measures[0].remaining, 10);
  assert.equal(october.planning.measures[0].periodPlanningDeadline, '2026-10-31');
});

test('focused existing tasks are first so bounded provider context cannot hide them', () => {
  const { state, task } = fixture();
  state.tasks = Array.from({ length: 100 }, (_, i) => ({ ...task, id: `other-${i}`, goalId: undefined, milestoneId: undefined, plannedDate: undefined }));
  state.tasks.push(task);
  const context = buildContext(state, { screen: 'goal', goalId: 'goal', message: 'I need tasks for this goal', pending: [] });
  assert.equal(context.tasks[0].id, 'existing');
  assert.match(context.tasks[0].notes, /10 messages/);
  assert.ok(JSON.stringify(context).length < 80000);
});
