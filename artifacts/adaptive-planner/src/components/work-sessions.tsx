import { useMemo, useRef, useState } from 'react';
import { Check, Clock3, CornerDownRight, Hourglass, Pencil, Play, Plus, Repeat, Timer, Trash2, X } from 'lucide-react';
import { manualTimeDays, timeUnitMinutes, sessionWorkDone } from '@workspace/api-zod';
import { WorkDoneField, WorkDonePreview, cleanWorkDone } from '@/components/work-done-editor';
import { DurationInput } from '@/components/duration-input';
import { formatMinutes } from '@/lib/reports';
import { useWorkSessionActions } from '@/components/work-session-provider';
import { editLoggedWorkSession, recordManualWork } from '@/lib/store/time-tracking';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field, FormDialog } from '@/components/form-dialog';
import { AreaDot, EmptyState } from '@/components/primitives';
import { useToast } from '@/hooks/use-toast';
import { fmt, relDay, todayIso } from '@/lib/dates';
import { convertTaskToWorkSession, deleteWorkSession, logWorkSession, recordUnplannedSession, saveWorkSession } from '@/lib/store/sessions';
import { effortLabel, formatValue } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';
import type { Goal, Metric, MetricEntry, Recurrence, Task, WorkSession } from '@/lib/store/types';
import { flushWorkspace } from '@/lib/workspace-sync';
import { cn } from '@/lib/utils';
import { SessionOutcomeChoice, outcomeReady, type SessionOutcome } from '@/components/session-outcome';

export const NONE = '__time_only__';
const errText = (applied: boolean, err: unknown) =>
  `${applied ? 'Changed on this device, but not saved to your account yet. ' : ''}${err instanceof Error ? err.message : 'Please try saving again.'}`;
const mins = formatMinutes;

export function timeMetrics(goal?: Goal): Metric[] {
  return goal ? goal.metrics.filter((m) => !!timeUnitMinutes(m.unit)) : [];
}

/** Shows exactly what saving will do to the chosen measure. */
export function EffectNote({ goal, metricId, minutes, planned, testId }: { goal?: Goal; metricId: string; minutes: number; planned?: boolean; testId: string }) {
  const metric = timeMetrics(goal).find((m) => m.id === metricId);
  const div = metric ? timeUnitMinutes(metric.unit)! : 1;
  return (
    <p className="rounded-lg border border-border/80 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground" data-testid={testId}>
      {planned ? (
        <>Planning reserves time on your calendar only. It never adds progress. {metric ? <>When you record actual time, it will count toward <span className="text-foreground">{metric.name}</span> ({metric.unit}).</> : <>Time-only: no measure will change when you log it.</>}</>
      ) : metric ? (
        <>Saving credits <span className="font-num text-foreground">{formatValue(minutes / div, metric.unit)}</span> to <span className="text-foreground">{metric.name}</span>, once. Editing later corrects this credit instead of adding another.</>
      ) : (
        <>Time-only: this records how long you worked. No measure changes.</>
      )}
    </p>
  );
}

