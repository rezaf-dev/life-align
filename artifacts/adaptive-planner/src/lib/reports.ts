import { isMeasurementDate, measurementBaseline, measurementPeriod, measurementTargetAt, measurementValueAt, timeUnitMinutes } from '@workspace/api-zod';
import { addDaysIso, daysBetween, todayIso } from './dates';
import type { AppState, Goal, Milestone, Task } from './store/types';

export interface MeasureReportPeriod {
  start: string; end: string; coveredStart: string; coveredEnd: string;
  startValue: number; endValue: number; change: number; target: number; fullPeriod: boolean;
  progress: number; remaining: number; direction: 'increase' | 'decrease';
}
export interface MeasureReport {
  id: string; name: string; unit: string; frequency: 'cumulative' | 'weekly' | 'monthly';
  periods: MeasureReportPeriod[];
}
export interface GoalReport {
  start: string; end: string; goalId: string; goalTitle: string;
  actualMinutes: number; plannedMinutes: number; sessionCount: number;
  completedTasks: Task[]; completedMilestones: Milestone[]; measures: MeasureReport[];
  /** Current next steps, explicitly separate from the selected historical activity window. */
  openTasks: Task[]; overdueTasks: Task[]; upcomingMilestones: Milestone[];
}
export interface TimesheetRow {
  id: string; date: string; description: string; sessionTitle?: string; milestone?: string;
  minutes: number; notes?: string; kind: 'session' | 'contribution' | 'adjustment';
}
export interface Timesheet {
  goalId: string; goalTitle: string; metricId: string; metricName: string; unit: string;
  start: string; end: string; rows: TimesheetRow[]; totalMinutes: number;
  sessionCount: number; excludedCheckpoints: number;
}
export function validateReportRange(start: string, end: string): string | null {
  if (!isMeasurementDate(start) || !isMeasurementDate(end)) return 'Choose a valid start and end date.';
  if (start > end) return 'The end date must be on or after the start date.';
  if (daysBetween(start, end) > 3660) return 'Choose a date range of ten years or less.';
  return null;
}
function assertRange(start: string, end: string) {
  const error = validateReportRange(start, end);
  if (error) throw new Error(error);
}
const within = (date: string | undefined, start: string, end: string) => !!date && date.slice(0, 10) >= start && date.slice(0, 10) <= end;
const sum = <T,>(items: T[], value: (item: T) => number) => items.reduce((total, item) => total + value(item), 0);

