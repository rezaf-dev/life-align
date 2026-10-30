export const PLANNER_VIEWS = ['week', 'today', 'month', 'quarter', 'year'] as const;
export type PlannerView = typeof PLANNER_VIEWS[number];
const isView = (value: unknown): value is PlannerView => PLANNER_VIEWS.includes(value as PlannerView);
const storageKey = (userId: string) => `align.planner.view.${encodeURIComponent(userId)}`;

export function resolvePlannerView(search: string, remembered: unknown): PlannerView {
  const requested = new URLSearchParams(search).get('view');
  return isView(requested) ? requested : isView(remembered) ? remembered : 'week';
}

export function readPlannerView(userId?: string): PlannerView {
  try {
    return userId ? resolvePlannerView('', localStorage.getItem(storageKey(userId))) : 'week';
  } catch { return 'week'; }
}

export function rememberPlannerView(userId: string | undefined, view: PlannerView) {
  try { if (userId) localStorage.setItem(storageKey(userId), view); }
  catch { /* The URL still retains the selection when storage is unavailable. */ }
}
