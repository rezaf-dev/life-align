import { addDaysIso, addMonthsIso, nowStamp, todayIso, uid } from '@/lib/dates';
import { createSeed } from './seed';
import { isMeasurementDate, measurementEntrySchema, measurementPeriod } from '@workspace/api-zod';
import { getState, isValidState, replaceState, update } from './store';
import type {
  Adjustment,
  AppState,
  Area,
  Goal,
  GoalStatus,
  HistoryEvent,
  Metric,
  MetricKind,
  Priority,
  Review,
  Task,
  WeekPlan,
} from './types';

const ev = (e: Omit<HistoryEvent, 'id' | 'at'>): HistoryEvent => ({ id: uid(), at: nowStamp(), source: 'manual', ...e });

function findGoal(d: AppState, id: string) {
  const g = d.goals.find((x) => x.id === id);
  if (!g) throw new Error('Goal not found');
  return g;
}

/* ---------- Tasks ---------- */

export type TaskInput = Partial<Omit<Task, 'id' | 'createdAt' | 'isDemo' | 'title'>> & { title: string };

export function addTask(input: TaskInput) {
  const id = uid();
  update((d) => {
    d.tasks.unshift({
      id,
      title: input.title.trim(),
      goalId: input.goalId,
      milestoneId: input.milestoneId,
      plannedDate: input.plannedDate,
      dueDate: input.dueDate,
      priority: input.priority ?? 'medium',
      effort: input.effort ?? 30,
      notes: input.notes ?? '',
      recurrence: input.recurrence ?? 'none',
      reminder: input.reminder,
      status: 'open',
      archived: false,
      createdAt: nowStamp(),
      isDemo: false,
    });
  });
  return id;
}

export function updateTask(id: string, patch: Partial<Task>) {
  update((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    if (patch.reminder !== undefined && patch.reminder !== t.reminder) t.reminderDismissed = false;
    Object.assign(t, patch);
  });
}

function shift(date: string, r: Task['recurrence']) {
  if (r === 'daily') return addDaysIso(date, 1);
  if (r === 'weekly') return addDaysIso(date, 7);
  return addMonthsIso(date, 1);
}

/** Toggle completion. Recurring tasks spawn their next occurrence exactly once. */
export function toggleTask(id: string): { spawned?: string } {
  let spawned: string | undefined;
  update((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.status === 'open') {
      spawned = finishTask(d, t);
    } else {
      t.status = 'open';
      t.completedAt = undefined;
    }
  });
  return { spawned };
}

/** The completion and its measured result share a single workspace write. */
export function completeTaskWithResult(
  id: string,
  result?: { metricId: string; amount: number; date: string; note?: string },
): { spawned?: string } {
  const existing = getState().tasks.find((t) => t.id === id);
  if (!existing) throw new Error('That task no longer exists.');
  // Saving again after a network failure must not credit or spawn twice.
  if (existing.status === 'done') return {};
  let spawned: string | undefined;
  update((d) => {
    const task = d.tasks.find((t) => t.id === id)!;
    if (result) {
      if (!task.goalId) throw new Error('Link this task to a goal before recording a result.');
      recordContributionInDraft(d, task.goalId, result.metricId, {
        amount: result.amount, date: result.date, note: result.note, taskId: task.id,
      });
    }
    spawned = finishTask(d, task);
  });
  return { spawned };
}

function finishTask(d: AppState, t: Task): string | undefined {
  t.status = 'done';
  t.completedAt = nowStamp();
  if (t.recurrence !== 'none' && !t.spawnedNextId) {
        const base = t.plannedDate ?? t.dueDate ?? todayIso();
        const next: Task = {
          ...t,
          id: uid(),
          status: 'open',
          completedAt: undefined,
          spawnedNextId: undefined,
          plannedDate: t.plannedDate ? shift(t.plannedDate, t.recurrence) : shift(base, t.recurrence),
          dueDate: t.dueDate ? shift(t.dueDate, t.recurrence) : undefined,
          reminder: t.reminder ? `${shift(t.reminder.slice(0, 10), t.recurrence)}${t.reminder.slice(10)}` : undefined,
          reminderDismissed: false,
          createdAt: nowStamp(),
          isDemo: false,
        };
        t.spawnedNextId = next.id;
        d.tasks.unshift(next);
        return next.plannedDate;
  }
  return undefined;
}

