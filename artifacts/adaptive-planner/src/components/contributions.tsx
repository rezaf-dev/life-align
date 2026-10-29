import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Pencil, Plus, TrendingUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, FormDialog } from '@/components/form-dialog';
import { fmt, todayIso } from '@/lib/dates';
import { deleteMetricEntry, editContribution, recordContribution } from '@/lib/store/actions';
import { contributionAmount, contributionPercent, formatValue } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';
import type { Goal, Metric, MetricEntry } from '@/lib/store/types';
import { flushWorkspace } from '@/lib/workspace-sync';
import { cn } from '@/lib/utils';

/* ---------- formatting helpers ---------- */

export function isContribution(e: MetricEntry) {
  return e.mode === 'contribution';
}

/** Signed change, e.g. "+12 customers" / "−$40". */
export function formatDelta(v: number, unit: string) {
  const sign = v > 0 ? '+' : v < 0 ? '\u2212' : '';
  return `${sign}${formatValue(Math.abs(v), unit)}`;
}

/** Share of baseline→target span, already direction-aware (favorable = positive). */
export function formatShare(metric: Metric, amount: number) {
  const p = contributionPercent(metric, amount);
  if (p === null || !Number.isFinite(p)) return null;
  const r = Math.abs(p) >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '\u2212' : ''}${Math.abs(r)}% of required change`;
}

function favorable(metric: Metric, amount: number) {
  const dir = Math.sign(metric.target - metric.baseline) || 1;
  return amount * dir > 0;
}

function sourceLabel(e: MetricEntry) {
  const s = e.source;
  if (!s) return 'Unattributed';
  if (s.taskTitle && s.milestoneTitle) return `${s.taskTitle} · ${s.milestoneTitle}`;
  return s.taskTitle ?? s.milestoneTitle ?? 'Unattributed';
}

/* ---------- Record / edit dialog ---------- */

export type RecordResultTarget = {
  metricId?: string;
  taskId?: string;
  milestoneId?: string;
  /** Edit mode: amount/date/note only, source is retained. */
  entryId?: string;
};

export function RecordResultDialog({
  goal,
  open,
  onOpenChange,
  target,
}: {
  goal: Goal;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target?: RecordResultTarget;
}) {
  const { tasks } = useAppState();
  const { toast } = useToast();
  const today = todayIso();
  const [mid, setMid] = useState('');
  const [kind, setKind] = useState<'task' | 'milestone'>('task');
  const [taskId, setTaskId] = useState('');
  const [msId, setMsId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [staged, setStaged] = useState<{ metricId: string; entryId: string } | null>(null);

  const editing = useMemo(() => {
    const entryId = target?.entryId ?? staged?.entryId;
    if (!entryId) return undefined;
    const m = goal.metrics.find((x) => x.id === (staged?.metricId ?? target?.metricId));
    return m?.entries.find((e) => e.id === entryId);
  }, [goal, target, staged]);

  useEffect(() => {
    if (!open) return;
    setMid(target?.metricId ?? goal.metrics[0]?.id ?? '');
    setKind(target?.milestoneId && !target?.taskId ? 'milestone' : 'task');
    setTaskId(target?.taskId ?? '');
    setMsId(target?.milestoneId ?? '');
    setAmount(editing ? String(editing.value) : '');
    setDate(editing?.date ?? todayIso());
    setNote(editing?.note ?? '');
    setPending(false);
    setStaged(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.metricId, target?.taskId, target?.milestoneId, target?.entryId]);

  const metric = goal.metrics.find((m) => m.id === mid);
  const goalTasks = tasks.filter((t) => t.goalId === goal.id && (!t.archived || t.id === taskId));
  const pickedTask = goalTasks.find((t) => t.id === taskId);
  const n = Number(amount);
  const amountOk = amount.trim() !== '' && Number.isFinite(n) && n !== 0;
  const sourceOk = !!editing || (kind === 'task' ? !!pickedTask : goal.milestones.some((m) => m.id === msId));
  const dateOk = !!date && date <= today;
  const share = metric && amountOk ? formatShare(metric, n) : null;
  const lockedSource = !!editing || !!target?.taskId || !!target?.milestoneId;

  const submit = async () => {
    if (!metric || pending) return;
    setPending(true);
    try {
      const entryId = target?.entryId ?? staged?.entryId;
      if (editing && entryId) {
        editContribution(goal.id, metric.id, entryId, { amount: n, date, note: note.trim() || undefined });
      } else {
        const recordedId = recordContribution(goal.id, metric.id, {
          amount: n,
          date,
          note: note.trim() || undefined,
          taskId: kind === 'task' ? taskId : undefined,
          milestoneId: kind === 'milestone' ? msId : undefined,
        });
        setStaged({ metricId: metric.id, entryId: recordedId });
      }
      await flushWorkspace();
      toast({ title: editing ? 'Contribution updated' : 'Contribution recorded', description: `${metric.name}: ${formatDelta(n, metric.unit)}` });
      onOpenChange(false);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not saved to your account', description: err instanceof Error ? err.message : 'Your draft remains on this screen. Retry saving.' });
    } finally {
      setPending(false);
    }
  };

  if (goal.metrics.length === 0) {
    return (
      <FormDialog open={open} onOpenChange={onOpenChange} title="Record result" submitLabel="Close" onSubmit={() => onOpenChange(false)}>
        <p className="text-sm text-muted-foreground" data-testid="text-record-no-metric">
          "{goal.title}" has nothing measured yet. Add a result measure on the goal's Results tab first, then credit changes to tasks or milestones.
        </p>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={editing ? 'Edit contribution' : 'Record contribution'}
      description="Credit a measured change to the work behind it. This is your historical attribution, not proof of cause."
      submitLabel={pending ? 'Saving…' : editing ? 'Save changes' : 'Record'}
      canSubmit={!!metric && amountOk && sourceOk && dateOk && !pending}
      onSubmit={() => void submit()}
    >
      <Field label="Metric">
        <Select value={mid} onValueChange={setMid} disabled={!!editing || pending}>
          <SelectTrigger data-testid="select-contribution-metric"><SelectValue placeholder="Choose a metric" /></SelectTrigger>
          <SelectContent>
            {goal.metrics.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}{m.unit ? ` (${m.unit})` : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {lockedSource ? (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" data-testid="text-contribution-source">
          <span className="text-xs text-muted-foreground">Credited to </span>
          {editing ? sourceLabel(editing) : pickedTask ? pickedTask.title : goal.milestones.find((m) => m.id === msId)?.title}
          {!editing && pickedTask?.milestoneId && (
            <span className="block text-xs text-muted-foreground">also counts toward milestone {goal.milestones.find((m) => m.id === pickedTask.milestoneId)?.title}</span>
          )}
          {editing && <span className="block text-xs text-muted-foreground">Source can't change. Delete and re-record to credit something else.</span>}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm font-medium">Credit to</div>
          <div role="radiogroup" aria-label="Credit to" className="inline-flex rounded-lg border border-border p-0.5">
            {(['task', 'milestone'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                disabled={pending}
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn('min-h-9 rounded-md px-3 text-sm', kind === k ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
                data-testid={`radio-contribution-${k}`}
              >
                {k === 'task' ? 'A task' : 'A milestone'}
              </button>
            ))}
          </div>
          {kind === 'task' ? (
            goalTasks.length ? (
              <Select value={taskId} onValueChange={setTaskId} disabled={pending}>
                <SelectTrigger data-testid="select-contribution-task"><SelectValue placeholder="Choose a task" /></SelectTrigger>
                <SelectContent>
                  {goalTasks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.title}{t.status === 'done' ? ' (done)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">No tasks in this goal yet. Credit a milestone instead.</p>
            )
          ) : goal.milestones.length ? (
            <Select value={msId} onValueChange={setMsId} disabled={pending}>
              <SelectTrigger data-testid="select-contribution-milestone"><SelectValue placeholder="Choose a milestone" /></SelectTrigger>
              <SelectContent>
                {goal.milestones.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">No milestones yet. Credit a task instead.</p>
          )}
          {kind === 'task' && pickedTask?.milestoneId && (
            <p className="text-xs text-muted-foreground">Also counts toward its milestone, {goal.milestones.find((m) => m.id === pickedTask.milestoneId)?.title}.</p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`Change${metric?.unit ? ` (${metric.unit})` : ''}`}
          htmlFor="contribution-amount"
          hint={amountOk && metric ? `${formatDelta(n, metric.unit)}${share ? ` · ${share}` : ''}${favorable(metric, n) ? '' : ' · unfavorable'}` : 'The amount it moved, not the new total. Negative is fine.'}
        >
          <Input id="contribution-amount" autoFocus disabled={pending} type="number" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 3 or -1.5" data-testid="input-contribution-amount" />
        </Field>
        <Field label="Date" htmlFor="contribution-date" hint={dateOk ? undefined : 'Today or earlier'}>
          <Input id="contribution-date" disabled={pending} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-contribution-date" />
        </Field>
      </div>
      <Field label="Note (optional)" htmlFor="contribution-note">
        <Input id="contribution-note" disabled={pending} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened?" data-testid="input-contribution-note" />
      </Field>
    </FormDialog>
  );
}

/* ---------- Results tab: per-metric attribution ---------- */

export function MetricAttribution({ goal, metric }: { goal: Goal; metric: Metric }) {
  const { tasks } = useAppState();
  const contribs = metric.entries.filter(isContribution);
  const total = contributionAmount(metric);
  if (!contribs.length) {
    return (
      <p className="mt-2 text-xs text-muted-foreground" data-testid={`text-attribution-empty-${metric.id}`}>
        No contributions credited yet.
      </p>
    );
  }
  const taskIds = [...new Set(contribs.map((e) => e.source?.taskId).filter(Boolean) as string[])];
  const msIds = [...new Set(contribs.flatMap((e) => [e.source?.milestoneId]).filter(Boolean) as string[])];
  const rows = [
    ...msIds.map((id) => ({ key: `m-${id}`, kind: 'Milestone', name: goal.milestones.find((m) => m.id === id)?.title ?? contribs.find((e) => e.source?.milestoneId === id)?.source?.milestoneTitle ?? 'Removed milestone', amt: contributionAmount(metric, { milestoneId: id }) })),
    ...taskIds.map((id) => ({ key: `t-${id}`, kind: 'Task', name: tasks.find((t) => t.id === id)?.title ?? contribs.find((e) => e.source?.taskId === id)?.source?.taskTitle ?? 'Removed task', amt: contributionAmount(metric, { taskId: id }) })),
  ];
  const share = formatShare(metric, total);
  return (
    <div className="mt-3 rounded-lg border border-border/80 p-2.5" data-testid={`attribution-${metric.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
        <span className="text-muted-foreground">Recorded contribution</span>
        <span className="font-num text-sm" data-testid={`text-attribution-total-${metric.id}`}>
          {formatDelta(total, metric.unit)}{share && <span className="text-muted-foreground"> · {share}</span>}
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-baseline gap-2 text-xs" data-testid={`attribution-row-${metric.id}-${r.key}`}>
            <span className="w-16 shrink-0 text-muted-foreground">{r.kind}</span>
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className={cn('font-num', !favorable(metric, r.amt) && r.amt !== 0 && 'text-destructive')}>{formatDelta(r.amt, metric.unit)}</span>
            <span className="hidden w-24 text-right font-num text-muted-foreground sm:inline">{formatShare(metric, r.amt) ?? ''}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.7rem] leading-snug text-muted-foreground">
        Credited by you after the fact, not proof of cause. A task's milestone total includes it, so rows overlap; the total counts each entry once.
      </p>
    </div>
  );
}
/** Entry list row for both checkpoints and contributions. */
export function MetricEntryRow({ goal, metric, entry, onEdit }: { goal: Goal; metric: Metric; entry: MetricEntry; onEdit: () => void }) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const contrib = isContribution(entry);
  const remove = async () => {
    try {
      deleteMetricEntry(goal.id, metric.id, entry.id);
      await flushWorkspace();
      toast({ title: contrib ? 'Contribution deleted' : 'Reading deleted' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Deletion not saved to your account', description: err instanceof Error ? err.message : 'Retry saving or reload your saved workspace.' });
    }
  };
  return (
    <li className="flex items-start gap-2 px-1 py-1 text-xs" data-testid={`entry-${entry.id}`}>
      <span className="w-12 shrink-0 pt-1.5 font-num text-muted-foreground">{fmt(entry.date, 'MMM d')}</span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn('font-num', contrib && !favorable(metric, entry.value) && 'text-destructive')}>
            {contrib ? formatDelta(entry.value, metric.unit) : formatValue(entry.value, metric.unit)}
          </span>
          <span className={cn('rounded px-1 text-[0.65rem]', contrib ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
            {contrib ? 'change' : 'reading'}
          </span>
        </div>
        {contrib && <div className="truncate text-muted-foreground">{sourceLabel(entry)}</div>}
        {entry.note && <div className="truncate text-muted-foreground italic">{entry.note}</div>}
      </div>
      {contrib && (
        <button type="button" onClick={onEdit} className="grid size-9 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Edit contribution from ${fmt(entry.date, 'MMM d')}`} data-testid={`button-edit-entry-${entry.id}`}>
          <Pencil className="size-3.5" />
        </button>
      )}
      <button type="button" onClick={() => setConfirm(true)} className="grid size-9 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Delete entry from ${fmt(entry.date, 'MMM d')}`} data-testid={`button-delete-entry-${entry.id}`}>
        <X className="size-3.5" />
      </button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={contrib ? 'Delete this contribution?' : 'Delete this reading?'}
        description={contrib ? `${formatDelta(entry.value, metric.unit)} credited to ${sourceLabel(entry)} will be removed and the current value recalculated.` : `The ${formatValue(entry.value, metric.unit)} reading from ${fmt(entry.date, 'MMM d')} will be removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void remove()}
      />
    </li>
  );
}

/* ---------- compact per-source summaries ---------- */

function summaries(goal: Goal | undefined, filter: { taskId?: string; milestoneId?: string }) {
  if (!goal) return [];
  return goal.metrics
    .map((m) => ({ m, amt: contributionAmount(m, filter) }))
    .filter((x) => x.amt !== 0 && Number.isFinite(x.amt));
}

export function ContributionChips({ goal, filter, testId }: { goal?: Goal; filter: { taskId?: string; milestoneId?: string }; testId: string }) {
  const list = summaries(goal, filter);
  if (!list.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-x-2" data-testid={testId}>
      {list.map(({ m, amt }) => {
        const share = formatShare(m, amt);
        return (
          <span key={m.id} className={cn('inline-flex items-center gap-1 font-num', favorable(m, amt) ? 'text-primary' : 'text-destructive')}>
            <TrendingUp className="size-3" />
            {formatDelta(amt, m.unit)} {m.name.toLowerCase()}
            {share && <span className="text-muted-foreground">({share})</span>}
          </span>
        );
      })}
    </span>
  );
}

/** Task dialog section; host renders the dialog itself so we never stack modals. */
export function TaskContributionSection({ goal, taskId, onRecord }: { goal?: Goal; taskId?: string; onRecord: () => void }) {
  const [open, setOpen] = useState(false);
  let body;
  if (!taskId) body = <p className="text-xs text-muted-foreground">Save the task first, then record what it moved.</p>;
  else if (!goal) body = <p className="text-xs text-muted-foreground">Link this task to a goal with a result measure to credit outcomes to it.</p>;
  else if (!goal.metrics.length) body = <p className="text-xs text-muted-foreground">"{goal.title}" has nothing measured yet. Add a measure on the goal's Results tab first.</p>;
  else {
    const list = summaries(goal, { taskId });
    body = (
      <>
        {list.length ? (
          <ul className="space-y-1">
            {list.map(({ m, amt }) => (
              <li key={m.id} className="flex items-baseline justify-between gap-3 text-sm" data-testid={`text-task-contribution-${m.id}`}>
                <span className="truncate">{m.name}</span>
                <span className="font-num">{formatDelta(amt, m.unit)} <span className="text-xs text-muted-foreground">{formatShare(m, amt) ?? ''}</span></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing credited yet. Completing a task never changes results on its own.</p>
        )}
        <Button type="button" size="sm" variant="outline" className="mt-2 h-9" onClick={onRecord} data-testid="button-task-record-result">
          <Plus /> Record result
        </Button>
        <p className="mt-1 text-[0.7rem] text-muted-foreground">Uses the task’s saved goal and milestone. Unsaved task edits are kept here while you record a result.</p>
      </>
    );
  }
  return (
    <div className="rounded-lg border border-border">
      <button type="button" className="flex min-h-10 w-full items-center justify-between px-3 text-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="button-toggle-task-results">
        <span className="inline-flex items-center gap-2"><TrendingUp className="size-4 text-primary" /> Measured results</span>
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-border px-3 py-2.5">{body}</div>}
    </div>
  );
}
