import { GOAL_CATEGORIES, type AppState, type GoalCategory } from './store/types';

/** Duration is counted once per logged session, never again via allocations or measure credits. */
export function buildCategoryDistribution(state: AppState, start: string, end: string) {
  const rows: { category: GoalCategory | 'unassigned'; label: string; minutes: number; tasks: number; completedTasks: number }[] =
    [...GOAL_CATEGORIES.map(({ value, label }) => ({ category: value, label, minutes: 0, tasks: 0, completedTasks: 0 })),
      { category: 'unassigned', label: 'General work', minutes: 0, tasks: 0, completedTasks: 0 }];
  const goalMap = new Map(state.goals.map((goal) => [goal.id, goal]));
  const rowFor = (goalId?: string) => {
    const goal = goalId ? goalMap.get(goalId) : undefined;
    return rows.find((row) => row.category === (goal ? goal.category ?? 'other' : 'unassigned'))!;
  };
  const within = (date?: string) => !!date && date.slice(0, 10) >= start && date.slice(0, 10) <= end;
  for (const session of state.sessions ?? []) {
    if (session.status === 'logged' && within(session.date)) rowFor(session.goalId).minutes += session.actualMinutes ?? 0;
  }
  for (const task of state.tasks) {
    if (task.archived || task.skippedAt) continue;
    const date = task.status === 'done' ? task.completedAt?.slice(0, 10) ?? task.plannedDate : task.plannedDate ?? task.dueDate ?? task.createdAt.slice(0, 10);
    if (!within(date)) continue;
    const row = rowFor(task.goalId);
    row.tasks++;
    if (task.status === 'done') row.completedTasks++;
  }
  return rows;
}
