export type Area = 'business' | 'fitness' | 'english' | 'personal';
export type GoalStatus = 'active' | 'paused' | 'completed' | 'cancelled';
export type Priority = 'high' | 'medium' | 'low';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type MetricKind = 'outcome' | 'leading';
export type { WorkSession } from '@workspace/api-zod';
export type { ActiveWorkTimer } from '@workspace/api-zod';

export interface Strategy {
  summary: string;
  rationale: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  title: string;
  dueDate: string;
  done: boolean;
  completedAt?: string;
}

export interface MetricEntry {
  id: string;
  date: string;
  value: number;
  note?: string;
  /** An explicitly measured change. Entries without mode remain absolute observations. */
  mode?: 'contribution';
  source?: {
    taskId?: string;
    taskTitle?: string;
    milestoneId?: string;
    milestoneTitle?: string;
    sessionId?: string;
    sessionTitle?: string;
  };
}

export interface Metric {
  id: string;
  name: string;
  unit: string;
  kind: MetricKind;
  baseline: number;
  target: number;
  /** Missing frequency means the original cumulative measurement. */
  frequency?: 'cumulative' | 'weekly' | 'monthly';
  startDate?: string;
  targetHistory?: { start: string; target: number }[];
  entries: MetricEntry[];
}

export type HistoryKind =
  | 'created'
  | 'edit'
  | 'strategy'
  | 'target'
  | 'deadline'
  | 'status'
  | 'milestone'
  | 'metric'
  | 'split'
  | 'review';

export interface HistoryEvent {
  id: string;
  at: string;
  kind: HistoryKind;
  summary: string;
  reason?: string;
  from?: string;
  to?: string;
  source?: 'manual' | 'review' | 'ai';
}

export interface Goal {
  id: string;
  title: string;
  outcome: string;
  area: Area;
  priority: Priority;
  targetDate: string;
  status: GoalStatus;
  strategy: Strategy;
  milestones: Milestone[];
  metrics: Metric[];
  history: HistoryEvent[];
  createdAt: string;
  isDemo: boolean;
}

export interface Task {
  id: string;
  title: string;
  goalId?: string;
  milestoneId?: string;
  parentTaskId?: string;
  plannedDate?: string;
  dueDate?: string;
  priority: Priority;
  effort: number; // minutes
  notes: string;
  recurrence: Recurrence;
  reminder?: string; // yyyy-MM-ddTHH:mm
  reminderDismissed?: boolean;
  status: 'open' | 'done';
  completedAt?: string;
  archived: boolean;
  createdAt: string;
  spawnedNextId?: string;
  isDemo: boolean;
}

export interface Commitment {
  taskId: string;
  title: string;
  goalId?: string;
  plannedDate?: string;
  effort: number;
}

export interface WeekPlan {
  weekStart: string;
  focus: string;
  capacityMinutes: number;
  finalized: boolean;
  finalizedAt?: string;
  commitments: Commitment[]; // original snapshot, never overwritten once taken
}

export interface SnapshotMetric {
  goalId: string;
  goalTitle: string;
  metricId: string;
  name: string;
  unit: string;
  kind: MetricKind;
  value: number;
  target: number;
  frequency?: Metric['frequency'];
  periodStart?: string;
  periodEnd?: string;
}

export interface ReviewSnapshot {
  committed: number;
  committedDone: number;
  extraDone: number;
  overdue: number;
  metrics: SnapshotMetric[];
}

export interface ReviewAnswers {
  wins: string;
  misses: string;
  learned: string;
  change: string;
  focus: string;
}

export interface Adjustment {
  kind: 'strategy' | 'milestone' | 'pause';
  goalId: string;
  summary: string;
}

export interface Review {
  id: string;
  type: 'weekly' | 'monthly';
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  answers: ReviewAnswers;
  snapshot: ReviewSnapshot;
  adjustments: Adjustment[];
  isDemo: boolean;
}

export interface Settings {
  name: string;
  theme: 'light' | 'dark';
  sidebarCollapsed: boolean;
  onboardedFresh: boolean;
}

export interface AppState {
  version: 1;
  settings: Settings;
  goals: Goal[];
  tasks: Task[];
  sessions?: import('@workspace/api-zod').WorkSession[];
  activeTimer?: import('@workspace/api-zod').ActiveWorkTimer;
  weekPlans: Record<string, WeekPlan>;
  periodNotes: Record<string, string>;
  reviews: Review[];
  aiApplied?: string[];
  aiHistory?: { at: string; summary: string }[];
}

export const AREAS: { value: Area; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'fitness', label: 'Strength' },
  { value: 'english', label: 'English' },
  { value: 'personal', label: 'Personal' },
];

export const areaLabel = (a: Area) => AREAS.find((x) => x.value === a)?.label ?? a;
