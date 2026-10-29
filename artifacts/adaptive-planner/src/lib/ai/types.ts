import type { AppState } from '@/lib/store/types';

export type OperationType =
  | 'create_goal'
  | 'update_goal'
  | 'create_strategy'
  | 'update_strategy'
  | 'create_milestone'
  | 'update_milestone'
  | 'create_task'
  | 'update_task'
  | 'link_task_to_goal'
  | 'create_weekly_plan'
  | 'reschedule_task'
  | 'record_metric'
  | 'create_review';

export interface Operation {
  key: string;
  type: OperationType;
  title?: string;
  goalId?: string;
  taskId?: string;
  milestoneId?: string;
  parentTaskId?: string;
  outcome?: string;
  area?: string;
  priority?: string;
  targetDate?: string;
  summary?: string;
  rationale?: string;
  reason?: string;
  dueDate?: string;
  plannedDate?: string;
  effort?: number;
  notes?: string;
  recurrence?: string;
  reminder?: string;
  status?: string;
  done?: boolean;
  weekStart?: string;
  focus?: string;
  capacityMinutes?: number;
  taskIds?: string[];
  metricId?: string;
  name?: string;
  unit?: string;
  kind?: 'outcome' | 'leading';
  baseline?: number;
  target?: number;
  value?: number;
  date?: string;
  reviewType?: 'weekly' | 'monthly';
  periodStart?: string;
  periodEnd?: string;
  wins?: string;
  misses?: string;
  learned?: string;
  change?: string;
}

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'superseded';

export interface Proposal {
  id: string;
  operations: Operation[];
  selected: string[];
  status: ProposalStatus;
  requestId?: string;
  changes?: string[];
  staleNotice?: boolean;
  appliedAt?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
  error?: string;
  proposal?: Proposal;
  streaming?: boolean;
}

export type Screen = 'overview' | 'goals' | 'goal' | 'planner' | 'tasks' | 'reviews' | 'settings' | 'task';

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  screen: Screen;
  messages: ChatMessage[];
}

export interface ApplyResponse {
  state: AppState;
  changes: string[];
  alreadyApplied: boolean;
}

export const OP_LABEL: Record<OperationType, string> = {
  create_goal: 'New goal',
  update_goal: 'Change goal',
  create_strategy: 'Strategy',
  update_strategy: 'Revise strategy',
  create_milestone: 'New milestone',
  update_milestone: 'Change milestone',
  create_task: 'New task',
  update_task: 'Change task',
  link_task_to_goal: 'Link task',
  create_weekly_plan: 'Weekly plan',
  reschedule_task: 'Reschedule',
  record_metric: 'Record result',
  create_review: 'Review',
};

/** Operations that alter existing records and therefore must carry a reason. */
export function needsReason(op: Operation, state: AppState): boolean {
  if (op.type === 'update_goal' || op.type === 'update_strategy' || op.type === 'update_milestone') return true;
  if (op.type === 'create_weekly_plan' && op.weekStart) {
    const cur = state.weekPlans[op.weekStart];
    return !!cur?.focus && op.focus !== undefined && op.focus !== cur.focus;
  }
  return false;
}

export const isOptional = (op: Operation) => /^\s*optional:/i.test(op.notes ?? '');
