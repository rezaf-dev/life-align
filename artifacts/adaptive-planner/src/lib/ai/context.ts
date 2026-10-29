import { addDaysIso, monthStartIso, nextMonday, todayIso, weekStartIso } from '@/lib/dates';
import { completedBetween, goalHealth, isOpen, isOverdue, metricValueAt } from '@/lib/store/selectors';
import type { AppState, Goal, Task } from '@/lib/store/types';
import type { Operation, Screen } from './types';
import { periodContext } from './context-periods';

const compactTask = (t: Task) => ({
  id: t.id,
  title: t.title,
  goalId: t.goalId,
  milestoneId: t.milestoneId,
  parentTaskId: t.parentTaskId,
  plannedDate: t.plannedDate,
  dueDate: t.dueDate,
  priority: t.priority,
  effort: t.effort,
  recurrence: t.recurrence !== 'none' ? t.recurrence : undefined,
  reminder: t.reminder,
  status: t.status,
  completedAt: t.completedAt,
});

function compactGoal(g: Goal, deep: boolean, tasks: Task[]) {
  const h = goalHealth(g);
  const base = {
    id: g.id,
    title: g.title,
    outcome: g.outcome,
    area: g.area,
    priority: g.priority,
    status: g.status,
    targetDate: g.targetDate,
    createdAt: g.createdAt.slice(0, 10),
    health: h.status,
    progress: Math.round(h.progress * 100),
    expectedProgress: Math.round(h.expected * 100),
    strategy: deep ? g.strategy : { summary: g.strategy.summary },
    milestones: g.milestones
      .filter((m) => deep || !m.done)
      .map((m) => ({ id: m.id, title: m.title, dueDate: m.dueDate, done: m.done, completedAt: m.completedAt })),
    metrics: g.metrics.map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      kind: m.kind,
      baseline: m.baseline,
      target: m.target,
      current: metricValueAt(m),
      recent: deep ? [...m.entries].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8).map((e) => ({ date: e.date, value: e.value })) : undefined,
    })),
    openTasks: tasks.filter((t) => t.goalId === g.id && isOpen(t)).length,
  };
  if (!deep) return base;
  return { ...base, history: g.history.slice(0, 12).map((e) => ({ at: e.at.slice(0, 10), kind: e.kind, summary: e.summary, reason: e.reason, from: e.from, to: e.to })) };
}

/**
 * Builds a structured, scoped context for the assistant.
 * It sends only what the current screen and request need, never the full database.
 */