export function MeasureSelect({ goal, value, onChange, disabled, testId, placeholder }: { goal?: Goal; value: string; onChange: (v: string) => void; disabled?: boolean; testId: string; placeholder?: string }) {
  const list = timeMetrics(goal);
  return (
    <Field label="Counts toward" hint={list.length ? 'Only hours or minutes measures can receive session time.' : 'This goal has no hours or minutes measure, so sessions are time-only.'}>
      <Select value={value} onValueChange={onChange} disabled={disabled || !list.length}>
        <SelectTrigger data-testid={testId}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Time only, no measure</SelectItem>
          {list.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function GoalSelect({ goals, value, onChange, disabled }: { goals: Goal[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Field label="Goal">
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger data-testid="select-session-goal"><SelectValue placeholder="Choose a goal" /></SelectTrigger>
        <SelectContent>
          {goals.map((g) => <SelectItem key={g.id} value={g.id}><span className="inline-flex items-center gap-2"><AreaDot area={g.area} /> {g.title}</span></SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

/* ---------- Plan / edit planned session ---------- */
export function PlanSessionDialog({ session, goalId, date, onClose }: { session?: WorkSession; goalId?: string; date?: string; onClose: () => void }) {
  const state = useAppState();
  const { toast } = useToast();
  const goals = state.goals.filter((g) => g.status === 'active' || g.status === 'paused' || g.id === (session?.goalId ?? goalId));
  const [gid, setGid] = useState(session?.goalId ?? goalId ?? '');
  const goal = state.goals.find((g) => g.id === gid);
  const [title, setTitle] = useState(session?.title ?? '');
  const [metricId, setMetricId] = useState(session?.metricId ?? (session ? NONE : timeMetrics(goal)[0]?.id ?? NONE));
  const [plannedDate, setPlannedDate] = useState(session ? session.plannedDate ?? '' : date ?? todayIso());
  const [minutes, setMinutes] = useState(String(session?.plannedMinutes ?? 60));
  const [recurrence, setRecurrence] = useState<Recurrence>((session?.recurrence as Recurrence) ?? 'none');
  const [taskIds, setTaskIds] = useState<string[]>(session?.taskIds ?? []);
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [pending, setPending] = useState(false);
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState('');
  const applied = useRef(false);
  const frozen = pending || staged;
  const goalTasks = state.tasks.filter((t) => t.goalId === gid && !t.archived && (t.status === 'open' || taskIds.includes(t.id)));
  const n = Number(minutes);
  const valid = !!goal && !!title.trim() && Number.isFinite(n) && n >= 0 && n <= 1440 && (recurrence === 'none' || !!plannedDate);

  const save = async () => {
    if (pending) return;
    setPending(true); setError('');
    try {
      if (!applied.current) {
        saveWorkSession({ title, goalId: gid, metricId: metricId === NONE ? undefined : metricId, plannedDate: plannedDate || undefined,
          plannedMinutes: n, recurrence, taskIds: taskIds.filter((id) => goalTasks.some((t) => t.id === id)), notes }, session?.id);
        applied.current = true; setStaged(true);
      }
      await flushWorkspace();
      toast({ title: session ? 'Session updated' : 'Session planned', description: `${mins(n)} reserved${plannedDate ? ` for ${relDay(plannedDate).toLowerCase()}` : ''}. No progress is added until you record actual time.` });
      onClose();
    } catch (err) { setError(errText(applied.current, err)); } finally { setPending(false); }
  };

  return (
    <FormDialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }} title={session ? 'Edit planned session' : 'Plan a work session'}
      description="Reserve a block of time for a goal. This is a plan, separate from completing tasks."
      submitLabel={pending ? 'Saving…' : staged ? 'Retry saving' : session ? 'Save session' : 'Plan session'} canSubmit={!pending && (staged || valid)} onSubmit={() => void save()}>
      {!goalId && <GoalSelect goals={goals} value={gid} onChange={(v) => { setGid(v); setTaskIds([]); setMetricId(timeMetrics(state.goals.find((g) => g.id === v))[0]?.id ?? NONE); }} disabled={frozen || !!session} />}
      <Field label="Title" htmlFor="session-title">
        <Input id="session-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} disabled={frozen} placeholder="e.g. Deep work on chapter three" data-testid="input-session-title" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Planned date" htmlFor="session-date" hint="Leave empty to keep it unscheduled.">
          <Input id="session-date" type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} disabled={frozen} className="font-num" data-testid="input-session-date" />
        </Field>
        <Field label="Reserved minutes" htmlFor="session-minutes" hint={n > 0 ? mins(n) : undefined}>
          <Input id="session-minutes" type="number" min={0} max={1440} step="any" value={minutes} onChange={(e) => setMinutes(e.target.value)} disabled={frozen} className="font-num" data-testid="input-session-minutes" />
        </Field>
      </div>
      <Field label="Repeat" hint={recurrence !== 'none' ? 'The next session is created when you log this one. Task picks do not repeat.' : undefined}>
        <Select value={recurrence} onValueChange={(v) => setRecurrence(v as Recurrence)} disabled={frozen}>
          <SelectTrigger data-testid="select-session-recurrence"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Does not repeat</SelectItem>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {goal && <MeasureSelect goal={goal} value={metricId} onChange={setMetricId} disabled={frozen} testId="select-session-metric" />}
      {goal && (
        <Field label="Tasks inside this time (optional)" hint="Their estimates are covered by this reservation, so capacity counts the time once.">
          {goalTasks.length === 0 ? <p className="text-xs text-muted-foreground">No open tasks on this goal.</p> : (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1" data-testid="list-session-tasks">
              {goalTasks.map((t) => (
                <li key={t.id}>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-muted">
                    <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={taskIds.includes(t.id)} disabled={frozen}
                      onChange={(e) => setTaskIds((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))} data-testid={`checkbox-session-task-${t.id}`} />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.effort > 0 && <span className="font-num text-xs text-muted-foreground">{effortLabel(t.effort)}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Field>
      )}
      <Field label="Notes" htmlFor="session-notes">
        <Textarea id="session-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={frozen} data-testid="input-session-notes" />
      </Field>
      {goal && <EffectNote goal={goal} metricId={metricId} minutes={0} planned testId="text-session-plan-effect" />}
      {error && <p role="alert" className="text-sm text-destructive" data-testid="text-session-error">{error}</p>}
    </FormDialog>
  );
}

/* ---------- Add / log actual time (planned, unplanned, range, or full correction) ---------- */
type Row = { key: string; taskId?: string; newTitle?: string; seconds: number };
const MAX_SECONDS = 1500 * 60;
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const hms = (sec: number) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
};

export function LogSessionDialog({ session, goalId, date, onClose }: { session?: WorkSession; goalId?: string; date?: string; onClose: () => void }) {
  const state = useAppState();
  const { toast } = useToast();
  const today = todayIso();
  const isNew = !session;
  const isCorrection = session?.status === 'logged';
  const editable = isNew || isCorrection;
  const goals = state.goals.filter((g) => g.status === 'active' || g.status === 'paused' || g.id === (session?.goalId ?? goalId));
  const [gid, setGid] = useState(session?.goalId ?? goalId ?? '');
  const goal = state.goals.find((g) => g.id === gid);
  const [title, setTitle] = useState(session?.title ?? '');
  const [metricId, setMetricId] = useState(session ? session.metricId ?? NONE : timeMetrics(goal)[0]?.id ?? NONE);
  const [mode, setMode] = useState<'duration' | 'range'>('duration');
  const [day, setDay] = useState(session?.date ?? (session?.plannedDate && session.plannedDate <= today ? session.plannedDate : date && date <= today ? date : today));
  const [seconds, setSeconds] = useState(() => Math.round((session?.actualMinutes ?? session?.plannedMinutes ?? 0) * 60));
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [zone] = useState(deviceZone);
  const [linkTask, setLinkTask] = useState(NONE);
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [rows, setRows] = useState<Row[]>(() => session?.allocations.length
    ? session.allocations.map((a) => ({ key: a.taskId, taskId: a.taskId, seconds: Math.round(a.minutes * 60) }))
    : (session?.taskIds ?? []).map((id) => ({ key: id, taskId: id, seconds: 0 })));
  const [newTitle, setNewTitle] = useState('');
  const [single, setSingle] = useState<string[]>(() => session?.workDone ?? []);
  const [byDate, setByDate] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<SessionOutcome | ''>('');
  const [remainingDate, setRemainingDate] = useState(today);
  const sessionId = useRef<string | undefined>(session?.id);
  const logged = useRef(false);
  const frozen = pending || staged;

  const goalTasks = useMemo(() => state.tasks.filter((t) => t.goalId === gid && !t.archived), [state.tasks, gid]);
  // Snapshot rows for deleted tasks stay editable as long as the goal is unchanged.
  const titleOf = (r: Row) => r.newTitle ?? goalTasks.find((t) => t.id === r.taskId)?.title ?? (gid === session?.goalId ? session?.allocations.find((a) => a.taskId === r.taskId)?.taskTitle : undefined) ?? 'Removed task';
  const available = goalTasks.filter((t) => t.status === 'open' && !rows.some((r) => r.taskId === t.id));
  const addRow = (r: Row) => setRows((s) => [...s, r]);

  const range = useMemo(() => {
    if (mode !== 'range' || !startAt || !endAt) return { days: [] as { date: string; seconds: number }[], err: '' };
    try { return { days: manualTimeDays(startAt, endAt, zone), err: '' }; }
    catch (e) { return { days: [] as { date: string; seconds: number }[], err: e instanceof Error ? e.message : 'Check the start and end.' }; }
  }, [mode, startAt, endAt, zone]);

  // Range mode: each item belongs to one date. Items from outside the range (or from duration mode) sit on the last day.
  const rangeDates = range.days.map((d) => d.date);
  const lastDate = rangeDates[rangeDates.length - 1];
  const orphanList = [...single, ...Object.keys(byDate).sort().filter((d) => !rangeDates.includes(d)).flatMap((d) => byDate[d])];
  const dayLists: Record<string, string[]> = Object.fromEntries(rangeDates.map((d) => [d, [...(byDate[d] ?? []), ...(d === lastDate ? orphanList : [])]]));
  const editDay = (date: string, v: string[]) => { setByDate({ ...dayLists, [date]: v }); setSingle([]); };
  const switchMode = (m: 'duration' | 'range') => {
    if (m === mode) return;
    if (m === 'duration') { setSingle([...Object.keys(byDate).sort().flatMap((d) => byDate[d]), ...single]); setByDate({}); }
    setMode(m);
  };
  const total = mode === 'range' ? range.days.reduce((a, d) => a + d.seconds, 0) : seconds;
  const allocated = rows.reduce((s, r) => s + r.seconds, 0);
  const remainder = seconds - allocated;
  const rowsValid = rows.every((r) => r.seconds > 0);
  const valid = !!goal && (!editable || !!title.trim()) && (mode === 'range'
    ? range.days.length > 0 && !range.err && range.days.every((d) => d.seconds <= MAX_SECONDS && d.date <= today)
    : seconds > 0 && seconds <= MAX_SECONDS && !!day && day <= today && rowsValid && remainder >= 0);
  const metricOut = metricId === NONE ? undefined : metricId;
  // Only an existing planned session logged short of its plan asks what happens to the rest.
  const plannedSession = !!session && session.status === 'planned' && mode === 'duration';
  const short = plannedSession && seconds > 0 && seconds < (session?.plannedMinutes ?? 0) * 60;
  const outcomeOk = outcomeReady(short, outcome, remainingDate, today);

  const save = async () => {
    if (pending) return;
    setPending(true); setError('');
    try {
      if (!logged.current) {
        const allocations = rows.filter((r) => !r.newTitle).map((r) => ({ taskId: r.taskId!, minutes: r.seconds / 60 }));
        if (isCorrection) {
          editLoggedWorkSession(session.id, { title: title.trim(), goalId: gid, metricId: metricOut, date: day, actualMinutes: seconds / 60, allocations, notes, workDone: cleanWorkDone(single) });
        } else if (isNew && mode === 'range') {
          const link = linkTask !== NONE && goalTasks.some((t) => t.id === linkTask) ? linkTask : undefined;
          recordManualWork({ title: title.trim(), goalId: gid, metricId: metricOut, plannedMinutes: 0, recurrence: 'none', taskIds: [], notes },
            range.days.map((d) => ({ date: d.date, actualMinutes: d.seconds / 60, workDone: cleanWorkDone(dayLists[d.date]), allocations: link ? [{ taskId: link, minutes: d.seconds / 60 }] : [] })));
        } else {
          const result = { date: day, actualMinutes: seconds / 60, notes, allocations, workDone: cleanWorkDone(single),
            newTasks: rows.filter((r) => r.newTitle).map((r) => ({ key: r.key, title: r.newTitle!, minutes: r.seconds / 60 })) };
          if (sessionId.current) {
            logWorkSession(sessionId.current, short
              ? { ...result, outcome: outcome || 'finish', remainingDate: outcome === 'replan' ? remainingDate : outcome === 'continue' ? today : undefined }
              : result);
          }
          else sessionId.current = recordUnplannedSession({ title: title.trim(), goalId: gid, metricId: metricOut, plannedMinutes: 0, recurrence: 'none', taskIds: [], notes }, result);
        }
        logged.current = true; setStaged(true);
      }
      await flushWorkspace();
      const metric = timeMetrics(goal).find((m) => m.id === (editable ? metricOut : session?.metricId));
      toast({ title: isCorrection ? 'Logged time corrected' : 'Time added', description: metric ? `${hms(total)} counted toward ${metric.name}${isCorrection ? ', replacing the earlier credit' : ''}.` : `${hms(total)} recorded as time only.` });
      onClose();
    } catch (err) { setError(errText(logged.current, err)); } finally { setPending(false); }
  };

  return (
    <FormDialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }} wide
      title={isCorrection ? 'Edit logged time' : isNew ? 'Add time' : `Log time: ${session.title}`}
      description={isCorrection ? `Edits replace this record and its measure credit. Repeating plans${session?.remainderSessionId ? ' and the separately planned remaining time' : ''} are not changed.` : 'Enter the actual time you spent. It is recorded once; editing later corrects it.'}
      submitLabel={pending ? 'Saving…' : staged ? 'Retry saving' : isCorrection ? 'Save changes' : 'Add time'} canSubmit={!pending && (staged || (valid && outcomeOk))} onSubmit={() => void save()}>
      {editable && !(isNew && goalId) && (
        <GoalSelect goals={goals} value={gid} disabled={frozen}
          onChange={(v) => { setGid(v); setLinkTask(NONE); setRows((s) => (v === session?.goalId ? s : [])); setMetricId(isCorrection ? NONE : timeMetrics(state.goals.find((g) => g.id === v))[0]?.id ?? NONE); }} />
      )}
      {editable && (
        <Field label="What did you work on?" htmlFor="log-title">
          <Input id="log-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} disabled={frozen} placeholder="e.g. Client call prep" data-testid="input-log-title" />
        </Field>
      )}
      {isNew && (
        <div className="inline-flex rounded-lg border border-border p-0.5 text-xs" role="tablist" aria-label="How to enter time">
          {(['duration', 'range'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} disabled={frozen} onClick={() => switchMode(m)}
              className={cn('rounded-md px-3 py-1.5', mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')} data-testid={`tab-time-${m}`}>
              {m === 'duration' ? 'Duration' : 'Start and end'}
            </button>
          ))}
        </div>
      )}
      {mode === 'range' ? (
        <div className="space-y-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Started" htmlFor="log-start"><Input id="log-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} disabled={frozen} className="font-num" data-testid="input-log-start" /></Field>
            <Field label="Ended" htmlFor="log-end"><Input id="log-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} disabled={frozen} className="font-num" data-testid="input-log-end" /></Field>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="text-log-zone">Times are read in your device time zone: {zone}. Work past midnight is split by day.</p>
          {range.err && <p className="text-xs text-destructive" data-testid="text-range-error">{range.err}</p>}
          {range.days.length > 0 && (
            <ul className="rounded-lg border border-border/80 p-2 text-sm" data-testid="list-range-preview">
              {range.days.map((d) => <li key={d.date} className="flex justify-between font-num"><span>{fmt(d.date, 'EEE MMM d')}</span><span>{hms(d.seconds)}</span></li>)}
            </ul>
          )}
          {goal && (
            <Field label="Link a task (optional)" hint="The task receives each day's whole time. It is not completed.">
              <Select value={linkTask} onValueChange={setLinkTask} disabled={frozen}>
                <SelectTrigger data-testid="select-range-task"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No task</SelectItem>
                  {goalTasks.filter((t) => t.status === 'open').map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date worked" htmlFor="log-date">
            <Input id="log-date" type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} disabled={frozen} className="font-num" data-testid="input-log-date" />
          </Field>
          <Field label="Actual time" hint={seconds > MAX_SECONDS ? 'At most 25 hours for one day.' : session?.plannedMinutes ? `Planned ${mins(session.plannedMinutes)}` : undefined}>
            <DurationInput seconds={seconds} onChange={setSeconds} disabled={frozen} label="Actual time" testId="log-duration" />
          </Field>
        </div>
      )}
      {short && session && (
        <SessionOutcomeChoice actualMinutes={seconds / 60} plannedMinutes={session.plannedMinutes} value={outcome} onChange={setOutcome}
          date={remainingDate} onDateChange={setRemainingDate} today={today} disabled={frozen} testId="log-outcome" />
      )}
      {editable && goal && <MeasureSelect goal={goal} value={metricId} onChange={setMetricId} disabled={frozen} testId="select-log-metric" />}

      {goal && mode === 'duration' && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Split across tasks <span className="font-normal text-muted-foreground">(optional)</span></span>
            <span className={cn('font-num text-xs', remainder < 0 ? 'text-destructive' : 'text-muted-foreground')} data-testid="text-log-unallocated">
              {remainder < 0 ? `${hms(-remainder)} over the session` : `${hms(Math.max(0, remainder))} unallocated`}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Allocating time never completes a task. Unallocated time still counts for the goal.</p>
          {rows.length > 0 && (
            <ul className="space-y-1" data-testid="list-log-allocations">
              {rows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 px-2 py-1">
                  <span className="min-w-0 flex-1 basis-32 truncate text-sm">{titleOf(r)}{r.newTitle && <span className="ml-1.5 rounded bg-accent px-1 text-[0.65rem] text-accent-foreground">new task</span>}</span>
                  <DurationInput className="w-44 shrink-0" seconds={r.seconds} disabled={frozen} label={`Time for ${titleOf(r)}`} testId={`allocation-${r.key}`}
                    onChange={(sec) => setRows((s) => s.map((x) => (x.key === r.key ? { ...x, seconds: sec } : x)))} />
                  <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" disabled={frozen} aria-label={`Remove ${titleOf(r)}`}
                    onClick={() => setRows((s) => s.filter((x) => x.key !== r.key))} data-testid={`button-remove-allocation-${r.key}`}><X /></Button>
                </li>
              ))}
            </ul>
          )}
          <div className={cn('grid gap-2', !isCorrection && 'sm:grid-cols-2')}>
            <Select value="" onValueChange={(v) => addRow({ key: v, taskId: v, seconds: 0 })} disabled={frozen || !available.length}>
              <SelectTrigger className="h-10" data-testid="select-add-allocation"><SelectValue placeholder={available.length ? 'Add an existing task' : 'No other open tasks'} /></SelectTrigger>
              <SelectContent>{available.map((t: Task) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}</SelectContent>
            </Select>
            {!isCorrection && (
              <div className="flex gap-1.5">
                <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} disabled={frozen} placeholder="Or name unexpected work" className="h-10 min-w-0"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newTitle.trim()) { addRow({ key: `new-${Date.now()}`, newTitle: newTitle.trim(), seconds: 0 }); setNewTitle(''); } } }}
                  data-testid="input-new-allocation-task" />
                <Button type="button" variant="outline" className="h-10 shrink-0" disabled={frozen || !newTitle.trim()} aria-label="Create task for this time"
                  onClick={() => { addRow({ key: `new-${Date.now()}`, newTitle: newTitle.trim(), seconds: 0 }); setNewTitle(''); }} data-testid="button-add-new-allocation"><Plus /></Button>
              </div>
            )}
          </div>
          {rows.some((r) => r.newTitle) && <p className="text-xs text-muted-foreground">New tasks are captured open and unscheduled on this goal. Mark them done yourself if they are finished.</p>}
        </div>
      )}
      {mode === 'range' && rangeDates.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-border/80 p-3" data-testid="list-range-workdone">
          {rangeDates.map((d, i) => (
            <WorkDoneField key={d} value={dayLists[d]} onChange={(v) => editDay(d, v)} disabled={frozen} testId={`range-${i}`}
              automaticItems={linkTask !== NONE ? [goalTasks.find((task) => task.id === linkTask)?.title ?? ''] : []}
              label={rangeDates.length > 1 ? `Work done on ${fmt(d, 'EEE MMM d')}` : 'Work done'} hint={i === 0 ? undefined : null}
              note={d === lastDate && cleanWorkDone(orphanList).length > 0 ? `${cleanWorkDone(orphanList).length} item(s) from outside this range are placed on this last day. Move or remove them as needed.` : undefined} />
          ))}
        </div>
      ) : (
        <WorkDoneField value={single} onChange={setSingle} disabled={frozen} testId="log"
          automaticItems={rows.filter((row) => row.seconds > 0).map((row) => row.newTitle ?? goalTasks.find((task) => task.id === row.taskId)?.title ?? session?.allocations.find((a) => a.taskId === row.taskId)?.taskTitle ?? '')}
          note={mode === 'range' ? 'Choose a start and end to place these items on work dates.' : undefined} />
      )}
      <Field label="Private notes" htmlFor="log-notes" hint="Internal. Not on client timesheets unless you choose to include notes.">
        <Textarea id="log-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={frozen} data-testid="input-log-notes" />
      </Field>
      {goal && <EffectNote goal={goal} metricId={editable ? metricId : session?.metricId ?? NONE} minutes={total / 60} testId="text-log-effect" />}
      {error && <p role="alert" className="text-sm text-destructive" data-testid="text-log-error">{error}</p>}
    </FormDialog>
  );
}

/* ---------- Delete ---------- */
export function DeleteSessionDialog({ session, onClose }: { session: WorkSession; onClose: () => void }) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState('');
  const applied = useRef(false);
  const run = async () => {
    if (pending) return;
    setPending(true); setError('');
    try {
      if (!applied.current) { deleteWorkSession(session.id); applied.current = true; setStaged(true); }
      await flushWorkspace();
      toast({ title: 'Session deleted', description: session.status === 'logged' ? 'Its goal contribution was removed too.' : undefined });
      onClose();
    } catch (err) { setError(errText(applied.current, err)); } finally { setPending(false); }
  };
  return (
    <FormDialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }} title="Delete this session?"
      submitLabel={pending ? 'Deleting…' : staged ? 'Retry saving' : 'Delete session'} onSubmit={() => void run()} canSubmit={!pending}>
      <p className="text-sm text-muted-foreground" data-testid="text-delete-session-explain">
        "{session.title}" will be removed.{' '}
        {session.status === 'logged' ? `Its ${mins(session.actualMinutes ?? 0)} of logged work and any credit it gave the goal's measure are removed too. Tasks themselves are not changed.` : 'Nothing was logged yet, so no results change.'}
        {session.spawnedNextId && ' The next repeat of this session is a separate session and stays.'}
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </FormDialog>
  );
}

