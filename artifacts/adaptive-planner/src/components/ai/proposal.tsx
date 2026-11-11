import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, ChevronDown, CircleSlash, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AreaDot } from '@/components/primitives';
import { addDaysIso, fmt } from '@/lib/dates';
import { effortLabel } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';
import type { AppState, Area } from '@/lib/store/types';
import { AREAS } from '@/lib/store/types';
import { isOptional, needsReason, OP_LABEL, type Operation, type Proposal } from '@/lib/ai/types';
import { cn } from '@/lib/utils';

type Kind = 'text' | 'long' | 'date' | 'datetime' | 'number' | 'select' | 'goal' | 'milestone' | 'task' | 'bool';
type FieldDef = { k: keyof Operation; label: string; kind: Kind; options?: string[] };

const PRIORITY = ['high', 'medium', 'low'];
const F = {
  title: { k: 'title', label: 'Title', kind: 'text' },
  outcome: { k: 'outcome', label: 'Outcome', kind: 'long' },
  area: { k: 'area', label: 'Area', kind: 'select', options: AREAS.map((a) => a.value) },
  priority: { k: 'priority', label: 'Priority', kind: 'select', options: PRIORITY },
  targetDate: { k: 'targetDate', label: 'Target date', kind: 'date' },
  summary: { k: 'summary', label: 'Strategy', kind: 'long' },
  rationale: { k: 'rationale', label: 'Why this works', kind: 'long' },
  goalId: { k: 'goalId', label: 'Goal', kind: 'goal' },
  milestoneId: { k: 'milestoneId', label: 'Milestone', kind: 'milestone' },
  parentTaskId: { k: 'parentTaskId', label: 'Part of', kind: 'task' },
  plannedDate: { k: 'plannedDate', label: 'Planned', kind: 'date' },
  dueDate: { k: 'dueDate', label: 'Due', kind: 'date' },
  effort: { k: 'effort', label: 'Effort (min)', kind: 'number' },
  recurrence: { k: 'recurrence', label: 'Repeats', kind: 'select', options: ['none', 'daily', 'weekly', 'monthly'] },
  reminder: { k: 'reminder', label: 'Reminder', kind: 'datetime' },
  notes: { k: 'notes', label: 'Notes', kind: 'long' },
  status: { k: 'status', label: 'Status', kind: 'select', options: ['active', 'paused', 'completed', 'cancelled'] },
  done: { k: 'done', label: 'Done', kind: 'bool' },
} satisfies Record<string, FieldDef>;

const FIELDS: Record<Operation['type'], FieldDef[]> = {
  create_goal: [F.title, F.outcome, F.area, F.priority, F.targetDate, F.summary, F.rationale],
  update_goal: [F.title, F.outcome, F.area, F.priority, F.targetDate, F.status],
  create_strategy: [F.summary, F.rationale],
  update_strategy: [F.summary, F.rationale],
  create_milestone: [F.goalId, F.title, F.dueDate],
  update_milestone: [F.title, F.dueDate, F.done],
  create_task: [F.title, F.goalId, F.milestoneId, F.parentTaskId, F.plannedDate, F.dueDate, F.effort, F.priority, F.recurrence, F.reminder, F.notes],
  update_task: [F.title, F.goalId, F.milestoneId, F.parentTaskId, F.plannedDate, F.dueDate, F.effort, F.priority, F.recurrence, F.reminder, F.notes],
  link_task_to_goal: [F.goalId, F.milestoneId],
  create_weekly_plan: [
    { k: 'weekStart', label: 'Week of', kind: 'date' },
    { k: 'focus', label: 'Focus', kind: 'long' },
    { k: 'capacityMinutes', label: 'Capacity (min)', kind: 'number' },
  ],
  reschedule_task: [F.plannedDate, F.dueDate],
  record_metric: [
    F.goalId,
    { k: 'name', label: 'Measure', kind: 'text' },
    { k: 'value', label: 'Value', kind: 'number' },
    { k: 'date', label: 'Date', kind: 'date' },
    { k: 'unit', label: 'Unit', kind: 'text' },
    { k: 'kind', label: 'Kind', kind: 'select', options: ['outcome', 'leading'] },
    { k: 'baseline', label: 'Baseline', kind: 'number' },
    { k: 'target', label: 'Target', kind: 'number' },
  ],
  create_review: [
    { k: 'reviewType', label: 'Type', kind: 'select', options: ['weekly', 'monthly'] },
    { k: 'periodStart', label: 'From', kind: 'date' },
    { k: 'periodEnd', label: 'To', kind: 'date' },
    { k: 'wins', label: 'Wins', kind: 'long' },
    { k: 'misses', label: 'Misses', kind: 'long' },
    { k: 'learned', label: 'Learned', kind: 'long' },
    { k: 'change', label: 'Change next', kind: 'long' },
    { k: 'focus', label: 'Next focus', kind: 'long' },
  ],
};