/** Date windows are inclusive; recurring measurements must never be subtracted across resets. */
export function buildGoalReport(state: AppState, goal: Goal, start: string, end: string, today = todayIso()): GoalReport {
  assertRange(start, end);
  const sessions = (state.sessions ?? []).filter((s) => s.goalId === goal.id);
  const logged = sessions.filter((s) => s.status === 'logged' && within(s.date, start, end));
  const openTasks = state.tasks.filter((t) => t.goalId === goal.id && t.status === 'open' && !t.archived)
    .sort((a, b) => (a.dueDate ?? a.plannedDate ?? '9999').localeCompare(b.dueDate ?? b.plannedDate ?? '9999'));
  return {
    start, end, goalId: goal.id, goalTitle: goal.title,
    actualMinutes: sum(logged, (s) => s.actualMinutes ?? 0),
    plannedMinutes: sum(sessions.filter((s) => within(s.plannedDate, start, end)), (s) => s.plannedMinutes),
    sessionCount: logged.length,
    completedTasks: state.tasks.filter((t) => t.goalId === goal.id && t.status === 'done' && within(t.completedAt, start, end))
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    completedMilestones: goal.milestones.filter((m) => m.done && within(m.completedAt, start, end)),
    openTasks,
    overdueTasks: openTasks.filter((t) => (!!t.dueDate && t.dueDate < today) || (!!t.plannedDate && t.plannedDate < today)),
    upcomingMilestones: goal.milestones.filter((m) => !m.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    measures: goal.metrics.map((metric) => {
      const frequency = metric.frequency ?? 'cumulative';
      const periods: MeasureReportPeriod[] = [];
      let cursor = start;
      do {
        const calendar = measurementPeriod(metric, cursor);
        const periodStart = calendar?.start ?? start;
        const periodEnd = calendar?.end ?? end;
        const coveredStart = [start, periodStart, metric.startDate ?? start].sort().at(-1)!;
        const coveredEnd = end < periodEnd ? end : periodEnd;
        if (coveredStart <= coveredEnd) {
          const baseline = measurementBaseline(metric);
          const startValue = calendar && coveredStart === periodStart ? baseline : measurementValueAt(metric, addDaysIso(coveredStart, -1));
          const endValue = measurementValueAt(metric, coveredEnd);
          const target = measurementTargetAt(metric, coveredEnd);
          const span = target - baseline;
          const direction = span < 0 ? 'decrease' : 'increase';
          periods.push({
            start: periodStart, end: periodEnd, coveredStart, coveredEnd,
            startValue, endValue, change: endValue - startValue,
            target,
            progress: span === 0 ? (calendar ? 0 : 1) : Math.max(0, Math.min(1, (endValue - baseline) / span)),
            remaining: Math.max(0, (target - endValue) * (direction === 'decrease' ? -1 : 1)),
            direction,
            fullPeriod: !calendar || (coveredStart === (metric.startDate && metric.startDate > periodStart ? metric.startDate : periodStart) && coveredEnd === periodEnd),
          });
        }
        if (!calendar || periodEnd >= end) break;
        cursor = addDaysIso(periodEnd, 1);
      } while (cursor <= end);
      return { id: metric.id, name: metric.name, unit: metric.unit, frequency, periods };
    }),
  };
}

/** A client timesheet is a record of durations, not a reconstruction from absolute observations. */
export function buildTimesheet(state: AppState, goal: Goal, metricId: string, start: string, end: string): Timesheet {
  assertRange(start, end);
  const metric = goal.metrics.find((m) => m.id === metricId);
  const multiplier = metric && timeUnitMinutes(metric.unit);
  if (!metric || !multiplier) throw new Error('Choose an hours or minutes measure belonging to this goal.');
  const sessions = (state.sessions ?? []).filter((s) =>
    s.goalId === goal.id && s.metricId === metric.id && s.status === 'logged' && within(s.date, start, end));
  const rows: TimesheetRow[] = [];
  for (const session of sessions) {
    for (const allocation of session.allocations) rows.push({
      id: `${session.id}:${allocation.taskId}`, date: session.date!, description: allocation.taskTitle || 'Recorded task work',
      sessionTitle: session.title, milestone: allocation.milestoneTitle, minutes: allocation.minutes,
      notes: session.notes, kind: 'session',
    });
    const remainder = (session.actualMinutes ?? 0) - sum(session.allocations, (a) => a.minutes);
    if (remainder > 0) rows.push({
      id: `${session.id}:general`, date: session.date!, description: session.allocations.length ? `${session.title} — general work` : session.title,
      sessionTitle: session.title, minutes: remainder, notes: session.notes, kind: 'session',
    });
  }
  let excludedCheckpoints = 0;
  for (const entry of metric.entries) {
    if (!within(entry.date, start, end)) continue;
    // A session is represented by its allocations/remainder above, never its mirrored ledger too.
    if (entry.source?.sessionId) continue;
    if (entry.mode !== 'contribution') { excludedCheckpoints++; continue; }
    if (!entry.value) continue;
    const task = state.tasks.find((t) => t.id === entry.source?.taskId);
    const milestone = goal.milestones.find((m) => m.id === entry.source?.milestoneId);
    rows.push({
      id: entry.id, date: entry.date,
      description: entry.source?.taskTitle || task?.title || entry.source?.milestoneTitle || milestone?.title || (entry.value < 0 ? 'Time adjustment' : 'Recorded work'),
      milestone: entry.source?.milestoneTitle || milestone?.title,
      minutes: entry.value * multiplier, notes: entry.note,
      kind: entry.value < 0 ? 'adjustment' : 'contribution',
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { goalId: goal.id, goalTitle: goal.title, metricId, metricName: metric.name, unit: metric.unit,
    start, end, rows, totalMinutes: sum(rows, (r) => r.minutes), sessionCount: sessions.length, excludedCheckpoints };
}

export function formatMinutes(minutes: number): string {
  const rounded = Math.round(Math.abs(minutes) * 100) / 100;
  const hours = Math.floor(rounded / 60);
  const rest = Math.round((rounded % 60) * 100) / 100;
  return `${minutes < 0 ? '−' : ''}${hours ? `${hours}h` : ''}${hours && rest ? ' ' : ''}${rest || !hours ? `${rest}m` : ''}`;
}