export function rescheduleTasks(ids: string[], date: string | undefined) {
  update((d) => {
    d.tasks.forEach((t) => {
      if (ids.includes(t.id)) t.plannedDate = date;
    });
  });
}

export function archiveTask(id: string, archived = true) {
  updateTask(id, archived ? { archived } : { archived, skippedAt: undefined });
}

export function deleteTask(id: string) {
  update((d) => {
    d.tasks = d.tasks.filter((t) => t.id !== id);
    d.tasks.forEach((t) => {
      if (t.parentTaskId === id) delete t.parentTaskId;
    });
  });
}

export function dismissReminder(id: string) {
  updateTask(id, { reminderDismissed: true });
}

/* ---------- Goals ---------- */

export interface GoalInput {
  title: string;
  outcome: string;
  area: Area;
  priority: Priority;
  targetDate: string;
  strategy?: string;
  rationale?: string;
  metric?: { name: string; unit: string; baseline: number; target: number; kind: MetricKind; frequency?: Metric['frequency']; startDate?: string };
}

export function addGoal(input: GoalInput, isDemo = false) {
  if (input.metric) validateMetricDefinition(input.metric);
  const id = uid();
  update((d) => {
    d.goals.unshift(buildGoal(id, input, isDemo));
  });
  return id;
}

function buildGoal(id: string, input: GoalInput, isDemo: boolean): Goal {
  return {
    id,
    title: input.title.trim(),
    outcome: input.outcome.trim(),
    area: input.area,
    priority: input.priority,
    targetDate: input.targetDate,
    status: 'active',
    strategy: { summary: input.strategy ?? '', rationale: input.rationale ?? '', updatedAt: nowStamp() },
    milestones: [],
    metrics: input.metric
      ? [{ id: uid(), entries: [], ...input.metric, startDate: input.metric.frequency && input.metric.frequency !== 'cumulative' ? input.metric.startDate ?? todayIso() : undefined }]
      : [],
    history: [ev({ kind: 'created', summary: 'Goal created' })],
    createdAt: nowStamp(),
    isDemo,
  };
}

export function editGoalBasics(id: string, patch: Pick<Goal, 'title' | 'outcome' | 'area' | 'priority'>) {
  update((d) => {
    const g = findGoal(d, id);
    const changed = (['title', 'outcome', 'area', 'priority'] as const).filter((k) => g[k] !== patch[k]);
    if (!changed.length) return;
    Object.assign(g, patch);
    g.history.unshift(ev({ kind: 'edit', summary: `Edited ${changed.join(', ')}` }));
  });
}

export function changeStrategy(
  id: string,
  summary: string,
  rationale: string,
  reason: string,
  source: 'manual' | 'review' = 'manual',
) {
  update((d) => {
    const g = findGoal(d, id);
    const from = g.strategy.summary;
    g.strategy = { summary, rationale, updatedAt: nowStamp() };
    g.history.unshift(ev({ kind: 'strategy', summary: 'Strategy revised', reason, from, to: summary, source }));
  });
}

export function changeTargetDate(id: string, date: string, reason: string) {
  update((d) => {
    const g = findGoal(d, id);
    const from = g.targetDate;
    g.targetDate = date;
    g.history.unshift(ev({ kind: 'deadline', summary: 'Target date moved', reason, from, to: date }));
  });
}

