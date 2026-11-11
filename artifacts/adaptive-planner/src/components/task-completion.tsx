import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Check, CircleSlash, Minus, Plus, RotateCcw, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Field } from '@/components/form-dialog';
import { AreaDot } from '@/components/primitives';
import { PeriodCreditHint, frequencyNoun, isRecurring } from '@/components/measurement-period';
import { formatDelta, formatShare } from '@/components/contributions';
import { relDay, todayIso } from '@/lib/dates';
import { completeTaskWithResult, toggleTask } from '@/lib/store/actions';
import { formatValue, measurementTargetAt, metricValueAt, primaryMetric } from '@/lib/store/selectors';
import { getState, useAppState } from '@/lib/store/store';
import type { Goal, Metric, Task } from '@/lib/store/types';
import { flushWorkspace } from '@/lib/workspace-sync';
import { cn } from '@/lib/utils';
import { isMeasurementDate } from '@workspace/api-zod';

type Ctx = { toggle: (task: Task) => void };

const CompletionContext = createContext<Ctx | null>(null);

/** Finish or reopen a task. Goal-linked open tasks ask for the actual result first. */
export function useTaskCompletion(): Ctx {
  const ctx = useContext(CompletionContext);
  const { toast } = useToast();
  if (ctx) return ctx;
  return {
    toggle: (task) => {
      const wasOpen = task.status === 'open';
      const { spawned } = toggleTask(task.id);
      if (wasOpen) toast({ title: spawned ? 'Done. Next one is scheduled.' : 'Done', description: spawned ? `Repeats on ${relDay(spawned)}.` : undefined });
    },
  };
}

export function TaskCompletionProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [session, setSession] = useState(0);

  const toggle = useCallback(
    (task: Task) => {
      const current = getState().tasks.find((t) => t.id === task.id) ?? task;
      if (current.status === 'done') {
        // Reopen: credited results stay in the ledger.
        toggleTask(current.id);
        toast({ title: 'Reopened', description: 'Any results already credited to this task are kept.' });
        return;
      }
      const goal = current.goalId ? getState().goals.find((g) => g.id === current.goalId) : undefined;
      if (!goal) {
        const { spawned } = toggleTask(current.id);
        toast({ title: spawned ? 'Done. Next one is scheduled.' : 'Done', description: spawned ? `Repeats on ${relDay(spawned)}.` : undefined });
        return;
      }
      setSession((s) => s + 1);
      setTaskId(current.id);
    },
    [toast],
  );

  const value = useMemo(() => ({ toggle }), [toggle]);

  return (
    <CompletionContext.Provider value={value}>
      {children}
      {taskId && <CompletionDialog key={session} taskId={taskId} onClose={() => setTaskId(null)} />}
    </CompletionContext.Provider>
  );
}

/* ---------- helpers ---------- */

type Mode = 'change' | 'total' | 'none';

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
const round = (n: number) => Math.round(n * 1000) / 1000;

function quickSteps(m: Metric): number[] {
  const u = m.unit.trim().toLowerCase();
  if (/^(h|hr|hrs|hour|hours)$/.test(u)) return [0.5, 1, 2];
  if (/^(m|min|mins|minute|minutes)$/.test(u)) return [15, 30, 60];
  if (/^(km|mi|miles|kg|lb|lbs)$/.test(u)) return [0.5, 1, 5];
  const span = Math.abs(measurementTargetAt(m, todayIso()) - m.baseline);
  const s = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, span / 10)))));
  return [s, 2 * s, 5 * s];
}

function direction(m: Metric, at: string) {
  return Math.sign(measurementTargetAt(m, at) - m.baseline) || 1;
}

/* ---------- dialog ---------- */

function CompletionDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { tasks, goals } = useAppState();
  const task = tasks.find((t) => t.id === taskId);
  const goal = task?.goalId ? goals.find((g) => g.id === task.goalId) : undefined;
  if (!task || !goal) return null;
  return <CompletionForm task={task} goal={goal} onClose={onClose} />;
}

