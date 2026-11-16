import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupGoalFocus } from './goal-focus';
import { addGoal, addTask, setGoalPriority, setGoalSpotlight, setGoalStatus } from './store/actions';
import { emptyWorkspace, getState, hydrateState, setWorkspaceWriter } from './store/store';
import { stateSchema } from '../../../api-server/src/lib/planner-state';

function setup() {
  hydrateState(emptyWorkspace());
  setWorkspaceWriter(() => {});
  const make = (title: string, priority: 'high' | 'medium' | 'low' = 'medium', targetDate = '2030-12-31') =>
    addGoal({ title, priority, targetDate, area: 'business', outcome: 'A measured result' });
  return make;
}

test('spotlight and priority survive a validated account save and reload', () => {
  const make = setup(), id = make('Focus');
  let saved: unknown;
  setWorkspaceWriter((state) => { saved = structuredClone(state); });
  setGoalSpotlight(id, true); setGoalPriority(id, 'high');
  hydrateState(stateSchema.parse(saved));
  assert.equal(getState().goals[0].spotlight, true);
  assert.equal(getState().goals[0].priority, 'high');
  assert.match(getState().goals[0].history[0].summary, /Priority/);
});

test('legacy goals need no spotlight field and existing priority is preserved', () => {
  const make = setup(); make('Existing', 'low');
  hydrateState(stateSchema.parse(getState()));
  const groups = groupGoalFocus(getState().goals);
  assert.equal(groups.focus.length, 0);
  assert.equal(groups.remaining[0].priority, 'low');
});

test('focus grouping is exclusive and each group sorts by priority then deadline', () => {
  const make = setup();
  const high = make('High', 'high'), lowFocus = make('Low focus', 'low');
  const later = make('Later', 'high', '2030-11-30'), sooner = make('Sooner', 'high', '2030-10-31');
  setGoalSpotlight(lowFocus, true); setGoalSpotlight(later, true); setGoalSpotlight(sooner, true);
  const input = structuredClone(getState().goals);
  const groups = groupGoalFocus(input);
  assert.deepEqual(groups.focus.map((g) => g.id), [sooner, later, lowFocus]);
  assert.deepEqual(groups.remaining.map((g) => g.id), [high]);
  assert.deepEqual(input, getState().goals);
});

test('paused, completed and cancelled goals never occupy active focus', () => {
  const make = setup();
  for (const status of ['paused', 'completed', 'cancelled'] as const) {
    const id = make(status); setGoalSpotlight(id, true); setGoalStatus(id, status, '');
    assert.ok(!groupGoalFocus(getState().goals).focus.some((g) => g.id === id));
    assert.throws(() => setGoalSpotlight(id, true), /Resume/);
    setGoalSpotlight(id, false);
    assert.equal(getState().goals.find((g) => g.id === id)!.spotlight, false);
  }
});

test('focus has no hard limit and toggling off restores normal grouping', () => {
  const make = setup();
  const ids = Array.from({ length: 5 }, (_, i) => make(`Goal ${i}`));
  ids.forEach((id) => setGoalSpotlight(id, true));
  assert.equal(groupGoalFocus(getState().goals).focus.length, 5);
  setGoalSpotlight(ids[0], false);
  assert.equal(groupGoalFocus(getState().goals).focus.length, 4);
  assert.deepEqual(groupGoalFocus(getState().goals).remaining.map((g) => g.id), [ids[0]]);
});

test('focus and priority edits do not change outcomes, time, deadlines or task priorities', () => {
  const make = setup(), id = make('Goal');
  addTask({ title: 'Task', goalId: id, priority: 'low' });
  const before = structuredClone(getState());
  setGoalSpotlight(id, true); setGoalPriority(id, 'high');
  const after = getState(), goal = after.goals[0];
  const { history: _h1, spotlight: _s1, priority: _p1, ...unchanged } = goal;
  const { history: _h2, spotlight: _s2, priority: _p2, ...original } = before.goals[0];
  assert.deepEqual(unchanged, original);
  assert.deepEqual(after.tasks, before.tasks);
  assert.deepEqual(after.sessions, before.sessions);
  assert.throws(() => setGoalPriority(id, 'urgent' as 'high'), /Choose/);
  assert.throws(() => setGoalSpotlight('missing', true), /not found/);
});
