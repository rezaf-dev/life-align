import { Input } from '@/components/ui/input';
import { isMeasurementDate } from '@workspace/api-zod';
import { formatMinutes } from '@/lib/reports';
import { cn } from '@/lib/utils';

export type SessionOutcome = 'finish' | 'continue' | 'replan';

const OPTIONS: { value: SessionOutcome; label: string; body: string }[] = [
  { value: 'continue', label: 'Continue later', body: 'Keep the rest as a separate planned block today.' },
  { value: 'finish', label: 'Finish session', body: 'Close it here. Nothing is carried forward.' },
  { value: 'replan', label: 'Replan remaining time', body: 'Move the rest to a day you choose.' },
];

/** True when a choice is required and present, with a valid date for replanning. */
export function outcomeReady(short: boolean, outcome: SessionOutcome | '', date: string, today: string) {
  if (!short) return true;
  if (!outcome) return false;
  return outcome !== 'replan' || (isMeasurementDate(date) && date >= today);
}

/**
 * Compact choice shown when actual time comes in under the planned amount.
 * Starts blank so the person decides explicitly.
 */
export function SessionOutcomeChoice({ actualMinutes, plannedMinutes, value, onChange, date, onDateChange, today, disabled, testId = 'session-outcome' }: {
  actualMinutes: number; plannedMinutes: number; value: SessionOutcome | ''; onChange: (v: SessionOutcome) => void;
  date: string; onDateChange: (d: string) => void; today: string; disabled?: boolean; testId?: string;
}) {
  const remaining = Math.max(0, plannedMinutes - actualMinutes);
  const name = `${testId}-choice`;
  return (
    <fieldset className="space-y-2 rounded-lg border border-border/80 bg-muted/30 p-3" data-testid={`group-${testId}`}>
      <legend className="sr-only">What happens to the remaining planned time</legend>
      <p className="text-sm leading-relaxed" data-testid={`text-${testId}-context`}>
        You recorded <span className="font-num">{formatMinutes(actualMinutes)}</span> of <span className="font-num">{formatMinutes(plannedMinutes)}</span> planned.
        {' '}<span className="text-muted-foreground"><span className="font-num">{formatMinutes(remaining)}</span> remains. What should happen to it?</span>
      </p>
      <div className="grid gap-1.5" role="radiogroup" aria-label="Remaining planned time">
        {OPTIONS.map((o) => {
          const on = value === o.value;
          return (
            <label key={o.value} className={cn('flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors',
              on ? 'border-foreground/40 bg-card' : 'border-transparent hover:bg-card/70', disabled && 'cursor-not-allowed opacity-70')}>
              <input type="radio" name={name} value={o.value} checked={on} disabled={disabled} onChange={() => onChange(o.value)}
                className="mt-1 size-4 shrink-0 accent-[hsl(var(--foreground))]" data-testid={`radio-${testId}-${o.value}`} />
              <span className="min-w-0 break-words">
                <span className="font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.body}</span>
              </span>
            </label>
          );
        })}
      </div>
      {value === 'replan' && (
        <div className="flex flex-wrap items-center gap-2 pl-1 pt-1">
          <label htmlFor={`${testId}-date`} className="text-xs text-muted-foreground">Remaining time on</label>
          <Input id={`${testId}-date`} type="date" min={today} value={date} disabled={disabled} onChange={(e) => onDateChange(e.target.value)}
            className="h-9 w-auto font-num" data-testid={`input-${testId}-date`} />
          {date && date < today && <span className="text-xs text-muted-foreground">Choose today or a later day.</span>}
        </div>
      )}
      {!value && <p className="text-xs text-muted-foreground" data-testid={`text-${testId}-hint`}>Choose one to save.</p>}
    </fieldset>
  );
}