/* ---------- Convert task ---------- */
export function ConvertTaskDialog({ task, goal, onClose }: { task: Task; goal: Goal; onClose: () => void }) {
  const { toast } = useToast();
  const list = timeMetrics(goal);
  const [metricId, setMetricId] = useState(list.length === 1 ? list[0].id : NONE);
  const [pending, setPending] = useState(false);
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState('');
  const applied = useRef(false);
  const run = async () => {
    if (pending) return;
    setPending(true); setError('');
    try {
      if (!applied.current) { convertTaskToWorkSession(task.id, metricId === NONE ? undefined : metricId); applied.current = true; setStaged(true); }
      await flushWorkspace();
      toast({ title: 'Converted to a work session', description: 'The original task is archived with its past results.' });
      onClose();
    } catch (err) { setError(errText(applied.current, err)); } finally { setPending(false); }
  };
  return (
    <FormDialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }} title="Convert to work session"
      description="Use this for ongoing time blocks rather than things you finish."
      submitLabel={pending ? 'Converting…' : staged ? 'Retry saving' : 'Convert'} onSubmit={() => void run()} canSubmit={!pending}>
      <p className="text-sm text-muted-foreground" data-testid="text-convert-explain">
        "{task.title}" becomes a planned session of {mins(task.effort || 60)}{task.plannedDate ? ` on ${fmt(task.plannedDate, 'MMM d')}` : ' today'}{task.recurrence !== 'none' ? `, repeating ${task.recurrence}` : ''}. The task is archived, not deleted, and contributions already recorded for it stay in the goal's results.
      </p>
      <MeasureSelect goal={goal} value={metricId} onChange={setMetricId} disabled={pending || staged} testId="select-convert-metric" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </FormDialog>
  );
}

