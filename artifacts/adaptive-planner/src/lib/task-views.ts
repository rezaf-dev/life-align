import type { WorkSession } from './store/types';
import { sessionWorkDone } from '@workspace/api-zod';

export const TASK_VIEW_KEYS = ['inbox', 'today', 'upcoming', 'overdue', 'open', 'done', 'archived'] as const;
export type TaskView = typeof TASK_VIEW_KEYS[number];
const isView = (value: unknown): value is TaskView => TASK_VIEW_KEYS.includes(value as TaskView);
const storageKey = (userId: string) => `align.tasks.view.${encodeURIComponent(userId)}`;

export function resolveTaskView(search: string, remembered: unknown): TaskView {
  const requested = new URLSearchParams(search).get('view');
  return isView(requested) ? requested : isView(remembered) ? remembered : 'inbox';
}

export function readTaskView(userId?: string): TaskView {
  try {
    return userId ? resolveTaskView('', localStorage.getItem(storageKey(userId))) : 'inbox';
  } catch { return 'inbox'; } // Private browsing may disable preference storage.
}

export function rememberTaskView(userId: string | undefined, view: TaskView) {
  try { if (userId) localStorage.setItem(storageKey(userId), view); }
  catch { /* URL-based selection still works without local storage. */ }
}

export function sessionMatchesTaskView(session: WorkSession, view: TaskView, today: string): boolean {
  if (session.status === 'skipped') return view === 'archived';
  const planned = session.status === 'planned';
  switch (view) {
    case 'inbox': return planned && !session.plannedDate;
    case 'today': return (planned ? session.plannedDate : session.date) === today;
    case 'upcoming': return planned && !!session.plannedDate && session.plannedDate > today;
    case 'overdue': return planned && !!session.plannedDate && session.plannedDate < today;
    case 'open': return planned;
    case 'done': return !planned;
    case 'archived': return false; // Sessions have no archive state.
  }
}

export function sessionMatchesTaskFilters(session: WorkSession, goalFilter: string, query: string): boolean {
  const search = query.trim().toLowerCase();
  return (goalFilter === 'all' || session.goalId === goalFilter) &&
    (!search || session.title.toLowerCase().includes(search) || session.notes.toLowerCase().includes(search) ||
      sessionWorkDone(session).all.some((item) => item.toLowerCase().includes(search)));
}
