import { useMemo, useState } from 'react';
import { CalendarClock, Clock3, ListTodo, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormDialog } from '@/components/form-dialog';
import { AreaDot } from '@/components/primitives';
import { useStagedAction } from '@/components/time-tracker';
import { missedWork } from '@/lib/missed-work';
import { replanMissedSession, replanMissedTask, skipMissedSession, skipMissedTask } from '@/lib/store/missed-work';
import { formatMinutes } from '@/lib/reports';
import { addDaysIso, fmt, todayIso } from '@/lib/dates';
import { useAppState } from '@/lib/store/store';
import type { Goal, Task, WorkSession } from '@/lib/store/types';
import { cn } from '@/lib/utils';

const PREVIEW = 4;

type Item =
  | { kind: 'task'; id: string; title: string; date: string; minutes?: number; goalId?: string; recurring: boolean; recurrence: string }
  | { kind: 'session'; id: string; title: string; date: string; minutes?: number; goalId?: string; recurring: boolean; recurrence: string };

type Pending = { item: Item; mode: 'today' | 'replan' | 'skip' };

const fromTask = (t: Task): Item => ({
  kind: 'task', id: t.id, title: t.title, date: t.plannedDate ?? t.dueDate ?? '',
  minutes: t.effort, goalId: t.goalId,
  recurring: !!t.recurrence && t.recurrence !== 'none', recurrence: String(t.recurrence ?? 'none'),
});
const fromSession = (s: WorkSession): Item => ({
  kind: 'session', id: s.id, title: s.title, date: s.plannedDate ?? '', minutes: s.plannedMinutes, goalId: s.goalId,
  recurring: !!s.recurrence && s.recurrence !== 'none', recurrence: String(s.recurrence ?? 'none'),
});

/** Missed tasks and planned sessions stay here until you replan or skip them. */
export function MissedWork({ className }: { className?: string }) {
  const state = useAppState();
  const today = todayIso();
  const [showAll, setShowAll] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const goalById = useMemo(() => new Map(state.goals.map((g) => [g.id, g])), [state.goals]);
  const items = useMemo(() => {
    const m = missedWork(state, today);
    return [...m.tasks.map(fromTask), ...m.sessions.map(fromSession)].sort((a, b) => a.date.localeCompare(b.date));
  }, [state.tasks, state.sessions, today]);

  const dialog = pending && <MissedDialog key={`${pending.item.id}-${pending.mode}`} pending={pending} onClose={() => setPending(null)} />;
  // Keep the dialog mounted after the list empties so save errors and retry stay visible.
  if (items.length === 0) return dialog || null;
  const visible = showAll ? items : items.slice(0, PREVIEW);
  const hidden = items.length - visible.length;

  return (
    <section className={cn('rounded-xl border border-destructive/25 bg-destructive/[0.04] p-3 sm:p-4', className)} aria-labelledby="missed-h" data-testid="panel-missed-work">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 id="missed-h" className="flex items-center gap-2 font-display text-lg">
          <CalendarClock className="size-4 text-destructive" aria-hidden /> Missed
          <span className="font-num text-xs text-muted-foreground" data-testid="text-missed-count">{items.length}</span>
        </h2>
        <p className="text-xs text-muted-foreground">Stays here until you move it to a new day or skip it.</p>
      </div>
      <ul className="divide-y divide-border/60" data-testid="list-missed-work">
        {visible.map((it) => (
          <MissedRow key={`${it.kind}-${it.id}`} item={it} goal={it.goalId ? goalById.get(it.goalId) : undefined} onAct={(mode) => setPending({ item: it, mode })} />
        ))}
      </ul>
      {items.length > PREVIEW && (
        <Button variant="ghost" size="sm" className="mt-1 h-10 text-xs sm:h-8" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)} data-testid="button-missed-show-all">
          {showAll ? 'Show fewer' : `Show all ${items.length} (${hidden} more)`}
        </Button>
      )}
      {dialog}
    </section>
  );
}