export function changeMetricTarget(goalId: string, metricId: string, target: number, reason: string, frequency?: Metric['frequency']) {
  update((d) => {
    const g = findGoal(d, goalId);
    const m = g.metrics.find((x) => x.id === metricId);
    if (!m) return;
    const nextFrequency = frequency ?? m.frequency ?? 'cumulative';
    if (nextFrequency !== (m.frequency ?? 'cumulative') && m.entries.length) {
      throw new Error('Keep this measurement’s history intact. Add a new measurement to use a different frequency.');
    }
    if (!Number.isFinite(target) || (nextFrequency !== 'cumulative' && target <= 0)) throw new Error('Enter a valid target; recurring targets must be greater than zero.');
    const from = `${m.target} (${m.frequency ?? 'cumulative'})`;
    if (nextFrequency !== (m.frequency ?? 'cumulative')) {
      delete m.targetHistory;
      m.startDate = nextFrequency === 'cumulative' ? undefined : todayIso();
    } else if (nextFrequency !== 'cumulative' && target !== m.target) {
      const start = measurementPeriod(m, todayIso())!.start;
      const previous = m.targetHistory ?? [{ start: '0001-01-01', target: m.target }];
      m.targetHistory = [...previous.filter((item) => item.start < start), { start, target }];
    }
    m.target = target;
    m.frequency = nextFrequency;
    if (nextFrequency !== 'cumulative') m.baseline = 0;
    g.history.unshift(ev({ kind: 'target', summary: `Target for "${m.name}" changed`, reason, from, to: `${target} (${nextFrequency})` }));
  });
}

const statusVerb: Record<GoalStatus, string> = {
  active: 'Resumed',
  paused: 'Paused',
  completed: 'Marked complete',
  cancelled: 'Cancelled',
};

export function setGoalStatus(id: string, status: GoalStatus, reason: string, source: 'manual' | 'review' = 'manual') {
  update((d) => {
    const g = findGoal(d, id);
    const from = g.status;
    g.status = status;
    g.history.unshift(ev({ kind: 'status', summary: statusVerb[status], reason, from, to: status, source }));
  });
}

export function deleteGoal(id: string) {
  update((d) => {
    if (d.savedTimesheets?.some((report) => report.goalId === id)) throw new Error('This goal has saved timesheets and payment history. Keep the goal to retain them, or delete its saved timesheets explicitly first.');
    if (d.activeTimer?.goalId === id) throw new Error('Finish or discard this goal’s timer before deleting the goal.');
    d.goals = d.goals.filter((g) => g.id !== id);
    if (d.sessions) d.sessions = d.sessions.filter((s) => s.goalId !== id);
    d.tasks.forEach((t) => {
      if (t.goalId === id) {
        t.goalId = undefined;
        t.milestoneId = undefined;
      }
    });
  });
}

export function addMilestone(goalId: string, title: string, dueDate: string) {
  update((d) => {
    const g = findGoal(d, goalId);
    g.milestones.push({ id: uid(), title, dueDate, done: false });
    g.milestones.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    g.history.unshift(ev({ kind: 'milestone', summary: `Milestone added: ${title}`, to: dueDate }));
  });
}

export function toggleMilestone(goalId: string, msId: string) {
  update((d) => {
    const g = findGoal(d, goalId);
    const m = g.milestones.find((x) => x.id === msId);
    if (!m) return;
    m.done = !m.done;
    m.completedAt = m.done ? nowStamp() : undefined;
    g.history.unshift(ev({ kind: 'milestone', summary: `${m.done ? 'Reached' : 'Reopened'}: ${m.title}` }));
  });
}

export function rescheduleMilestone(
  goalId: string,
  msId: string,
  date: string,
  reason: string,
  source: 'manual' | 'review' = 'manual',
) {
  update((d) => {
    const g = findGoal(d, goalId);
    const m = g.milestones.find((x) => x.id === msId);
    if (!m) return;
    const from = m.dueDate;
    m.dueDate = date;
    g.milestones.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    g.history.unshift(ev({ kind: 'milestone', summary: `Rescheduled: ${m.title}`, reason, from, to: date, source }));
  });
}

export function deleteMilestone(goalId: string, msId: string) {
  update((d) => {
    const g = findGoal(d, goalId);
    const m = g.milestones.find((x) => x.id === msId);
    g.milestones = g.milestones.filter((x) => x.id !== msId);
    d.tasks.forEach((t) => {
      if (t.milestoneId === msId) t.milestoneId = undefined;
    });
    if (m) g.history.unshift(ev({ kind: 'milestone', summary: `Milestone removed: ${m.title}` }));
  });
}

