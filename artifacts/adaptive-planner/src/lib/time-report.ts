import { plannedWorkMinutes, type WorkSession } from '@workspace/api-zod';
import { addDaysIso, daysBetween, todayIso, weekStartIso } from './dates';
import { buildGoalReport, validateReportRange, type MeasureReport } from './reports';
import type { AppState } from './store/types';

export interface TimeGoalRow {
  goalId: string; title: string; minutes: number; plannedMinutes: number;
  completedTasks: number; completedMilestones: number; measures: MeasureReport[];
}
export interface TimeReport {
  start: string; end: string; totalMinutes: number; allTimeMinutes: number;
  todayMinutes: number; weekMinutes: number; averageDailyMinutes: number; activeDays: number;
  plannedMinutes: number; plannedLoggedMinutes: number; unplannedMinutes: number;
  knownTimeMinutes: number; unknownTimeMinutes: number;
  daily: { date: string; minutes: number; plannedMinutes: number }[];
  goals: TimeGoalRow[];
  tasks: { taskId: string; title: string; goalId: string; minutes: number }[];
  dayParts: { name: string; minutes: number }[];
  intervals: { sessionId: string; title: string; date: string; start: string; end: string; timezone: string; minutes: number }[];
  entries: WorkSession[]; completedTasks: number; completedMilestones: number;
}
const within = (date: string | undefined, start: string, end: string) => !!date && date.slice(0, 10) >= start && date.slice(0, 10) <= end;
const total = (sessions: WorkSession[]) => sessions.reduce((sum, s) => sum + (s.actualMinutes ?? 0), 0);

/** Time is counted from the session ledger once, never re-added from task allocations or goal measures. */
export function buildTimeReport(state: AppState, start: string, end: string, today = todayIso()): TimeReport {
  const error = validateReportRange(start, end);
  if (error) throw new Error(error);
  const logged = (state.sessions ?? []).filter((s) => s.status === 'logged');
  const entries = logged.filter((s) => within(s.date, start, end)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.createdAt.localeCompare(a.createdAt));
  const daily = [];
  for (let date = start; date <= end; date = addDaysIso(date, 1)) {
    daily.push({ date, minutes: total(entries.filter((s) => s.date === date)), plannedMinutes: plannedWorkMinutes(state, date, date) });
  }
  const groups = new Map<string, TimeGoalRow>();
  for (const goal of state.goals) {
    const report = buildGoalReport(state, goal, start, end, today);
    const updates = goal.metrics.some((m) => m.entries.some((e) => within(e.date, start, end)));
    if (report.sessionCount || report.plannedMinutes || report.completedTasks.length || report.completedMilestones.length || updates) {
      groups.set(goal.id, { goalId: goal.id, title: goal.title, minutes: report.actualMinutes, plannedMinutes: report.plannedMinutes,
        completedTasks: report.completedTasks.length, completedMilestones: report.completedMilestones.length, measures: report.measures });
    }
  }
  const general = entries.filter((s) => !s.goalId);
  const generalPlans = (state.sessions ?? []).filter((s) => !s.goalId && s.status !== 'skipped' && within(s.plannedDate, start, end));
  const generalDone = state.tasks.filter((t) => !t.goalId && t.status === 'done' && within(t.completedAt, start, end));
  if (general.length || generalPlans.length || generalDone.length) groups.set('', { goalId: '', title: 'General work', minutes: total(general),
    plannedMinutes: generalPlans.reduce((sum, s) => sum + s.plannedMinutes, 0), completedTasks: generalDone.length, completedMilestones: 0, measures: [] });
  const tasks = new Map<string, TimeReport['tasks'][number]>();
  for (const session of entries) for (const allocation of session.allocations) {
    const row = tasks.get(allocation.taskId) ?? { taskId: allocation.taskId, title: allocation.taskTitle || 'Recorded task', goalId: session.goalId, minutes: 0 };
    row.minutes += allocation.minutes; tasks.set(allocation.taskId, row);
  }
  const dayParts = ['Morning', 'Afternoon', 'Evening', 'Night'].map((name) => ({ name, minutes: 0 }));
  const intervals: TimeReport['intervals'] = [];
  let knownTimeMinutes = 0;
  for (const session of entries) {
    if (!session.timeIntervals?.length || !session.timezone) continue;
    const formatter = new Intl.DateTimeFormat('en', { timeZone: session.timezone, hour: '2-digit', hourCycle: 'h23' });
    for (const interval of session.timeIntervals) {
      const from = Date.parse(interval.start), endMs = Date.parse(interval.end);
      const minutes = (endMs - from) / 60000;
      intervals.push({ sessionId: session.id, title: session.title, date: session.date!, ...interval, timezone: session.timezone, minutes });
      knownTimeMinutes += minutes;
      // Minute-sized pieces respect timezone offsets and DST; fractions retain exact elapsed seconds.
      for (let cursor = from; cursor < endMs;) {
        const next = Math.min(endMs, Math.floor(cursor / 60000) * 60000 + 60000);
        const hour = Number(formatter.format(new Date(cursor)));
        const index = hour >= 6 && hour < 12 ? 0 : hour < 18 && hour >= 12 ? 1 : hour >= 18 ? 2 : 3;
        dayParts[index].minutes += (next - cursor) / 60000; cursor = next;
      }
    }
  }
  const totalMinutes = total(entries);
  const plannedLoggedMinutes = total(entries.filter((s) => s.plannedWork ?? (!!s.plannedDate && s.plannedMinutes > 0)));
  const elapsedEnd = end < today ? end : today;
  const elapsedDays = elapsedEnd >= start ? daysBetween(start, elapsedEnd) + 1 : 0;
  return {
    start, end, totalMinutes, allTimeMinutes: total(logged), todayMinutes: total(logged.filter((s) => s.date === today)),
    weekMinutes: total(logged.filter((s) => within(s.date, weekStartIso(today), today))),
    averageDailyMinutes: elapsedDays ? totalMinutes / elapsedDays : 0,
    activeDays: daily.filter((d) => d.minutes > 0).length, plannedMinutes: plannedWorkMinutes(state, start, end),
    plannedLoggedMinutes, unplannedMinutes: totalMinutes - plannedLoggedMinutes,
    knownTimeMinutes, unknownTimeMinutes: Math.max(0, totalMinutes - knownTimeMinutes),
    daily, goals: [...groups.values()].sort((a, b) => b.minutes - a.minutes),
    tasks: [...tasks.values()].sort((a, b) => b.minutes - a.minutes), dayParts,
    intervals: intervals.sort((a, b) => b.start.localeCompare(a.start)), entries,
    completedTasks: state.tasks.filter((t) => t.status === 'done' && within(t.completedAt, start, end)).length,
    completedMilestones: state.goals.reduce((sum, g) => sum + g.milestones.filter((m) => m.done && within(m.completedAt, start, end)).length, 0),
  };
}
