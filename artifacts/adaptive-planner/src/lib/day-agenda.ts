import type { AppState } from './store/types';

/** One definition of a day's work for Overview and the planner. */
export function dayAgenda(state: Pick<AppState, 'tasks' | 'sessions'>, day: string) {
  const priority = { high: 0, medium: 1, low: 2 };
  const tasks = state.tasks.filter((task) => !task.archived);
  return {
    remainingTasks: tasks
      .filter((task) => task.status === 'open' && (task.plannedDate === day || task.dueDate === day))
      .sort((a, b) => priority[a.priority] - priority[b.priority]),
    doneTasks: tasks
      .filter((task) => task.status === 'done' && (task.completedAt?.slice(0, 10) || task.plannedDate) === day)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    remainingSessions: (state.sessions ?? []).filter((session) => session.status === 'planned' && session.plannedDate === day),
    doneSessions: (state.sessions ?? []).filter((session) => session.status === 'logged' && session.date === day),
  };
}
