import { activeWorkTimerSchema, timeTrackingDate, type ActiveWorkTimer } from '@workspace/api-zod';
import { nowStamp, uid } from '@/lib/dates';
import { update } from './store';
import { buildSession, logWorkSessionInDraft, validateDraft, type SessionDraft, type SessionResult } from './sessions';
import type { AppState } from './types';

export interface TimerStartInput { title: string; goalId: string; metricId?: string; taskId?: string; sessionId?: string }
export interface WorkDayInput { date: string; actualMinutes: number; allocations: { taskId: string; minutes: number }[] }
export interface TimerSaveInput { title: string; goalId: string; metricId?: string; notes: string; days: WorkDayInput[] }
export interface LoggedWorkEdit extends SessionResult { title: string; goalId: string; metricId?: string }
const stamp = () => new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
function draft(input: { title: string; goalId: string; metricId?: string; notes?: string }): SessionDraft {
  return { title: input.title, goalId: input.goalId, metricId: input.metricId, notes: input.notes ?? '', plannedMinutes: 0, recurrence: 'none', taskIds: [] };
}
export function startWorkTimer(input: TimerStartInput): string {
  let id = '';
  update((state) => {
    if (state.activeTimer) throw new Error('You already have a timer. Resume or finish it before starting another.');
    validateDraft(state, { ...draft(input), taskIds: input.taskId ? [input.taskId] : [] });
    if (input.sessionId && !state.sessions?.some((s) => s.id === input.sessionId && s.goalId === input.goalId && s.status === 'planned')) {
      throw new Error('This reservation is no longer available. Start an unplanned timer instead.');
    }
    const now = stamp();
    const timer = activeWorkTimerSchema.parse({ ...input, id: uid(), title: input.title.trim(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, status: 'running', segments: [{ start: now }], createdAt: now });
    id = timer.id; state.activeTimer = timer;
  });
  return id;
}
function closeInterval(timer: ActiveWorkTimer) {
  const last = timer.segments.at(-1)!;
  if (last.end) return;
  const end = stamp();
  if (end < last.start) throw new Error('Your device clock is earlier than the timer start. Check the clock before pausing.');
  last.end = end; timer.status = 'paused';
}
export function pauseWorkTimer() {
  update((state) => {
    if (!state.activeTimer) throw new Error('This timer has already been finished or discarded.');
    closeInterval(state.activeTimer);
    activeWorkTimerSchema.parse(state.activeTimer);
  });
}
export function resumeWorkTimer() {
  update((state) => {
    const timer = state.activeTimer;
    if (!timer) throw new Error('This timer has already been finished or discarded.');
    if (timer.status === 'running') return;
    const start = stamp();
    if (start < (timer.segments.at(-1)?.end ?? '')) throw new Error('Your device clock moved backwards. Check it before resuming.');
    timer.segments.push({ start }); timer.status = 'running';
    activeWorkTimerSchema.parse(timer);
  });
}
export function discardWorkTimer() { update((state) => { state.activeTimer = undefined; }); }

/** All dated records, their goal credits, and clearing the draft share one CAS workspace save. */
export function saveWorkTimer(timerId: string, input: TimerSaveInput): string[] {
  let ids: string[] = [];
  update((state) => {
    const timer = state.activeTimer;
    if (!timer || timer.id !== timerId) {
      const saved = (state.sessions ?? []).filter((s) => s.sourceTimerId === timerId);
      const pending = [...input.days];
      const same = saved.length === pending.length && saved.every((s) => {
        if (s.title !== input.title.trim() || s.goalId !== input.goalId || s.metricId !== input.metricId || s.notes !== input.notes) return false;
        const index = pending.findIndex((d) => d.date === s.date && Math.abs(d.actualMinutes - s.actualMinutes!) < 1e-8 &&
          d.allocations.length === s.allocations.length && d.allocations.every((a) => s.allocations.some((b) => b.taskId === a.taskId && Math.abs(a.minutes - b.minutes) < 1e-8)));
        if (index < 0) return false;
        pending.splice(index, 1); return true;
      });
      if (saved.length && same) { ids = saved.map((s) => s.id); return; }
      throw new Error('This timer changed elsewhere. Reload its latest saved state before recording time.');
    }
    if (timer.status !== 'paused') throw new Error('Pause the timer before saving its reviewed time.');
    if (!input.days.length || input.days.length > 367) throw new Error('Review at least one work date (up to one year).');
    const base = draft(input);
    validateDraft(state, base);
    const lastDate = input.days.map((d) => d.date).sort().at(-1)!;
    const original = state.sessions?.find((s) => s.id === timer.sessionId && s.goalId === input.goalId && s.status === 'planned');
    input.days.forEach((day, index) => {
      const session = index === 0 && original ? original : buildSession(base);
      if (session !== original) (state.sessions ??= []).push(session);
      session.title = input.title.trim(); session.metricId = input.metricId; session.notes = input.notes;
      session.sourceTimerId = timer.id;
      logWorkSessionInDraft(state, session.id, { ...day, notes: input.notes, recurrenceAfter: lastDate,
        allowedThroughDate: timeTrackingDate(timer.timezone) });
      ids.push(session.id);
    });
    state.activeTimer = undefined;
  });
  return ids;
}
export function recordManualWork(input: SessionDraft, days: WorkDayInput[]): string[] {
  let ids: string[] = [];
  update((state) => {
    if (!days.length || days.length > 367) throw new Error('Enter at least one work date (up to one year).');
    const base = { ...input, plannedDate: undefined, plannedMinutes: 0, recurrence: 'none' as const };
    validateDraft(state, base);
    for (const day of days) {
      const session = buildSession(base);
      (state.sessions ??= []).push(session);
      logWorkSessionInDraft(state, session.id, { ...day, notes: input.notes });
      ids.push(session.id);
    }
  });
  return ids;
}
export function editLoggedWorkSession(id: string, input: LoggedWorkEdit) {
  update((state: AppState) => {
    const session = state.sessions?.find((s) => s.id === id);
    if (!session || session.status !== 'logged') throw new Error('This work entry no longer exists.');
    const base = draft(input);
    validateDraft(state, base);
    if (session.goalId !== input.goalId) {
      session.allocations = []; // Old-goal snapshots must not allow new-goal attribution.
      session.taskIds = [];
    }
    session.title = input.title.trim(); session.goalId = input.goalId; session.metricId = input.metricId;
    logWorkSessionInDraft(state, id, input);
  });
}
