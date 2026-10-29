import { randomUUID } from 'node:crypto';
import { measurementValueAt } from '@workspace/api-zod';
import { requireText, stateSchema, validDate, type Operation, type Workspace } from './planner-state';

/** Pure transactional reducer. Nothing is persisted server-side or sent to the model here. */
export function applyOperations(raw: unknown, operations: Operation[], requestId: string) {
  const state = stateSchema.parse(raw);
  if (state.aiApplied?.includes(requestId)) return { state, changes: [], alreadyApplied: true };
  const stamp = new Date().toISOString();
  const refs = new Map<string, string>();
  const keys = new Set<string>();
  const changes: string[] = [];
  const resolve = (v?: string) => v ? refs.get(v) ?? v : undefined;
  const goalFor = (ref?: string) => {
    const g = state.goals.find((g) => g.id === resolve(ref));
    if (!g) throw new Error('The referenced goal no longer exists. Refresh the proposal.');
    return g;
  };
  const taskFor = (ref?: string) => {
    const t = state.tasks.find((t) => t.id === resolve(ref));
    if (!t) throw new Error('The referenced task no longer exists. Refresh the proposal.');
    return t;
  };
  const record = (g: Workspace['goals'][number], kind: string, summary: string, op: Operation, from?: string, to?: string) => {
    g.history.unshift({ id: randomUUID(), at: stamp, kind, summary, reason: op.reason, from, to, source: 'ai' });
  };
  const setTaskLinks = (t: Workspace['tasks'][number], op: Operation) => {
    if (op.goalId !== undefined) {
      t.goalId = op.goalId ? goalFor(op.goalId).id : undefined;
      if (!t.goalId || !state.goals.find((g) => g.id === t.goalId)?.milestones.some((m) => m.id === t.milestoneId)) t.milestoneId = undefined;
    }
    if (op.milestoneId !== undefined) {
      const mid = resolve(op.milestoneId);
      if (mid && !state.goals.find((g) => g.id === t.goalId)?.milestones.some((m) => m.id === mid)) {
        throw new Error('The milestone must belong to the task’s selected goal.');
      }
      t.milestoneId = mid;
    }
    if (op.parentTaskId !== undefined) {
      const parent = taskFor(op.parentTaskId);
      if (parent.id === t.id || parent.parentTaskId) throw new Error('Breakdowns support one level of actions under an original task.');
      t.parentTaskId = parent.id;
      if (op.goalId === undefined) t.goalId = parent.goalId;
      if (op.milestoneId === undefined && t.goalId === parent.goalId) t.milestoneId = parent.milestoneId;
      if (op.plannedDate === undefined) t.plannedDate = parent.plannedDate;
    }
  };
  for (const op of operations) {
    requireText(op.key, 'Proposal item key');
    if (keys.has(op.key)) throw new Error('Proposal item keys must be unique.');
    if (state.goals.some((g) => g.id === op.key) || state.tasks.some((t) => t.id === op.key)) {
      throw new Error('A proposal key conflicts with an existing record. Regenerate it.');
    }
    keys.add(op.key);
    for (const field of ['targetDate', 'dueDate', 'plannedDate', 'weekStart', 'date', 'periodStart', 'periodEnd'] as const) {
      if (op[field] !== undefined) validDate(op[field], field);
    }
    if (op.reminder) {
      if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(op.reminder)) throw new Error('Reminder needs a valid local date and time.');
      validDate(op.reminder.slice(0, 10), 'Reminder date', true);
    }
    switch (op.type) {
      case 'create_goal': {
        const title = requireText(op.title, 'Goal title');
        if (state.goals.some((g) => g.status !== 'cancelled' && g.title.trim().toLowerCase() === title.toLowerCase())) {
          throw new Error(`A goal named “${title}” already exists. Link to it instead.`);
        }
        const id = randomUUID();
        refs.set(op.key, id);
        state.goals.unshift({
          id, title, outcome: op.outcome ?? '', area: op.area ?? 'personal', priority: op.priority ?? 'medium',
          targetDate: validDate(op.targetDate, 'Goal target date'), status: 'active',
          strategy: { summary: op.summary ?? '', rationale: op.rationale ?? '', updatedAt: stamp },
          milestones: [], metrics: [], history: [{ id: randomUUID(), at: stamp, kind: 'created', summary: 'Created from an approved AI proposal', source: 'ai' }],
          createdAt: stamp, isDemo: false,
        });
        changes.push(`Created goal: ${title}`);
        break;
      }
      case 'update_goal': {
        const g = goalFor(op.goalId);
        requireText(op.reason, 'Reason for changing this goal');
        const before = JSON.stringify({ title: g.title, outcome: g.outcome, targetDate: g.targetDate, status: g.status, area: g.area, priority: g.priority });
        if (op.title !== undefined) g.title = requireText(op.title, 'Goal title');
        if (op.outcome !== undefined) g.outcome = op.outcome;
        if (op.targetDate !== undefined) g.targetDate = op.targetDate;
        if (op.area) g.area = op.area;
        if (op.priority) g.priority = op.priority;
        if (op.status) {
          if (!['active', 'paused', 'completed', 'cancelled'].includes(op.status)) throw new Error('Invalid goal status.');
          g.status = op.status as typeof g.status;
        }
        const after = JSON.stringify({ title: g.title, outcome: g.outcome, targetDate: g.targetDate, status: g.status, area: g.area, priority: g.priority });
        record(g, 'edit', 'Goal adjusted with AI assistance', op, before, after);
        changes.push(`Updated goal: ${g.title}`);
        break;
      }
      case 'create_strategy':
      case 'update_strategy': {
        const g = goalFor(op.goalId);
        requireText(op.reason, 'Reason for changing strategy');
        const summary = requireText(op.summary, 'Strategy');
        const before = g.strategy.summary;
        g.strategy = { summary, rationale: op.rationale ?? g.strategy.rationale, updatedAt: stamp };
        record(g, 'strategy', 'Strategy revised with AI assistance', op, before, summary);
        changes.push(`Updated strategy: ${g.title}`);
        break;
      }
      case 'create_milestone': {
        const g = goalFor(op.goalId);
        const title = requireText(op.title, 'Milestone title');
        if (g.milestones.some((m) => m.title.toLowerCase() === title.toLowerCase())) throw new Error('This milestone already exists on the goal.');
        const id = randomUUID();
        refs.set(op.key, id);
        g.milestones.push({ id, title, dueDate: validDate(op.dueDate, 'Milestone date', true), done: false });
        record(g, 'milestone', `Added milestone: ${title}`, op);
        changes.push(`Added milestone: ${title}`);
        break;
      }
      case 'update_milestone': {
        const g = goalFor(op.goalId);
        const m = g.milestones.find((m) => m.id === resolve(op.milestoneId));
        if (!m) throw new Error('The referenced milestone no longer exists.');
        requireText(op.reason, 'Reason for changing milestone');
        const from = JSON.stringify(m);
        if (op.title !== undefined) m.title = requireText(op.title, 'Milestone title');
        if (op.dueDate !== undefined) m.dueDate = validDate(op.dueDate, 'Milestone date', true);
        if (op.done !== undefined) { m.done = op.done; m.completedAt = op.done ? stamp : undefined; }
        record(g, 'milestone', `Updated milestone: ${m.title}`, op, from, JSON.stringify(m));
        changes.push(`Updated milestone: ${m.title}`);
        break;
      }
      case 'create_task': {
        const title = requireText(op.title, 'Task title');
        const parentId = resolve(op.parentTaskId);
        if (state.tasks.some((t) => !t.archived && t.status === 'open' && t.title.trim().toLowerCase() === title.toLowerCase() &&
          (t.parentTaskId ?? '') === (parentId ?? '') && (t.plannedDate ?? '') === (op.plannedDate ?? ''))) {
          throw new Error(`“${title}” is already in your tasks. Schedule or link the existing task instead.`);
        }
        const id = randomUUID();
        const t: Workspace['tasks'][number] = {
          id, title, priority: op.priority ?? 'medium', effort: op.effort ?? 30, notes: op.notes ?? '',
          recurrence: op.recurrence ?? 'none', status: 'open', archived: false, createdAt: stamp, isDemo: false,
          plannedDate: op.plannedDate || undefined, dueDate: op.dueDate || undefined, reminder: op.reminder || undefined,
        };
        setTaskLinks(t, op);
        refs.set(op.key, id);
        state.tasks.unshift(t);
        changes.push(`Created task: ${title}`);
        break;
      }
      case 'update_task':
      case 'link_task_to_goal':
      case 'reschedule_task': {
        const t = taskFor(op.taskId);
        if (op.type === 'link_task_to_goal' && op.goalId === undefined) throw new Error('Select a goal for this link, or choose no goal to unlink.');
        if (op.type === 'reschedule_task' && op.plannedDate === undefined && op.dueDate === undefined) throw new Error('Choose a new date or clear the existing planned date.');
        if (t.archived) throw new Error('Unarchive this task before changing it.');
        const before = { plannedDate: t.plannedDate, goalId: t.goalId, title: t.title };
        if (op.title !== undefined) t.title = requireText(op.title, 'Task title');
        if (op.effort !== undefined) t.effort = op.effort;
        if (op.priority) t.priority = op.priority;
        if (op.notes !== undefined) t.notes = op.notes;
        if (op.plannedDate !== undefined) t.plannedDate = op.plannedDate || undefined;
        if (op.dueDate !== undefined) t.dueDate = op.dueDate || undefined;
        if (op.reminder !== undefined) t.reminder = op.reminder || undefined;
        if (op.recurrence) t.recurrence = op.recurrence;
        if (op.status !== undefined) throw new Error('Complete tasks manually so recurrence and execution history stay accurate.');
        setTaskLinks(t, op);
        if (t.goalId) record(goalFor(t.goalId), 'edit', `Task adjusted: ${t.title}`, op, JSON.stringify(before), JSON.stringify({ plannedDate: t.plannedDate, goalId: t.goalId, title: t.title }));
        changes.push(`Updated task: ${t.title}`);
        break;
      }
      case 'create_weekly_plan': {
        const start = validDate(op.weekStart, 'Week start', true);
        if (new Date(`${start}T00:00:00Z`).getUTCDay() !== 1) throw new Error('Weekly plans must start on Monday.');
        const end = new Date(`${start}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
        const endIso = end.toISOString().slice(0, 10);
        const old = state.weekPlans[start];
        if (old && ((op.focus !== undefined && op.focus !== old.focus) || (op.capacityMinutes !== undefined && op.capacityMinutes !== old.capacityMinutes))) {
          requireText(op.reason, 'Reason for adjusting the existing weekly plan');
        }
        const ids = [...new Set((op.taskIds ?? []).map((id) => taskFor(id).id))];
        for (const id of ids) {
          const t = taskFor(id);
          if (t.archived || t.status !== 'open') throw new Error('Only open, unarchived tasks can be scheduled.');
          if (!t.plannedDate || t.plannedDate < start || t.plannedDate > endIso) t.plannedDate = start;
        }
        // Keep original commitments immutable. Later scheduling is visible as additions/moved work.
        state.weekPlans[start] = {
          ...old, weekStart: start, focus: op.focus ?? old?.focus ?? '',
          capacityMinutes: op.capacityMinutes ?? old?.capacityMinutes ?? 600,
          finalized: true, finalizedAt: old?.finalizedAt ?? stamp,
          commitments: old && (old.finalizedAt || old.finalized || old.commitments.length) ? old.commitments : state.tasks
            .filter((t) => !t.archived && t.plannedDate && t.plannedDate >= start && t.plannedDate <= endIso)
            .map((t) => ({ taskId: t.id, title: t.title, goalId: t.goalId, plannedDate: t.plannedDate, effort: t.effort })),
        };
        changes.push(`Saved weekly plan: ${start}${old ? ' (original commitments preserved)' : ''}`);
        break;
      }
      case 'record_metric': {
        const g = goalFor(op.goalId);
        if (op.value === undefined) throw new Error('A measured value is required. Do not infer results from tasks.');
        let metric = g.metrics.find((m) => m.id === resolve(op.metricId));
        if (!metric && op.metricId) throw new Error('The referenced metric no longer exists.');
        if (!metric) {
          if (op.target === undefined) throw new Error('A new metric needs a target.');
          metric = { id: randomUUID(), name: requireText(op.name, 'Metric name'), unit: op.unit ?? '', kind: op.kind ?? 'outcome', baseline: op.baseline ?? 0, target: op.target, entries: [] };
          g.metrics.push(metric);
        }
        metric.entries.push({ id: randomUUID(), date: validDate(op.date, 'Measurement date', true), value: op.value, note: op.notes });
        record(g, 'metric', `Logged ${metric.name}: ${op.value} ${metric.unit}`, op);
        changes.push(`Logged result: ${metric.name}`);
        break;
      }
      case 'create_review': {
        const start = validDate(op.periodStart, 'Review start', true);
        const end = validDate(op.periodEnd, 'Review end', true);
        if (end < start) throw new Error('Review end must follow its start.');
        const type = op.reviewType ?? 'weekly';
        if (state.reviews.some((r) => r.type === type && r.periodStart === start && !r.isDemo)) throw new Error('You have already saved a review for this period.');
        const planned = state.tasks.filter((t) => !t.archived && t.plannedDate && t.plannedDate >= start && t.plannedDate <= end);
        const commitments = Object.values(state.weekPlans).filter((p) => {
          const weekEnd = new Date(`${p.weekStart}T00:00:00Z`); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
          return p.weekStart <= end && weekEnd.toISOString().slice(0, 10) >= start;
        }).flatMap((p) => p.commitments.filter((c) => !c.plannedDate || (c.plannedDate >= start && c.plannedDate <= end)));
        const unique = [...new Map(commitments.map((c) => [c.taskId, c])).values()];
        const committedIds = new Set(unique.map((c) => c.taskId));
        const committed = unique.length ? unique.length : planned.length;
        const doneInPeriod = state.tasks.filter((t) => !t.archived && t.completedAt && t.completedAt.slice(0, 10) >= start && t.completedAt.slice(0, 10) <= end);
        const committedDone = unique.length ? unique.filter((c) => doneInPeriod.some((t) => t.id === c.taskId)).length : planned.filter((t) => doneInPeriod.some((done) => done.id === t.id)).length;
        state.reviews.unshift({
          id: randomUUID(), type, periodStart: start, periodEnd: end, createdAt: stamp,
          answers: { wins: op.wins ?? '', misses: op.misses ?? '', learned: op.learned ?? '', change: op.change ?? '', focus: op.focus ?? '' },
          snapshot: {
            committed, committedDone,
            extraDone: doneInPeriod.filter((t) => !committedIds.has(t.id) && !planned.some((p) => p.id === t.id)).length,
            overdue: state.tasks.filter((t) => !t.archived && t.status === 'open' && (t.dueDate ?? t.plannedDate ?? end) < end).length,
            metrics: state.goals.flatMap((g) => g.metrics.map((m) => {
              return { goalId: g.id, goalTitle: g.title, metricId: m.id, name: m.name, unit: m.unit, kind: m.kind, value: measurementValueAt(m, end), target: m.target };
            })),
          }, adjustments: [], isDemo: false,
        });
        changes.push(`Saved ${type} review: ${start}`);
        break;
      }
    }
  }
  // Commit only after the entire sequence validates; IDs also make retries idempotent across reloads.
  state.aiApplied = [...(state.aiApplied ?? []), requestId];
  state.aiHistory = [...(state.aiHistory ?? []), ...changes.map((summary) => ({ at: stamp, summary }))];
  return { state, changes, alreadyApplied: false };
}
