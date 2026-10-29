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
  metric: { baseline: number; entries: E[] }, at?: string,
): { entry: E; value: number }[] {
  let value = metric.baseline;
  return metric.entries.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !at || entry.date <= at)
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.index - b.index)
    .map(({ entry }) => {
      value = entry.mode === 'contribution' ? value + entry.value : entry.value;
      return { entry, value };
    });
}
export function measurementValueAt(metric: { baseline: number; entries: MeasurementEvent[] }, at?: string) {
  return measurementTimeline(metric, at).at(-1)?.value ?? metric.baseline;
}
export function contributionAmount(
  metric: { entries: MeasurementEvent[] },
  filter?: { taskId?: string; milestoneId?: string }, at?: string,
) {
  return metric.entries.reduce((sum, entry) => {
    if (entry.mode !== 'contribution' || (at && entry.date > at)) return sum;
    if (filter?.taskId && entry.source?.taskId !== filter.taskId) return sum;
    if (filter?.milestoneId && entry.source?.milestoneId !== filter.milestoneId) return sum;
    return sum + entry.value;
  }, 0);
}
export function contributionPercent(metric: { baseline: number; target: number }, amount: number): number | null {
  const span = metric.target - metric.baseline;
  return span === 0 ? null : (amount / span) * 100;
}
