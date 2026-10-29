import { useState, type ReactElement } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { Archive, ArchiveRestore, Bell, CalendarDays, Inbox, MoreHorizontal, Pencil, Repeat, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { CheckButton } from '@/components/check-button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { TaskDialog } from '@/components/task-dialog';
import { AreaDot, SampleMark } from '@/components/primitives';
import { addDaysIso, fmt, nextMonday, relDay, todayIso } from '@/lib/dates';
import { archiveTask, deleteTask, rescheduleTasks, toggleTask } from '@/lib/store/actions';
import { effortLabel, isOverdue } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';
import type { Task } from '@/lib/store/types';
import { cn } from '@/lib/utils';

/** Compact, always-visible schedule control. Uses the existing rescheduleTasks action. */
export function ScheduleControl({ task, hideLabel }: { task: Task; hideLabel?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const today = todayIso();
  const [date, setDate] = useState(task.plannedDate ?? today);
  const overdue = isOverdue(task) && task.status === 'open';
  const label = task.plannedDate ? relDay(task.plannedDate) : 'Inbox';

  const move = (d: string | undefined, name: string) => {
    rescheduleTasks([task.id], d);
    setOpen(false);
    toast({ title: d ? `Moved to ${name}` : 'Moved to inbox' });
  };

  const opts: { label: string; date: string | undefined; hint: string }[] = [
    { label: 'Today', date: today, hint: fmt(today, 'EEE') },
    { label: 'Tomorrow', date: addDaysIso(today, 1), hint: fmt(addDaysIso(today, 1), 'EEE') },
    { label: 'Next week', date: nextMonday(), hint: fmt(nextMonday(), 'EEE MMM d') },
  ];

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDate(task.plannedDate ?? today); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Schedule ${task.title}. Currently ${task.plannedDate ? relDay(task.plannedDate) : 'in inbox'}`}
          data-testid={`button-schedule-${task.id}`}
          className={cn(
            'inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:min-w-8',
            overdue && 'text-destructive',
          )}
        >
          <CalendarDays className="size-4" />
          {!hideLabel && <span className="hidden max-w-[6.5rem] truncate font-num sm:inline">{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        <div className="px-2 pb-1 pt-1 text-xs text-muted-foreground">Schedule</div>
        {opts.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => move(o.date, o.label.toLowerCase())}
            className={cn('flex min-h-10 w-full items-center justify-between rounded-md px-2 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none', task.plannedDate === o.date && 'text-primary')}
            data-testid={`schedule-${o.label.toLowerCase().replace(' ', '-')}-${task.id}`}
          >
            {o.label}
            <span className="font-num text-xs text-muted-foreground">{o.hint}</span>
          </button>
        ))}
        {task.plannedDate && (
          <button type="button" onClick={() => move(undefined, '')} className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" data-testid={`schedule-inbox-${task.id}`}>
            <Inbox className="size-4 text-muted-foreground" /> Back to inbox
          </button>
        )}
        <form
          className="mt-1 flex gap-1.5 border-t border-border px-1 pt-2"
          onSubmit={(e) => { e.preventDefault(); if (date) move(date, relDay(date).toLowerCase()); }}
        >
          <input
            type="date"
            aria-label="Pick a date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-num text-xs"
            data-testid={`input-schedule-date-${task.id}`}
          />
          <Button type="submit" size="sm" className="h-9" disabled={!date}>Set</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

type TaskRowProps = {
  task: Task;
  siblings?: Task[];
  showGoal?: boolean;
  compact?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (v: boolean) => void;
  hideDate?: boolean;
};

const sameBucket = (a: Task, b: Task) => (a.plannedDate ?? '') === (b.plannedDate ?? '');

/**
 * Renders a task and, beneath it, its live sub-tasks that share the same day bucket.
 * Sub-tasks nested this way are skipped at the root so lists never show them twice;
 * sub-tasks scheduled on a different day stay at the root with a "part of" hint.
 */
export function TaskRow(props: TaskRowProps) {
  const { tasks } = useAppState();
  const t = props.task;
  const visible = props.siblings ?? tasks;
  const parent = t.parentTaskId ? tasks.find((x) => x.id === t.parentTaskId) : undefined;
  if (!props.selectable && parent && !parent.archived && visible.some((x) => x.id === parent.id) && sameBucket(parent, t)) return null;
  const children = props.selectable ? [] : visible.filter((c) => c.parentTaskId === t.id && !c.archived && sameBucket(t, c));
  if (!children.length) return <TaskRowInner {...props} parent={parent} />;
  const doneCount = children.filter((c) => c.status === 'done').length;
  return (
    <div data-testid={`group-task-${t.id}`}>
      <TaskRowInner {...props} parent={parent} subCount={`${doneCount}/${children.length} steps`} />
      <div className="ml-[1.35rem] border-l border-border/80 pl-2 sm:ml-[1.1rem]">
        {children.map((c) => (
          <TaskRowInner key={c.id} task={c} showGoal={false} compact={props.compact} hideDate={props.hideDate} nested />
        ))}
      </div>
    </div>
  );
}

function TaskRowInner({
  task,
  showGoal = true,
  compact,
  selectable,
  selected,
  onSelect,
  hideDate,
  nested,
  parent,
  subCount,
}: {
  nested?: boolean;
  parent?: Task;
  subCount?: string;
  task: Task;
  showGoal?: boolean;
  compact?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (v: boolean) => void;
  /** Hide the date label on the schedule control when the context already implies the day. */
  hideDate?: boolean;
}) {
  const { goals } = useAppState();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const goal = goals.find((g) => g.id === task.goalId);
  const done = task.status === 'done';
  const today = todayIso();

  const onToggle = () => {
    const wasOpen = task.status === 'open';
    const { spawned } = toggleTask(task.id);
    if (wasOpen && spawned) toast({ title: 'Done. Next one is scheduled.', description: `Repeats on ${relDay(spawned)}.` });
  };

  const meta: ReactElement[] = [];
  if (!compact) {
    if (subCount) meta.push(<span key="s" className="font-num">{subCount}</span>);
    if (parent && !nested) meta.push(<span key="p" className="truncate">part of {parent.title}</span>);
    if (showGoal && goal)
      meta.push(
        <span key="g" className="inline-flex min-w-0 max-w-[14rem] items-center gap-1.5">
          <AreaDot area={goal.area} />
          <span className="truncate">{goal.title}</span>
        </span>,
      );
    if (task.dueDate && !done)
      meta.push(<span key="d" className={cn('font-num', task.dueDate < today && 'text-destructive')}>due {relDay(task.dueDate).toLowerCase()}</span>);
    if (task.effort > 0 && !done) meta.push(<span key="e" className="font-num">{effortLabel(task.effort)}</span>);
    if (done && task.completedAt) meta.push(<span key="c" className="font-num">done {relDay(task.completedAt.slice(0, 10)).toLowerCase()}</span>);
  }

  return (
    <motion.div
      layout="position"
      transition={{ duration: 0.25 }}
      className={cn('group flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/60 sm:gap-2.5', selected && 'bg-accent/60', nested && 'py-0.5')}
      data-testid={`row-task-${task.id}`}
    >
      {selectable ? (
        <label className="grid size-10 shrink-0 cursor-pointer place-items-center sm:size-8">
          <input
            type="checkbox"
            aria-label={`Select ${task.title}`}
            checked={!!selected}
            onChange={(e) => onSelect?.(e.target.checked)}
            className="size-4 accent-[hsl(var(--primary))]"
            data-testid={`checkbox-select-${task.id}`}
          />
        </label>
      ) : (
        <div className="grid size-10 shrink-0 place-items-center sm:size-8">
          <CheckButton checked={done} onToggle={onToggle} label={`${done ? 'Reopen' : 'Complete'} ${task.title}`} testId={`check-task-${task.id}`} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-w-0 flex-1 rounded py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Edit ${task.title}`}
        data-testid={`button-edit-task-${task.id}`}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 text-[0.93rem] leading-snug transition-colors',
              done && 'text-muted-foreground line-through decoration-foreground/30',
              task.priority === 'high' && !done && 'font-medium',
            )}
          >
            {task.title}
          </span>
          {task.recurrence !== 'none' && <Repeat className="size-3 shrink-0 text-muted-foreground" aria-label={`Repeats ${task.recurrence}`} />}
          {task.reminder && !done && <Bell className="size-3 shrink-0 text-muted-foreground" aria-label={`Reminder ${relDay(task.reminder.slice(0, 10))} ${task.reminder.slice(11)}`} />}
          {task.isDemo && <SampleMark />}
        </span>
        {meta.length > 0 && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">{meta}</span>
        )}
      </button>
      {!done && !task.archived && <ScheduleControl task={task} hideLabel={selectable || (hideDate && !isOverdue(task))} />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 text-muted-foreground sm:size-8"
            aria-label={`More actions for ${task.title}`}
            data-testid={`button-task-menu-${task.id}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Edit details, date and repeat
          </DropdownMenuItem>
          {done && (
            <DropdownMenuItem onSelect={() => { rescheduleTasks([task.id], today); toast({ title: 'Moved to today' }); }} data-testid={`menu-today-${task.id}`}>
              <CalendarDays /> Plan for today
            </DropdownMenuItem>
          )}
          {goal && (
            <DropdownMenuItem asChild>
              <Link href={`/goals/${goal.id}`}>
                <AreaDot area={goal.area} className="mx-1" /> Open goal
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              archiveTask(task.id, !task.archived);
              toast({ title: task.archived ? 'Restored from archive' : 'Archived' });
            }}
          >
            {task.archived ? <ArchiveRestore /> : <Archive />} {task.archived ? 'Unarchive' : 'Archive'}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 /> Delete...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TaskDialog open={editing} onOpenChange={setEditing} task={task} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        description={`"${task.title}" will be removed permanently. Past review snapshots keep their numbers. Archive instead if you may need it.`}
        confirmLabel="Delete task"
        destructive
        onConfirm={() => {
          deleteTask(task.id);
          toast({ title: 'Task deleted' });
        }}
      />
    </motion.div>
  );
}