export function buildContext(
  state: AppState,
  opts: { screen: Screen; goalId?: string; taskId?: string; period?: { start: string; end: string; label: string }; message: string; pending: Operation[] },
) {
  const today = todayIso();
  const ws = weekStartIso(today);
  const nextWs = nextMonday(today);
  const live = state.tasks.filter((t) => !t.archived);
  const msg = opts.message.toLowerCase();
  const wantsReview = opts.screen === 'reviews' || /review|month|progress|analy|last week|how did|quarter|compare|neglect|accomplish|results|year/.test(msg);
  const wantsWeek = opts.screen === 'planner' || /week|plan my|schedule|capacity|monday/.test(msg);

  const activeGoals = state.goals.filter((g) => g.status === 'active' || g.status === 'paused');
  const archivedGoals = state.goals
    .filter((g) => g.status === 'completed' || g.status === 'cancelled')
    .map((g) => ({ id: g.id, title: g.title, status: g.status, area: g.area, targetDate: g.targetDate }));

  const focusGoal = opts.goalId ? state.goals.find((g) => g.id === opts.goalId) : undefined;
  const focusTask = opts.taskId ? state.tasks.find((t) => t.id === opts.taskId) : undefined;

  const horizon = addDaysIso(nextWs, 13);
  const relevant = new Map<string, Task>();
  const add = (t: Task) => relevant.set(t.id, t);
  live.filter((t) => isOverdue(t, today)).slice(0, 25).forEach(add);
  live.filter((t) => isOpen(t) && t.plannedDate && t.plannedDate >= ws && t.plannedDate <= horizon).slice(0, 60).forEach(add);
  live.filter((t) => isOpen(t) && !t.plannedDate).slice(0, 30).forEach(add);
  live.filter((t) => isOpen(t) && t.dueDate && t.dueDate <= horizon).slice(0, 20).forEach(add);
  if (opts.period) {
    const { start, end } = opts.period;
    live.filter((t) => (t.plannedDate && t.plannedDate >= start && t.plannedDate <= end) ||
      (t.dueDate && t.dueDate >= start && t.dueDate <= end)).slice(0, 60).forEach(add);
  }
  if (focusGoal) live.filter((t) => t.goalId === focusGoal.id && (isOpen(t) || (t.completedAt ?? '') >= addDaysIso(today, -30))).slice(0, 50).forEach(add);
  if (focusTask) {
    add(focusTask);
    live.filter((t) => t.parentTaskId === focusTask.id).forEach(add);
  }
  // Records referenced by the pending proposal must be visible to revise it.
  opts.pending.forEach((op) => {
    [op.taskId, op.parentTaskId, ...(op.taskIds ?? [])].forEach((id) => {
      const t = id && state.tasks.find((x) => x.id === id);
      if (t) add(t);
    });
  });

  const recentStart = addDaysIso(today, wantsReview ? -34 : -13);
  const recentDone = completedBetween(state.tasks, recentStart, today);

  const plan = (key: string) => {
    const p = state.weekPlans[key];
    if (!p) return null;
    return {
      weekStart: p.weekStart,
      focus: p.focus,
      capacityMinutes: p.capacityMinutes,
      finalized: p.finalized,
      commitments: p.commitments.map((c) => ({ taskId: c.taskId, title: c.title, plannedDate: c.plannedDate, effort: c.effort })),
    };
  };

  const prevWs = addDaysIso(ws, -7);
  const execution = [prevWs, ws].map((w) => {
    const p = state.weekPlans[w];
    const end = addDaysIso(w, 6);
    const ids = p?.commitments.map((c) => c.taskId) ?? [];
    const completedIds = new Set(completedBetween(state.tasks, w, end).map((t) => t.id));
    const done = ids.filter((id) => completedIds.has(id)).length;
    return { weekStart: w, committed: ids.length, committedDone: done, completedTotal: completedBetween(state.tasks, w, end).length };
  });

  return {
    today,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekday: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
    currentWeekStart: ws,
    nextWeekStart: nextWs,
    monthStart: monthStartIso(today),
    screen: opts.screen,
    viewedPeriod: opts.period ? { ...opts.period, plan: state.weekPlans[opts.period.start] } : undefined,
    user: { name: state.settings.name },
    focusGoal: focusGoal ? compactGoal(focusGoal, true, state.tasks) : undefined,
    focusTask: focusTask
      ? { ...compactTask(focusTask), notes: focusTask.notes, subtasks: live.filter((t) => t.parentTaskId === focusTask.id).map(compactTask) }
      : undefined,
    goals: activeGoals.filter((g) => g.id !== focusGoal?.id).map((g) => compactGoal(g, opts.screen === 'goals' || wantsReview, state.tasks)),
    pastGoals: archivedGoals,
    tasks: [...relevant.values()].map(compactTask),
    taskCounts: {
      open: live.filter(isOpen).length,
      inbox: live.filter((t) => isOpen(t) && !t.plannedDate).length,
      overdue: live.filter((t) => isOverdue(t, today)).length,
    },
    recentlyCompleted: recentDone.slice(0, 40).map((t) => ({ id: t.id, title: t.title, goalId: t.goalId, completedAt: t.completedAt?.slice(0, 10) })),
    weekPlans: wantsWeek || wantsReview ? { current: plan(ws), next: plan(nextWs), previous: plan(prevWs) } : { current: plan(ws) },
    execution,
    periodSummaries: wantsReview ? periodContext(state, msg, today) : undefined,
    reviews: state.reviews
      .slice()
      .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))
      .slice(0, wantsReview ? 4 : 2)
      .map((r) => ({ type: r.type, periodStart: r.periodStart, periodEnd: r.periodEnd, answers: r.answers, snapshot: { ...r.snapshot, metrics: undefined }, adjustments: r.adjustments })),
    recentAiChanges: (state.aiHistory ?? []).slice(-5),
  };
}