const isCreate = (t: Operation['type']) => t.startsWith('create_') || t === 'record_metric';

/** Resolves ids or proposal keys to human labels. */
function useResolver(ops: Operation[]) {
  const state = useAppState();
  return useMemo(() => {
    const byKey = new Map(ops.map((o) => [o.key, o]));
    const goal = (id?: string) => {
      if (!id) return undefined;
      const g = state.goals.find((x) => x.id === id);
      if (g) return { title: g.title, area: g.area as Area, isNew: false, goalId: g.id };
      const o = byKey.get(id);
      if (o?.type === 'create_goal') return { title: o.title || 'New goal', area: (o.area || 'personal') as Area, isNew: true, goalId: undefined };
      return undefined;
    };
    const task = (id?: string) => {
      if (!id) return undefined;
      const t = state.tasks.find((x) => x.id === id);
      if (t) return { title: t.title, plannedDate: t.plannedDate, effort: t.effort, isNew: false };
      const o = byKey.get(id);
      if (o?.type === 'create_task') return { title: o.title || 'New task', plannedDate: o.plannedDate, effort: o.effort ?? 0, isNew: true };
      return undefined;
    };
    const milestone = (id?: string) => {
      if (!id) return undefined;
      for (const g of state.goals) {
        const m = g.milestones.find((x) => x.id === id);
        if (m) return { title: m.title, dueDate: m.dueDate, goalId: g.id, isNew: false };
      }
      const o = byKey.get(id);
      if (o?.type === 'create_milestone') return { title: o.title || 'New milestone', dueDate: o.dueDate, goalId: o.goalId, isNew: true };
      return undefined;
    };
    const goalOptions = [
      ...state.goals.filter((g) => g.status === 'active' || g.status === 'paused').map((g) => ({ id: g.id, title: g.title })),
      ...ops.filter((o) => o.type === 'create_goal').map((o) => ({ id: o.key, title: `${o.title || 'New goal'} (new)` })),
    ];
    const milestoneOptions = (goalId?: string) => {
      const g = state.goals.find((x) => x.id === goalId);
      return [
        ...(g?.milestones.filter((m) => !m.done).map((m) => ({ id: m.id, title: m.title })) ?? []),
        ...ops.filter((o) => o.type === 'create_milestone' && o.goalId === goalId).map((o) => ({ id: o.key, title: `${o.title} (new)` })),
      ];
    };
    const taskOptions = [
      ...state.tasks.filter((t) => t.status === 'open' && !t.archived).slice(0, 80).map((t) => ({ id: t.id, title: t.title })),
      ...ops.filter((o) => o.type === 'create_task').map((o) => ({ id: o.key, title: `${o.title} (new)` })),
    ];
    return { state, goal, task, milestone, goalOptions, milestoneOptions, taskOptions };
  }, [state, ops]);
}
type Resolver = ReturnType<typeof useResolver>;

/** Current value of a field on the existing record targeted by an update operation. */
function beforeValue(op: Operation, k: keyof Operation, state: AppState): string | undefined {
  const s = (v: unknown) => (v === undefined || v === null || v === '' ? '(none)' : String(v));
  if (op.type === 'update_goal' || op.type === 'update_strategy') {
    const g = state.goals.find((x) => x.id === op.goalId);
    if (!g) return undefined;
    if (k === 'summary') return s(g.strategy.summary);
    if (k === 'rationale') return s(g.strategy.rationale);
    return s((g as unknown as Record<string, unknown>)[k as string]);
  }
  if (op.type === 'update_milestone') {
    const m = state.goals.flatMap((g) => g.milestones).find((x) => x.id === op.milestoneId);
    return m ? s((m as unknown as Record<string, unknown>)[k as string]) : undefined;
  }
  if (op.type === 'update_task' || op.type === 'reschedule_task' || op.type === 'link_task_to_goal') {
    const t = state.tasks.find((x) => x.id === op.taskId);
    return t ? s((t as unknown as Record<string, unknown>)[k as string]) : undefined;
  }
  if (op.type === 'create_weekly_plan' && op.weekStart) {
    const p = state.weekPlans[op.weekStart];
    if (!p) return undefined;
    if (k === 'focus') return s(p.focus);
    if (k === 'capacityMinutes') return s(p.capacityMinutes);
  }
  return undefined;
}