function CompletionForm({ task, goal, onClose }: { task: Task; goal: Goal; onClose: () => void }) {
  const { toast } = useToast();
  const today = todayIso();
  const hasMetrics = goal.metrics.length > 0;
  const [metricId, setMetricId] = useState(primaryMetric(goal)?.id ?? '');
  const [mode, setMode] = useState<Mode>(() => {
    const m = primaryMetric(goal);
    return !hasMetrics || m?.entries.some((e) => e.source?.sessionId && e.source.taskId === task.id) ? 'none' : 'change';
  });
  const [change, setChange] = useState('');
  const [total, setTotal] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  /** Set once the completion is applied locally; retries then only flush, controls freeze. */
  const [staged, setStaged] = useState(false);
  const [stagedBaseline, setStagedBaseline] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stagedRef = useRef(false);

  const metric = goal.metrics.find((m) => m.id === metricId);
  const dateOk = isMeasurementDate(date) && date <= today;
  const valueAtDate = stagedBaseline ?? (metric && dateOk ? metricValueAt(metric, date) : metric ? metricValueAt(metric, today) : 0);
  const targetNow = metric ? measurementTargetAt(metric, dateOk ? date : today) : 0;
  const dir = metric ? direction(metric, dateOk ? date : today) : 1;

  const amount = useMemo(() => {
    if (mode === 'change') return num(change);
    if (mode === 'total') {
      const t = num(total);
      return Number.isFinite(t) ? round(t - valueAtDate) : NaN;
    }
    return 0;
  }, [mode, change, total, valueAtDate]);

  const amountOk = mode === 'none' || (Number.isFinite(amount) && amount !== 0);
  const canSubmit = !pending && (staged || (amountOk && (mode === 'none' || (!!metric && dateOk))));
  const frozen = pending || staged;

  const priorCredits = useMemo(
    () =>
      goal.metrics.flatMap((m) =>
        m.entries.filter((e) => e.mode === 'contribution' && e.source?.taskId === task.id).map((e) => ({ m, e })),
      ),
    [goal.metrics, task.id],
  );

  const bump = (step: number) => {
    const base = Number.isFinite(num(change)) ? num(change) : 0;
    setChange(String(round(base + step)));
  };

  const close = () => {
    if (pending) return;
    if (stagedRef.current) {
      toast({ title: 'Finished on this device', description: 'Saving to your account is still pending. It will retry from the sync status.' });
    }
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      let spawned: string | undefined;
      if (!stagedRef.current) {
        const result =
          mode !== 'none' && metric
            ? { metricId: metric.id, amount, date, note: note.trim() || undefined }
            : undefined;
        spawned = completeTaskWithResult(task.id, result).spawned;
        setStagedBaseline(valueAtDate);
        stagedRef.current = true;
        setStaged(true);
      }
      await flushWorkspace();
      toast({
        title: spawned ? 'Done. Next one is scheduled.' : 'Task done',
        description:
          mode !== 'none' && metric
            ? `${metric.name}: ${formatDelta(amount, metric.unit)} credited to this task.${spawned ? ` Repeats ${relDay(spawned).toLowerCase()}.` : ''}`
            : spawned
              ? `Repeats on ${relDay(spawned)}.`
              : 'No measured change recorded.',
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save.';
      setError(stagedRef.current ? `Finished on this device, but not saved to your account yet. ${msg}` : msg);
    } finally {
      setPending(false);
    }
  };

  const newValue = metric && Number.isFinite(amount) ? valueAtDate + (mode === 'none' ? 0 : amount) : valueAtDate;
  const share = metric && mode !== 'none' && amountOk ? formatShare(metric, amount, date) : null;
  const unfavorable = metric && mode !== 'none' && amountOk && amount * dir < 0;

  // Slider for absolute total: from the lower of current/baseline to the target (with headroom).
  const sliderRange = metric
    ? (() => {
        const lo = Math.min(valueAtDate, targetNow, metric.baseline);
        const hi = Math.max(valueAtDate, targetNow, metric.baseline);
        const span = hi - lo || 10;
        const step = span <= 20 ? (Number.isInteger(span) ? 1 : 0.5) : Math.pow(10, Math.floor(Math.log10(span / 20)));
        return { lo, hi: hi + (span > 0 ? 0 : 10), step };
      })()
    : null;
  const totalNum = num(total);

  const submitLabel = pending
    ? 'Saving…'
    : staged
      ? 'Retry saving'
      : mode === 'none'
        ? 'Finish task'
        : 'Finish and record result';

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" data-testid="dialog-complete-task">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-normal">What changed?</DialogTitle>
            <DialogDescription>
              Record the actual result of this work, if you measured one. Nothing is estimated from effort or completion.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm" data-testid="text-complete-context">
            <div className="font-medium leading-snug" data-testid="text-complete-task-title">{task.title}</div>
            <Link
              href={`/goals/${goal.id}`}
              onClick={() => close()}
              className="mt-0.5 inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              data-testid="link-complete-goal"
            >
              <Target className="size-3.5 shrink-0" />
              <AreaDot area={goal.area} goalId={goal.id} />
              <span className="truncate">{goal.title}</span>
            </Link>
          </div>

          {!hasMetrics ? (
            <p className="rounded-lg bg-accent/60 px-3 py-2.5 text-sm text-accent-foreground" data-testid="text-complete-no-metric">
              This goal has no result measure yet, so finishing only marks the task done. Add a measure on the goal's Results tab to credit real changes to tasks later.
            </p>
          ) : (
            <>
              {priorCredits.some(({ e }) => e.source?.sessionId) && (
                <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="text-session-already-credited">
                  Time for this task has already been recorded in a work session. Finish without an additional change to keep it counted once. Only add a result here for genuinely additional work or a different outcome.
                </p>
              )}
              {goal.metrics.length > 1 && (
                <Field label="Measure">
                  <Select value={metricId} onValueChange={(v) => { setMetricId(v); setChange(''); setTotal(''); }} disabled={frozen || mode === 'none'}>
                    <SelectTrigger data-testid="select-complete-metric"><SelectValue placeholder="Choose a measure" /></SelectTrigger>
                    <SelectContent>
                      {goal.metrics.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}{m.unit ? ` (${m.unit})` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {metric && (
                <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3" data-testid="text-complete-metric">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{metric.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {isRecurring(metric) ? `Target ${frequencyNoun(metric.frequency)}` : 'Running total'}
                      {dir < 0 ? ' · lower is better' : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-num text-sm">
                    <span data-testid="text-complete-current">{formatValue(valueAtDate, metric.unit)}</span>
                    <span className="text-muted-foreground"> / {formatValue(targetNow, metric.unit)}</span>
                  </div>
                </div>
              )}

              {priorCredits.length > 0 && (
                <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground" data-testid="text-complete-prior-credits">
                  Already credited to this task:{' '}
                  {priorCredits.map(({ m, e }, i) => (
                    <span key={e.id} className="font-num text-foreground">
                      {i > 0 && ', '}
                      {formatDelta(e.value, m.unit)} {goal.metrics.length > 1 ? m.name : ''} ({relDay(e.date).toLowerCase()})
                    </span>
                  ))}
                  . Enter only an additional result that has not already been recorded.
                </div>
              )}

              <div role="radiogroup" aria-label="How to record the result" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                {([
                  ['change', 'Change'],
                  ['total', 'New total'],
                  ['none', 'No change'],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={mode === k}
                    disabled={frozen}
                    onClick={() => setMode(k)}
                    className={cn(
                      'h-10 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:h-9',
                      mode === k ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                    data-testid={`mode-complete-${k}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {mode === 'change' && metric && (
                <Field label={`Measured change${metric.unit ? ` (${metric.unit})` : ''}`} htmlFor="complete-change" hint={dir < 0 ? 'Lower is better here: a reduction is entered as a negative number.' : undefined}>
                  <div className="flex items-center gap-1.5">
                    <Button type="button" variant="outline" size="icon" className="size-10 shrink-0" disabled={frozen} onClick={() => bump(-quickSteps(metric)[0])} aria-label="Decrease" data-testid="button-complete-decrease">
                      <Minus />
                    </Button>
                    <Input
                      id="complete-change"
                      inputMode="decimal"
                      value={change}
                      disabled={frozen}
                      onChange={(e) => setChange(e.target.value)}
                      placeholder={dir < 0 ? `-${quickSteps(metric)[0]}` : String(quickSteps(metric)[0])}
                      className="h-10 text-center font-num"
                      data-testid="input-complete-change"
                      autoFocus
                    />
                    <Button type="button" variant="outline" size="icon" className="size-10 shrink-0" disabled={frozen} onClick={() => bump(quickSteps(metric)[0])} aria-label="Increase" data-testid="button-complete-increase">
                      <Plus />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {quickSteps(metric).map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={frozen}
                        onClick={() => bump(s * dir)}
                        className="h-9 rounded-full border border-border px-3 font-num text-xs hover:bg-muted disabled:opacity-60"
                        data-testid={`button-complete-quick-${s}`}
                      >
                        {formatDelta(s * dir, metric.unit)}
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              {mode === 'total' && metric && sliderRange && (
                <Field
                  label={`New ${isRecurring(metric) ? 'period total' : 'total'}${metric.unit ? ` (${metric.unit})` : ''}`}
                  htmlFor="complete-total"
                  hint={`Measured at ${formatValue(valueAtDate, metric.unit)} on ${relDay(dateOk ? date : today).toLowerCase()}; only the difference is credited to this task.`}
                >
                  <Input
                    id="complete-total"
                    inputMode="decimal"
                    value={total}
                    disabled={frozen}
                    onChange={(e) => setTotal(e.target.value)}
                    placeholder={String(valueAtDate)}
                    className="h-10 font-num"
                    data-testid="input-complete-total"
                    autoFocus
                  />
                  {sliderRange.hi > sliderRange.lo && (
                    <div className="pt-2">
                      <Slider
                        min={sliderRange.lo}
                        max={sliderRange.hi}
                        step={sliderRange.step}
                        value={[Number.isFinite(totalNum) ? Math.min(sliderRange.hi, Math.max(sliderRange.lo, totalNum)) : valueAtDate]}
                        onValueChange={([v]) => setTotal(String(round(v)))}
                        disabled={frozen}
                        aria-label={`New total in ${metric.unit || 'units'}`}
                        data-testid="slider-complete-total"
                      />
                      <div className="mt-1.5 flex justify-between font-num text-[11px] text-muted-foreground">
                        <span>{formatValue(sliderRange.lo, metric.unit)}</span>
                        <span>target {formatValue(targetNow, metric.unit)}</span>
                        <span>{formatValue(sliderRange.hi, metric.unit)}</span>
                      </div>
                    </div>
                  )}
                </Field>
              )}

              {mode === 'none' && (
                <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground" data-testid="text-complete-none">
                  <CircleSlash className="mr-1.5 inline size-4 align-[-3px]" />
                  The task is marked done and the goal's numbers stay as they are. Useful for preparation work with no measurable result yet.
                </p>
              )}

              {mode !== 'none' && metric && (
                <div className={cn('flex items-center justify-between gap-2 rounded-lg px-3 py-2.5', unfavorable ? 'bg-destructive/10' : 'bg-accent/60')} aria-live="polite" data-testid="text-complete-preview">
                  <span className="flex items-center gap-2 font-num text-sm">
                    {formatValue(valueAtDate, metric.unit)}
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                    <span className="font-medium">{amountOk ? formatValue(newValue, metric.unit) : '—'}</span>
                  </span>
                  <span className="text-right text-xs text-muted-foreground">
                    {amountOk ? (
                      <>
                        <span className="font-num text-foreground">{formatDelta(amount, metric.unit)}</span>
                        {share ? ` · ${share}` : ''}
                        {unfavorable ? ' · moves away from target' : ''}
                      </>
                    ) : mode === 'total' && Number.isFinite(totalNum) ? (
                      'Same as current: nothing to credit'
                    ) : (
                      'Enter a number'
                    )}
                  </span>
                </div>
              )}

              {mode !== 'none' && (
                <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                  <Field label="When the work happened" htmlFor="complete-date">
                    <Input id="complete-date" type="date" max={today} value={date} disabled={frozen} onChange={(e) => setDate(e.target.value)} className="h-10 font-num" data-testid="input-complete-date" />
                  </Field>
                  <Field label="Note (optional)" htmlFor="complete-note">
                    <Textarea id="complete-note" rows={1} value={note} disabled={frozen} onChange={(e) => setNote(e.target.value)} placeholder="How you measured it" className="min-h-10" data-testid="input-complete-note" />
                  </Field>
                </div>
              )}
              {mode !== 'none' && !dateOk && <p className="text-xs text-destructive" data-testid="text-complete-date-error">Choose today or an earlier date.</p>}
              {mode !== 'none' && metric && dateOk && <PeriodCreditHint metric={metric} date={date} />}
            </>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="text-complete-error">
              {error}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={pending} data-testid="button-complete-cancel">
              {staged ? 'Close' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="button-complete-submit">
              {staged ? <RotateCcw /> : <Check />} {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
