import { z } from 'zod';
import { isMeasurementDate, type MeasurementEvent } from './measurements';

const date = z.string().refine(isMeasurementDate, 'Choose a real date.');
export const workDoneListSchema = z.array(z.string().max(2000)).max(200)
  .transform((items) => items.map((item) => item.trim()).filter(Boolean));
export const workSessionSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1), goalId: z.string().min(1),
  metricId: z.string().optional(), plannedDate: date.optional(),
  plannedMinutes: z.number().finite().min(0).max(1440),
  originalPlannedMinutes: z.number().finite().positive().max(1440).optional(),
  continuationOfId: z.string().optional(), remainderSessionId: z.string().optional(),
  sessionOutcome: z.enum(['finish', 'continue', 'replan']).optional(),
  recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']),
  taskIds: z.array(z.string()).max(100),
  notes: z.string(), status: z.enum(['planned', 'logged', 'skipped']),
  skippedAt: z.string().optional(),
  workDone: workDoneListSchema.optional(),
  date: date.optional(), actualMinutes: z.number().finite().positive().max(1500).optional(),
  allocations: z.array(z.object({
    taskId: z.string().min(1), taskTitle: z.string(), milestoneId: z.string().optional(),
    milestoneTitle: z.string().optional(), minutes: z.number().finite().positive().max(1500),
  })).max(100),
  createdAt: z.string(), loggedAt: z.string().optional(), spawnedNextId: z.string().optional(),
  sourceTaskId: z.string().optional(),
  sourceTimerId: z.string().optional(),
}).superRefine((s, ctx) => {
  if (s.status === 'logged' && (!s.date || !s.actualMinutes)) ctx.addIssue({ code: 'custom', message: 'Logged sessions need an actual date and duration.' });
  if (s.status !== 'logged' && (s.actualMinutes !== undefined || s.allocations.length)) ctx.addIssue({ code: 'custom', message: 'Unlogged time is not actual work.' });
  if (s.status === 'skipped' && !s.skippedAt) ctx.addIssue({ code: 'custom', message: 'Skipped sessions need a skip date.' });
  if (s.allocations.reduce((sum, row) => sum + row.minutes, 0) - (s.actualMinutes ?? 0) > 1e-8) ctx.addIssue({ code: 'custom', message: 'Task time cannot exceed the session duration.' });
  if (new Set(s.allocations.map((a) => a.taskId)).size !== s.allocations.length) ctx.addIssue({ code: 'custom', message: 'Allocate time to each task once per session.' });
});
export type WorkSession = z.infer<typeof workSessionSchema>;

/** Allocations already retain the task title. Derive descriptions, never extra time or completion. */
export function sessionWorkDone(session: {
  allocations?: readonly { taskTitle: string; minutes: number }[];
  workDone?: readonly string[];
}): { tasks: string[]; additional: string[]; all: string[] } {
  const seen = new Set<string>();
  const unique = (items: readonly string[]) => items.map((item) => item.trim()).filter((item) => {
    const key = item.replace(/\s+/g, ' ').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
  const tasks = unique((session.allocations ?? [])
    .filter((row) => Number.isFinite(row.minutes) && row.minutes > 0)
    .map((row) => row.taskTitle || 'Recorded task work'));
  const additional = unique(session.workDone ?? []);
  return { tasks, additional, all: [...tasks, ...additional] };
}

export function timeUnitMinutes(unit: string): number | null {
  const normalized = unit.trim().toLowerCase();
  if (/^(h|hr|hrs|hour|hours)$/.test(normalized)) return 60;
  if (/^(m|min|mins|minute|minutes)$/.test(normalized)) return 1;
  return null;
}

/** Tasks inside a reserved work session do not reserve that same time again. */
export function plannedWorkMinutes(
  state: {
    tasks: { id: string; goalId?: string; plannedDate?: string; effort: number; archived: boolean }[];
    sessions?: WorkSession[];
  }, start: string, end: string,
) {
  const sessions = (state.sessions ?? []).filter((s) => s.status !== 'skipped' && s.plannedDate && s.plannedDate >= start && s.plannedDate <= end);
  const covered = new Set(sessions.flatMap((s) => s.taskIds.filter((id) => state.tasks.some((t) => t.id === id && t.goalId === s.goalId))));
  return sessions.reduce((sum, s) => sum + s.plannedMinutes, 0)
    + state.tasks.filter((t) => !t.archived && t.plannedDate && t.plannedDate >= start && t.plannedDate <= end && !covered.has(t.id))
      .reduce((sum, t) => sum + t.effort, 0);
}

/** Validate a complete account snapshot, including the once-only session ledger. */
export function sessionLedgerIssues(state: {
  sessions?: WorkSession[];
  goals: { id: string; metrics: { id: string; unit: string; entries: MeasurementEvent[] }[] }[];
}): string[] {
  const issues: string[] = [];
  const sessions = new Map((state.sessions ?? []).map((s) => [s.id, s]));
  if (sessions.size !== (state.sessions ?? []).length) issues.push('Session identifiers must be unique.');
  const credits = new Map<string, MeasurementEvent[]>();
  for (const goal of state.goals) for (const metric of goal.metrics) for (const entry of metric.entries) {
    if (!entry.source?.sessionId) continue;
    const session = sessions.get(entry.source.sessionId);
    if (!session || session.status !== 'logged' || session.goalId !== goal.id || session.metricId !== metric.id) {
      issues.push('A session credit must belong to its logged session and chosen measure.');
      continue;
    }
    const entries = credits.get(session.id) ?? [];
    entries.push(entry); credits.set(session.id, entries);
  }
  for (const session of sessions.values()) {
    const goal = state.goals.find((g) => g.id === session.goalId);
    if (!goal) { issues.push('A work session must belong to an existing goal.'); continue; }
    const metric = goal.metrics.find((m) => m.id === session.metricId);
    if (session.metricId && (!metric || !timeUnitMinutes(metric.unit))) {
      issues.push('A work session can only credit an hours or minutes measure in its own goal.'); continue;
    }
    if (session.status !== 'logged' || !metric) continue;
    const divisor = timeUnitMinutes(metric.unit)!;
    const expected = new Map(session.allocations.map((a) => [a.taskId, a.minutes]));
    const remainder = session.actualMinutes! - session.allocations.reduce((sum, a) => sum + a.minutes, 0);
    if (remainder > 1e-8) expected.set('', remainder);
    for (const entry of credits.get(session.id) ?? []) {
      const key = entry.source?.taskId ?? '';
      const minutes = expected.get(key);
      if (minutes === undefined || entry.mode !== 'contribution' || entry.date !== session.date
        || entry.source?.sessionTitle !== session.title || Math.abs(entry.value * divisor - minutes) > 1e-8) {
        issues.push('Session credits must match actual time and allocations exactly, without double counting.');
      }
      expected.delete(key);
    }
    if (expected.size) issues.push('Each logged session needs its corresponding time contributions.');
  }
  return issues;
}
