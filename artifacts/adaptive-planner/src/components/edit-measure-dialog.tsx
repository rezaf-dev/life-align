import { useRef, useState } from 'react';
import { Field, FormDialog } from '@/components/form-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { updateMetric } from '@/lib/store/actions';
import type { Metric, MetricKind } from '@/lib/store/types';
import { flushWorkspace } from '@/lib/workspace-sync';
import { MeasurementStartField } from '@/components/measurement-period';
import { todayIso } from '@/lib/dates';
import { isMeasurementDate } from '@workspace/api-zod';

export function EditMeasureDialog({ goalId, metric, onClose }: {
  goalId: string;
  metric: Metric;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(metric.name);
  const [kind, setKind] = useState<MetricKind>(metric.kind);
  const [unit, setUnit] = useState(metric.unit);
  const [baseline, setBaseline] = useState(String(metric.baseline));
  const [startDate, setStartDate] = useState(metric.startDate ?? todayIso());
  const [pending, setPending] = useState(false);
  const [staged, setStaged] = useState(false);
  const [error, setError] = useState('');
  const applied = useRef(false);
  const locked = metric.entries.length > 0;
  const recurring = !!metric.frequency && metric.frequency !== 'cumulative';
  const n = Number(baseline);
  const valid = !!name.trim() && baseline.trim() !== '' && Number.isFinite(n) && (!recurring || (n === 0 && isMeasurementDate(startDate)));
  const changed = name.trim() !== metric.name || kind !== metric.kind || unit.trim() !== metric.unit || n !== metric.baseline || (recurring && !locked && startDate !== metric.startDate);
  const frozen = pending || staged;

  const save = async () => {
    if (pending || (!staged && (!valid || !changed))) return;
    setPending(true);
    setError('');
    try {
      if (!applied.current) {
        updateMetric(goalId, metric.id, { name, kind, unit, baseline: n, startDate: recurring && !locked ? startDate : metric.startDate });
        applied.current = true;
        setStaged(true);
      }
      await flushWorkspace();
      toast({ title: 'Measure updated', description: 'Recorded results and task contributions are preserved.' });
      onClose();
    } catch (err) {
      setError(`${applied.current ? 'Changed on this device, but not saved to your account yet. ' : ''}${err instanceof Error ? err.message : 'Please try saving again.'}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(open) => { if (!open && !pending) onClose(); }}
      title="Edit measure"
      description="Correct the name or type without losing recorded results. Use Target to change the target or measurement period."
      submitLabel={pending ? 'Saving…' : staged ? 'Retry saving' : 'Save changes'}
      canSubmit={!pending && (staged || (valid && changed))}
      onSubmit={() => void save()}
    >
      <Field label="Name" htmlFor="edit-measure-name">
        <Input id="edit-measure-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} disabled={frozen} data-testid="input-edit-measure-name" />
      </Field>
      <Field label="Type" hint={kind === 'outcome' ? 'Result: the outcome you want, such as customers gained or revenue earned.' : 'Activity: work you control, such as hours spent or calls made.'}>
        <Select value={kind} onValueChange={(value) => setKind(value as MetricKind)} disabled={frozen}>
          <SelectTrigger data-testid="select-edit-measure-kind"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="outcome">Result</SelectItem>
            <SelectItem value="leading">Activity</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Unit" htmlFor="edit-measure-unit">
          <Input id="edit-measure-unit" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={frozen || locked} placeholder="e.g. hours" data-testid="input-edit-measure-unit" />
        </Field>
        <Field label="Starting value" htmlFor="edit-measure-baseline" hint={recurring ? 'Each period starts at zero.' : undefined}>
          <Input id="edit-measure-baseline" type="number" step="any" value={baseline} onChange={(e) => setBaseline(e.target.value)} disabled={frozen || locked || recurring} data-testid="input-edit-measure-baseline" />
        </Field>
      </div>
      {recurring && (metric.startDate || !locked) && <MeasurementStartField frequency={metric.frequency!} target={metric.target} unit={unit} value={startDate} onChange={setStartDate} disabled={frozen || locked} testId="edit-measure-start" />}
      {locked && <p className="text-xs text-muted-foreground" data-testid="text-edit-measure-history-protected">Units, starting value, and start date are locked because results already exist. Name and type can still be corrected. For different units, add a separate measure rather than reinterpreting past results.</p>}
      {error && <p role="alert" className="text-sm text-destructive" data-testid="text-edit-measure-error">{error}</p>}
    </FormDialog>
  );
}
