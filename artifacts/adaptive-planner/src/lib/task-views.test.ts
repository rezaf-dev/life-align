import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkSession } from './store/types';
import { readTaskView, rememberTaskView, resolveTaskView, sessionMatchesTaskFilters, sessionMatchesTaskView } from './task-views';

const today = '2026-10-30';
const session = (patch: Partial<WorkSession> = {}): WorkSession => ({
  id: 'session', goalId: 'goal-a', title: 'Client development', notes: 'Email setup',
  status: 'planned', plannedMinutes: 60, recurrence: 'none', taskIds: [], allocations: [],
  createdAt: today, updatedAt: today, ...patch,
});

test('unscheduled, today, future and missed reservations follow the corresponding task views', () => {
  const unscheduled = session();
  const scheduled = session({ plannedDate: today });
  const future = session({ plannedDate: '2026-10-31' });
  const past = session({ plannedDate: '2026-10-29' });
  for (const [item, expected] of [[unscheduled, 'inbox'], [scheduled, 'today'], [future, 'upcoming'], [past, 'overdue']] as const) {
    for (const view of ['inbox', 'today', 'upcoming', 'overdue'] as const) {
      assert.equal(sessionMatchesTaskView(item, view, today), view === expected);
    }
    assert.equal(sessionMatchesTaskView(item, 'open', today), true);
    assert.equal(sessionMatchesTaskView(item, 'done', today), false);
    assert.equal(sessionMatchesTaskView(item, 'archived', today), false);
  }
});

test('logged time is selected by actual date, never the original reservation date or overdue status', () => {
  const logged = session({ status: 'logged', plannedDate: '2026-10-29', date: today, actualMinutes: 60 });
  assert.equal(sessionMatchesTaskView(logged, 'today', today), true);
  assert.equal(sessionMatchesTaskView(logged, 'done', today), true);
  for (const view of ['open', 'overdue', 'upcoming', 'inbox', 'archived'] as const) {
    assert.equal(sessionMatchesTaskView(logged, view, today), false);
  }
  assert.equal(sessionMatchesTaskView({ ...logged, plannedDate: today, date: '2026-10-28' }, 'today', today), false);
});

test('session search and goal selection match the task filters without leaking other goals', () => {
  const item = session();
  assert.equal(sessionMatchesTaskFilters(item, 'all', '  DEVELOPMENT '), true);
  assert.equal(sessionMatchesTaskFilters(item, 'goal-a', 'EMAIL'), true);
  assert.equal(sessionMatchesTaskFilters(item, 'goal-b', 'Email'), false);
  assert.equal(sessionMatchesTaskFilters(item, 'none', ''), false);
  assert.equal(sessionMatchesTaskFilters(item, 'all', 'not present'), false);
});

test('explicit URL views take priority over preferences and malformed values safely fall back', () => {
  assert.equal(resolveTaskView('view=today', 'inbox'), 'today');
  assert.equal(resolveTaskView('view=inbox', 'today'), 'inbox');
  assert.equal(resolveTaskView('', 'today'), 'today');
  assert.equal(resolveTaskView('view=unknown', 'upcoming'), 'upcoming');
  assert.equal(resolveTaskView('view=unknown', 'invalid'), 'inbox');
  assert.equal(resolveTaskView('', undefined), 'inbox');
});

test('refresh preferences survive remount, remain account scoped, and tolerate unavailable storage', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    rememberTaskView('account-a', 'today');
    assert.equal(readTaskView('account-a'), 'today');
    assert.equal(resolveTaskView('', readTaskView('account-a')), 'today');
    assert.equal(readTaskView('account-b'), 'inbox');
    rememberTaskView('account-b', 'overdue');
    assert.equal(readTaskView('account-b'), 'overdue');
    assert.equal(readTaskView('account-a'), 'today');
    assert.equal(readTaskView(undefined), 'inbox');
    const count = values.size;
    rememberTaskView(undefined, 'today');
    assert.equal(values.size, count);
    storage.setItem = () => { throw new Error('Storage blocked'); };
    storage.getItem = () => { throw new Error('Storage blocked'); };
    assert.doesNotThrow(() => rememberTaskView('account-a', 'open'));
    assert.equal(readTaskView('account-a'), 'inbox');
    assert.equal(resolveTaskView('view=today', readTaskView('account-a')), 'today');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
