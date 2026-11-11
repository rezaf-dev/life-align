import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Field, FormDialog } from '@/components/form-dialog';
import { addDaysIso, todayIso } from '@/lib/dates';
import { addGoal, editGoalBasics, logMetric } from '@/lib/store/actions';
import { formatValue, metricValueAt, measurementTargetAt } from '@/lib/store/selectors';
import { AREAS, GOAL_CATEGORIES } from '@/lib/store/types';
import { FrequencySelect, MeasurementStartField, PeriodCreditHint, isRecurring, type Frequency } from '@/components/measurement-period';
import type { Area, Goal, GoalCategory, MetricKind, Priority } from '@/lib/store/types';
import { isMeasurementDate } from '@workspace/api-zod';

export function AreaSelect({ value, onChange }: { value: Area; onChange: (a: Area) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Area)}>
      <SelectTrigger data-testid="select-goal-area"><SelectValue /></SelectTrigger>
      <SelectContent>
        {AREAS.map((a) => (
          <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Kind of work a goal represents. Separate from Area (life domain); legacy goals show Other. */
export function CategorySelect({ value, onChange }: { value: GoalCategory; onChange: (c: GoalCategory) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as GoalCategory)}>
      <SelectTrigger data-testid="select-goal-category"><SelectValue /></SelectTrigger>
      <SelectContent>
        {GOAL_CATEGORIES.map((c) => (
          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PrioritySelect({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Priority)}>
      <SelectTrigger data-testid="select-goal-priority"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="high">High</SelectItem>
        <SelectItem value="medium">Medium</SelectItem>
        <SelectItem value="low">Low</SelectItem>
      </SelectContent>
    </Select>
  );
}

const blank = () => ({
  title: '',
  outcome: '',
  area: 'business' as Area,
  category: 'other' as GoalCategory,
  priority: 'medium' as Priority,
  targetDate: addDaysIso(todayIso(), 90),
  strategy: '',
  rationale: '',
  metricName: '',
  metricUnit: '',
  metricBaseline: '0',
  metricTarget: '',
  metricKind: 'outcome' as MetricKind,
  metricFrequency: 'cumulative' as Frequency,
  metricStartDate: todayIso(),
});

export function NewGoalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState(blank);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  useEffect(() => {
    if (open) setF(blank());
  }, [open]);
  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const goalRecurring = f.metricFrequency !== 'cumulative';
  const metricOk = !f.metricName.trim() || (f.metricTarget !== '' && Number.isFinite(Number(f.metricTarget)) && (!goalRecurring || (Number(f.metricTarget) > 0 && isMeasurementDate(f.metricStartDate))));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="A new direction"
      description="Name the outcome you want, not the activity. You can refine strategy and milestones in the workspace."
      submitLabel="Create goal"
      canSubmit={!!f.title.trim() && !!f.targetDate && metricOk}
      wide
      onSubmit={() => {
        const id = addGoal({
          title: f.title,
          outcome: f.outcome,
          area: f.area,
          category: f.category,
          priority: f.priority,
          targetDate: f.targetDate,
          strategy: f.strategy,
          rationale: f.rationale,
          metric: f.metricName.trim()
            ? {
                name: f.metricName.trim(),
                unit: f.metricUnit.trim(),
                baseline: goalRecurring ? 0 : Number(f.metricBaseline) || 0,
                target: Number(f.metricTarget),
                kind: f.metricKind,
                frequency: f.metricFrequency,
                startDate: goalRecurring ? f.metricStartDate : undefined,
              }
            : undefined,
        });
        onOpenChange(false);
        toast({ title: 'Goal created' });
        navigate(`/goals/${id}`);
      }}
    >
      <Field label="Goal" htmlFor="goal-title">
        <Input id="goal-title" autoFocus placeholder="e.g. Reach $5,000 monthly revenue" value={f.title} onChange={(e) => set('title', e.target.value)} data-testid="input-goal-title" />
      </Field>
      <Field label="Desired outcome" htmlFor="goal-outcome" hint="What will be true when this is done?">
        <Textarea id="goal-outcome" rows={2} value={f.outcome} onChange={(e) => set('outcome', e.target.value)} data-testid="input-goal-outcome" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Area"><AreaSelect value={f.area} onChange={(v) => set('area', v)} /></Field>
        <Field label="Category" hint="The type of work, used to group time and tasks."><CategorySelect value={f.category} onChange={(v) => set('category', v)} /></Field>
        <Field label="Priority"><PrioritySelect value={f.priority} onChange={(v) => set('priority', v)} /></Field>
        <Field label="Target date" htmlFor="goal-target">
          <Input id="goal-target" type="date" value={f.targetDate} onChange={(e) => set('targetDate', e.target.value)} data-testid="input-goal-target" />
        </Field>
      </div>
      <Field label="Strategy (optional)" htmlFor="goal-strategy">
        <Textarea id="goal-strategy" rows={2} value={f.strategy} onChange={(e) => set('strategy', e.target.value)} data-testid="input-goal-strategy" />
      </Field>
      <div className="rounded-xl border border-dashed border-border p-4">
        <div className="eyebrow mb-3">First result to measure (optional)</div>
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Metric" className="sm:col-span-2">
            <Input placeholder="Monthly revenue" value={f.metricName} onChange={(e) => set('metricName', e.target.value)} data-testid="input-goal-metric-name" />
          </Field>
          <Field label="Unit"><Input placeholder="$, kg" value={f.metricUnit} onChange={(e) => set('metricUnit', e.target.value)} data-testid="input-goal-metric-unit" /></Field>
          {goalRecurring ? (
            <Field label="Start"><div className="flex h-10 items-center rounded-md border border-dashed border-border px-3 font-num text-sm text-muted-foreground" data-testid="text-goal-metric-baseline-fixed">0</div></Field>
          ) : (
            <Field label="Start"><Input type="number" step="any" value={f.metricBaseline} onChange={(e) => set('metricBaseline', e.target.value)} data-testid="input-goal-metric-baseline" /></Field>
          )}
          <Field label={goalRecurring ? (f.metricFrequency === 'weekly' ? 'Target / week' : 'Target / month') : 'Target'}><Input type="number" step="any" min={goalRecurring ? 0 : undefined} value={f.metricTarget} onChange={(e) => set('metricTarget', e.target.value)} data-testid="input-goal-metric-target" /></Field>
        </div>
        <Field label="Measured" className="mt-3" hint={goalRecurring ? 'Each period starts at 0 with no carryover. Example: 30 hours each month.' : 'One running total from the start value toward the target.'}>
          <FrequencySelect value={f.metricFrequency} onChange={(v) => set('metricFrequency', v)} testId="select-goal-metric-frequency" />
        </Field>
        {goalRecurring && <MeasurementStartField frequency={f.metricFrequency} target={Number(f.metricTarget)} unit={f.metricUnit} value={f.metricStartDate} onChange={(v) => set('metricStartDate', v)} testId="goal-measure-start" />}
      </div>
    </FormDialog>
  );
}

export function EditGoalDialog({ goal, open, onOpenChange }: { goal: Goal; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState({ title: goal.title, outcome: goal.outcome, area: goal.area, category: (goal.category ?? 'other') as GoalCategory, priority: goal.priority });
  useEffect(() => {
    if (open) setF({ title: goal.title, outcome: goal.outcome, area: goal.area, category: (goal.category ?? 'other') as GoalCategory, priority: goal.priority });
  }, [open, goal]);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit goal"
      description="Strategy and target date have their own edits so the reason is recorded."
      canSubmit={!!f.title.trim()}
      onSubmit={() => {
        editGoalBasics(goal.id, { ...f, title: f.title.trim() });
        onOpenChange(false);
      }}
    >
      <Field label="Goal" htmlFor="edit-goal-title">
        <Input id="edit-goal-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="input-edit-goal-title" />
      </Field>
      <Field label="Desired outcome" htmlFor="edit-goal-outcome">
        <Textarea id="edit-goal-outcome" rows={3} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} data-testid="input-edit-goal-outcome" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Area"><AreaSelect value={f.area} onChange={(v) => setF({ ...f, area: v })} /></Field>
        <Field label="Category" hint="The type of work this goal represents."><CategorySelect value={f.category} onChange={(v) => setF({ ...f, category: v })} /></Field>
        <Field label="Priority"><PrioritySelect value={f.priority} onChange={(v) => setF({ ...f, priority: v })} /></Field>
      </div>
    </FormDialog>
  );
}

export function LogMetricDialog({
  goal,
  metricId,
  open,
  onOpenChange,
  initialDate,
}: {
  goal: Goal;
  metricId?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Prefill date, e.g. end of a historical period being viewed. Clamped to today. */
  initialDate?: string;
}) {
  const { toast } = useToast();
  const [mid, setMid] = useState(metricId ?? goal.metrics[0]?.id ?? '');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      const id = metricId ?? goal.metrics[0]?.id ?? '';
      setMid(id);
      const m = goal.metrics.find((x) => x.id === id);
      const d = initialDate && initialDate < todayIso() ? initialDate : todayIso();
      setValue(m ? String(metricValueAt(m, d)) : '');
      setDate(d);
      setNote('');
    }
  }, [open, metricId, goal, initialDate]);
  const metric = goal.metrics.find((m) => m.id === mid);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Log current value"
      description="An absolute reading of what is true now. It reconciles the total and is not counted as a contribution. To credit a change to a task or milestone, use Record contribution."
      submitLabel="Log value"
      canSubmit={!!metric && value !== '' && !Number.isNaN(Number(value)) && !!date}
      onSubmit={() => {
        if (!metric) return;
        logMetric(goal.id, metric.id, Number(value), date, note);
        toast({ title: 'Value logged', description: `${metric.name}: ${formatValue(Number(value), metric.unit)}` });
        onOpenChange(false);
      }}
    >
      {goal.metrics.length === 0 ? (
        <p className="text-sm text-muted-foreground">This goal has no metric yet. Add one in the goal workspace.</p>
      ) : (
        <>
          <Field label="Metric">
            <Select value={mid} onValueChange={(v) => {
              setMid(v);
              const m = goal.metrics.find((x) => x.id === v);
              if (m) setValue(String(metricValueAt(m, date)));
            }}>
              <SelectTrigger data-testid="select-log-metric"><SelectValue /></SelectTrigger>
              <SelectContent>
                {goal.metrics.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name} ({m.kind === 'outcome' ? 'result' : 'activity'})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${isRecurring(metric) ? (metric?.frequency === 'weekly' ? 'Total so far this week' : 'Total so far this month') : 'Current value'}${metric?.unit ? ` (${metric.unit})` : ''}`} htmlFor="log-value" hint={metric ? `Target ${formatValue(measurementTargetAt(metric, date), metric.unit)}${isRecurring(metric) ? (metric.frequency === 'weekly' ? ' per week' : ' per month') : ''}` : undefined}>
              <Input id="log-value" autoFocus type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} data-testid="input-log-value" />
            </Field>
            <Field label="As of" htmlFor="log-date">
              <Input id="log-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-log-date" />
            </Field>
          </div>
          {isRecurring(metric) && <PeriodCreditHint metric={metric} date={date} verb="A period-to-date total for" />}
          <Field label="Note (optional)" htmlFor="log-note">
            <Input id="log-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What caused the change?" data-testid="input-log-note" />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