/* ---------- Ledger entry for session credits (read-only) ---------- */
export function SessionEntryRow({ metric, entry }: { metric: Metric; entry: MetricEntry }) {
  const src = entry.source!;
  return (
    <li className="flex items-start gap-2 px-1 py-1 text-xs" data-testid={`entry-${entry.id}`}>
      <span className="w-12 shrink-0 pt-1.5 font-num text-muted-foreground">{fmt(entry.date, 'MMM d')}</span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-num">+{formatValue(entry.value, metric.unit)}</span>
          <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1 text-[0.65rem] text-primary" data-testid={`badge-session-entry-${entry.id}`}><Timer className="size-2.5" /> session</span>
        </div>
        <div className="truncate text-muted-foreground">{src.taskTitle ?? src.sessionTitle ?? 'Work session'}{src.taskTitle && src.sessionTitle ? ` · ${src.sessionTitle}` : ''}</div>
        <div className="text-[0.68rem] text-muted-foreground/80">Edit or delete in Work sessions</div>
      </div>
    </li>
  );
}


/** One session row with its real actions. Dialogs are owned by the caller. */
export function SessionRow({ session: s, goal: g, showGoal = true, hideDate, onPlan, onLog, onDelete }: { session: WorkSession; goal?: Goal; showGoal?: boolean; hideDate?: boolean; onPlan: (s: WorkSession) => void; onLog: (s: WorkSession) => void; onDelete: (s: WorkSession) => void }) {
  const actions = useWorkSessionActions();
  const state = useAppState();
  const metric = g?.metrics.find((m) => m.id === s.metricId);
  const alloc = s.allocations.reduce((a, x) => a + x.minutes, 0);
  const status = s.status;
  const isLogged = status === 'logged';
  const isSkipped = status === 'skipped';
  const isPlanned = !isLogged && !isSkipped;
  const d = (isLogged ? s.date : s.plannedDate) ?? '';
  const missed = isPlanned && !!d && d < todayIso();
  const split = isLogged && !!s.remainderSessionId;
  const remainderPiece = isPlanned && !!s.continuationOfId;
  const statusText = isLogged ? (split ? 'Recorded' : 'Done') : isSkipped ? 'Skipped' : missed ? 'Missed' : remainderPiece ? 'Remaining' : 'Planned';
  const minutes = isLogged ? s.actualMinutes ?? 0 : s.plannedMinutes;
  const origPlanned = s.originalPlannedMinutes ?? s.plannedMinutes;
  const shortClosed = isLogged && origPlanned > 0 && (s.actualMinutes ?? 0) < origPlanned;
  const remainder = split ? state.sessions?.find((x) => x.id === s.remainderSessionId) : undefined;
  const parent = remainderPiece ? state.sessions?.find((x) => x.id === s.continuationOfId) : undefined;
  return (
    <li className={cn('grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-2.5', isSkipped && 'opacity-70')} data-testid={`row-session-${s.id}`}>
      <div className={cn('flex flex-col items-center rounded-lg px-1 py-1 text-center', isLogged ? 'bg-success/10 text-success' : isSkipped ? 'bg-muted text-muted-foreground' : missed ? 'border border-destructive/40 text-destructive' : 'border border-dashed border-foreground/30 text-foreground')}>
        <span className={cn('font-num text-sm leading-tight', isSkipped && 'line-through')} data-testid={isLogged ? `text-session-actual-${s.id}` : `text-session-minutes-${s.id}`}>{mins(minutes)}</span>
        <span className="flex flex-wrap items-center justify-center gap-0.5 text-[0.65rem] leading-tight" data-testid={`status-session-${s.id}`}>
          {isLogged ? <Check className="size-2.5" aria-hidden /> : <Clock3 className="size-2.5" aria-hidden />}{statusText}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-1.5 text-[0.93rem] leading-snug">
          <span className={cn('min-w-0 break-words', isSkipped && 'line-through decoration-muted-foreground/60')} data-testid={`text-session-title-${s.id}`}>{s.title}</span>
          {s.recurrence !== 'none' && <Repeat className="mt-1 size-3 shrink-0 text-muted-foreground" aria-label={`Repeats ${s.recurrence}`} />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
          {showGoal && (g ? <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 sm:max-w-[14rem]"><AreaDot area={g.area} /><span className="truncate text-foreground/80">{g.title}</span></span> : <span>No goal</span>)}
          {!hideDate && <span className="font-num">{d ? relDay(d) : 'Unscheduled'}</span>}
          {isPlanned && <span>{mins(s.plannedMinutes)} reserved{s.taskIds.length ? ` · ${s.taskIds.length} task${s.taskIds.length > 1 ? 's' : ''}` : ''}</span>}
          {isSkipped && <span>No time credited</span>}
          {shortClosed && <span className="font-num" data-testid={`text-session-compare-${s.id}`}>{mins(s.actualMinutes ?? 0)} of {mins(origPlanned)} planned</span>}
          {isLogged && s.allocations.length > 0 && <span className="font-num" data-testid={`text-session-unallocated-${s.id}`}>{mins((s.actualMinutes ?? 0) - alloc)} unallocated</span>}
          {!isSkipped && <span>{metric ? `Counts to ${metric.name}` : 'Time only'}</span>}
        </div>
        {split && (
          <p className="mt-1 flex min-w-0 items-start gap-1 break-words text-xs text-muted-foreground" data-testid={`text-session-remainder-${s.id}`}>
            <CornerDownRight className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>{remainder ? (remainder.status === 'logged' ? `${mins(remainder.actualMinutes ?? 0)} was recorded in the follow-up session.` : remainder.status === 'skipped' ? 'The follow-up session was skipped. No extra time was credited.' : `${mins(remainder.plannedMinutes)} remains planned${remainder.plannedDate ? ` for ${relDay(remainder.plannedDate).toLowerCase()}` : ''}.`) : 'The remaining time was planned as a separate session.'}</span>
          </p>
        )}
        {remainderPiece && (
          <p className="mt-1 flex min-w-0 items-start gap-1 break-words text-xs text-muted-foreground" data-testid={`text-session-continuation-${s.id}`}>
            <CornerDownRight className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>Remaining time from {parent ? `${mins(parent.actualMinutes ?? 0)} recorded${parent.date ? ` ${relDay(parent.date).toLowerCase()}` : ''}` : 'an earlier session'}.</span>
          </p>
        )}
        {isLogged && <div className="min-w-0 overflow-hidden break-words"><WorkDonePreview items={sessionWorkDone(s).all} testId={s.id} /></div>}
      </div>
      <div className="col-start-2 -ml-2 flex flex-wrap items-center gap-0.5">
        {isPlanned && (
          <>
            <Button variant="ghost" size="sm" className="h-9 px-2 text-xs text-primary" aria-label={`Start timer for ${s.title}`} onClick={() => actions.start({ sessionId: s.id, goalId: s.goalId })} data-testid={`button-start-timer-${s.id}`}><Play /> Start</Button>
            <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" aria-label={`Log time for ${s.title}`} onClick={() => onLog(s)} data-testid={`button-log-session-${s.id}`}>Log time</Button>
            <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Edit ${s.title}`} onClick={() => onPlan(s)} data-testid={`button-edit-session-${s.id}`}><Pencil /></Button>
          </>
        )}
        {isLogged && <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Correct time and work details for ${s.title}`} onClick={() => onLog(s)} data-testid={`button-edit-log-${s.id}`}><Pencil /></Button>}
        <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Delete ${s.title}`} onClick={() => onDelete(s)} data-testid={`button-delete-session-${s.id}`}><Trash2 /></Button>
      </div>
    </li>
  );
}

/* ---------- List ---------- */
type DialogState = null | { plan: WorkSession | true } | { log: WorkSession | true } | { del: WorkSession };

export function WorkSessionsPanel({ goalId, start, end, defaultDate, title = 'Work sessions', filter }: { goalId?: string; start?: string; end?: string; defaultDate?: string; title?: string; filter?: (session: WorkSession) => boolean }) {
  const state = useAppState();
  const sessions = state.sessions ?? [];
  const [dialog, setDialog] = useState<DialogState>(null);
  const actions = useWorkSessionActions();
  const goalById = new Map(state.goals.map((g) => [g.id, g]));
  const rank = (s: WorkSession) => (s.status === 'planned' ? 0 : s.status === 'logged' ? 1 : 2);
  const when = (s: WorkSession) => (s.status === 'logged' ? s.date : s.plannedDate) ?? '';
  const inRange = (d?: string) => !!d && (!start || d >= start) && (!end || d <= end);
  const list = sessions
    .filter((s) => (!goalId || s.goalId === goalId) && (goalId || (!start && !end) || inRange(s.plannedDate) || inRange(s.date)) && (!filter || filter(s)))
    .sort((a, b) => (a.status === b.status ? when(a).localeCompare(when(b)) : rank(a) - rank(b)));
  const planned = list.filter((s) => s.status === 'planned');
  const logged = list.filter((s) => s.status === 'logged');
  const close = () => setDialog(null);
  const date = defaultDate && defaultDate >= todayIso() ? defaultDate : undefined;

  return (
    <div className="surface rise min-w-0 max-w-full p-4 sm:p-5" data-testid="panel-work-sessions">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg"><Hourglass className="size-4 text-primary" /> {title}</h2>
        <span className="font-num text-xs text-muted-foreground" data-testid="text-sessions-summary">
          {mins(planned.reduce((a, s) => a + s.plannedMinutes, 0))} reserved · {mins(logged.reduce((a, s) => a + (s.actualMinutes ?? 0), 0))} logged
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Plan a session, start a timer, or record work. Tasks stay open until you complete them.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" className="h-10 px-2 sm:h-9" onClick={() => actions.start({ goalId })} data-testid="button-start-timer"><Play /> Start timer</Button>
        <Button size="sm" variant="secondary" className="h-10 px-2 sm:h-9" onClick={() => setDialog({ log: true })} data-testid="button-log-work"><Plus /> Add time</Button>
        <Button variant="outline" size="sm" className="h-10 px-2 sm:h-9" onClick={() => setDialog({ plan: true })} data-testid="button-plan-session"><Clock3 /> Plan</Button>
      </div>
      {list.length === 0 ? (
        <EmptyState className="py-4" title="No sessions here" body="Plan a block for focused work, or log time you already spent." />
      ) : (
        <ul className="max-h-[26rem] divide-y divide-border/60 overflow-y-auto" data-testid="list-work-sessions">
          {list.map((s) => (
            <SessionRow key={s.id} session={s} goal={goalById.get(s.goalId)} showGoal={!goalId} onPlan={(x) => setDialog({ plan: x })} onLog={(x) => setDialog({ log: x })} onDelete={(x) => setDialog({ del: x })} />
          ))}
        </ul>
      )}
      {dialog && 'plan' in dialog && <PlanSessionDialog session={dialog.plan === true ? undefined : dialog.plan} goalId={goalId} date={date} onClose={close} />}
      {dialog && 'log' in dialog && <LogSessionDialog session={dialog.log === true ? undefined : dialog.log} goalId={goalId} date={defaultDate} onClose={close} />}
      {dialog && 'del' in dialog && <DeleteSessionDialog session={dialog.del} onClose={close} />}
    </div>
  );
}
