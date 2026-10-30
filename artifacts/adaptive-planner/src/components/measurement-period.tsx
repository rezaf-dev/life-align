import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmt, todayIso } from '@/lib/dates';
import { measurementPeriod } from '@/lib/store/selectors';
import type { Metric } from '@/lib/store/types';
import { cn } from '@/lib/utils';
import { Field } from '@/components/form-dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { isMeasurementDate, measurementActivePeriod, measurementTargetAt, nextMeasurementStart } from '@workspace/api-zod';
import { formatValue } from '@/lib/store/selectors';

export type Frequency = NonNullable<Metric['frequency']>;

export const isRecurring = (m?: { frequency?: Metric['frequency'] }) => !!m?.frequency && m.frequency !== 'cumulative';

/** "May 5 – 11" or "May 2025". */
export function formatPeriod(p: { start: string; end: string }, frequency?: Metric['frequency']) {
  if (frequency === 'monthly') return fmt(p.start, 'MMMM yyyy');
  const sameMonth = p.start.slice(0, 7) === p.end.slice(0, 7);
  return `${fmt(p.start, 'MMM d')} \u2013 ${fmt(p.end, sameMonth ? 'd' : 'MMM d')}`;
}

/** Human label for the period containing `at`; null for cumulative. */
export function periodLabel(m: { frequency?: Metric['frequency']; startDate?: string }, at?: string, withRange = true) {
  const p = measurementPeriod(m, at);
  if (!p) return null;
  const isCurrent = !at || (todayIso() >= p.start && todayIso() <= p.end);
  const word = m.frequency === 'weekly' ? 'week' : 'month';
  const active = measurementActivePeriod(m, at);
  if (active?.notStarted) return `Starts ${fmt(m.startDate!, 'MMM d')}`;
  if (active?.partial) return `First partial ${word}${withRange ? ` · ${fmt(active.activeStart, 'MMM d')}–${fmt(active.end, 'MMM d')}` : ''}`;
  const range = formatPeriod(p, m.frequency);
  if (isCurrent) return withRange ? `This ${word} \u00b7 ${range}` : `This ${word}`;
  return m.frequency === 'weekly' ? `Week ${range}` : range;
}

export const frequencyNoun = (f?: Metric['frequency']) => (f === 'weekly' ? 'per week' : f === 'monthly' ? 'per month' : 'overall');

/** Small inline badge naming the measurement period. */
export function PeriodTag({ metric, at, className, testId }: { metric: { frequency?: Metric['frequency']; startDate?: string }; at?: string; className?: string; testId?: string }) {
  const label = periodLabel(metric, at);
  if (!label) return null;
  return (
    <span className={cn('inline-flex items-center rounded bg-accent px-1.5 text-[0.68rem] font-normal text-accent-foreground', className)} data-testid={testId}>
      {label}
    </span>
  );
}

/** Shared setup control: a fixed date plus an explicit first-period preview. */
export function MeasurementStartField({ frequency, target, unit, value, onChange, disabled, testId = 'measure-start' }: {
  frequency: Frequency; target: number; unit: string; value: string;
  onChange: (date: string) => void; disabled?: boolean; testId?: string;
}) {
  if (frequency === 'cumulative') return null;
  const today = todayIso();
  const metric = { frequency, startDate: value, target };
  const active = isMeasurementDate(value)
    ? measurementActivePeriod(metric, value) : null;
  return (
    <Field label="Start measuring" htmlFor={testId} hint={disabled ? 'Start date is locked to preserve recorded periods.' : undefined}>
      <div className="flex flex-wrap gap-2">
        <Input id={testId} type="date" className="min-w-0 flex-1" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} data-testid={`input-${testId}`} />
        <Button type="button" variant="outline" disabled={disabled} onClick={() => onChange(value === today ? nextMeasurementStart(frequency, today) : today)} data-testid={`button-${testId}-toggle`}>
          {value === today ? `Start next ${frequency === 'weekly' ? 'week' : 'month'}` : 'Start today'}
        </Button>
      </div>
      {active && target > 0 && Number.isFinite(target) && (
        <p className="text-xs leading-relaxed text-muted-foreground" data-testid={`text-${testId}-preview`}>
          {active.partial ? `First partial ${frequency === 'weekly' ? 'week' : 'month'} (${fmt(active.activeStart, 'MMM d')}–${fmt(active.end, 'MMM d')}): ${formatValue(measurementTargetAt(metric, value), unit)}. Then ${formatValue(target, unit)} ${frequencyNoun(frequency)}.` : `${formatValue(target, unit)} ${frequencyNoun(frequency)}, starting ${fmt(value, 'MMM d')}.`}
        </p>
      )}
    </Field>
  );
}

export function FrequencySelect({ value, onChange, disabled, testId }: { value: Frequency; onChange: (f: Frequency) => void; disabled?: boolean; testId: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Frequency)} disabled={disabled}>
      <SelectTrigger data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="cumulative">Overall (one running total)</SelectItem>
        <SelectItem value="weekly">Each week (Mon–Sun, resets to 0)</SelectItem>
        <SelectItem value="monthly">Each month (resets to 0)</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Hint telling which period a chosen date credits. */
export function PeriodCreditHint({ metric, date, verb = 'Counts toward' }: { metric?: { frequency?: Metric['frequency'] }; date: string; verb?: string }) {
  if (!metric || !isRecurring(metric) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  let label: string | null = null;
  try { label = periodLabel(metric, date); } catch { return null; }
  return (
    <p className="rounded-lg bg-accent/60 px-3 py-2 text-xs text-accent-foreground" data-testid="text-period-credit">
      {verb} <span className="font-medium">{label}</span>. Each {metric.frequency === 'weekly' ? 'week' : 'month'} starts again at 0; earlier periods keep their own totals.
    </p>
  );
}