function validateMetricDefinition(m: Pick<Metric, 'baseline' | 'target' | 'frequency' | 'startDate'>) {
  if (!Number.isFinite(m.target) || !Number.isFinite(m.baseline)) throw new Error('Enter a valid starting value and target.');
  if (m.startDate && !isMeasurementDate(m.startDate)) throw new Error('Choose a real measurement start date.');
  if (m.frequency && m.frequency !== 'cumulative' && (m.baseline !== 0 || m.target <= 0)) throw new Error('Recurring measurements start at zero and need a positive period target.');
}
export function addMetric(goalId: string, m: Omit<Metric, 'id' | 'entries'>) {
  validateMetricDefinition(m);
  update((d) => {
    const g = findGoal(d, goalId);
    g.metrics.push({ ...m, startDate: m.frequency && m.frequency !== 'cumulative' ? m.startDate ?? todayIso() : undefined, id: uid(), entries: [] });
    g.history.unshift(ev({ kind: 'metric', summary: `Now measuring: ${m.name}` }));
  });
}

/** Correct a measure's definition without replacing its ledger or dated targets. */
export function updateMetric(
  goalId: string,
  metricId: string,
  patch: Pick<Metric, 'name' | 'unit' | 'kind' | 'baseline'> & Pick<Partial<Metric>, 'startDate'>,
) {
  const name = patch.name.trim();
  const unit = patch.unit.trim();
  if (!name) throw new Error('Enter a measure name.');
  if (patch.kind !== 'outcome' && patch.kind !== 'leading') throw new Error('Choose Result or Activity.');
  update((d) => {
    const goal = findGoal(d, goalId);
    const metric = goal.metrics.find((m) => m.id === metricId);
    if (!metric) throw new Error('That measure no longer exists.');
    const startDate = patch.startDate ?? metric.startDate;
    if (metric.entries.length && startDate !== metric.startDate) {
      throw new Error('The start date is locked to preserve recorded periods.');
    }
    if (metric.entries.length && (unit !== metric.unit || patch.baseline !== metric.baseline)) {
      throw new Error('Units and starting value cannot change after results are recorded. Add a separate measure to keep those results accurate.');
    }
    validateMetricDefinition({ ...metric, baseline: patch.baseline, startDate });
    const label = (m: Pick<Metric, 'name' | 'unit' | 'kind' | 'baseline'>) =>
      `${m.name} · ${m.kind === 'outcome' ? 'Result' : 'Activity'} · ${m.unit || 'no unit'} · starting at ${m.baseline}`;
    const from = `${label(metric)}${metric.startDate ? ` · starts ${metric.startDate}` : ''}`;
    const next = { name, unit, kind: patch.kind, baseline: patch.baseline, startDate };
    if (metric.name === name && metric.unit === unit && metric.kind === patch.kind && metric.baseline === patch.baseline && metric.startDate === startDate) return;
    Object.assign(metric, next);
    goal.history.unshift(ev({ kind: 'metric', summary: `Measure updated: ${name}`, from, to: `${label(metric)}${metric.startDate ? ` · starts ${metric.startDate}` : ''}` }));
  });
}

export function deleteMetric(goalId: string, metricId: string) {
  update((d) => {
    const g = findGoal(d, goalId);
    const m = g.metrics.find((x) => x.id === metricId);
    g.metrics = g.metrics.filter((x) => x.id !== metricId);
    d.sessions?.forEach((s) => { if (s.goalId === goalId && s.metricId === metricId) delete s.metricId; });
    if (d.activeTimer?.goalId === goalId && d.activeTimer.metricId === metricId) delete d.activeTimer.metricId;
    if (m) g.history.unshift(ev({ kind: 'metric', summary: `Stopped measuring: ${m.name}` }));
  });
}

export function logMetric(goalId: string, metricId: string, value: number, date: string, note?: string) {
  update((d) => {
    const g = findGoal(d, goalId);
    const m = g.metrics.find((x) => x.id === metricId);
    if (!m) return;
    m.entries.push({ id: uid(), date, value, note: note?.trim() || undefined });
    m.entries.sort((a, b) => a.date.localeCompare(b.date));
  });
}