function displayValue(v: string | undefined, kind: Kind, r: Resolver) {
  if (!v || v === '(none)') return 'none';
  if (kind === 'goal') return r.goal(v)?.title ?? v;
  if (kind === 'task') return r.task(v)?.title ?? v;
  if (kind === 'milestone') return r.milestone(v)?.title ?? v;
  if (kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmt(v, 'EEE MMM d, yyyy');
  return v;
}

const inputCls = 'h-8 text-[0.85rem]';

function FieldEditor({ op, def, r, onChange }: { op: Operation; def: FieldDef; r: Resolver; onChange: (patch: Partial<Operation>) => void }) {
  const v = op[def.k];
  const id = `f-${op.key}-${def.k}`;
  const set = (val: unknown) => onChange({ [def.k]: val } as Partial<Operation>);
  const before = beforeValue(op, def.k, r.state);
  const changed = before !== undefined && String(v ?? '') !== (before === '(none)' ? '' : before);
  const selectCls = cn(inputCls, 'w-full rounded-md border border-input bg-background px-2');

  let control;
  switch (def.kind) {
    case 'long':
      control = <Textarea id={id} rows={2} value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} className="min-h-[3.25rem] text-[0.85rem]" data-testid={`input-op-${def.k}-${op.key}`} />;
      break;
    case 'date':
      control = <Input id={id} type="date" value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} className={inputCls} data-testid={`input-op-${def.k}-${op.key}`} />;
      break;
    case 'datetime':
      control = <Input id={id} type="datetime-local" value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} className={inputCls} data-testid={`input-op-${def.k}-${op.key}`} />;
      break;
    case 'number':
      control = <Input id={id} type="number" inputMode="numeric" value={v === undefined ? '' : String(v)} onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))} className={cn(inputCls, 'font-num')} data-testid={`input-op-${def.k}-${op.key}`} />;
      break;
    case 'bool':
      control = (
        <label className="flex h-8 items-center gap-2 text-sm">
          <input id={id} type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" data-testid={`input-op-${def.k}-${op.key}`} />
          Mark as done
        </label>
      );
      break;
    case 'select':
      control = (
        <select id={id} value={(v as string) ?? ''} onChange={(e) => set(e.target.value || undefined)} className={selectCls} data-testid={`select-op-${def.k}-${op.key}`}>
          <option value="">Not set</option>
          {def.options!.map((o) => (
            <option key={o} value={o}>{def.k === 'area' ? AREAS.find((a) => a.value === o)?.label : o}</option>
          ))}
        </select>
      );
      break;
    case 'goal':
    case 'milestone':
    case 'task': {
      const opts = def.kind === 'goal' ? r.goalOptions : def.kind === 'milestone' ? r.milestoneOptions(op.goalId) : r.taskOptions.filter((t) => t.id !== op.key && t.id !== op.taskId);
      const cur = v as string | undefined;
      const known = !cur || opts.some((o) => o.id === cur);
      control = (
        <select id={id} value={cur ?? ''} onChange={(e) => set(e.target.value)} className={selectCls} data-testid={`select-op-${def.k}-${op.key}`}>
          <option value="">{def.kind === 'goal' ? 'No goal' : def.kind === 'milestone' ? 'No milestone' : 'Standalone'}</option>
          {!known && <option value={cur}>{displayValue(cur, def.kind, r)}</option>}
          {opts.map((o) => (
            <option key={o.id} value={o.id}>{o.title}</option>
          ))}
        </select>
      );
      break;
    }
    default:
      control = <Input id={id} value={(v as string) ?? ''} onChange={(e) => set(e.target.value)} className={inputCls} data-testid={`input-op-${def.k}-${op.key}`} />;
  }

  return (
    <div className={cn(def.kind === 'long' && 'sm:col-span-2')}>
      <label htmlFor={id} className="mb-1 block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">{def.label}</label>
      {control}
      {changed && (
        <div className="mt-1 flex items-start gap-1.5 text-[0.72rem] text-muted-foreground" data-testid={`text-before-${def.k}-${op.key}`}>
          <span className="shrink-0">was</span>
          <span className="line-through decoration-foreground/30">{displayValue(before, def.kind, r)}</span>
        </div>
      )}
    </div>
  );
}

