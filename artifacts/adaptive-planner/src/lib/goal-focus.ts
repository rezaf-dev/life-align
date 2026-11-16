import type { Goal } from './store/types';

const priorityOrder = { high: 0, medium: 1, low: 2 };

export function compareGoalPriority(a: Goal, b: Goal) {
  return priorityOrder[a.priority] - priorityOrder[b.priority]
    || a.targetDate.localeCompare(b.targetDate)
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id);
}

/** Spotlight is a separate focus preference, never a new priority or goal status. */
export function groupGoalFocus(goals: Goal[]) {
  const focus = goals.filter((g) => g.status === 'active' && g.spotlight).sort(compareGoalPriority);
  const remaining = goals.filter((g) => !(g.status === 'active' && g.spotlight)).sort(compareGoalPriority);
  return { focus, remaining };
}
