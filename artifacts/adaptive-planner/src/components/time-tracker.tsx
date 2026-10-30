import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Pause, Play, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { formatElapsed, splitTimerDays, timeTrackingDate, timerElapsedSeconds, type ActiveWorkTimer } from '@workspace/api-zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field, FormDialog } from '@/components/form-dialog';
import { AreaDot } from '@/components/primitives';
import { DurationInput } from '@/components/duration-input';
import { EffectNote, GoalSelect, MeasureSelect, NONE, timeMetrics } from '@/components/work-sessions';
import { useToast } from '@/hooks/use-toast';
import { fmt } from '@/lib/dates';
import { discardWorkTimer, pauseWorkTimer, resumeWorkTimer, saveWorkTimer, startWorkTimer } from '@/lib/store/time-tracking';
import { formatMinutes } from '@/lib/reports';
import { useAppState } from '@/lib/store/store';
import { flushWorkspace } from '@/lib/workspace-sync';
import { cn } from '@/lib/utils';

export const LONG_SECONDS = 8 * 3600;
const MAX_DAY_SECONDS = 1500 * 60;
const msg = (err: unknown) => (err instanceof Error ? err.message : 'Please try again.');

export type StartRequest = { goalId?: string; taskId?: string; sessionId?: string; title?: string };

/** Ticks once a second while a timer runs. */
export function useElapsed(timer?: ActiveWorkTimer) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer || timer.status !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer?.status, timer?.id]);
  return timer ? timerElapsedSeconds(timer, now) : 0;
}

/**
 * Apply a local mutation exactly once, then flush. Retries only flush again,
 * so a failed save never duplicates the mutation.
 */
export function useStagedAction() {
  const [pending, setPending] = useState(false);
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState('');
  const applied = useRef(false);
  const run = async (apply: () => void, done: () => void) => {
    if (pending) return;
    setPending(true); setError('');
    try {
      if (!applied.current) { apply(); applied.current = true; setStaged(true); }
      await flushWorkspace();
      applied.current = false; setStaged(false);
      done();
    } catch (err) {
      setError(`${applied.current ? 'Changed on this device, but not saved to your account yet. ' : ''}${msg(err)}`);
    } finally { setPending(false); }
  };
  return { pending, staged, error, frozen: pending || staged, run, reset: () => { applied.current = false; setStaged(false); setError(''); } };
}

