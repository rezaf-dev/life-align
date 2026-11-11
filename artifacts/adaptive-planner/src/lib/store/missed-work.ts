import { workSessionSchema } from '@workspace/api-zod';
import { addDaysIso, addMonthsIso, daysBetween, nowStamp, todayIso, uid } from '@/lib/dates';
import { update } from './store';
import type { AppState, Recurrence } from './types';

const validDate = (date: string) => {
  const parsed = new Date(`${date}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};
const validateReplan = (date: string) => {
  if (!validDate(date) || date < todayIso()) throw new Error('Choose today or a future date.');
};
function guardTimer(state: AppState, kind: 'task' | 'session', id: string) {
  if (state.activeTimer && (kind === 'task' ? state.activeTimer.taskId === id : state.activeTimer.sessionId === id)) {
    throw new Error('Finish or discard the active timer before changing this plan.');
  }
}

function shift(date: string, recurrence: Exclude<Recurrence, 'none'>, steps: number) {
  return recurrence === 'monthly' ? addMonthsIso(date, steps) : addDaysIso(date, steps * (recurrence === 'weekly' ? 7 : 1));
}
/** Next occurrence on/after today: don't skip today's work, manufacture a backlog, or drift a monthly anchor. */
function nextOccurrence(base: string, recurrence: Exclude<Recurrence, 'none'>, today: string) {
  let steps = recurrence === 'monthly'
    ? Math.max(1, (Number(today.slice(0, 4)) - Number(base.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(base.slice(5, 7)))
    : Math.max(1, Math.ceil(daysBetween(base, today) / (recurrence === 'weekly' ? 7 : 1)));
  let date = shift(base, recurrence, steps);
  if (date < today) date = shift(base, recurrence, ++steps);
  return { date, steps };
}

export function replanMissedTask(id: string, date: string) {
  validateReplan(date);
  update((state) => {
    const task = state.tasks.find((t) => t.id === id);
    if (!task || task.status !== 'open' || task.archived) throw new Error('This task is no longer open.');
    guardTimer(state, 'task', id);
    task.plannedDate = date;
    if (task.dueDate && task.dueDate < todayIso()) task.dueDate = date;
    if (task.reminder && task.reminder.slice(0, 10) < todayIso()) {
      task.reminder = `${date}${task.reminder.slice(10)}`;
      task.reminderDismissed = false;
    }
  });
}

export function replanMissedSession(id: string, date: string, time?: string) {
  validateReplan(date);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a valid time.');
  update((state) => {
    const session = state.sessions?.find((s) => s.id === id);
    if (!session || session.status !== 'planned') throw new Error('This session is no longer planned.');
    guardTimer(state, 'session', id);
    session.plannedDate = date;
    if (time !== undefined) session.plannedTime = time || undefined;
  });
}

export function skipMissedTask(id: string) {
  update((state) => {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) throw new Error('This task no longer exists.');
    if (task.skippedAt) return; // Retry cannot spawn twice.
    if (task.status !== 'open' || task.archived) throw new Error('Only open tasks can be skipped.');
    guardTimer(state, 'task', id);
    if (task.recurrence !== 'none' && !task.spawnedNextId) {
      const base = task.plannedDate ?? task.dueDate ?? todayIso();
      const next = nextOccurrence(base, task.recurrence, todayIso());
      const nextId = uid();
      state.tasks.unshift({
        ...task, id: nextId, plannedDate: next.date,
        dueDate: task.dueDate ? shift(task.dueDate, task.recurrence, next.steps) : undefined,
        reminder: task.reminder ? `${shift(task.reminder.slice(0, 10), task.recurrence, next.steps)}${task.reminder.slice(10)}` : undefined,
        reminderDismissed: false, completedAt: undefined, skippedAt: undefined, archived: false,
        spawnedNextId: undefined, createdAt: nowStamp(), isDemo: false,
      });
      task.spawnedNextId = nextId;
    }
    task.archived = true;
    task.skippedAt = nowStamp();
    task.reminderDismissed = true;
  });
}

export function skipMissedSession(id: string) {
  update((state) => {
    const session = state.sessions?.find((s) => s.id === id);
    if (!session) throw new Error('This session no longer exists.');
    if (session.status === 'skipped') return;
    if (session.status !== 'planned') throw new Error('Logged work cannot be skipped.');
    guardTimer(state, 'session', id);
    if (session.recurrence !== 'none' && !session.spawnedNextId) {
      const { date } = nextOccurrence(session.plannedDate ?? todayIso(), session.recurrence, todayIso());
      const next = workSessionSchema.parse({
        ...session, id: uid(), plannedDate: date, taskIds: [], allocations: [], workDone: undefined,
        spawnedNextId: undefined, skippedAt: undefined, createdAt: nowStamp(),
      });
      (state.sessions ??= []).push(next);
      session.spawnedNextId = next.id;
    }
    session.status = 'skipped';
    session.skippedAt = nowStamp();
  });
}
