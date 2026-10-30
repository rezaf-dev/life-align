import { useMemo, useRef, useState } from 'react';
import { Clock3, Hourglass, Pencil, Plus, Repeat, Timer, Trash2, X } from 'lucide-react';
import { timeUnitMinutes } from '@workspace/api-zod';
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

const NONE = '__time_only__';
const errText = (applied: boolean, err: unknown) =>
  `${applied ? 'Changed on this device, but not saved to your account yet. ' : ''}${err instanceof Error ? err.message : 'Please try saving again.'}`;
const mins = (m: number) => effortLabel(m) || '0m';

export function timeMetrics(goal?: Goal): Metric[] {
  return goal ? goal.metrics.filter((m) => !!timeUnitMinutes(m.unit)) : [];
}

/** Shows exactly what saving will do to the chosen measure. */
function EffectNote({ goal, metricId, minutes, planned, testId }: { goal?: Goal; metricId: string; minutes: number; planned?: boolean; testId: string }) {
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

function MeasureSelect({ goal, value, onChange, disabled, testId }: { goal?: Goal; value: string; onChange: (v: string) => void; disabled?: boolean; testId: string }) {
  const list = timeMetrics(goal);
  return (
    <Field label="Counts toward" hint={list.length ? 'Only hours or minutes measures can receive session time.' : 'This goal has no hours or minutes measure, so sessions are time-only.'}>
      <Select value={value} onValueChange={onChange} disabled={disabled || !list.length}>
        <SelectTrigger data-testid={testId}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Time only, no measure</SelectItem>
          {list.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function GoalSelect({ goals, value, onChange, disabled }: { goals: Goal[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
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
  const valid = !!goal && !!title.trim() && Number.isInteger(n) && n >= 0 && n <= 1440 && (recurrence === 'none' || !!plannedDate);

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
          <Input id="session-minutes" type="number" min={0} max={1440} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} disabled={frozen} className="font-num" data-testid="input-session-minutes" />
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

/* ---------- Log actual time (planned, unplanned, or correction) ---------- */
type Row = { key: string; taskId?: string; newTitle?: string; minutes: string };

export function LogSessionDialog({ session, goalId, date, onClose }: { session?: WorkSession; goalId?: string; date?: string; onClose: () => void }) {
  const state = useAppState();
  const { toast } = useToast();
  const today = todayIso();
  const goals = state.goals.filter((g) => g.status === 'active' || g.status === 'paused' || g.id === (session?.goalId ?? goalId));
  const [gid, setGid] = useState(session?.goalId ?? goalId ?? '');
  const goal = state.goals.find((g) => g.id === gid);
  const [title, setTitle] = useState(session?.title ?? '');
  const [metricId, setMetricId] = useState(session ? session.metricId ?? NONE : timeMetrics(goal)[0]?.id ?? NONE);
  const [day, setDay] = useState(session?.date ?? (session?.plannedDate && session.plannedDate <= today ? session.plannedDate : date && date <= today ? date : today));
  const [actual, setActual] = useState(String(session?.actualMinutes ?? (session?.plannedMinutes || '')));
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [rows, setRows] = useState<Row[]>(() => session?.allocations.length
    ? session.allocations.map((a) => ({ key: a.taskId, taskId: a.taskId, minutes: String(a.minutes) }))
    : (session?.taskIds ?? []).map((id) => ({ key: id, taskId: id, minutes: '' })));
  const [newTitle, setNewTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState('');
  const sessionId = useRef<string | undefined>(session?.id);
  const logged = useRef(false);
  const frozen = pending || staged;
  const isNew = !session;
  const isCorrection = session?.status === 'logged';

  const goalTasks = useMemo(() => state.tasks.filter((t) => t.goalId === gid && !t.archived), [state.tasks, gid]);
  const titleOf = (r: Row) => r.newTitle ?? goalTasks.find((t) => t.id === r.taskId)?.title ?? session?.allocations.find((a) => a.taskId === r.taskId)?.taskTitle ?? 'Removed task';
  const available = goalTasks.filter((t) => t.status === 'open' && !rows.some((r) => r.taskId === t.id));
  const total = Number(actual);
  const allocated = rows.reduce((s, r) => s + (Number(r.minutes) || 0), 0);
  const remainder = total - allocated;
  const rowsValid = rows.every((r) => Number.isInteger(Number(r.minutes)) && Number(r.minutes) > 0);
  const valid = !!goal && (!isNew || !!title.trim()) && Number.isInteger(total) && total > 0 && total <= 1440 && day <= today && !!day && rowsValid && remainder >= 0;

  const save = async () => {
    if (pending) return;
    setPending(true); setError('');
    const any = () => logged.current;
    try {
      if (!logged.current) {
        const result = { date: day, actualMinutes: total, notes,
          allocations: rows.filter((r) => !r.newTitle).map((r) => ({ taskId: r.taskId!, minutes: Number(r.minutes) })),
          newTasks: rows.filter((r) => r.newTitle).map((r) => ({ key: r.key, title: r.newTitle!, minutes: Number(r.minutes) })) };
        if (sessionId.current) logWorkSession(sessionId.current, result);
        else sessionId.current = recordUnplannedSession({ title, goalId: gid, metricId: metricId === NONE ? undefined : metricId, plannedMinutes: 0, recurrence: 'none', taskIds: [], notes }, result);
        logged.current = true; setStaged(true);
      }
      await flushWorkspace();
      const metric = timeMetrics(goal).find((m) => m.id === (session ? session.metricId : metricId === NONE ? undefined : metricId));
      toast({ title: isCorrection ? 'Logged time corrected' : 'Work logged', description: metric ? `${mins(total)} counted toward ${metric.name}${isCorrection ? ', replacing the earlier credit' : ''}.` : `${mins(total)} recorded as time only.` });
      onClose();
    } catch (err) { setError(errText(any(), err)); } finally { setPending(false); }
  };

  const effMetric = session ? session.metricId ?? NONE : metricId;
  return (
    <FormDialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }} wide
      title={isCorrection ? 'Correct logged time' : isNew ? 'Log work' : `Log time: ${session.title}`}
      description="Enter the actual time you spent, not an estimate. It is recorded once; editing later corrects it. It may exceed what you planned."
      submitLabel={pending ? 'Saving…' : staged ? 'Retry saving' : isCorrection ? 'Save correction' : 'Record time'} canSubmit={!pending && (staged || valid)} onSubmit={() => void save()}>
      {isNew && !goalId && <GoalSelect goals={goals} value={gid} onChange={(v) => { setGid(v); setRows([]); setMetricId(timeMetrics(state.goals.find((g) => g.id === v))[0]?.id ?? NONE); }} disabled={frozen} />}
      {isNew && (
        <Field label="What did you work on?" htmlFor="log-title">
          <Input id="log-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} disabled={frozen} placeholder="e.g. Unplanned client call prep" data-testid="input-log-title" />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date worked" htmlFor="log-date">
          <Input id="log-date" type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} disabled={frozen} className="font-num" data-testid="input-log-date" />
        </Field>
        <Field label="Actual minutes" htmlFor="log-minutes" hint={total > 0 ? `${mins(total)}${session?.plannedMinutes ? ` · planned ${mins(session.plannedMinutes)}` : ''}` : undefined}>
          <Input id="log-minutes" type="number" min={1} max={1440} step={1} value={actual} onChange={(e) => setActual(e.target.value)} disabled={frozen} className="font-num" data-testid="input-log-minutes" />
        </Field>
      </div>
      {isNew && goal && <MeasureSelect goal={goal} value={metricId} onChange={setMetricId} disabled={frozen} testId="select-log-metric" />}

      {goal && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Split across tasks <span className="font-normal text-muted-foreground">(optional)</span></span>
            <span className={cn('font-num text-xs', remainder < 0 ? 'text-destructive' : 'text-muted-foreground')} data-testid="text-log-unallocated">
              {remainder < 0 ? `${mins(-remainder)} over the session` : `${mins(Math.max(0, remainder))} unallocated`}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Allocating time never completes a task. Unallocated time still counts for the goal through this session.</p>
          {rows.length > 0 && (
            <ul className="space-y-1" data-testid="list-log-allocations">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-2 rounded-lg border border-border/80 px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-sm">{titleOf(r)}{r.newTitle && <span className="ml-1.5 rounded bg-accent px-1 text-[0.65rem] text-accent-foreground">new task</span>}</span>
                  <Input type="number" min={1} step={1} aria-label={`Minutes for ${titleOf(r)}`} value={r.minutes} disabled={frozen}
                    onChange={(e) => setRows((s) => s.map((x) => (x.key === r.key ? { ...x, minutes: e.target.value } : x)))}
                    className="h-9 w-20 shrink-0 font-num" data-testid={`input-allocation-${r.key}`} />
                  <span className="text-xs text-muted-foreground">min</span>
                  <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" disabled={frozen} aria-label={`Remove ${titleOf(r)}`}
                    onClick={() => setRows((s) => s.filter((x) => x.key !== r.key))} data-testid={`button-remove-allocation-${r.key}`}><X /></Button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value="" onValueChange={(v) => setRows((s) => [...s, { key: v, taskId: v, minutes: '' }])} disabled={frozen || !available.length}>
              <SelectTrigger className="h-10" data-testid="select-add-allocation"><SelectValue placeholder={available.length ? 'Add an existing task' : 'No other open tasks'} /></SelectTrigger>
              <SelectContent>{available.map((t: Task) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex gap-1.5">
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} disabled={frozen} placeholder="Or name unexpected work" className="h-10 min-w-0"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newTitle.trim()) { setRows((s) => [...s, { key: `new-${Date.now()}`, newTitle: newTitle.trim(), minutes: '' }]); setNewTitle(''); } } }}
                data-testid="input-new-allocation-task" />
              <Button type="button" variant="outline" className="h-10 shrink-0" disabled={frozen || !newTitle.trim()} aria-label="Create task for this time"
                onClick={() => { setRows((s) => [...s, { key: `new-${Date.now()}`, newTitle: newTitle.trim(), minutes: '' }]); setNewTitle(''); }} data-testid="button-add-new-allocation"><Plus /></Button>
            </div>
          </div>
          {rows.some((r) => r.newTitle) && <p className="text-xs text-muted-foreground">New tasks are captured open and unscheduled on this goal. Their time counts here once. Mark them done yourself if they are finished.</p>}
        </div>
      )}
      <Field label="Notes" htmlFor="log-notes">
        <Textarea id="log-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={frozen} data-testid="input-log-notes" />
      </Field>
      {goal && <EffectNote goal={goal} metricId={effMetric} minutes={total > 0 ? total : 0} testId="text-log-effect" />}
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

/* ---------- List ---------- */
type DialogState = null | { plan: WorkSession | true } | { log: WorkSession | true } | { del: WorkSession };

export function WorkSessionsPanel({ goalId, start, end, defaultDate, title = 'Work sessions' }: { goalId?: string; start?: string; end?: string; defaultDate?: string; title?: string }) {
  const state = useAppState();
  const sessions = state.sessions ?? [];
  const [dialog, setDialog] = useState<DialogState>(null);
  const goalById = new Map(state.goals.map((g) => [g.id, g]));
  const when = (s: WorkSession) => (s.status === 'logged' ? s.date : s.plannedDate) ?? '';
  const inRange = (d?: string) => !!d && (!start || d >= start) && (!end || d <= end);
  const list = sessions
    .filter((s) => (!goalId || s.goalId === goalId) && (goalId ? true : inRange(s.plannedDate) || inRange(s.date)))
    .sort((a, b) => (a.status === b.status ? when(a).localeCompare(when(b)) : a.status === 'planned' ? -1 : 1));
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
      <p className="mb-3 text-xs text-muted-foreground">Reserve time, then record what you actually spent. No timer, no task completion.</p>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" className="h-10 sm:h-9" onClick={() => setDialog({ plan: true })} data-testid="button-plan-session"><Clock3 /> Plan session</Button>
        <Button size="sm" className="h-10 sm:h-9" onClick={() => setDialog({ log: true })} data-testid="button-log-work"><Plus /> Log work</Button>
      </div>
      {list.length === 0 ? (
        <EmptyState className="py-4" title="No sessions here" body="Plan a block for focused work, or log time you already spent." />
      ) : (
        <ul className="max-h-[26rem] divide-y divide-border/60 overflow-y-auto" data-testid="list-work-sessions">
          {list.map((s) => {
            const g = goalById.get(s.goalId);
            const metric = g?.metrics.find((m) => m.id === s.metricId);
            const alloc = s.allocations.reduce((a, x) => a + x.minutes, 0);
            const d = when(s);
            return (
              <li key={s.id} className="flex items-start gap-2 py-2" data-testid={`row-session-${s.id}`}>
                <span className={cn('mt-1 grid size-7 shrink-0 place-items-center rounded-full', s.status === 'logged' ? 'bg-primary/15 text-primary' : 'border border-dashed border-foreground/30 text-muted-foreground')}>
                  {s.status === 'logged' ? <Timer className="size-3.5" /> : <Clock3 className="size-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[0.93rem] leading-snug">
                    <span className="truncate" data-testid={`text-session-title-${s.id}`}>{s.title}</span>
                    {s.recurrence !== 'none' && <Repeat className="size-3 shrink-0 text-muted-foreground" aria-label={`Repeats ${s.recurrence}`} />}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                    {!goalId && g && <span className="inline-flex min-w-0 max-w-[10rem] items-center gap-1.5"><AreaDot area={g.area} /><span className="truncate">{g.title}</span></span>}
                    <span className="font-num">{d ? relDay(d) : 'Unscheduled'}</span>
                    {s.status === 'planned' ? <span className="font-num">{mins(s.plannedMinutes)} reserved{s.taskIds.length ? ` · ${s.taskIds.length} tasks` : ''}</span> : (
                      <>
                        <span className="font-num text-foreground" data-testid={`text-session-actual-${s.id}`}>{mins(s.actualMinutes ?? 0)} actual</span>
                        {s.allocations.length > 0 && <span className="font-num" data-testid={`text-session-unallocated-${s.id}`}>{mins((s.actualMinutes ?? 0) - alloc)} unallocated</span>}
                      </>
                    )}
                    <span>{metric ? `to ${metric.name}` : 'time only'}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  {s.status === 'planned' ? (
                    <>
                      <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => setDialog({ log: s })} data-testid={`button-log-session-${s.id}`}>Log time</Button>
                      <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Edit ${s.title}`} onClick={() => setDialog({ plan: s })} data-testid={`button-edit-session-${s.id}`}><Pencil /></Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Correct time for ${s.title}`} onClick={() => setDialog({ log: s })} data-testid={`button-edit-log-${s.id}`}><Pencil /></Button>
                  )}
                  <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Delete ${s.title}`} onClick={() => setDialog({ del: s })} data-testid={`button-delete-session-${s.id}`}><Trash2 /></Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {dialog && 'plan' in dialog && <PlanSessionDialog session={dialog.plan === true ? undefined : dialog.plan} goalId={goalId} date={date} onClose={close} />}
      {dialog && 'log' in dialog && <LogSessionDialog session={dialog.log === true ? undefined : dialog.log} goalId={goalId} date={defaultDate} onClose={close} />}
      {dialog && 'del' in dialog && <DeleteSessionDialog session={dialog.del} onClose={close} />}
    </div>
  );
}