/* ---------- Global compact bar ---------- */
export function TimerBar({ onFinish, onDiscard, finishError, finishPending }: { onFinish: () => void; onDiscard: () => void; finishError?: string; finishPending?: boolean }) {
  const state = useAppState();
  const timer = state.activeTimer;
  const elapsed = useElapsed(timer);
  const action = useStagedAction();
  if (!timer) return null;
  const goal = state.goals.find((g) => g.id === timer.goalId);
  const running = timer.status === 'running';
  const toggle = () => void action.run(() => (running ? pauseWorkTimer() : resumeWorkTimer()), () => undefined);
  return (
    <div className="sticky top-16 z-20 border-b border-primary/25 bg-[hsl(var(--background)/0.97)] px-3 py-2 sm:px-5 md:top-0" data-testid="bar-active-timer" role="region" aria-label="Active timer">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={cn('size-2.5 shrink-0 rounded-full', running ? 'animate-pulse bg-primary' : 'bg-muted-foreground/50')} aria-hidden />
        <span className="font-num text-lg tabular-nums leading-none" data-testid="text-timer-elapsed">{formatElapsed(elapsed)}</span>
        <div className="min-w-0 flex-1 basis-40">
          <div className="truncate text-sm" data-testid="text-timer-title">{timer.title}</div>
          <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {goal && <><AreaDot area={goal.area} /> <span className="truncate">{goal.title}</span> · </>}
            <span data-testid="status-timer">{running ? 'Running, keeps counting in the background until paused' : 'Paused'}</span>
          </div>
        </div>
        {elapsed >= LONG_SECONDS && <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" data-testid="text-timer-long"><AlertTriangle className="size-3.5" /> Over 8h, check before saving</span>}
        <div className="flex shrink-0 items-center gap-1">
          {action.staged ? (
            <Button size="sm" variant="outline" className="h-9" disabled={action.pending} onClick={() => void action.run(() => undefined, () => undefined)} data-testid="button-timer-retry">
              <RotateCcw /> {action.pending ? 'Saving…' : 'Retry save'}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-9" disabled={action.pending} onClick={toggle} data-testid="button-timer-toggle">
              {running ? <><Pause /> Pause</> : <><Play /> Resume</>}
            </Button>
          )}
          <Button size="sm" className="h-9" disabled={action.frozen || finishPending} onClick={onFinish} data-testid="button-timer-finish"><Square /> {finishPending ? 'Pausing…' : finishError ? 'Retry finish' : 'Finish'}</Button>
          <Button size="icon" variant="ghost" className="size-9 text-muted-foreground" disabled={action.frozen} aria-label="Discard timer" onClick={onDiscard} data-testid="button-timer-discard"><Trash2 /></Button>
        </div>
      </div>
      {action.pending && !action.staged && <p className="mx-auto max-w-6xl text-xs text-muted-foreground" data-testid="text-timer-saving">Waiting for your account to save…</p>}
      {action.error && <p role="alert" className="mx-auto max-w-6xl text-xs text-destructive" data-testid="text-timer-error">{action.error}</p>}
      {finishError && <p role="alert" className="mx-auto max-w-6xl text-xs text-destructive" data-testid="text-timer-finish-error">{finishError}</p>}
    </div>
  );
}

/* ---------- Start ---------- */
export function StartTimerDialog({ req, onClose, onFinish }: { req: StartRequest; onClose: () => void; onFinish: () => void }) {
  const state = useAppState();
  const { toast } = useToast();
  const existing = state.activeTimer;
  const elapsed = useElapsed(existing);
  const session = req.sessionId ? state.sessions?.find((s) => s.id === req.sessionId) : undefined;
  const task = req.taskId ? state.tasks.find((t) => t.id === req.taskId) : undefined;
  const initGoal = session?.goalId ?? req.goalId ?? task?.goalId ?? '';
  const [gid, setGid] = useState(initGoal);
  const goal = state.goals.find((g) => g.id === gid);
  const goals = state.goals.filter((g) => g.status === 'active' || g.status === 'paused' || g.id === initGoal);
  const [title, setTitle] = useState(req.title ?? session?.title ?? task?.title ?? '');
  const [metricId, setMetricId] = useState(session ? session.metricId ?? NONE : '');
  const action = useStagedAction();
  const hasMetrics = timeMetrics(goal).length > 0;
  const metricChosen = !hasMetrics || !!metricId;
  const valid = !!goal && !!title.trim() && metricChosen;

  if (existing && !action.staged && !action.pending) {
    return (
      <FormDialog open onOpenChange={(o) => { if (!o) onClose(); }} title="A timer is already going"
        description="You can only run one timer at a time on your account. Finish or discard it first, nothing is lost."
        submitLabel="Review and finish it" canSubmit onSubmit={() => { onClose(); onFinish(); }}>
        <div className="rounded-lg border border-border p-3" data-testid="card-existing-timer">
          <div className="font-num text-2xl tabular-nums">{formatElapsed(elapsed)}</div>
          <div className="text-sm">{existing.title}</div>
          <div className="text-xs text-muted-foreground">{existing.status === 'running' ? 'Running' : 'Paused'} · started {fmt(existing.createdAt.slice(0, 10), 'MMM d')}</div>
        </div>
      </FormDialog>
    );
  }

  const start = () => void action.run(() => {
    startWorkTimer({ title: title.trim(), goalId: gid, metricId: metricId && metricId !== NONE ? metricId : undefined, taskId: task && task.goalId === gid ? task.id : undefined, sessionId: session?.id });
  }, () => { toast({ title: 'Timer started', description: 'It keeps running in the background, even if you close this tab, until you pause or finish.' }); onClose(); });

  return (
    <FormDialog open onOpenChange={(o) => { if (!o && !action.pending) onClose(); }} title={session ? `Start timer: ${session.title}` : 'Start a timer'}
      description="The timer keeps counting in the background until you pause it. Nothing is credited until you finish and review."
      submitLabel={action.pending ? 'Starting…' : action.staged ? 'Retry saving' : 'Start timer'} canSubmit={!action.pending && (action.staged || valid)} onSubmit={start}>
      {!session && <GoalSelect goals={goals} value={gid} onChange={(v) => { setGid(v); setMetricId(''); }} disabled={action.frozen} />}
      <Field label="What are you working on?" htmlFor="timer-title">
        <Input id="timer-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} disabled={action.frozen || !!session} data-testid="input-timer-title" />
      </Field>
      {task && task.goalId === gid && <p className="text-xs text-muted-foreground" data-testid="text-timer-task">Linked to task "{task.title}". On finish, its time is allocated to this task by default. The task is not completed.</p>}
      {goal && (session ? (
        <EffectNote goal={goal} metricId={metricId || NONE} minutes={0} planned testId="text-timer-effect" />
      ) : hasMetrics ? (
        <MeasureSelect goal={goal} value={metricId} onChange={setMetricId} disabled={action.frozen} testId="select-timer-metric" placeholder="Choose where the time counts" />
      ) : <p className="text-xs text-muted-foreground">This goal has no hours or minutes measure, so the time is recorded only.</p>)}
      {action.error && <p role="alert" className="text-sm text-destructive" data-testid="text-timer-start-error">{action.error}</p>}
    </FormDialog>
  );
}

/* ---------- Discard ---------- */
export function DiscardTimerDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const { toast } = useToast();
  const timer = useRef(state.activeTimer).current;
  const elapsed = useElapsed(timer);
  const action = useStagedAction();
  return (
    <FormDialog open onOpenChange={(o) => { if (!o && !action.pending) onClose(); }} title="Discard this timer?"
      submitLabel={action.pending ? 'Discarding…' : action.staged ? 'Retry saving' : 'Discard timer'} canSubmit={!action.pending && !!timer}
      onSubmit={() => void action.run(() => discardWorkTimer(), () => { toast({ title: 'Timer discarded', description: 'No time was recorded.' }); onClose(); })}>
      <p className="text-sm text-muted-foreground" data-testid="text-discard-timer">"{timer?.title}" ({formatElapsed(elapsed)}) will be thrown away. No time or measure credit is recorded.</p>
      {action.error && <p role="alert" className="text-sm text-destructive">{action.error}</p>}
    </FormDialog>
  );
}