export interface ContributionInput {
  amount: number;
  date: string;
  note?: string;
  taskId?: string;
  milestoneId?: string;
}
function validateContributionInput(input: Pick<ContributionInput, 'amount' | 'date'>) {
  if (!Number.isFinite(input.amount) || input.amount === 0) throw new Error('Enter a non-zero measured change.');
  if (!isMeasurementDate(input.date) || input.date > todayIso()) throw new Error('Choose a real date, today or earlier.');
}
export function recordContribution(goalId: string, metricId: string, input: ContributionInput): string {
  let id = '';
  update((d) => { id = recordContributionInDraft(d, goalId, metricId, input); });
  return id;
}

function recordContributionInDraft(d: AppState, goalId: string, metricId: string, input: ContributionInput): string {
  validateContributionInput(input);
  const id = uid();
    const goal = findGoal(d, goalId);
    const metric = goal.metrics.find((m) => m.id === metricId);
    if (!metric) throw new Error('That measurement no longer exists.');
    const task = input.taskId ? d.tasks.find((t) => t.id === input.taskId) : undefined;
    if (input.taskId && (!task || task.goalId !== goalId)) throw new Error('Choose a task linked to this goal.');
    if (task && input.milestoneId && task.milestoneId !== input.milestoneId) throw new Error('The task belongs to a different milestone.');
    const milestoneId = task ? task.milestoneId : input.milestoneId;
    const milestone = milestoneId ? goal.milestones.find((m) => m.id === milestoneId) : undefined;
    if (milestoneId && !milestone) throw new Error('That milestone no longer exists.');
    if (!task && !milestone) throw new Error('Choose a contributing task or milestone.');
    const entry = {
      id, date: input.date, value: input.amount, note: input.note?.trim() || undefined,
      mode: 'contribution' as const,
      source: { taskId: task?.id, taskTitle: task?.title, milestoneId: milestone?.id, milestoneTitle: milestone?.title },
    };
    measurementEntrySchema.parse(entry);
    metric.entries.push(entry);
    metric.entries.sort((a, b) => a.date.localeCompare(b.date));
    goal.history.unshift(ev({
      kind: 'metric',
      summary: `Recorded contribution to ${metric.name}: ${input.amount > 0 ? '+' : ''}${input.amount} ${metric.unit} from ${task?.title ?? milestone!.title}`,
      reason: input.note?.trim() || undefined,
    }));
  return id;
}
export function editContribution(goalId: string, metricId: string, entryId: string, patch: Pick<ContributionInput, 'amount' | 'date' | 'note'>) {
  validateContributionInput(patch);
  update((d) => {
    const goal = findGoal(d, goalId);
    const metric = goal.metrics.find((m) => m.id === metricId);
    const entry = metric?.entries.find((e) => e.id === entryId);
    if (!metric || !entry || entry.mode !== 'contribution') throw new Error('That contribution no longer exists.');
    if (entry.source?.sessionId) throw new Error('Edit this time in Work sessions so its duration and task allocations stay consistent.');
    const before = `${entry.value} ${metric.unit} on ${entry.date}`;
    entry.value = patch.amount; entry.date = patch.date; entry.note = patch.note?.trim() || undefined;
    metric.entries.sort((a, b) => a.date.localeCompare(b.date));
    goal.history.unshift(ev({
      kind: 'metric', summary: `Corrected recorded contribution to ${metric.name}`,
      from: before, to: `${entry.value} ${metric.unit} on ${entry.date}`, reason: patch.note?.trim() || undefined,
    }));
  });
}

export function deleteMetricEntry(goalId: string, metricId: string, entryId: string) {
  update((d) => {
    const goal = findGoal(d, goalId);
    const m = goal.metrics.find((x) => x.id === metricId);
    const entry = m?.entries.find((e) => e.id === entryId);
    if (entry?.source?.sessionId) throw new Error('Delete or edit this contribution through its work session.');
    if (entry?.mode === 'contribution') goal.history.unshift(ev({
      kind: 'metric', summary: `Removed contribution to ${m!.name}: ${entry.value} ${m!.unit}`,
      from: `${entry.source?.taskTitle ?? entry.source?.milestoneTitle}: ${entry.value}`,
    }));
    if (m) m.entries = m.entries.filter((e) => e.id !== entryId);
  });
}

