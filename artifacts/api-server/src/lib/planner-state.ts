import { z } from 'zod';
import { savedTimesheetSchema } from '@workspace/api-zod';
import { ApplyAiOperationsBody, measurementEntrySchema, measurementFrequencySchema, isMeasurementDate, legacyMeasurementStart, workSessionSchema, sessionLedgerIssues, activeWorkTimerSchema, timeUnitMinutes } from '@workspace/api-zod';

export const operationSchema = ApplyAiOperationsBody.shape.operations.element;
export type Operation = z.infer<typeof operationSchema>;
const text = z.string();
const id = z.string().min(1);
const priority = z.enum(['high', 'medium', 'low']);
const history = z.object({
  id, at: text, kind: text, summary: text, reason: text.optional(),
  from: text.optional(), to: text.optional(), source: text.optional(),
}).passthrough();
const milestone = z.object({
  id, title: text, dueDate: text, done: z.boolean(), completedAt: text.optional(),
}).passthrough();
const metric = z.object({
  id, name: text, unit: text, kind: z.enum(['outcome', 'leading']),
  baseline: z.number(), target: z.number(),
  frequency: measurementFrequencySchema.optional(),
  startDate: z.string().refine(isMeasurementDate, 'Choose a real measurement start date.').optional(),
  targetHistory: z.array(z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), target: z.number().positive().finite() })).optional(),
  entries: z.array(measurementEntrySchema),
}).passthrough().superRefine((m, ctx) => {
  if (m.frequency && m.frequency !== 'cumulative' && (m.baseline !== 0 || m.target <= 0)) {
    ctx.addIssue({ code: 'custom', message: 'Recurring measurements start at zero and need a positive period target.' });
  }
});
const goal = z.object({
  id, title: text, outcome: text, area: z.enum(['business', 'fitness', 'english', 'personal']),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  spotlight: z.boolean().optional(),
  priority, targetDate: text, status: z.enum(['active', 'paused', 'completed', 'cancelled']),
  strategy: z.object({ summary: text, rationale: text, updatedAt: text }).passthrough(),
  milestones: z.array(milestone), metrics: z.array(metric), history: z.array(history),
  createdAt: text, isDemo: z.boolean(),
}).passthrough().transform((g) => {
  for (const m of g.metrics) {
    const startDate = legacyMeasurementStart(m, g.createdAt);
    if (startDate) m.startDate = startDate;
  }
  return g;
});
const task = z.object({
  id, title: text, goalId: text.optional(), milestoneId: text.optional(), parentTaskId: text.optional(),
  plannedDate: text.optional(), dueDate: text.optional(), priority, effort: z.number().min(0),
  notes: text, recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']),
  reminder: text.optional(), status: z.enum(['open', 'done']), completedAt: text.optional(),
  archived: z.boolean(), skippedAt: text.optional(), createdAt: text, isDemo: z.boolean(),
}).passthrough();
const commitment = z.object({
  taskId: id, title: text, goalId: text.optional(), plannedDate: text.optional(), effort: z.number(),
}).passthrough();
export const stateSchema = z.object({
  version: z.literal(1),
  settings: z.object({ name: text, theme: z.enum(['light', 'dark']), sidebarCollapsed: z.boolean(), onboardedFresh: z.boolean() }).passthrough(),
  goals: z.array(goal).max(5000), tasks: z.array(task).max(30000),
  sessions: z.array(workSessionSchema).max(30000).optional(),
  activeTimer: activeWorkTimerSchema.optional(),
  savedTimesheets: z.array(savedTimesheetSchema).max(1000).optional(),
  weekPlans: z.record(text, z.object({
    weekStart: text, focus: text, capacityMinutes: z.number(), finalized: z.boolean(),
    finalizedAt: text.optional(), commitments: z.array(commitment),
  }).passthrough()),
  periodNotes: z.record(text, text),
  reviews: z.array(z.object({
    id, type: z.enum(['weekly', 'monthly']), periodStart: text, periodEnd: text, createdAt: text,
    answers: z.object({ wins: text, misses: text, learned: text, change: text, focus: text }),
    snapshot: z.object({
      committed: z.number(), committedDone: z.number(), extraDone: z.number(), overdue: z.number(),
      metrics: z.array(z.object({
        goalId: id, goalTitle: text, metricId: id, name: text, unit: text,
        kind: z.enum(['outcome', 'leading']), value: z.number(), target: z.number(),
        frequency: measurementFrequencySchema.optional(), periodStart: text.optional(), periodEnd: text.optional(),
      })),
    }),
    adjustments: z.array(z.object({ kind: z.enum(['strategy', 'milestone', 'pause']), goalId: id, summary: text })),
    isDemo: z.boolean(),
  }).passthrough()),
  aiApplied: z.array(text).optional(),
  aiHistory: z.array(z.object({ at: text, summary: text })).optional(),
}).passthrough().superRefine((state, ctx) => {
  const reports = state.savedTimesheets ?? [];
  if (new Set(reports.map((report) => report.id)).size !== reports.length ||
    reports.some((report) => !state.goals.some((goal) => goal.id === report.goalId))) {
    ctx.addIssue({ code: 'custom', path: ['savedTimesheets'], message: 'Saved timesheets need unique identities and an existing goal. Remove reports explicitly before deleting their goal.' });
  }
  for (const message of sessionLedgerIssues(state)) ctx.addIssue({ code: 'custom', path: ['sessions'], message });
  if (state.activeTimer) {
    const goal = state.goals.find((g) => g.id === state.activeTimer!.goalId);
    const metric = goal?.metrics.find((m) => m.id === state.activeTimer!.metricId);
    if ((state.activeTimer.goalId && !goal) || (state.activeTimer.metricId && (!metric || !timeUnitMinutes(metric.unit)))) {
      ctx.addIssue({ code: 'custom', path: ['activeTimer'], message: 'A timer needs an existing goal and an optional time measure from that goal.' });
    }
  }
});
export type Workspace = z.infer<typeof stateSchema>;

export function requireText(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

export function validDate(value: string | undefined, label: string, required = false): string {
  if (!value && !required) return '';
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real date in YYYY-MM-DD format.`);
  }
  return value;
}
