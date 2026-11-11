import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignGoalColors } from './goal-colors';
import { addGoal } from './store/actions';
import { emptyWorkspace, hydrateState, getState, setWorkspaceWriter, update } from './store/store';
import { stateSchema } from '../../../api-server/src/lib/planner-state';

test('legacy goals receive distinct deterministic colors independent of list order', () => {
  const goals = ['c', 'a', 'b'].map((id) => ({ id, createdAt: '2026-01-01', color: undefined as string | undefined }));
  const reversed = structuredClone(goals).reverse();
  assignGoalColors(goals); assignGoalColors(reversed);
  assert.equal(new Set(goals.map((g) => g.color)).size, 3);
  for (const goal of goals) assert.equal(goal.color, reversed.find((g) => g.id === goal.id)!.color);
});

test('existing colors stay fixed when a new goal is added or goals are removed', () => {
  const goals = [{ id: 'a', createdAt: '2026-01-01', color: '#397cb8' }, { id: 'b', createdAt: '2026-01-02', color: undefined as string | undefined }];
  assignGoalColors(goals);
  const before = goals.map((g) => g.color);
  goals.unshift({ id: 'earlier', createdAt: '2025-01-01', color: undefined });
  assignGoalColors(goals);
  assert.deepEqual(goals.slice(1).map((g) => g.color), before);
  goals.shift(); goals.shift();
  assignGoalColors(goals);
  assert.equal(goals[0].color, before[1]);
});

test('duplicate and invalid imported colors are repaired without sharing a goal color', () => {
  const goals = [
    { id: 'a', createdAt: '2026-01-01', color: '#397CB8' },
    { id: 'b', createdAt: '2026-01-01', color: '#397cb8' },
    { id: 'c', createdAt: '2026-01-01', color: 'red' },
  ];
  assignGoalColors(goals);
  assert.equal(new Set(goals.map((g) => g.color.toLowerCase())).size, 3);
  assert.ok(goals.every((g) => /^#[0-9a-f]{6}$/i.test(g.color)));
});

test('colors do not recycle beyond the palette, including the supported goal limit', () => {
  const goals = Array.from({ length: 5000 }, (_, n) => ({ id: String(n), createdAt: '2026-01-01', color: undefined as string | undefined }));
  assignGoalColors(goals);
  assert.equal(new Set(goals.map((g) => g.color!.toLowerCase())).size, goals.length);
});

test('new goals persist distinct colors through account reload and goal changes', () => {
  hydrateState(emptyWorkspace()); setWorkspaceWriter(() => {});
  const input = { title: 'Project', outcome: '', area: 'business' as const, priority: 'medium' as const, targetDate: '2030-12-31' };
  const a = addGoal(input), b = addGoal(input);
  const color = getState().goals.find((g) => g.id === a)!.color;
  assert.notEqual(color, getState().goals.find((g) => g.id === b)!.color);
  update((state) => { const goal = state.goals.find((g) => g.id === a)!; goal.title = 'Renamed'; goal.area = 'personal'; goal.status = 'completed'; });
  hydrateState(stateSchema.parse(structuredClone(getState())));
  assert.equal(getState().goals.find((g) => g.id === a)!.color, color);
});