export function splitGoal(
  id: string,
  opts: { title: string; outcome: string; milestoneIds: string[]; metricIds: string[]; reason: string },
) {
  const newId = uid();
  update((d) => {
    const g = findGoal(d, id);
    const moveMs = g.milestones.filter((m) => opts.milestoneIds.includes(m.id));
    const moveMetrics = g.metrics.filter((m) => opts.metricIds.includes(m.id));
    g.milestones = g.milestones.filter((m) => !opts.milestoneIds.includes(m.id));
    g.metrics = g.metrics.filter((m) => !opts.metricIds.includes(m.id));
    const child: Goal = {
      ...buildGoal(newId, {
        title: opts.title,
        outcome: opts.outcome,
        area: g.area,
        priority: g.priority,
        targetDate: g.targetDate,
        strategy: g.strategy.summary,
        rationale: g.strategy.rationale,
      }, false),
      milestones: moveMs,
      metrics: moveMetrics,
    };
    child.history = [ev({ kind: 'split', summary: `Split from "${g.title}"`, reason: opts.reason })];
    g.history.unshift(ev({ kind: 'split', summary: `Split into "${opts.title}"`, reason: opts.reason }));
    d.tasks.forEach((t) => {
      if (t.goalId === id && t.milestoneId && opts.milestoneIds.includes(t.milestoneId)) t.goalId = newId;
    });
    d.sessions?.forEach((s) => {
      if (s.goalId === id && s.metricId && opts.metricIds.includes(s.metricId)) {
        s.goalId = newId;
        s.taskIds = s.taskIds.filter((taskId) => d.tasks.some((t) => t.id === taskId && t.goalId === newId));
      }
    });
    if (d.activeTimer?.goalId === id && d.activeTimer.metricId && opts.metricIds.includes(d.activeTimer.metricId)) {
      d.activeTimer.goalId = newId;
      if (d.activeTimer.taskId && !d.tasks.some((t) => t.id === d.activeTimer!.taskId && t.goalId === newId)) delete d.activeTimer.taskId;
    }
    d.goals.unshift(child);
  });
  return newId;
}

/* ---------- Planning ---------- */

export function defaultWeek(weekStart: string): WeekPlan {
  return { weekStart, focus: '', capacityMinutes: 600, finalized: false, commitments: [] };
}

export function setWeekPlan(weekStart: string, patch: Partial<Pick<WeekPlan, 'focus' | 'capacityMinutes'>>) {
  update((d) => {
    d.weekPlans[weekStart] = { ...(d.weekPlans[weekStart] ?? defaultWeek(weekStart)), ...patch };
  });
}

export function finalizeWeek(weekStart: string) {
  update((d) => {
    const plan = d.weekPlans[weekStart] ?? defaultWeek(weekStart);
    const end = addDaysIso(weekStart, 6);
    if (!plan.commitments.length) {
      plan.commitments = d.tasks
        .filter((t) => !t.archived && t.plannedDate && t.plannedDate >= weekStart && t.plannedDate <= end)
        .map((t) => ({ taskId: t.id, title: t.title, goalId: t.goalId, plannedDate: t.plannedDate, effort: t.effort }));
    }
    plan.finalized = true;
    plan.finalizedAt = nowStamp();
    d.weekPlans[weekStart] = plan;
  });
}

export function reopenWeek(weekStart: string) {
  update((d) => {
    const plan = d.weekPlans[weekStart];
    if (plan) plan.finalized = false;
  });
}

export function setPeriodNote(key: string, text: string) {
  update((d) => {
    d.periodNotes[key] = text;
  });
}

/* ---------- Reviews ---------- */

