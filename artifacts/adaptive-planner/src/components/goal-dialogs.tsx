import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Field, FormDialog } from '@/components/form-dialog';
import { addDaysIso, todayIso } from '@/lib/dates';
import { addGoal, editGoalBasics, logMetric } from '@/lib/store/actions';
import { formatValue, metricValueAt } from '@/lib/store/selectors';
import { AREAS } from '@/lib/store/types';
import type { Area, Goal, MetricKind, Priority } from '@/lib/store/types';

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
  priority: 'medium' as Priority,
  targetDate: addDaysIso(todayIso(), 90),
  strategy: '',
  rationale: '',
  metricName: '',
  metricUnit: '',
  metricBaseline: '0',
  metricTarget: '',
  metricKind: 'outcome' as MetricKind,
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
  const metricOk = !f.metricName.trim() || (f.metricTarget !== '' && !Number.isNaN(Number(f.metricTarget)));

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
          priority: f.priority,
          targetDate: f.targetDate,
          strategy: f.strategy,
          rationale: f.rationale,
          metric: f.metricName.trim()
            ? {
                name: f.metricName.trim(),
                unit: f.metricUnit.trim(),
                baseline: Number(f.metricBaseline) || 0,
                target: Number(f.metricTarget),
                kind: f.metricKind,
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
          <Field label="Start"><Input type="number" step="any" value={f.metricBaseline} onChange={(e) => set('metricBaseline', e.target.value)} data-testid="input-goal-metric-baseline" /></Field>
          <Field label="Target"><Input type="number" step="any" value={f.metricTarget} onChange={(e) => set('metricTarget', e.target.value)} data-testid="input-goal-metric-target" /></Field>
        </div>
      </div>
    </FormDialog>
  );
}

export function EditGoalDialog({ goal, open, onOpenChange }: { goal: Goal; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState({ title: goal.title, outcome: goal.outcome, area: goal.area, priority: goal.priority });
  useEffect(() => {
    if (open) setF({ title: goal.title, outcome: goal.outcome, area: goal.area, priority: goal.priority });
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
}: {
  goal: Goal;
  metricId?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
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
      setValue(m ? String(metricValueAt(m)) : '');
      setDate(todayIso());
      setNote('');
    }
  }, [open, metricId, goal]);
  const metric = goal.metrics.find((m) => m.id === mid);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Log a result"
      description="Record what is actually true now. Results are logged by you — finishing tasks never changes them automatically."
      submitLabel="Log result"
      canSubmit={!!metric && value !== '' && !Number.isNaN(Number(value)) && !!date}
      onSubmit={() => {
        if (!metric) return;
        logMetric(goal.id, metric.id, Number(value), date, note);
        toast({ title: 'Result logged', description: `${metric.name}: ${formatValue(Number(value), metric.unit)}` });
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
              if (m) setValue(String(metricValueAt(m)));
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
            <Field label={`Current value${metric?.unit ? ` (${metric.unit})` : ''}`} htmlFor="log-value" hint={metric ? `Target ${formatValue(metric.target, metric.unit)}` : undefined}>
              <Input id="log-value" autoFocus type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} data-testid="input-log-value" />
            </Field>
            <Field label="As of" htmlFor="log-date">
              <Input id="log-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-log-date" />
            </Field>
          </div>
          <Field label="Note (optional)" htmlFor="log-note">
            <Input id="log-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What caused the change?" data-testid="input-log-note" />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
