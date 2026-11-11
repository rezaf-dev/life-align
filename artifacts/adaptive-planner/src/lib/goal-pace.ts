import { measurementActivePeriod, measurementBaseline, measurementTargetAt } from '@workspace/api-zod';
import { addDaysIso, daysBetween, fmt, todayIso } from './dates';
import { formatValue, goalHealth, metricValueAt, primaryMetric } from './store/selectors';
import type { Goal } from './store/types';

/** Estimates only: no task completion or reserved time is treated as a measured result. */
export function getGoalPaceFeedback(goal: Goal, today = todayIso()) {
  const metric = primaryMetric(goal);
  if (!metric) return {
    current: 'No measure yet.',
    expected: 'Choose a measure that reflects the result you want.',
    forecast: 'Log a result to start seeing a forecast.',
    recommendation: 'Choose one useful next action for this goal.',
  };
  const period = measurementActivePeriod(metric, today);
  const start = period?.activeStart ?? goal.createdAt.slice(0, 10);
  const end = period?.end ?? goal.targetDate;
  const target = measurementTargetAt(metric, today);
  const baseline = measurementBaseline(metric);
  const value = metricValueAt(metric, today);
  const direction = target >= baseline ? 1 : -1;
  const remaining = Math.max(0, (target - value) * direction);
  const elapsed = Math.max(0, daysBetween(start, today));
  const advanced = (value - baseline) * direction;
  const expectedValue = baseline + (target - baseline) * goalHealth(goal, today).expected;
  const scope = period ? ` ${metric.frequency === 'weekly' ? 'this week' : 'this month'}` : '';
  const current = `${formatValue(value, metric.unit)} of ${formatValue(target, metric.unit)}${scope}${direction < 0 ? ' target.' : ' done.'}`;
  const expected = `Even-pace reference: ${formatValue(expectedValue, metric.unit)} by today.`;
  if (today < start) return {
    current, expected: `Starts ${fmt(start)}.`,
    forecast: 'A forecast will appear after work begins.',
    recommendation: 'Plan your first action for the start date.',
  };
  if (!remaining) return {
    current, expected, forecast: period ? 'This period’s target is reached.' : 'Your target is reached.',
    recommendation: period ? 'Keep the next period manageable.' : 'Review the result and decide whether to complete this goal.',
  };
  let forecast = 'Not enough progress history for a completion forecast yet.';
  if (elapsed > 0 && advanced > 0) {
    const daysLeft = Math.ceil(remaining / (advanced / elapsed));
    if (daysLeft <= 36500) {
      const date = addDaysIso(today, daysLeft);
      forecast = `At your current pace, you’d reach ${period ? 'this period’s target' : 'your target'} around ${fmt(date, 'MMM d, yyyy')}.${period && date > end ? ' That falls after this period ends.' : ''}`;
    }
  }
  const daysLeft = Math.max(1, daysBetween(today, end) + 1);
  const perDay = Math.ceil(remaining / daysLeft * 100) / 100;
  const amount = formatValue(perDay, metric.unit);
  const recommendation = direction < 0
    ? `Choose an action toward a ${amount} reduction today${today > end ? ', or choose a new target date' : ''}.`
    : `Plan ${amount} today ${today > end ? 'and choose a new target date' : 'to stay on track'}.`;
  return { current, expected, forecast, recommendation };
}
