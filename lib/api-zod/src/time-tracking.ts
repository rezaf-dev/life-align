import { z } from 'zod';

export const activeWorkTimerSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1), goalId: z.string().min(1),
  metricId: z.string().optional(), taskId: z.string().optional(), sessionId: z.string().optional(),
  timezone: z.string().refine((zone) => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } }, 'Choose a valid time zone.'),
  status: z.enum(['running', 'paused']),
  segments: z.array(z.object({ start: z.string().datetime(), end: z.string().datetime().optional() })).min(1).max(2000),
  createdAt: z.string(),
}).superRefine((timer, ctx) => {
  let lastEnd = -Infinity;
  timer.segments.forEach((s, index) => {
    const start = Date.parse(s.start), end = s.end ? Date.parse(s.end) : Infinity;
    if (start < lastEnd || end < start || (!s.end && (timer.status !== 'running' || index !== timer.segments.length - 1))) {
      ctx.addIssue({ code: 'custom', message: 'Timer intervals must be ordered, non-overlapping, and only the last running interval may be open.' });
    }
    lastEnd = end;
  });
  if (timer.status === 'running' && timer.segments.at(-1)?.end) ctx.addIssue({ code: 'custom', message: 'A running timer needs an open interval.' });
});
export type ActiveWorkTimer = z.infer<typeof activeWorkTimerSchema>;
export function timerElapsedSeconds(timer: ActiveWorkTimer, nowMs = Date.now()): number {
  return Math.max(0, Math.floor(timer.segments.reduce((sum, s) => sum + Math.max(0, (s.end ? Date.parse(s.end) : nowMs) - Date.parse(s.start)), 0) / 1000));
}
export function formatElapsed(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function dateFormatter(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
}
function localDate(formatter: Intl.DateTimeFormat, seconds: number) {
  const parts = formatter.formatToParts(new Date(seconds * 1000));
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}-${parts.find((p) => p.type === 'day')!.value}`;
}
export function timeTrackingDate(timezone: string, nowMs = Date.now()) {
  return localDate(dateFormatter(timezone), Math.floor(nowMs / 1000));
}
/** Split at real local midnights, including 23/25-hour DST days, without losing seconds. */
function splitSegments(segments: { start: string; end?: string }[], timezone: string): { date: string; seconds: number }[] {
  const formatter = dateFormatter(timezone);
  const days = new Map<string, number>();
  for (const segment of segments) {
    if (!segment.end) throw new Error('Pause the timer before reviewing its work dates.');
    let cursor = Math.floor(Date.parse(segment.start) / 1000);
    const end = Math.floor(Date.parse(segment.end) / 1000);
    if (end < cursor) throw new Error('The end must be after the start.');
    if (end - cursor > 366 * 86400) throw new Error('This interval exceeds a year. Add the correct time manually instead.');
    while (cursor < end) {
      const date = localDate(formatter, cursor);
      let boundary = end;
      if (localDate(formatter, end - 1) !== date) {
        let lo = cursor + 1, hi = Math.min(end, cursor + 36 * 3600);
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (localDate(formatter, mid) === date) lo = mid + 1; else hi = mid;
        }
        boundary = lo;
      }
      days.set(date, (days.get(date) ?? 0) + boundary - cursor);
      cursor = boundary;
    }
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, seconds]) => ({ date, seconds }));
}
export function splitTimerDays(timer: ActiveWorkTimer) {
  return splitSegments(timer.segments, timer.timezone);
}
function localTimestamp(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error('Choose a valid local date and time.');
  const normalized = value.length === 16 ? `${value}:00` : value;
  const wanted = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(wanted)) throw new Error('Choose a valid local date and time.');
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const partsAt = (at: number) => {
    const parts = formatter.formatToParts(new Date(at));
    const part = (name: string) => parts.find((p) => p.type === name)!.value;
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
  };
  let candidate = wanted;
  for (let i = 0; i < 4; i++) {
    const found = partsAt(candidate);
    if (found === normalized) {
      if (partsAt(candidate - 3600000) === normalized || partsAt(candidate + 3600000) === normalized) {
        throw new Error('This local time occurs twice during a clock change. Enter a duration instead.');
      }
      return new Date(candidate).toISOString();
    }
    candidate += wanted - Date.parse(`${found}Z`);
  }
  throw new Error('This local time does not exist because of a clock change. Choose another time or enter a duration.');
}
export function manualTimeDays(startLocal: string, endLocal: string, timezone: string) {
  const start = localTimestamp(startLocal, timezone), end = localTimestamp(endLocal, timezone);
  if (end <= start) throw new Error('The end must be after the start.');
  return splitSegments([{ start, end }], timezone);
}