export type ProposedAdjustment =
  | { kind: 'strategy'; goalId: string; summary: string; rationale: string; reason: string }
  | { kind: 'milestone'; goalId: string; milestoneId: string; date: string; reason: string }
  | { kind: 'pause'; goalId: string; reason: string };

export function saveReview(
  review: Omit<Review, 'id' | 'createdAt' | 'adjustments' | 'isDemo'>,
  approved: ProposedAdjustment[],
) {
  const s = getState();
  const applied: Adjustment[] = approved.map((a) => {
    const g = s.goals.find((x) => x.id === a.goalId);
    if (a.kind === 'strategy') return { kind: 'strategy', goalId: a.goalId, summary: `Strategy for "${g?.title}" revised: ${a.summary}` };
    if (a.kind === 'milestone') {
      const m = g?.milestones.find((x) => x.id === a.milestoneId);
      return { kind: 'milestone', goalId: a.goalId, summary: `"${m?.title}" moved from ${m?.dueDate} to ${a.date}` };
    }
    return { kind: 'pause', goalId: a.goalId, summary: `Paused "${g?.title}"` };
  });
  approved.forEach((a) => {
    if (a.kind === 'strategy') changeStrategy(a.goalId, a.summary, a.rationale, a.reason, 'review');
    if (a.kind === 'milestone') rescheduleMilestone(a.goalId, a.milestoneId, a.date, a.reason, 'review');
    if (a.kind === 'pause') setGoalStatus(a.goalId, 'paused', a.reason, 'review');
  });
  const id = uid();
  update((d) => {
    d.reviews.unshift({ ...review, id, createdAt: nowStamp(), adjustments: applied, isDemo: false });
    const touched = new Set(approved.map((a) => a.goalId));
    d.goals.forEach((g) => {
      if (touched.has(g.id))
        g.history.unshift(ev({ kind: 'review', summary: `Adjusted in ${review.type} review`, source: 'review' }));
    });
  });
  return id;
}

export function deleteReview(id: string) {
  update((d) => {
    d.reviews = d.reviews.filter((r) => r.id !== id);
  });
}

/* ---------- Settings & data ---------- */

export function setSettings(patch: Partial<AppState['settings']>) {
  update((d) => {
    d.settings = { ...d.settings, ...patch };
  });
}

export function exportJson() {
  return JSON.stringify(getState(), null, 2);
}

export function importJson(raw: string) {
  const parsed = JSON.parse(raw);
  if (!isValidState(parsed)) throw new Error('This file is not an Align backup.');
  replaceState(parsed);
}

export function restoreSample() {
  const s = getState();
  const seed = createSeed();
  seed.settings = { ...seed.settings, theme: s.settings.theme, name: s.settings.name };
  replaceState(seed);
}

export function removeSampleData() {
  update((d) => {
    const demoGoals = new Set(d.goals.filter((g) => g.isDemo).map((g) => g.id));
    if (d.savedTimesheets?.some((report) => demoGoals.has(report.goalId))) throw new Error('Sample goals contain saved timesheets and payment history. Remove those reports explicitly before removing the sample data.');
    d.goals = d.goals.filter((g) => !g.isDemo);
    if (d.sessions) d.sessions = d.sessions.filter((s) => !demoGoals.has(s.goalId));
    d.tasks = d.tasks.filter((t) => !t.isDemo);
    d.tasks.forEach((t) => {
      if (t.goalId && demoGoals.has(t.goalId)) {
        t.goalId = undefined;
        t.milestoneId = undefined;
      }
    });
    d.reviews = d.reviews.filter((r) => !r.isDemo);
    const live = new Set(d.tasks.map((t) => t.id));
    Object.values(d.weekPlans).forEach((p) => {
      p.commitments = p.commitments.filter((c) => live.has(c.taskId));
      if (!p.commitments.length) p.finalized = false;
    });
    d.periodNotes = {};
  });
}

export function startFresh(name: string, goals: GoalInput[], removeSample: boolean) {
  if (removeSample) removeSampleData();
  goals.forEach((g) => addGoal(g));
  setSettings({ name: name.trim() || getState().settings.name, onboardedFresh: true });
}