function targetLine(op: Operation, r: Resolver) {
  if (op.type === 'update_goal' || op.type === 'create_strategy' || op.type === 'update_strategy') return r.goal(op.goalId)?.title;
  if (op.type === 'update_milestone') return r.milestone(op.milestoneId)?.title;
  if (op.type === 'update_task' || op.type === 'reschedule_task' || op.type === 'link_task_to_goal') return r.task(op.taskId)?.title;
  if (op.type === 'record_metric') {
    const g = r.state.goals.find((x) => x.id === op.goalId);
    return g?.metrics.find((m) => m.id === op.metricId)?.name;
  }
  return undefined;
}

function headline(op: Operation, r: Resolver) {
  switch (op.type) {
    case 'create_weekly_plan':
      return op.weekStart ? `Week of ${fmt(op.weekStart, 'MMM d')}` : 'Weekly plan';
    case 'create_strategy':
    case 'update_strategy':
      return op.summary || 'Strategy';
    case 'record_metric':
      return `${op.name || targetLine(op, r) || 'Result'}: ${op.value ?? ''}${op.unit ? ` ${op.unit}` : ''}`;
    case 'create_review':
      return `${op.reviewType === 'monthly' ? 'Monthly' : 'Weekly'} review`;
    case 'reschedule_task':
    case 'link_task_to_goal':
      return targetLine(op, r) || 'Task';
    default:
      return op.title || targetLine(op, r) || OP_LABEL[op.type];
  }
}

