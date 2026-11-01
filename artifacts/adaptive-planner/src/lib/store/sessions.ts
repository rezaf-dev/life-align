import { timeUnitMinutes, workSessionSchema, type WorkSession } from '@workspace/api-zod';
import { addDaysIso, addMonthsIso, daysBetween, nowStamp, todayIso, uid } from '@/lib/dates';
import { update } from './store';
import type { AppState, MetricEntry, Recurrence } from './types';

export interface SessionDraft {
  title: string; goalId: string; metricId?: string; plannedDate?: string;
  plannedMinutes: number; recurrence: Recurrence; taskIds: string[]; notes: string;
  workDone?: string[];
}
export interface SessionResult {
  date: string; actualMinutes: number; allocations: { taskId: string; minutes: number }[]; notes?: string;
  workDone?: string[];
  newTasks?: { key: string; title: string; minutes: number }[];
  recurrenceAfter?: string;
  allowedThroughDate?: string;
}
export function validateDraft(state: AppState, input: SessionDraft) {
  const goal = state.goals.find((g) => g.id === input.goalId);
  if (!goal) throw new Error('Choose an existing goal for this session.');
  if (input.metricId) {
    const metric = goal.metrics.find((m) => m.id === input.metricId);
    if (!metric || !timeUnitMinutes(metric.unit)) throw new Error('Choose an hours or minutes measure belonging to this goal.');
  }
  if (input.taskIds.some((id) => !state.tasks.some((t) => t.id === id && t.goalId === goal.id && !t.archived))) throw new Error('Choose tasks belonging to this goal.');
  if (input.recurrence !== 'none' && !input.plannedDate) throw new Error('Recurring sessions need a planned date.');
}
export function buildSession(input: SessionDraft): WorkSession {
  return workSessionSchema.parse({ title: input.title.trim(), goalId: input.goalId, metricId: input.metricId || undefined,
    plannedDate: input.plannedDate || undefined, plannedMinutes: input.plannedMinutes, recurrence: input.recurrence,
    taskIds: input.taskIds, notes: input.notes, workDone: input.workDone, id: uid(), createdAt: nowStamp(), status: 'planned', allocations: [] });
}
export function saveWorkSession(input: SessionDraft, id?: string): string {
  let result = id ?? '';
  update((state) => {
    validateDraft(state, input);
    const existing = id ? state.sessions?.find((s) => s.id === id) : undefined;
    if (id && !existing) throw new Error('This session no longer exists.');
    if (existing?.status === 'skipped') throw new Error('Skipped sessions are kept as history. Plan a new session instead.');
    if (existing?.status === 'logged') throw new Error('Use Edit time to correct a logged session.');
    const next = buildSession(input);
    if (existing) Object.assign(existing, next, { id: existing.id, createdAt: existing.createdAt, sourceTaskId: existing.sourceTaskId });
    else (state.sessions ??= []).push(next);
    result = existing?.id ?? next.id;
  });
  return result;
}
function syncCredits(state: AppState, session: WorkSession) {
  const goal = state.goals.find((g) => g.id === session.goalId);
  if (!goal) throw new Error('The session goal no longer exists.');
  const metric = session.metricId ? goal.metrics.find((m) => m.id === session.metricId) : undefined;
  if (session.metricId && !metric) throw new Error('The session measure was removed. Restore it or keep this session as time-only.');
  const divisor = metric ? timeUnitMinutes(metric.unit) : null;
  if (metric && !divisor) throw new Error('Session time can only contribute to an hours or minutes measure.');
  const old = state.goals.flatMap((g) => g.metrics.flatMap((m) => m.entries.filter((e) => e.source?.sessionId === session.id)));
  const expected = new Map<string, MetricEntry>();
  const add = (minutes: number, allocation?: WorkSession['allocations'][number]) => {
    if (!metric || !divisor || !minutes) return;
    const key = allocation?.taskId ?? '';
    expected.set(key, {
      id: old.find((e) => (e.source?.taskId ?? '') === key)?.id ?? uid(),
      date: session.date!, value: minutes / divisor, mode: 'contribution', note: session.notes || undefined,
      source: { sessionId: session.id, sessionTitle: session.title, taskId: allocation?.taskId,
        taskTitle: allocation?.taskTitle, milestoneId: allocation?.milestoneId, milestoneTitle: allocation?.milestoneTitle },
    });
  };
  session.allocations.forEach((a) => add(a.minutes, a));
  const remainder = session.actualMinutes! - session.allocations.reduce((sum, a) => sum + a.minutes, 0);
  if (remainder > 1e-8) add(remainder);
  // Replace in-place so correcting a session does not move it past a same-day absolute checkpoint.
  for (const g of state.goals) for (const m of g.metrics) {
    m.entries = m.entries.flatMap((entry) => {
      if (entry.source?.sessionId !== session.id) return [entry];
      if (m !== metric || !expected.size) return [];
      const replacements = [...expected.values()];
      expected.clear();
      return replacements;
    });
  }
  if (metric) {
    metric.entries.push(...expected.values());
    metric.entries.sort((a, b) => a.date.localeCompare(b.date));
  }
}
export function logWorkSession(id: string, input: SessionResult) {
  update((state) => logWorkSessionInDraft(state, id, input));
}
export function logWorkSessionInDraft(state: AppState, id: string, input: SessionResult) {
    const session = state.sessions?.find((s) => s.id === id);
    if (!session) throw new Error('This session no longer exists.');
    if (session.status === 'skipped') throw new Error('Skipped sessions cannot record work. Add a new time entry instead.');
    if (input.date > (input.allowedThroughDate ?? todayIso())) throw new Error('Record actual work today or earlier.');
    const previousAllocations = session.allocations;
    const newAllocations = (input.newTasks ?? []).map((item) => {
      if (!item.title.trim()) throw new Error('Name the unexpected work.');
      const taskId = `${session.id}-${item.key}`;
      if (!state.tasks.some((t) => t.id === taskId)) state.tasks.unshift({
        id: taskId, title: item.title.trim(), goalId: session.goalId, priority: 'medium', effort: 0, notes: '',
        recurrence: 'none', status: 'open', archived: false, createdAt: nowStamp(), isDemo: false,
      });
      return { taskId, minutes: item.minutes };
    });
    const allocations = [...input.allocations, ...newAllocations].map((a) => {
      const task = state.tasks.find((t) => t.id === a.taskId);
      const previous = previousAllocations.find((p) => p.taskId === a.taskId);
      if ((!task || task.goalId !== session.goalId) && !previous) throw new Error('Choose a task belonging to this session’s goal.');
      // Historical attribution survives task deletion or relinking.
      const milestone = state.goals.find((g) => g.id === session.goalId)?.milestones.find((m) => m.id === task?.milestoneId);
      return { ...a, taskTitle: previous?.taskTitle ?? task!.title,
        milestoneId: previous?.milestoneId ?? milestone?.id, milestoneTitle: previous?.milestoneTitle ?? milestone?.title };
    });
    const wasLogged = session.status === 'logged';
    Object.assign(session, workSessionSchema.parse({ ...session, date: input.date, actualMinutes: input.actualMinutes,
      allocations, notes: input.notes ?? session.notes, workDone: input.workDone ?? session.workDone,
      status: 'logged', loggedAt: session.loggedAt ?? nowStamp() }));
    syncCredits(state, session);
    if (!wasLogged && session.recurrence !== 'none' && !session.spawnedNextId) {
      const base = session.plannedDate ?? input.date;
      const afterDate = input.recurrenceAfter && input.recurrenceAfter > input.date ? input.recurrenceAfter : input.date;
      let nextDate: string;
      if (session.recurrence === 'monthly') {
        let months = Math.max(1, (Number(afterDate.slice(0, 4)) - Number(base.slice(0, 4))) * 12 + Number(afterDate.slice(5, 7)) - Number(base.slice(5, 7)));
        nextDate = addMonthsIso(base, months);
        if (nextDate <= afterDate) nextDate = addMonthsIso(base, ++months);
      } else {
        const interval = session.recurrence === 'weekly' ? 7 : 1;
        nextDate = addDaysIso(base, Math.max(1, Math.floor(daysBetween(base, afterDate) / interval) + 1) * interval);
      }
      const next = buildSession({ ...session, plannedDate: nextDate, workDone: undefined });
      // A session reserves time; specific task assignments don't automatically recur.
      next.taskIds = [];
      state.sessions!.push(next);
      session.spawnedNextId = next.id;
    }
}
/** Capture unexpected work and its actual contribution in one account-state write. */
export function recordUnplannedSession(input: SessionDraft, result: SessionResult): string {
  let id = '';
  update((state) => {
    const draft = { ...input, plannedDate: undefined, plannedMinutes: 0, recurrence: 'none' as const };
    validateDraft(state, draft);
    const session = buildSession(draft);
    (state.sessions ??= []).push(session);
    id = session.id;
    logWorkSessionInDraft(state, id, result);
  });
  return id;
}
export function deleteWorkSession(id: string) {
  update((state) => {
    const session = state.sessions?.find((s) => s.id === id);
    if (!session) return;
    for (const goal of state.goals) for (const metric of goal.metrics) metric.entries = metric.entries.filter((e) => e.source?.sessionId !== id);
    state.sessions = state.sessions!.filter((s) => s.id !== id);
  });
}
/** Explicit conversion only: the old reminder and all previous results stay in history. */
export function convertTaskToWorkSession(taskId: string, metricId?: string): string {
  let result = '';
  update((state) => {
    const converted = state.sessions?.find((s) => s.sourceTaskId === taskId);
    if (converted) { result = converted.id; return; }
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task?.goalId || task.status !== 'open' || task.archived) throw new Error('Choose an open task linked to a goal.');
    const draft: SessionDraft = { title: task.title, goalId: task.goalId, metricId, plannedDate: task.plannedDate ?? todayIso(),
      plannedMinutes: task.effort || 60, recurrence: task.recurrence, taskIds: [], notes: task.notes };
    validateDraft(state, draft);
    const session = buildSession(draft);
    session.sourceTaskId = task.id;
    (state.sessions ??= []).push(session);
    task.archived = true;
    result = session.id;
  });
  return result;
}