/* ---------- Finish review ---------- */
type Alloc = { key: string; taskId: string; seconds: number };
type DayRow = { key: string; date: string; seconds: number; allocs: Alloc[]; open: boolean };

export function FinishTimerDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const { toast } = useToast();
  const [timer] = useState(() => state.activeTimer);
  const [init] = useState(() => {
    if (!timer) return { days: [] as { date: string; seconds: number }[], err: '' };
    try { return { days: splitTimerDays(timer), err: '' }; }
    catch (e) { return { days: [] as { date: string; seconds: number }[], err: e instanceof Error ? e.message : 'The timer interval could not be split into days.' }; }
  });
  const maxDate = timer ? timeTrackingDate(timer.timezone) : '';
  const fallback = !!init.err;
  const [rows, setRows] = useState<DayRow[]>(() => {
    const base = fallback ? [{ date: maxDate, seconds: 0 }] : init.days;
    return base.map((d, i) => ({ key: `d${i}`, date: d.date, seconds: d.seconds, open: false,
      allocs: timer?.taskId ? [{ key: 'a0', taskId: timer.taskId, seconds: d.seconds }] : [] }));
  });
  const [gid, setGid] = useState(timer?.goalId ?? '');
  const [title, setTitle] = useState(timer?.title ?? '');
  const [metricId, setMetricId] = useState(timer?.metricId ?? NONE);
  const [notes, setNotes] = useState('');
  const [confirmLong, setConfirmLong] = useState(false);
  const action = useStagedAction();
  const goal = state.goals.find((g) => g.id === gid);
  const goals = state.goals.filter((g) => g.status === 'active' || g.status === 'paused' || g.id === timer?.goalId);
  const tasks = state.tasks.filter((t) => t.goalId === gid && !t.archived && (t.status === 'open' || rows.some((r) => r.allocs.some((a) => a.taskId === t.id))));
  const taskTitle = (id: string) => tasks.find((t) => t.id === id)?.title ?? 'Removed task';
  const total = rows.reduce((a, r) => a + r.seconds, 0);
  const long = total >= LONG_SECONDS;
  const sumOf = (r: DayRow) => r.allocs.reduce((a, x) => a + x.seconds, 0);
  const rowsOk = rows.every((r) => r.seconds >= 0 && r.seconds <= MAX_DAY_SECONDS && sumOf(r) <= r.seconds && r.allocs.every((a) => a.seconds > 0) && !!r.date && r.date <= maxDate);
  const valid = !!timer && !!goal && !!title.trim() && total > 0 && rowsOk && (!long || confirmLong);
  const patch = (key: string, f: (r: DayRow) => DayRow) => setRows((s) => s.map((r) => (r.key === key ? f(r) : r)));

  if (!timer) {
    return (
      <FormDialog open onOpenChange={(o) => { if (!o) onClose(); }} title="No timer to finish" submitLabel="Close" canSubmit onSubmit={onClose}>
        <p className="text-sm text-muted-foreground">The timer was already saved or discarded, maybe on another device.</p>
      </FormDialog>
    );
  }

  const save = () => void action.run(() => {
    saveWorkTimer(timer.id, {
      title: title.trim(), goalId: gid, metricId: metricId === NONE ? undefined : metricId, notes,
      days: rows.filter((r) => r.seconds > 0).map((r) => ({ date: r.date, actualMinutes: r.seconds / 60,
        allocations: r.allocs.filter((a) => tasks.some((t) => t.id === a.taskId)).map((a) => ({ taskId: a.taskId, minutes: a.seconds / 60 })) })),
    });
  }, () => { toast({ title: 'Time recorded', description: `${formatMinutes(total / 60)} saved${rows.length > 1 ? ` across ${rows.length} days` : ''}.` }); onClose(); });

  return (
    <FormDialog open wide onOpenChange={(o) => { if (!o && !action.pending) onClose(); }} title="Review timed work"
      description="The timer is paused. Adjust anything before saving. Closing keeps it paused so you can resume later."
      submitLabel={action.pending ? 'Saving…' : action.staged ? 'Retry saving' : 'Save time'} canSubmit={!action.pending && (action.staged || valid)} onSubmit={save}>
      {fallback && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="text-finish-split-error">
          {init.err} Enter the actual time you worked below, or discard the timer.
        </p>
      )}
      <Field label="Description" htmlFor="finish-title">
        <Input id="finish-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={action.frozen} data-testid="input-finish-title" />
      </Field>
      <GoalSelect goals={goals} value={gid} onChange={(v) => { setGid(v); setMetricId(NONE); setRows((s) => s.map((r) => ({ ...r, allocs: [] }))); }} disabled={action.frozen} />
      {goal && <MeasureSelect goal={goal} value={metricId} onChange={setMetricId} disabled={action.frozen} testId="select-finish-metric" />}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-sm"><span className="font-medium">Time by day</span><span className="font-num text-xs text-muted-foreground" data-testid="text-finish-total">{formatElapsed(total)} total</span></div>
        <ul className="space-y-2" data-testid="list-finish-days">
          {rows.map((r, i) => {
            const used = sumOf(r);
            const free = r.seconds - used;
            const avail = tasks.filter((t) => t.status === 'open' && !r.allocs.some((a) => a.taskId === t.id));
            return (
              <li key={r.key} className="space-y-2 rounded-lg border border-border/80 p-2" data-testid={`row-finish-day-${i}`}>
                <div className="grid gap-2 sm:grid-cols-[9rem_1fr] sm:items-center">
                  {fallback ? (
                    <Input type="date" max={maxDate} value={r.date} disabled={action.frozen} onChange={(e) => patch(r.key, (x) => ({ ...x, date: e.target.value }))} className="h-10 font-num" data-testid={`input-finish-date-${i}`} />
                  ) : <span className="font-num text-sm">{fmt(r.date, 'EEE MMM d')}</span>}
                  <DurationInput seconds={r.seconds} showSeconds disabled={action.frozen} label={`Time on ${r.date}`} testId={`finish-day-${i}`}
                    onChange={(sec) => patch(r.key, (x) => ({ ...x, seconds: sec,
                      // keep the default "whole day to linked task" in step with the day total
                      allocs: x.allocs.length === 1 && x.allocs[0].seconds === x.seconds && !x.open ? [{ ...x.allocs[0], seconds: sec }] : x.allocs }))} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span data-testid={`text-finish-alloc-summary-${i}`}>
                    {r.allocs.length === 0 ? 'All goal time, no task' : r.allocs.map((a) => `${taskTitle(a.taskId)} ${formatElapsed(a.seconds)}`).join(' · ')}
                    {r.allocs.length > 0 && free > 0 && ` · ${formatElapsed(free)} general`}
                  </span>
                  {goal && <button type="button" className="underline-offset-2 hover:underline" disabled={action.frozen} onClick={() => patch(r.key, (x) => ({ ...x, open: !x.open }))} data-testid={`button-finish-split-${i}`}>{r.open ? 'Done splitting' : 'Split across tasks'}</button>}
                </div>
                {r.open && (
                  <div className="space-y-1.5 border-t border-border/60 pt-2">
                    {r.allocs.map((a) => (
                      <div key={a.key} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 basis-32 truncate text-sm">{taskTitle(a.taskId)}</span>
                        <DurationInput className="w-48 shrink-0" seconds={a.seconds} disabled={action.frozen} label={`Time for ${taskTitle(a.taskId)}`} testId={`finish-alloc-${i}-${a.key}`}
                          onChange={(sec) => patch(r.key, (x) => ({ ...x, allocs: x.allocs.map((y) => (y.key === a.key ? { ...y, seconds: sec } : y)) }))} />
                        <Button type="button" variant="ghost" size="icon" className="size-9" disabled={action.frozen} aria-label={`Remove ${taskTitle(a.taskId)}`}
                          onClick={() => patch(r.key, (x) => ({ ...x, allocs: x.allocs.filter((y) => y.key !== a.key) }))} data-testid={`button-finish-remove-alloc-${i}-${a.key}`}><X /></Button>
                      </div>
                    ))}
                    <Select value="" onValueChange={(v) => patch(r.key, (x) => ({ ...x, allocs: [...x.allocs, { key: `a${Date.now()}`, taskId: v, seconds: Math.max(0, free) }] }))} disabled={action.frozen || !avail.length}>
                      <SelectTrigger className="h-10" data-testid={`select-finish-add-task-${i}`}><SelectValue placeholder={avail.length ? 'Add a task' : 'No other open tasks'} /></SelectTrigger>
                      <SelectContent>{avail.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}</SelectContent>
                    </Select>
                    <p className={cn('font-num text-xs', free < 0 ? 'text-destructive' : 'text-muted-foreground')}>{free < 0 ? `${formatElapsed(-free)} more than the day` : `${formatElapsed(free)} stays general goal time`}</p>
                  </div>
                )}
                {r.seconds > MAX_DAY_SECONDS && <p className="text-xs text-destructive">One day can hold at most 25 hours.</p>}
                {r.allocs.some((a) => a.seconds <= 0) && <p className="text-xs text-destructive">Give each task some time or remove it.</p>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">Allocating never completes a task. Dates use the timer's time zone ({timer.timezone}).</p>
      </div>
      <Field label="Notes" htmlFor="finish-notes">
        <Textarea id="finish-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={action.frozen} data-testid="input-finish-notes" />
      </Field>
      {long && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="warning-finish-long">
          <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={confirmLong} disabled={action.frozen} onChange={(e) => setConfirmLong(e.target.checked)} data-testid="checkbox-confirm-long" />
          <span>This is over 8 hours. If the timer ran while you were away, lower the days above. Nothing is deducted automatically. <b className="font-medium">I checked these times.</b></span>
        </label>
      )}
      {goal && <EffectNote goal={goal} metricId={metricId} minutes={total / 60} testId="text-finish-effect" />}
      {action.error && <p role="alert" className="text-sm text-destructive" data-testid="text-finish-error">{action.error}</p>}
      {action.staged && <p className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" /> Saved on this device, waiting for your account.</p>}
    </FormDialog>
  );
}
