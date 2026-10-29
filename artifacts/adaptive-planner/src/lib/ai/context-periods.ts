import { addDaysIso, addMonthsIso, monthEndIso, monthStartIso, weekStartIso } from '@/lib/dates';
import type { AppState } from '@/lib/store/types';
import { metricValueAt } from '@/lib/store/selectors';

/** Retrieve period aggregates locally rather than uploading every historical record. */
export function periodContext(state: AppState, message: string, today: string) {
  const q = message.toLowerCase();
  const ranges = new Map<string, { start: string; end: string }>();
  const add = (start: string, end: string) => ranges.set(`${start}/${end}`, { start, end });
  const month = (date: string) => add(monthStartIso(date), monthEndIso(date));
  const current = monthStartIso(today);
  const ws = weekStartIso(today);
  add(ws, addDaysIso(ws, 6));
  add(addDaysIso(ws, -7), addDaysIso(ws, -1));
  if (/month|review|compare|progress|neglect|results|how did/.test(q)) {
    month(today);
    month(addMonthsIso(current, -1));
  }
  const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const explicitYear = q.match(/\b(20\d{2})\b/)?.[1] ?? today.slice(0, 4);
  names.forEach((name, i) => {
    if (new RegExp(`\\b${name}(?:\\s+20\\d{2})?\\b|\\b${name.slice(0, 3)}\\b`).test(q)) {
      const matchingYear = q.match(new RegExp(`${name}\\s+(20\\d{2})`))?.[1] ?? explicitYear;
      month(`${matchingYear}-${String(i + 1).padStart(2, '0')}-01`);
    }
  });
  if (/quarter/.test(q)) {
    const quarterMonth = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
    let start = `${today.slice(0, 4)}-${String(quarterMonth).padStart(2, '0')}-01`;
    if (/last|previous/.test(q)) start = addMonthsIso(start, -3);
    add(start, addDaysIso(addMonthsIso(start, 3), -1));
  }
  if (/\byear\b/.test(q)) {
    const year = Number(explicitYear) - (/last year|previous year/.test(q) && !q.match(/\b20\d{2}\b/) ? 1 : 0);
    add(`${year}-01-01`, `${year}-12-31`);
  }
  return [...ranges.values()].slice(-6).map(({ start, end }) => {
    const completed = state.tasks.filter((t) => !t.archived && t.completedAt && t.completedAt.slice(0, 10) >= start && t.completedAt.slice(0, 10) <= end);
    const planned = state.tasks.filter((t) => !t.archived && t.plannedDate && t.plannedDate >= start && t.plannedDate <= end);
    const commitments = Object.values(state.weekPlans).filter((w) => w.weekStart <= end && addDaysIso(w.weekStart, 6) >= start)
      .flatMap((w) => w.commitments.filter((c) => !c.plannedDate || (c.plannedDate >= start && c.plannedDate <= end)));
    const ids = new Set(commitments.map((c) => c.taskId));
    return {
      start, end, future: start > today,
      plannedCount: planned.length, originalCommitments: ids.size,
      commitmentsCompletedInPeriod: completed.filter((t) => ids.has(t.id)).length,
      completedCount: completed.length,
      completed: completed.slice(0, 15).map((t) => ({ title: t.title, goalId: t.goalId, date: t.completedAt?.slice(0, 10) })),
      goals: state.goals.filter((g) => !g.createdAt || g.createdAt.slice(0, 10) <= end).slice(0, 25).map((g) => ({
        id: g.id, title: g.title,
        completedActions: completed.filter((t) => t.goalId === g.id).length,
        metrics: g.metrics.map((m) => {
          const within = m.entries.filter((e) => e.date >= start && e.date <= end).sort((a, b) => a.date.localeCompare(b.date));
          return { id: m.id, name: m.name, unit: m.unit, kind: m.kind, startValue: metricValueAt(m, addDaysIso(start, -1)),
            lastRecordedInPeriod: within.length ? metricValueAt(m, end) : null, measurementsInPeriod: within.length, target: m.target,
            attributedResults: within.filter((e) => e.mode === 'contribution').map((e) => ({ change: e.value, source: e.source, date: e.date })),
          };
        }),
        milestoneStatusNow: g.milestones.filter((m) => m.dueDate >= start && m.dueDate <= end).map((m) => ({ title: m.title, dueDate: m.dueDate, done: m.done, completedAt: m.completedAt })),
        decisions: g.history.filter((h) => h.at.slice(0, 10) >= start && h.at.slice(0, 10) <= end).slice(0, 6).map((h) => ({ kind: h.kind, summary: h.summary, reason: h.reason })),
      })),
    };
  });
}
