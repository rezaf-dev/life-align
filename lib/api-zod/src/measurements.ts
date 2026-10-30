import { z } from 'zod';

export interface MeasurementSource {
  taskId?: string;
  taskTitle?: string;
  milestoneId?: string;
  milestoneTitle?: string;
}
export interface MeasurementEvent {
  id: string;
  date: string;
  value: number;
  note?: string;
  mode?: 'contribution';
  source?: MeasurementSource;
}

export type MeasurementFrequency = 'cumulative' | 'weekly' | 'monthly';
export const measurementFrequencySchema = z.enum(['cumulative', 'weekly', 'monthly']);
export interface MeasurementPeriod { start: string; end: string }
export interface MeasurementTarget { start: string; target: number }
export interface MeasurementSchedule {
  frequency?: MeasurementFrequency;
  /** Fixed first active date. Never derived from today's remaining days. */
  startDate?: string;
}
export function nextMeasurementStart(frequency: MeasurementFrequency, at = localToday()) {
  const period = measurementPeriod({ frequency }, at);
  if (!period) return at;
  const date = new Date(`${period.end}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return isoDay(date);
}
/** Only unlogged legacy measures can be inferred without rewriting recorded history. */
export function legacyMeasurementStart(
  metric: MeasurementSchedule & { entries: MeasurementEvent[]; targetHistory?: MeasurementTarget[] }, createdAt: string,
) {
  if (metric.startDate || !metric.frequency || metric.frequency === 'cumulative' || metric.entries.length || metric.targetHistory?.length) return metric.startDate;
  const date = createdAt.slice(0, 10);
  return isMeasurementDate(date) ? date : undefined;
}
const calendarDays = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
/** Calendar boundary plus the active part of that period. */
export function measurementActivePeriod(metric: MeasurementSchedule, at = localToday()) {
  const period = measurementPeriod(metric, at);
  if (!period) return null;
  const start = metric.startDate && metric.startDate > period.start ? metric.startDate : period.start;
  const activeDays = Math.max(0, calendarDays(start, period.end) + 1);
  return {
    ...period, activeStart: start, activeDays,
    totalDays: calendarDays(period.start, period.end) + 1,
    partial: activeDays > 0 && start > period.start,
    notStarted: !!metric.startDate && at < metric.startDate,
  };
}
/** A changed recurring target applies to this period onward, not past periods. */
export function measurementTargetAt(
  metric: MeasurementSchedule & { target: number; targetHistory?: MeasurementTarget[] }, at = localToday(),
) {
  if (!metric.frequency || metric.frequency === 'cumulative') return metric.target;
  const target = [...(metric.targetHistory ?? [])].filter((item) => item.start <= at)
    .sort((a, b) => a.start.localeCompare(b.start)).at(-1)?.target ?? metric.target;
  const period = measurementActivePeriod(metric, at)!;
  return target * period.activeDays / period.totalDays;
}
type DatedMeasurement = { baseline: number; entries: MeasurementEvent[]; frequency?: MeasurementFrequency };
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Calendar periods, independent of DST. Weeks run Monday through Sunday. */
export function measurementPeriod(metric: { frequency?: MeasurementFrequency }, at = localToday()): MeasurementPeriod | null {
  if (!metric.frequency || metric.frequency === 'cumulative') return null;
  if (!isMeasurementDate(at)) throw new Error('Choose a valid measurement date.');
  const date = new Date(`${at}T00:00:00Z`);
  if (metric.frequency === 'weekly') {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const start = isoDay(date);
    date.setUTCDate(date.getUTCDate() + 6);
    return { start, end: isoDay(date) };
  }
  return {
    start: isoDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))),
    end: isoDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))),
  };
}
export function measurementBaseline(metric: { baseline: number; frequency?: MeasurementFrequency }) {
  return metric.frequency && metric.frequency !== 'cumulative' ? 0 : metric.baseline;
}
/** Recorded periods plus this period; empty periods remain accessible by date. */
export function measurementPeriods(metric: DatedMeasurement, at = localToday()): MeasurementPeriod[] {
  const current = measurementPeriod(metric, at);
  if (!current) return [];
  const periods = new Map<string, MeasurementPeriod>([[current.start, current]]);
  for (const entry of metric.entries) {
    const period = measurementPeriod(metric, entry.date)!;
    if (period.start <= current.start) periods.set(period.start, period);
  }
  return [...periods.values()].sort((a, b) => b.start.localeCompare(a.start));
}
export function measurementEntries<E extends MeasurementEvent>(
  metric: { entries: E[]; frequency?: MeasurementFrequency }, at?: string,
): E[] {
  const period = measurementPeriod(metric, at);
  const cutoff = at ?? (period ? localToday() : undefined);
  return metric.entries.filter((entry) => (!cutoff || entry.date <= cutoff) && (!period || entry.date >= period.start));
}

export function isMeasurementDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export const measurementEntrySchema = z.object({
  id: z.string().min(1), date: z.string(), value: z.number().finite(), note: z.string().optional(),
  mode: z.literal('contribution').optional(),
  source: z.object({
    taskId: z.string().min(1).optional(), taskTitle: z.string().optional(),
    milestoneId: z.string().min(1).optional(), milestoneTitle: z.string().optional(),
  }).optional(),
}).passthrough().superRefine((entry, ctx) => {
  if (entry.mode !== 'contribution') return;
  if (!isMeasurementDate(entry.date)) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Enter a real measurement date.' });
  if (entry.value === 0) ctx.addIssue({ code: 'custom', path: ['value'], message: 'A contribution must record a non-zero change.' });
  if (!entry.source?.taskId && !entry.source?.milestoneId) {
    ctx.addIssue({ code: 'custom', path: ['source'], message: 'A contribution must identify its task or milestone.' });
  }
  if (entry.source?.taskId && !entry.source.taskTitle?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['source', 'taskTitle'], message: 'Keep a snapshot of the contributing task title.' });
  }
  if (entry.source?.milestoneId && !entry.source.milestoneTitle?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['source', 'milestoneTitle'], message: 'Keep a snapshot of the contributing milestone title.' });
  }
});

/** Absolute observations reconcile the current value; later result deltas add to it.
 * Old entries remain absolute. Stable same-day ordering survives save/reload.
 */
export function measurementTimeline<E extends MeasurementEvent>(
  metric: { baseline: number; entries: E[]; frequency?: MeasurementFrequency }, at?: string,
): { entry: E; value: number }[] {
  let value = measurementBaseline(metric);
  return measurementEntries(metric, at).map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.index - b.index)
    .map(({ entry }) => {
      value = entry.mode === 'contribution' ? value + entry.value : entry.value;
      return { entry, value };
    });
}
export function measurementValueAt(metric: DatedMeasurement, at?: string) {
  return measurementTimeline(metric, at).at(-1)?.value ?? measurementBaseline(metric);
}
export function contributionAmount(
  metric: { entries: MeasurementEvent[]; frequency?: MeasurementFrequency },
  filter?: { taskId?: string; milestoneId?: string }, at?: string,
) {
  return measurementEntries(metric, at).reduce((sum, entry) => {
    if (entry.mode !== 'contribution' || (at && entry.date > at)) return sum;
    if (filter?.taskId && entry.source?.taskId !== filter.taskId) return sum;
    if (filter?.milestoneId && entry.source?.milestoneId !== filter.milestoneId) return sum;
    return sum + entry.value;
  }, 0);
}
export function contributionPercent(metric: MeasurementSchedule & { baseline: number; target: number; targetHistory?: MeasurementTarget[] }, amount: number, at?: string): number | null {
  const span = measurementTargetAt(metric, at) - measurementBaseline(metric);
  return span === 0 ? null : (amount / span) * 100;
}
