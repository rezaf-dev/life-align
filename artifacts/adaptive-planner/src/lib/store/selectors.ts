import { addDaysIso, daysBetween, todayIso } from '@/lib/dates';
import type { AppState, Goal, Metric, ReviewSnapshot, Task } from './types';

export const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function metricValueAt(m: Metric, at?: string) {
  const sorted = [...m.entries]
    .filter((e) => !at || e.date <= at)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.length ? sorted[sorted.length - 1].value : m.baseline;
}

export function metricProgress(m: Metric) {
  const span = m.target - m.baseline;
  if (span === 0) return 1;
  return clamp((metricValueAt(m) - m.baseline) / span);
}

export function lastEntryDate(m: Metric) {
  return m.entries.reduce<string | undefined>((acc, e) => (!acc || e.date > acc ? e.date : acc), undefined);
}

export type Health = 'achieved' | 'on-track' | 'watch' | 'behind' | 'no-data';

export function primaryMetric(g: Goal) {
  return g.metrics.find((m) => m.kind === 'outcome') ?? g.metrics[0];
}

export function goalHealth(g: Goal, t = todayIso()) {
  const m = primaryMetric(g);
  const start = g.createdAt.slice(0, 10);
  const total = Math.max(1, daysBetween(start, g.targetDate));
  const expected = clamp(daysBetween(start, t) / total);
  if (!m) return { status: 'no-data' as Health, progress: 0, expected, metric: undefined };
  const progress = metricProgress(m);
  const gap = progress - expected;
  const status: Health =
    progress >= 1 ? 'achieved' : gap >= -0.1 ? 'on-track' : gap >= -0.25 ? 'watch' : 'behind';
  return { status, progress, expected, metric: m };
}

export const isLive = (t: Task) => !t.archived;
export const isOpen = (t: Task) => t.status === 'open' && !t.archived;

export function isOverdue(t: Task, today = todayIso()) {
  if (!isOpen(t)) return false;
  return (!!t.dueDate && t.dueDate < today) || (!!t.plannedDate && t.plannedDate < today);
}

export function overdueTasks(tasks: Task[], today = todayIso()) {
  return tasks
    .filter((t) => isOverdue(t, today))
    .sort((a, b) => ((a.plannedDate ?? a.dueDate ?? '') < (b.plannedDate ?? b.dueDate ?? '') ? -1 : 1));
}

export function plannedOn(tasks: Task[], day: string) {
  return tasks.filter((t) => !t.archived && t.plannedDate === day);
}

export function inboxTasks(tasks: Task[]) {
  return tasks.filter((t) => isOpen(t) && !t.plannedDate);
}

export function weekRange(ws: string) {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(ws, i));
}

export function tasksInRange(tasks: Task[], start: string, end: string) {
  return tasks.filter((t) => !t.archived && !!t.plannedDate && t.plannedDate >= start && t.plannedDate <= end);
}

export function dueReminders(tasks: Task[], now: string) {
  return tasks.filter((t) => isOpen(t) && !!t.reminder && !t.reminderDismissed && t.reminder <= now);
}

export function completedBetween(tasks: Task[], start: string, end: string) {
  return tasks.filter(
    (t) => t.status === 'done' && !!t.completedAt && t.completedAt.slice(0, 10) >= start && t.completedAt.slice(0, 10) <= end,
  );
}

export function goalExecution(goalId: string, tasks: Task[], days = 14, today = todayIso()) {
  const start = addDaysIso(today, -days + 1);
  const done = completedBetween(tasks, start, today).filter((t) => t.goalId === goalId).length;
  const open = tasks.filter((t) => isOpen(t) && t.goalId === goalId).length;
  return { done, open };
}

export function computeSnapshot(
  state: AppState,
  type: 'weekly' | 'monthly',
  start: string,
  end: string,
  today = todayIso(),
): ReviewSnapshot {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const plan = state.weekPlans[start];
  const committedIds =
    type === 'weekly' && plan?.finalized && plan.commitments.length
      ? plan.commitments.map((c) => c.taskId)
      : tasksInRange(state.tasks, start, end).map((t) => t.id);
  const committedSet = new Set(committedIds);
  const committedDone = committedIds.filter((id) => {
    const t = byId.get(id);
    return t && t.status === 'done' && !!t.completedAt && t.completedAt.slice(0, 10) <= end;
  }).length;
  const extraDone = completedBetween(state.tasks, start, end).filter((t) => !committedSet.has(t.id)).length;
  const cutoff = end < today ? end : today;
  const overdue = state.tasks.filter((t) => {
    if (t.archived) return false;
    const d = t.plannedDate ?? t.dueDate;
    if (!d || d >= cutoff) return false;
    const doneBy = t.status === 'done' && !!t.completedAt && t.completedAt.slice(0, 10) <= cutoff;
    return !doneBy && t.createdAt.slice(0, 10) <= cutoff;
  }).length;
  const metrics = state.goals
    .filter((g) => g.status !== 'cancelled' && g.createdAt.slice(0, 10) <= end)
    .flatMap((g) =>
      g.metrics.map((m) => ({
        goalId: g.id,
        goalTitle: g.title,
        metricId: m.id,
        name: m.name,
        unit: m.unit,
        kind: m.kind,
        value: metricValueAt(m, end),
        target: m.target,
      })),
    );
  return { committed: committedIds.length, committedDone, extraDone, overdue, metrics };
}

export function formatValue(v: number, unit: string) {
  const n = Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (unit === '$' || unit === 'USD') return `$${n}`;
  return unit ? `${n} ${unit}` : n;
}

export function effortLabel(min: number) {
  if (!min) return '';
  if (min < 60) return `${min}m`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}
