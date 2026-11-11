import { addDaysIso, daysBetween, fmt, todayIso, weekStartIso } from '@/lib/dates';
import {
  completedBetween,
  formatValue,
  goalHealth,
  isOpen,
  lastEntryDate,
  metricValueAt,
  measurementTargetAt,
  measurementBaseline,
  measurementPeriod,
  overdueTasks,
  tasksInRange,
} from './selectors';
import type { AppState } from './types';

export interface Insight {
  id: string;
  tone: 'warning' | 'notice' | 'positive';
  title: string;
  detail: string;
  href?: string;
  goalId?: string;
  goalTitle?: string;
  rule: string;
}

/** Deterministic, rule-based observations derived only from stored data. No AI. */
export function generateInsights(s: AppState, today = todayIso()): Insight[] {
  const out: Insight[] = [];
  const active = s.goals.filter((g) => g.status === 'active');
  const ws = weekStartIso(today);
  const we = addDaysIso(ws, 6);

  const overdue = overdueTasks(s.tasks, today);
  if (overdue.length) {
    const oldest = overdue[0];
    const age = daysBetween(oldest.plannedDate ?? oldest.dueDate ?? today, today);
    out.push({
      id: 'overdue',
      tone: 'warning',
      title: `${overdue.length} ${overdue.length === 1 ? 'task is' : 'tasks are'} past their date`,
      detail: `Oldest: "${oldest.title}", ${age} days ago. Reschedule honestly or archive it.`,
      href: '/tasks?view=overdue',
      rule: 'Open tasks with a planned or due date before today',
    });
  }

  active.forEach((g) => {
    const health = goalHealth(g, today);
    if (health.metric && (health.status === 'behind' || health.status === 'watch')) {
      const m = health.metric;
      const target = measurementTargetAt(m, today);
      const baseline = measurementBaseline(m);
      const expectedValue = baseline + (target - baseline) * health.expected;
      const period = measurementPeriod(m, today);
      out.push({
        id: `pace-${g.id}`,
        goalId: g.id, goalTitle: g.title,
        tone: health.status === 'behind' ? 'warning' : 'notice',
        title: `${m.name} is behind linear pace`,
        detail: `${formatValue(metricValueAt(m, today), m.unit)} now; a straight line to ${formatValue(target, m.unit)} by ${fmt(period?.end ?? g.targetDate)} would be about ${formatValue(Math.round(expectedValue * 10) / 10, m.unit)} today.`,
        href: `/goals/${g.id}`,
        rule: 'Latest outcome value vs. straight line from start to target date',
      });
    }

    const plannedThisWeek = tasksInRange(s.tasks, ws, we).filter((t) => t.goalId === g.id).length;
    if (!plannedThisWeek) {
      out.push({
        id: `noplan-${g.id}`,
        goalId: g.id, goalTitle: g.title,
        tone: 'notice',
        title: `Nothing planned this week for "${g.title}"`,
        detail: 'An active goal with no scheduled action. Plan one step, or pause it on purpose.',
        href: '/planner?view=week',
        rule: 'Active goal with zero tasks planned in the current week',
      });
    }

    const doneRecent = completedBetween(s.tasks, addDaysIso(today, -13), today).filter((t) => t.goalId === g.id).length;
    const lastLog = g.metrics.map(lastEntryDate).filter(Boolean).sort().pop();
    if (doneRecent >= 3 && (!lastLog || daysBetween(lastLog, today) > 10)) {
      out.push({
        id: `nolog-${g.id}`,
        goalId: g.id, goalTitle: g.title,
        tone: 'notice',
        title: `Activity without a measured result on "${g.title}"`,
        detail: `${doneRecent} actions completed in 14 days, but no result logged for ${lastLog ? daysBetween(lastLog, today) + ' days' : 'this goal yet'}. Completing tasks does not move the metric by itself.`,
        href: `/goals/${g.id}`,
        rule: '3+ completed tasks in 14 days and no metric entry in 10 days',
      });
    }

    g.milestones
      .filter((m) => !m.done && m.dueDate < today)
      .forEach((m) =>
        out.push({
          id: `ms-${m.id}`,
          goalId: g.id, goalTitle: g.title,
          tone: 'warning',
          title: `Milestone passed: ${m.title}`,
          detail: `Was due ${fmt(m.dueDate)}. Mark it reached, or reschedule with a reason.`,
          href: `/goals/${g.id}`,
          rule: 'Open milestone with a date before today',
        }),
      );
  });

  const plan = s.weekPlans[ws];
  if (plan) {
    const effort = tasksInRange(s.tasks, ws, we).reduce((a, t) => a + t.effort, 0);
    if (effort > plan.capacityMinutes) {
      out.push({
        id: 'capacity',
        tone: 'warning',
        title: 'More planned than your available time',
        detail: `${Math.round(effort / 6) / 10}h planned against ${Math.round(plan.capacityMinutes / 6) / 10}h available.`,
        href: '/planner?view=week',
        rule: 'Sum of task effort this week vs. weekly capacity',
      });
    }
  }

  const lastWs = addDaysIso(ws, -7);
  const lastPlan = s.weekPlans[lastWs];
  if (lastPlan?.finalized && lastPlan.commitments.length) {
    const byId = new Map(s.tasks.map((t) => [t.id, t]));
    const doneCount = lastPlan.commitments.filter((c) => byId.get(c.taskId)?.status === 'done').length;
    const rate = doneCount / lastPlan.commitments.length;
    out.push({
      id: 'lastweek',
      tone: rate >= 0.8 ? 'positive' : 'notice',
      title: `Last week: ${doneCount} of ${lastPlan.commitments.length} commitments kept`,
      detail:
        rate >= 0.8
          ? 'Your planning matched your capacity. Keep the same load.'
          : 'Fewer commitments, kept fully, beat a full list half-done. Consider planning less.',
      href: '/reviews',
      rule: 'Original finalized commitments from last week vs. their completion',
    });
  }

  const inbox = s.tasks.filter((t) => isOpen(t) && !t.plannedDate).length;
  if (inbox >= 5) {
    out.push({
      id: 'inbox',
      tone: 'notice',
      title: `${inbox} items waiting in the inbox`,
      detail: 'Decide: schedule, attach to a goal, or archive.',
      href: '/tasks?view=inbox',
      rule: 'Open tasks with no planned date',
    });
  }

  const rank = { warning: 0, notice: 1, positive: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