function MissedRow({ item: it, goal, onAct }: { item: Item; goal?: Goal; onAct: (m: Pending['mode']) => void }) {
  const Icon = it.kind === 'task' ? ListTodo : Clock3;
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 py-2.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto] sm:items-center" data-testid={`row-missed-${it.kind}-${it.id}`}>
      <Icon className="mt-0.5 size-4 text-destructive/80 sm:mt-0" aria-label={it.kind === 'task' ? 'Task' : 'Planned session'} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[0.93rem] leading-snug">
          <span className="min-w-0 break-words" data-testid={`text-missed-title-${it.id}`}>{it.title}</span>
          {it.recurring && <Repeat className="size-3 shrink-0 text-muted-foreground" aria-label={`Repeats ${it.recurrence}`} />}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-medium text-destructive">{it.kind === 'task' ? 'Missed task' : 'Missed session'}</span>
          <span className="font-num" data-testid={`text-missed-date-${it.id}`}>{it.date ? (it.date === addDaysIso(todayIso(), -1) ? `Yesterday · ${fmt(it.date, 'MMM d')}` : fmt(it.date, 'MMM d')) : 'No date'}</span>
          {!!it.minutes && <span className="font-num">{formatMinutes(it.minutes)}</span>}
          {goal ? <span className="inline-flex min-w-0 max-w-[14rem] items-center gap-1.5"><AreaDot area={goal.area} goalId={goal.id} /><span className="truncate">{goal.title}</span></span> : <span>No goal</span>}
        </div>
      </div>
      <div className="col-start-2 flex flex-wrap gap-1 sm:col-start-3">
        <Button size="sm" variant="secondary" className="h-9 px-2.5 text-xs" onClick={() => onAct('today')} data-testid={`button-missed-today-${it.id}`}>Do today</Button>
        <Button size="sm" variant="ghost" className="h-9 px-2.5 text-xs" onClick={() => onAct('replan')} data-testid={`button-missed-replan-${it.id}`}>Replan</Button>
        <Button size="sm" variant="ghost" className="h-9 px-2.5 text-xs text-muted-foreground" onClick={() => onAct('skip')} data-testid={`button-missed-skip-${it.id}`}>Skip</Button>
      </div>
    </li>
  );
}

function MissedDialog({ pending: { item: it, mode }, onClose }: { pending: Pending; onClose: () => void }) {
  const today = todayIso();
  const [date, setDate] = useState(mode === 'today' ? today : addDaysIso(today, 1));
  const action = useStagedAction();
  const label = it.kind === 'task' ? 'task' : 'session';
  const validDate = !!date && date >= today;
  const apply = () => {
    if (mode === 'skip') return it.kind === 'task' ? skipMissedTask(it.id) : skipMissedSession(it.id);
    return it.kind === 'task' ? replanMissedTask(it.id, date) : replanMissedSession(it.id, date);
  };
  const title = mode === 'skip' ? `Skip this ${label}?` : mode === 'today' ? 'Do it today' : `Replan ${label}`;
  const submit = mode === 'skip' ? 'Skip' : mode === 'today' ? 'Move to today' : 'Replan';
  return (
    <FormDialog
      open
      onOpenChange={(o) => { if (!o && !action.frozen) onClose(); }}
      title={title}
      submitLabel={action.pending ? 'Saving' : action.error ? 'Retry' : submit}
      canSubmit={!action.pending && (mode !== 'replan' || validDate)}
      onSubmit={() => void action.run(() => { apply(); }, onClose)}
    >
      <p className="text-sm"><span className="font-medium">{it.title}</span> <span className="text-muted-foreground">was planned for {it.date ? fmt(it.date, 'EEEE, MMM d') : 'an earlier day'}.</span></p>
      {mode === 'replan' && (
        <div>
          <label htmlFor="missed-date" className="mb-1 block text-xs text-muted-foreground">New date (today or later)</label>
          <Input id="missed-date" type="date" min={today} value={date} disabled={action.frozen} onChange={(e) => setDate(e.target.value)} className="h-10 font-num" data-testid="input-missed-date" />
        </div>
      )}
      {mode === 'today' && <p className="text-sm text-muted-foreground">It moves to today's plan. Nothing is marked done.</p>}
      {mode === 'skip' && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground" data-testid="text-skip-explainer">
          Skipping records that this {label} did not happen. No completion, time or progress is credited, and it is kept in history rather than deleted.
          {it.recurring && ` Because it repeats ${it.recurrence}, the next occurrence keeps its usual schedule, including today if due. Older missed dates will not pile up.`}
        </p>
      )}
      {action.error && <p role="alert" className="text-sm text-destructive" data-testid="text-missed-error">{action.error}</p>}
    </FormDialog>
  );
}
