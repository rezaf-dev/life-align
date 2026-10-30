import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayAgenda } from './day-agenda';
import { readPlannerView, rememberPlannerView, resolvePlannerView } from './planner-views';
import type { Task, WorkSession } from './store/types';

const day = '2026-10-30';
const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id, title: id, priority: 'medium', effort: 30, notes: '', recurrence: 'none',
  status: 'open', archived: false, createdAt: day, isDemo: false, ...patch,
});
const session = (id: string, patch: Partial<WorkSession> = {}): WorkSession => ({
  id, goalId: 'goal', title: id, notes: '', status: 'planned', plannedMinutes: 60,
  recurrence: 'none', taskIds: [], allocations: [], createdAt: day, updatedAt: day, ...patch,
});

test('daily remaining work includes scheduled and due tasks once, ordered by priority', () => {
  const tasks = [
    task('scheduled', { plannedDate: day }),
    task('due', { dueDate: day, priority: 'high' }),
    task('both', { dueDate: day, plannedDate: day }),
    task('elsewhere', { plannedDate: '2026-10-31' }),
    task('inbox'),
    task('archived', { plannedDate: day, archived: true }),
  ];
  const agenda = dayAgenda({ tasks }, day);
  assert.deepEqual(agenda.remainingTasks.map((t) => t.id), ['due', 'scheduled', 'both']);
  assert.deepEqual(agenda.doneTasks, []);
  assert.deepEqual(agenda.remainingSessions, []);
  assert.deepEqual(tasks.map((t) => t.id), ['scheduled', 'due', 'both', 'elsewhere', 'inbox', 'archived']);
});

test('daily done tasks follow completion date, not their original schedule; legacy tasks use planned date', () => {
  const tasks = [
    task('finished', { status: 'done', plannedDate: '2026-10-29', completedAt: `${day}T14:00` }),
    task('unplanned-done', { status: 'done', completedAt: `${day}T15:00` }),
    task('finished-yesterday', { status: 'done', plannedDate: day, completedAt: '2026-10-29T14:00' }),
    task('legacy', { status: 'done', plannedDate: day }),
    task('archived', { status: 'done', completedAt: `${day}T14:00`, archived: true }),
  ];
  const agenda = dayAgenda({ tasks }, day);
  assert.deepEqual(agenda.doneTasks.map((t) => t.id), ['unplanned-done', 'finished', 'legacy']);
  assert.deepEqual(agenda.remainingTasks, []);
});

test('sessions use reservation date while planned and actual work date when logged', () => {
  const tasks = [task('linked', { plannedDate: day })];
  const sessions = [
    session('remaining', { plannedDate: day }),
    session('done', { status: 'logged', plannedDate: '2026-10-29', date: day, actualMinutes: 60, taskIds: ['linked'] }),
    session('logged-elsewhere', { status: 'logged', plannedDate: day, date: '2026-10-31', actualMinutes: 60 }),
    session('unscheduled'),
  ];
  const agenda = dayAgenda({ tasks, sessions }, day);
  assert.deepEqual(agenda.remainingSessions.map((s) => s.id), ['remaining']);
  assert.deepEqual(agenda.doneSessions.map((s) => s.id), ['done']);
  assert.deepEqual(agenda.remainingTasks.map((t) => t.id), ['linked']);
  assert.deepEqual(agenda.doneTasks, []);
});

test('explicit planner links override remembered tabs and invalid values fall back safely', () => {
  assert.equal(resolvePlannerView('view=today', 'month'), 'today');
  assert.equal(resolvePlannerView('view=week', 'today'), 'week');
  assert.equal(resolvePlannerView('', 'today'), 'today');
  assert.equal(resolvePlannerView('view=nope', 'quarter'), 'quarter');
  assert.equal(resolvePlannerView('view=nope', 'nope'), 'week');
});

test('planner tab preferences persist per account and tolerate blocked browser storage', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    rememberPlannerView('account-a', 'today');
    rememberPlannerView('account-b', 'month');
    assert.equal(readPlannerView('account-a'), 'today');
    assert.equal(resolvePlannerView('', readPlannerView('account-a')), 'today');
    assert.equal(readPlannerView('account-b'), 'month');
    assert.equal(readPlannerView('account-c'), 'week');
    rememberPlannerView(undefined, 'year');
    assert.equal(values.size, 2);
    storage.getItem = () => { throw new Error('Unavailable'); };
    storage.setItem = () => { throw new Error('Unavailable'); };
    assert.equal(readPlannerView('account-a'), 'week');
    assert.doesNotThrow(() => rememberPlannerView('account-a', 'today'));
    assert.equal(resolvePlannerView('view=today', readPlannerView('account-a')), 'today');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
