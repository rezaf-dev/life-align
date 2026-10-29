import { ListTree } from 'lucide-react';
import { openAssistant } from '@/lib/ai/bus';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Field, FormDialog } from '@/components/form-dialog';
import { addTask, updateTask } from '@/lib/store/actions';
import { useAppState } from '@/lib/store/store';
import { RecordResultDialog, TaskContributionSection } from '@/components/contributions';
import type { Priority, Recurrence, Task } from '@/lib/store/types';

const EFFORTS = [10, 15, 20, 30, 45, 55, 60, 90, 120, 180, 240];

export function TaskDialog({
  open,
  onOpenChange,
  task,
  defaults,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  task?: Task;
  defaults?: Partial<Task>;
}) {
  const { goals } = useAppState();
  const { toast } = useToast();
  const [f, setF] = useState(() => init(task, defaults));
  const [recording, setRecording] = useState(false);
  const savedGoal = task?.goalId ? goals.find((g) => g.id === task.goalId) : undefined;

  useEffect(() => {
    if (open) setF(init(task, defaults));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const goal = goals.find((g) => g.id === f.goalId);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const submit = () => {
    const payload = {
      title: f.title.trim(),
      goalId: f.goalId === 'none' ? undefined : f.goalId,
      milestoneId: f.goalId === 'none' || f.milestoneId === 'none' ? undefined : f.milestoneId,
      plannedDate: f.plannedDate || undefined,
      dueDate: f.dueDate || undefined,
      priority: f.priority,
      effort: Number(f.effort),
      notes: f.notes,
      recurrence: f.recurrence,
      reminder: f.reminder || undefined,
      archived: f.archived,
    };
    if (task) {
      updateTask(task.id, payload);
      toast({ title: 'Task updated' });
    } else {
      addTask(payload);
      toast({ title: 'Task captured', description: payload.plannedDate ? undefined : 'Added to your inbox.' });
    }
    onOpenChange(false);
  };

  const selectableGoals = goals.filter((g) => g.status === 'active' || g.status === 'paused' || g.id === f.goalId);

  return (
    <>
    <FormDialog
      open={open && !recording}
      onOpenChange={onOpenChange}
      title={task ? 'Edit task' : 'New task'}
      description="Only the title is required. Everything else helps planning."
      submitLabel={task ? 'Save changes' : 'Add task'}
      canSubmit={!!f.title.trim()}
      onSubmit={submit}
      wide
    >
      {task && (
        <button
          type="button"
          onClick={() => { onOpenChange(false); openAssistant({ screen: 'task', taskId: task.id, fresh: true, send: `Break down "${task.title}" into a few concrete steps. Keep the original task as the parent.` }); }}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/[0.04] px-3 py-2 text-left text-sm hover:bg-primary/[0.08]"
          data-testid="button-task-breakdown-ai"
        >
          <ListTree className="size-4 text-primary" />
          <span className="flex-1">Break this down with Align</span>
          <span className="text-xs text-muted-foreground">steps nest under it</span>
        </button>
      )}
      <Field label="Title" htmlFor="task-title">
        <Input id="task-title" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} data-testid="input-task-title" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Goal">
          <Select value={f.goalId} onValueChange={(v) => setF((p) => ({ ...p, goalId: v, milestoneId: 'none' }))}>
            <SelectTrigger data-testid="select-task-goal"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No goal</SelectItem>
              {selectableGoals.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Milestone">
          <Select value={f.milestoneId} onValueChange={(v) => set('milestoneId', v)} disabled={!goal || !goal.milestones.length}>
            <SelectTrigger data-testid="select-task-milestone"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {goal?.milestones.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Planned for" htmlFor="task-planned" hint="When you intend to do it">
          <Input id="task-planned" type="date" value={f.plannedDate} onChange={(e) => set('plannedDate', e.target.value)} data-testid="input-task-planned" />
        </Field>
        <Field label="Due" htmlFor="task-due" hint="Hard deadline, if any">
          <Input id="task-due" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} data-testid="input-task-due" />
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onValueChange={(v) => set('priority', v as Priority)}>
            <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Effort">
          <Select value={String(f.effort)} onValueChange={(v) => set('effort', Number(v))}>
            <SelectTrigger data-testid="select-task-effort"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EFFORTS.map((e) => (
                <SelectItem key={e} value={String(e)}>{e < 60 ? `${e} min` : `${e / 60} h`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Repeats" hint="Completing creates the next occurrence once">
          <Select value={f.recurrence} onValueChange={(v) => set('recurrence', v as Recurrence)}>
            <SelectTrigger data-testid="select-task-recurrence"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Does not repeat</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Reminder" htmlFor="task-reminder" hint="In-app only — shown when Align is open">
          <Input id="task-reminder" type="datetime-local" value={f.reminder} onChange={(e) => set('reminder', e.target.value)} data-testid="input-task-reminder" />
        </Field>
      </div>
      <Field label="Notes" htmlFor="task-notes">
        <Textarea id="task-notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} data-testid="input-task-notes" />
      </Field>
      {task && (
        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm">
          <span>Archived <span className="text-muted-foreground">— hidden from plans and lists</span></span>
          <Switch checked={f.archived} onCheckedChange={(v) => set('archived', v)} data-testid="switch-task-archived" />
        </label>
      )}
      <TaskContributionSection
        goal={savedGoal}
        taskId={task?.id}
        onRecord={() => setRecording(true)}
      />
    </FormDialog>
    {savedGoal && task && (
      <RecordResultDialog goal={savedGoal} open={recording} onOpenChange={setRecording} target={{ taskId: task.id }} />
    )}
    </>
  );
}

function init(task?: Task, defaults?: Partial<Task>) {
  const t = { ...defaults, ...task };
  return {
    title: t.title ?? '',
    goalId: t.goalId ?? 'none',
    milestoneId: t.milestoneId ?? 'none',
    plannedDate: t.plannedDate ?? '',
    dueDate: t.dueDate ?? '',
    priority: (t.priority ?? 'medium') as Priority,
    effort: t.effort ?? 30,
    notes: t.notes ?? '',
    recurrence: (t.recurrence ?? 'none') as Recurrence,
    reminder: t.reminder ?? '',
    archived: t.archived ?? false,
  };
}
