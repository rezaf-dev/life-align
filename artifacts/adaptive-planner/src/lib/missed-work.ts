import type { AppState } from './store/types';
import { isOverdue } from './store/selectors';

/** Replanning explicitly resolves attention, even when the original due date was missed. */
export function missedWork(state: Pick<AppState, 'tasks' | 'sessions'>, today: string) {
  return {
    tasks: state.tasks.filter((task) => isOverdue(task, today))
      .sort((a, b) => (a.plannedDate ?? a.dueDate ?? '').localeCompare(b.plannedDate ?? b.dueDate ?? '')),
    sessions: (state.sessions ?? []).filter((session) => session.status === 'planned' && !!session.plannedDate && session.plannedDate < today)
      .sort((a, b) => a.plannedDate!.localeCompare(b.plannedDate!)),
  };
}