function WeekGrid({ op, r, onChange }: { op: Operation; r: Resolver; onChange: (p: Partial<Operation>) => void }) {
  const ids = op.taskIds ?? [];
  const ws = op.weekStart;
  const days = ws ? Array.from({ length: 7 }, (_, i) => addDaysIso(ws, i)) : [];
  const items = ids.map((id) => ({ id, t: r.task(id) }));
  const total = items.reduce((a, x) => a + (x.t?.effort ?? 0), 0);
  const cap = op.capacityMinutes ?? r.state.weekPlans[ws ?? '']?.capacityMinutes ?? 0;
  const groups = [
    ...days.map((d) => ({ key: d, label: fmt(d, 'EEE d'), list: items.filter((x) => x.t?.plannedDate === d) })),
    { key: 'other', label: 'Unscheduled', list: items.filter((x) => !x.t?.plannedDate || !days.includes(x.t.plannedDate)) },
  ].filter((g) => g.list.length);
  return (
    <div className="mt-3 sm:col-span-2">
      <div className="mb-1.5 flex items-baseline justify-between text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Committed tasks ({ids.length})</span>
        <span className={cn('font-num normal-case', cap && total > cap && 'text-destructive')} data-testid={`text-week-load-${op.key}`}>
          {effortLabel(total) || '0m'} of {effortLabel(cap) || 'no cap'}
        </span>
      </div>
      {groups.length === 0 && <p className="text-xs text-muted-foreground">No tasks selected for this week.</p>}
      <div className="space-y-1.5">
        {groups.map((g) => (
          <div key={g.key} className="grid grid-cols-[3.75rem_1fr] gap-2">
            <div className="pt-1 font-num text-[0.7rem] text-muted-foreground">{g.label}</div>
            <ul className="space-y-0.5">
              {g.list.map(({ id, t }) => (
                <li key={id} className="group flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-[0.82rem]">
                  <span className="min-w-0 flex-1 truncate">{t?.title ?? id}</span>
                  {t?.isNew && <span className="font-num text-[0.62rem] uppercase text-primary">new</span>}
                  {!!t?.effort && <span className="font-num text-[0.7rem] text-muted-foreground">{effortLabel(t.effort)}</span>}
                  <button
                    type="button"
                    aria-label={`Remove ${t?.title ?? id} from plan`}
                    onClick={() => onChange({ taskIds: ids.filter((x) => x !== id) })}
                    className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                    data-testid={`button-remove-plan-task-${id}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpCard({
  op,
  selected,
  locked,
  onToggle,
  onChange,
  r,
}: {
  op: Operation;
  selected: boolean;
  locked: boolean;
  onToggle: (v: boolean) => void;
  onChange: (p: Partial<Operation>) => void;
  r: Resolver;
}) {
  const [open, setOpen] = useState(() => !isCreate(op.type) || (op.type === 'create_weekly_plan' && !!r.state.weekPlans[op.weekStart ?? '']?.focus));
  const optional = isOptional(op);
  const reasonNeeded = needsReason(op, r.state);
  const missingReason = selected && reasonNeeded && !op.reason?.trim();
  const target = targetLine(op, r);
  const goal = r.goal(op.goalId);
  const fields = FIELDS[op.type].filter((f) => isCreate(op.type) || op[f.k] !== undefined || (op.type === 'update_task' && f.k === 'title'));
  const meta: string[] = [];
  if (op.plannedDate) meta.push(fmt(op.plannedDate, 'EEE MMM d'));
  if (op.dueDate) meta.push(`due ${fmt(op.dueDate, 'MMM d')}`);
  if (op.targetDate) meta.push(`by ${fmt(op.targetDate, 'MMM d, yyyy')}`);
  if (op.effort) meta.push(effortLabel(op.effort));
  if (op.recurrence && op.recurrence !== 'none') meta.push(op.recurrence);
  const parent = r.task(op.parentTaskId);
  const ms = r.milestone(op.milestoneId);
  const isUpdate = !isCreate(op.type);

  return (
    <li
      className={cn('rounded-lg border bg-card transition-colors', selected ? 'border-card-border' : 'border-dashed border-border opacity-70', missingReason && 'border-destructive/50')}
      data-testid={`card-op-${op.key}`}
    >
      <div className="flex items-start gap-2 p-2.5">
        <input
          type="checkbox"
          checked={selected}
          disabled={locked}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Include ${headline(op, r)}`}
          className="mt-1 size-4 shrink-0 accent-[hsl(var(--primary))]"
          data-testid={`checkbox-op-${op.key}`}
        />
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left" aria-expanded={open} data-testid={`button-expand-op-${op.key}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('font-num text-[0.62rem] uppercase tracking-wider', isUpdate ? 'text-destructive/80' : 'text-primary')}>{OP_LABEL[op.type]}</span>
            {optional && <span className="rounded-full border border-dashed border-foreground/30 px-1.5 font-num text-[0.6rem] uppercase text-muted-foreground">Optional</span>}
          </div>
          <div className="mt-0.5 text-[0.9rem] font-medium leading-snug">{headline(op, r)}</div>
          {isUpdate && target && op.type !== 'reschedule_task' && op.type !== 'link_task_to_goal' && <div className="text-xs text-muted-foreground">on {target}</div>}
          {(meta.length > 0 || goal || parent || ms) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {goal && op.type !== 'update_goal' && op.type !== 'create_strategy' && op.type !== 'update_strategy' && (
                <span className="inline-flex items-center gap-1"><AreaDot area={goal.area} goalId={goal.goalId} />{goal.title}</span>
              )}
              {ms && <span>{ms.title}</span>}
              {parent && <span>under {parent.title}</span>}
              {meta.map((m) => <span key={m} className="font-num">{m}</span>)}
            </div>
          )}
          {op.type === 'reschedule_task' && (
            <BeforeAfter before={beforeValue(op, 'plannedDate', r.state)} after={op.plannedDate} />
          )}
        </button>
        <ChevronDown className={cn('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </div>
      {(open || missingReason || op.type === 'create_weekly_plan') && (
        <div className="grid gap-2.5 border-t border-border/70 p-2.5 sm:grid-cols-2">
          {open && fields.map((f) => <FieldEditor key={f.k} op={op} def={f} r={r} onChange={onChange} />)}
          {(reasonNeeded || op.reason !== undefined) && (
            <div className="sm:col-span-2">
              <label htmlFor={`f-${op.key}-reason`} className="mb-1 block text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
                Reason {reasonNeeded && <span className="text-destructive">required</span>}
              </label>
              <Input
                id={`f-${op.key}-reason`}
                value={op.reason ?? ''}
                onChange={(e) => onChange({ reason: e.target.value })}
                placeholder="Why this change is worth making"
                className={inputCls}
                data-testid={`input-op-reason-${op.key}`}
              />
            </div>
          )}
          {op.type === 'create_weekly_plan' && <WeekGrid op={op} r={r} onChange={onChange} />}
        </div>
      )}
    </li>
  );
}

function BeforeAfter({ before, after }: { before?: string; after?: string }) {
  const b = !before || before === '(none)' ? 'Inbox' : fmt(before, 'EEE MMM d');
  const a = !after ? 'Inbox' : fmt(after, 'EEE MMM d');
  return (
    <div className="mt-1 flex items-center gap-1.5 font-num text-xs">
      <span className="text-muted-foreground line-through decoration-foreground/30">{b}</span>
      <ArrowRight className="size-3 text-muted-foreground" />
      <span className="text-foreground">{a}</span>
    </div>
  );
}

/** Keys of ops that depend (directly or transitively) on `key`. */
function dependents(ops: Operation[], key: string): string[] {
  const out = new Set<string>();
  const walk = (k: string) => {
    ops.forEach((o) => {
      const refs = [o.goalId, o.taskId, o.milestoneId, o.parentTaskId];
      if (refs.includes(k) && !out.has(o.key)) {
        out.add(o.key);
        walk(o.key);
      }
    });
  };
  walk(key);
  return [...out];
}

export function ProposalView({
  proposal,
  onChange,
  onApprove,
  onReject,
  applying,
  busy,
}: {
  proposal: Proposal;
  onChange: (p: Proposal) => void;
  onApprove: () => void;
  onReject: () => void;
  applying: boolean;
  busy: boolean;
}) {
  const r = useResolver(proposal.operations);
  const locked = proposal.status !== 'pending' || applying;
  const sel = new Set(proposal.selected);
  const chosen = proposal.operations.filter((o) => sel.has(o.key));
  const missing = chosen.filter((o) => needsReason(o, r.state) && !o.reason?.trim());

  const toggle = (key: string, v: boolean) => {
    const next = new Set(sel);
    if (v) {
      next.add(key);
      // Selecting an op pulls in the records it references.
      const op = proposal.operations.find((o) => o.key === key);
      [op?.goalId, op?.milestoneId, op?.parentTaskId, op?.taskId].forEach((k) => {
        if (k && proposal.operations.some((o) => o.key === k)) next.add(k);
      });
    } else {
      next.delete(key);
      dependents(proposal.operations, key).forEach((k) => next.delete(k));
    }
    onChange({ ...proposal, selected: [...next] });
  };
  const patch = (key: string, p: Partial<Operation>) =>
    onChange({ ...proposal, requestId: undefined, staleNotice: false, operations: proposal.operations.map((o) => (o.key === key ? { ...o, ...p } : o)) });

  if (proposal.status === 'applied') {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-3" data-testid={`proposal-applied-${proposal.id}`}>
        <div className="flex items-center gap-2 text-sm font-medium text-success"><Check className="size-4" /> Applied to your workspace</div>
        {proposal.changes && proposal.changes.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[0.8rem] text-muted-foreground">
            {proposal.changes.map((c, i) => <li key={i} className="flex gap-1.5"><span aria-hidden>-</span>{c}</li>)}
          </ul>
        )}
      </div>
    );
  }
  if (proposal.status === 'rejected' || proposal.status === 'superseded') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground" data-testid={`proposal-${proposal.status}-${proposal.id}`}>
        <CircleSlash className="size-3.5" />
        {proposal.status === 'rejected' ? `Declined. ${proposal.operations.length} suggested change${proposal.operations.length === 1 ? '' : 's'} not applied.` : 'Replaced by a revised proposal below.'}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.035] p-2.5" data-testid={`proposal-${proposal.id}`}>
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="eyebrow !text-primary">Proposed changes</span>
        <span className="font-num text-[0.7rem] text-muted-foreground">{chosen.length} of {proposal.operations.length} selected</span>
      </div>
      <ul className="space-y-1.5">
        {proposal.operations.map((op) => (
          <OpCard key={op.key} op={op} r={r} selected={sel.has(op.key)} locked={locked} onToggle={(v) => toggle(op.key, v)} onChange={(p) => patch(op.key, p)} />
        ))}
      </ul>
      {proposal.staleNotice && (
        <div className="mt-2 flex gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive" role="alert" data-testid="text-proposal-stale">
          <AlertTriangle className="size-4 shrink-0" />
          Your workspace changed while this was being applied, so nothing was overwritten. Check the changes and approve again to apply them to the latest data.
        </div>
      )}
      {missing.length > 0 && <p className="mt-2 text-xs text-destructive">Add a reason for {missing.length} change{missing.length === 1 ? '' : 's'} to existing records.</p>}
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onReject} disabled={applying} data-testid="button-reject-proposal">Decline</Button>
        <Button size="sm" onClick={onApprove} disabled={applying || busy || chosen.length === 0 || missing.length > 0} data-testid="button-approve-proposal">
          {applying ? <Loader2 className="animate-spin" /> : <Check />}
          {applying ? 'Applying' : `Apply ${chosen.length}`}
        </Button>
      </div>
    </div>
  );
}
