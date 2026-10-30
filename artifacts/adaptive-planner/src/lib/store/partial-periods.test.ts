import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, getState, hydrateState, setWorkspaceWriter } from './store';
import { addGoal, addMetric, updateMetric, recordContribution } from './actions';
import { computeSnapshot, goalHealth, measurementTargetAt } from './selectors';
import { stateSchema } from '../../../../api-server/src/lib/planner-state';
import { compactGoal } from '../ai/context';
import { todayIso } from '../dates';

beforeEach(() => { hydrateState(emptyWorkspace()); setWorkspaceWriter(() => {}); });
function goal(startDate = '2026-10-30', frequency: 'monthly' | 'weekly' = 'monthly') {
  const id = addGoal({ title: 'Project', outcome: '', area: 'business', priority: 'medium', targetDate: '2026-12-31',
    metric: { name: 'Project hours', kind: 'leading', baseline: 0, target: 30, unit: 'hours', frequency, startDate } });
  return getState().goals.find((g) => g.id === id)!;
}
test('new measures default to today and explicit next-period starts persist through validation and reload', () => {
  const g = goal('2026-11-01');
  const reloaded = stateSchema.parse(getState());
  hydrateState(reloaded);
  assert.equal(getState().goals[0].metrics[0].startDate, '2026-11-01');
  assert.equal(measurementTargetAt(getState().goals[0].metrics[0], '2026-10-31'), 0);
  assert.equal(measurementTargetAt(getState().goals[0].metrics[0], '2026-11-01'), 30);
  addMetric(g.id, { name: 'Focus', kind: 'leading', baseline: 0, target: 7, unit: 'h', frequency: 'weekly' });
  assert.equal(getState().goals[0].metrics[1].startDate, todayIso());
});
test('pace never penalizes inactive time or the first active day', () => {
  const g = goal();
  assert.equal(goalHealth(g, '2026-10-29').status, 'not-started');
  assert.equal(goalHealth(g, '2026-10-30').status, 'just-started');
  assert.equal(goalHealth(g, '2026-10-30').expected, 0);
  assert.equal(goalHealth(g, '2026-10-31').expected, 0.5);
  assert.equal(goalHealth(g, '2026-10-31').status, 'behind');
  g.metrics[0].entries.push({ id: 'hours', date: '2026-10-30', value: 1 });
  assert.equal(goalHealth(g, '2026-10-31').status, 'on-track');
  assert.equal(goalHealth(g, '2026-11-01').status, 'on-track');
  const weekly = goal('2026-10-30', 'weekly');
  assert.equal(goalHealth(weekly, '2026-10-30').status, 'just-started');
  assert.equal(goalHealth(weekly, '2026-10-31').expected, 1 / 3);
});
test('reviews and AI planning share the adjusted target, not a full month or invented results', () => {
  const g = goal();
  g.createdAt = '2026-10-30T09:00:00Z';
  const snapshot = computeSnapshot(getState(), 'monthly', '2026-10-01', '2026-10-31', '2026-10-31');
  assert.equal(snapshot.metrics[0].target, 60 / 31);
  const context = compactGoal(g, true, [], '2026-10-30');
  assert.equal(context.metrics[0].target, 60 / 31);
  assert.equal(context.metrics[0].fullPeriodTarget, 30);
  assert.equal(context.metrics[0].startDate, '2026-10-30');
  assert.equal(context.metrics[0].current, 0);
});
test('start-date corrections are allowed before results and locked afterward', () => {
  const g = goal();
  const m = g.metrics[0];
  updateMetric(g.id, m.id, { ...m, startDate: '2026-11-01' });
  assert.equal(getState().goals[0].metrics[0].startDate, '2026-11-01');
  assert.throws(() => updateMetric(g.id, m.id, { ...m, startDate: '2026-02-30' }));
  addMetric(g.id, { name: 'Count', kind: 'leading', baseline: 0, target: 7, unit: 'items', frequency: 'weekly', startDate: '2026-10-30' });
  const resultMetric = getState().goals[0].metrics[1];
  const milestoneId = 'fixture-milestone';
  getState().goals[0].milestones.push({ id: milestoneId, title: 'Checkpoint', dueDate: '2026-11-30', done: false });
  recordContribution(g.id, resultMetric.id, { milestoneId, amount: 1, date: '2026-10-30' });
  assert.throws(() => updateMetric(g.id, resultMetric.id, { ...resultMetric, startDate: '2026-11-01' }), /locked/);
});
test('legacy logged history is untouched; empty measures infer a fixed goal start', () => {
  const g = goal();
  const state = structuredClone(getState());
  const m = state.goals[0].metrics[0];
  state.goals[0].createdAt = '2026-10-30T10:00:00Z';
  delete m.startDate;
  m.entries.push({ id: 'old', date: '2026-10-30', value: 1 });
  hydrateState(state);
  assert.equal(getState().goals[0].metrics[0].startDate, undefined);
  assert.equal(measurementTargetAt(getState().goals[0].metrics[0], '2026-10-31'), 30);
  m.entries = [];
  hydrateState(state);
  assert.equal(getState().goals[0].metrics[0].startDate, '2026-10-30');
  assert.equal(stateSchema.parse(state).goals[0].metrics[0].startDate, '2026-10-30');
  assert.equal(g.metrics[0].target, 30);
});
