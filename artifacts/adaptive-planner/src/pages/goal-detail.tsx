import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import {
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitFork,
  LineChart,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  X,
  CheckCheck,
  Ban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Field, FormDialog } from '@/components/form-dialog';
import { EditGoalDialog, LogMetricDialog } from '@/components/goal-dialogs';
import { EditMeasureDialog } from '@/components/edit-measure-dialog';
import { AreaTag, EmptyState, HealthPill, PaceBar, SampleMark, Section, StatusPill } from '@/components/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QuickAdd } from '@/components/quick-add';
import { TaskRow } from '@/components/task-row';
import { addDaysIso, daysBetween, fmt, relDay, todayIso } from '@/lib/dates';
import {
  addMetric,
  addMilestone,
  changeMetricTarget,
  changeStrategy,
  changeTargetDate,
  deleteGoal,
  deleteMetric,
  deleteMilestone,
  rescheduleMilestone,
  setGoalStatus,
  splitGoal,
  toggleMilestone,
} from '@/lib/store/actions';
import { formatValue, goalExecution, goalHealth, measurementBaseline, measurementPeriod, measurementPeriods, measurementTargetAt, metricProgress, metricTimeline, metricValueAt } from '@/lib/store/selectors';
import { FrequencySelect, MeasurementStartField, PeriodTag, formatPeriod, frequencyNoun, isRecurring, periodLabel, type Frequency } from '@/components/measurement-period';
import { isMeasurementDate, measurementActivePeriod } from '@workspace/api-zod';
import { ContributionChips, MetricAttribution, MetricEntryRow, RecordResultDialog, type RecordResultTarget } from '@/components/contributions';
import { useAppState } from '@/lib/store/store';
import type { Goal, GoalStatus, Metric, MetricKind } from '@/lib/store/types';
import { cn } from '@/lib/utils';
import { AskButton } from '@/components/ai/ask-button';

type DialogKind =
  | null
  | 'edit'
  | 'strategy'
  | 'target'
  | 'milestone'
  | 'metric'
  | 'split'
  | 'delete'
  | { status: GoalStatus }
  | { reschedule: string }
  | { deleteMs: string }
  | { log: string | undefined; date?: string }
  | { metricTarget: string }
  | { editMetric: string }
  | { deleteMetric: string }
  | { record: RecordResultTarget };

export default function GoalDetailPage() {
  const params = useParams<{ id: string }>();
  const state = useAppState();
  const goal = state.goals.find((g) => g.id === params.id);
  if (!goal) {
    return (
      <div className="surface mt-10">
        <EmptyState
          mark="circle"
          title="This goal no longer exists"
          body="It may have been deleted or split. Your other goals are safe."
          action={<Button asChild><Link href="/goals">Back to goals</Link></Button>}
        />
      </div>
    );
  }
  return <GoalWorkspace goal={goal} />;
}

function GoalWorkspace({ goal }: { goal: Goal }) {
  const state = useAppState();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [showDone, setShowDone] = useState(false);
  const today = todayIso();
  const close = () => setDialog(null);
  const h = goalHealth(goal, today);
  const ex = goalExecution(goal.id, state.tasks, 30);

  const tasks = useMemo(() => state.tasks.filter((t) => t.goalId === goal.id && !t.archived), [state.tasks, goal.id]);
  const open = tasks
    .filter((t) => t.status === 'open')
    .sort((a, b) => ((a.plannedDate ?? '9999') < (b.plannedDate ?? '9999') ? -1 : 1));
  const done = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => ((a.completedAt ?? '') > (b.completedAt ?? '') ? -1 : 1));
  const daysLeft = daysBetween(today, goal.targetDate);
  const outcomeMetrics = goal.metrics.filter((m) => m.kind === 'outcome');
  const leadingMetrics = goal.metrics.filter((m) => m.kind === 'leading');

  const nextMs = goal.milestones.filter((m) => !m.done).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
  const [strategyOpen, setStrategyOpen] = useState(false);

  return (
    <div>
      <Link href="/goals" className="mb-3 inline-flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-goals">
        <ArrowLeft className="size-4" /> Goals
      </Link>

      <header className="rise mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <AreaTag area={goal.area} />
            <StatusPill status={goal.status} />
            <span className="text-xs capitalize text-muted-foreground">{goal.priority} priority</span>
            {goal.isDemo && <SampleMark />}
          </div>
          <h1 className="font-display text-[1.8rem] font-normal leading-tight md:text-[2.2rem]" data-testid="text-goal-title">{goal.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground md:text-[0.95rem]" data-testid="text-goal-outcome">
            {goal.outcome || <span className="italic">No desired outcome written yet.</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <AskButton focus={{ screen: 'goal', goalId: goal.id }} label="Ask about this goal" />
          {goal.metrics.length > 0 ? (
            <Button onClick={() => setDialog({ record: {} })} data-testid="button-record-contribution-top"><TrendingUp /> Record contribution</Button>
          ) : (
            <Button onClick={() => setDialog('metric')} data-testid="button-add-metric-top"><Plus /> Add result measure</Button>
          )}
          <Button variant="outline" onClick={() => setDialog('edit')} aria-label="Edit goal" data-testid="button-edit-goal"><Pencil /> <span className="hidden sm:inline">Edit</span></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-goal-status">Status <ChevronDown /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {goal.status !== 'active' && <DropdownMenuItem onSelect={() => setDialog({ status: 'active' })}><Play /> Resume</DropdownMenuItem>}
              {goal.status === 'active' && <DropdownMenuItem onSelect={() => setDialog({ status: 'paused' })}><Pause /> Pause</DropdownMenuItem>}
              {goal.status !== 'completed' && <DropdownMenuItem onSelect={() => setDialog({ status: 'completed' })}><CheckCheck /> Mark complete</DropdownMenuItem>}
              {goal.status !== 'cancelled' && <DropdownMenuItem onSelect={() => setDialog({ status: 'cancelled' })}><Ban /> Cancel goal</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More goal actions" data-testid="button-goal-more"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog('strategy')}><Pencil /> Revise strategy</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog('target')}><CalendarClock /> Change target date</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog('split')}><GitFork /> Split goal</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDialog('delete')}><Trash2 /> Delete goal...</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Fact strip */}
      <div className="rise mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border bg-border md:grid-cols-4">
        <Fact label="Target date" value={fmt(goal.targetDate, 'MMM d, yyyy')} sub={daysLeft >= 0 ? `${daysLeft} days left` : `${-daysLeft} days past`} onClick={() => setDialog('target')} testId="fact-target" />
        <Fact label="Result" value={h.metric ? formatValue(metricValueAt(h.metric), h.metric.unit) : 'Not measured'} sub={h.metric ? `of ${formatValue(h.metric.target, h.metric.unit)}${isRecurring(h.metric) ? ` ${frequencyNoun(h.metric.frequency)}, ${periodLabel(h.metric, undefined, false)?.toLowerCase()}` : ''} · ${h.metric.name}` : 'Add a result measure'} />
        <Fact label="Tasks done, 30 days" value={`${ex.done}`} sub={`${ex.open} still open`} />
        <div className="bg-card p-3 sm:p-4">
          <div className="mb-1 text-xs text-muted-foreground" title="Compares your logged result with an even pace to the target date. A reference, not a forecast.">Pace</div>
          {goal.status === 'active' ? <HealthPill health={h.status} /> : <StatusPill status={goal.status} />}
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {nextMs ? <>Next: {nextMs.title} &middot; {relDay(nextMs.dueDate).toLowerCase()}</> : 'No upcoming milestone'}
          </p>
        </div>
      </div>

      {/* Compact strategy */}
      <div className="surface rise mb-5 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-xs text-muted-foreground">Strategy</div>
            {goal.strategy.summary ? (
              <p className={cn('text-[0.95rem] leading-relaxed', !strategyOpen && 'line-clamp-2')} data-testid="text-strategy">{goal.strategy.summary}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No strategy yet. How will you get there?</p>
            )}
            {strategyOpen && (
              <div className="mt-3 space-y-2 border-l-2 border-primary/40 pl-3" id="strategy-more">
                {goal.strategy.rationale && (
                  <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Why: </span>{goal.strategy.rationale}</p>
                )}
                <p className="text-xs text-muted-foreground">Last revised {relDay(goal.strategy.updatedAt.slice(0, 10)).toLowerCase()}. Earlier versions are in History.</p>
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
            {goal.strategy.summary && (
              <Button size="sm" variant="ghost" className="h-9" onClick={() => setStrategyOpen((v) => !v)} aria-expanded={strategyOpen} aria-controls="strategy-more" data-testid="button-toggle-strategy">
                {strategyOpen ? 'Less' : 'More'}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-9" onClick={() => setDialog('strategy')} data-testid="button-edit-strategy">
              <Pencil /> {goal.strategy.summary ? 'Revise' : 'Write'}
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="actions" className="rise">
        <TabsList className="mb-4 flex h-auto w-full max-w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1 sm:w-auto">
          {[
            { v: 'actions', l: 'Actions', n: open.length },
            { v: 'milestones', l: 'Milestones', n: goal.milestones.filter((m) => !m.done).length },
            { v: 'results', l: 'Results', n: goal.metrics.length },
            { v: 'history', l: 'History', n: goal.history.length },
          ].map((t) => (
            <TabsTrigger key={t.v} value={t.v} className="min-h-9 gap-1 rounded-lg px-2 text-xs data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-none sm:gap-1.5 sm:px-3 sm:text-sm" data-testid={`tab-goal-${t.v}`}>
              {t.l} <span className="font-num text-xs opacity-70">{t.n}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="actions" className="mt-0">
          <div className="surface p-3 sm:p-5">
            <QuickAdd defaults={{ goalId: goal.id }} placeholder="Add a next step" testId="input-goal-quick-add" />
            <div className="mt-2 divide-y divide-border/60">
              {open.length === 0 ? (
                <EmptyState className="py-6" title="No open actions" body="What is the next physical step? Add it above." />
              ) : (
                open.map((t) => <TaskRow key={t.id} task={t} siblings={open} showGoal={false} />)
              )}
            </div>
            {done.length > 0 && (
              <div className="mt-3 border-t border-border pt-2">
                <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} data-testid="button-toggle-done">
                  <ChevronDown className={cn('size-4 transition-transform', !showDone && '-rotate-90')} /> Completed &middot; {done.length}
                </button>
                {showDone && <div className="mt-1 divide-y divide-border/60">{done.map((t) => <TaskRow key={t.id} task={t} siblings={done} showGoal={false} />)}</div>}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="milestones" className="mt-0">
          <Section title="Milestones" aside={<Button size="sm" variant="outline" onClick={() => setDialog('milestone')} data-testid="button-add-milestone"><Plus /> Add</Button>}>
            {goal.milestones.length === 0 ? (
              <EmptyState title="No milestones" body="Break the outcome into checkpoints with dates." />
            ) : (
              <ol className="space-y-0.5">
                {goal.milestones.map((m) => {
                  const late = !m.done && m.dueDate < today;
                  const linked = state.tasks.filter((t) => t.milestoneId === m.id && !t.archived);
                  return (
                    <li key={m.id} className="flex items-center gap-2 rounded-lg py-1 hover:bg-muted/40" data-testid={`milestone-${m.id}`}>
                      <div className="grid size-10 shrink-0 place-items-center sm:size-8">
                        <CheckButton checked={m.done} onToggle={() => toggleMilestone(goal.id, m.id)} label={`Mark ${m.title} reached`} size="sm" testId={`check-milestone-${m.id}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={cn('text-[0.93rem]', m.done && 'text-muted-foreground line-through decoration-foreground/30')}>{m.title}</div>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span className={cn('font-num', late && 'text-destructive')}>{m.done && m.completedAt ? `reached ${fmt(m.completedAt.slice(0, 10))}` : `${late ? 'was due' : 'due'} ${fmt(m.dueDate, 'MMM d')}`}</span>
                          {linked.length > 0 && <span>{linked.filter((t) => t.status === 'done').length} of {linked.length} tasks done</span>}
                          <ContributionChips goal={goal} filter={{ milestoneId: m.id }} testId={`text-milestone-contribution-${m.id}`} />
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="size-10 text-muted-foreground sm:size-8" aria-label={`Record result for ${m.title}`} title="Record result" onClick={() => setDialog(goal.metrics.length ? { record: { milestoneId: m.id } } : 'metric')} data-testid={`button-record-milestone-${m.id}`}>
                        <TrendingUp />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-10 text-muted-foreground sm:size-8" aria-label={`Reschedule ${m.title}`} onClick={() => setDialog({ reschedule: m.id })} data-testid={`button-reschedule-milestone-${m.id}`}>
                        <CalendarClock />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-10 text-muted-foreground sm:size-8" aria-label={`Remove ${m.title}`} onClick={() => setDialog({ deleteMs: m.id })} data-testid={`button-delete-milestone-${m.id}`}>
                        <X />
                      </Button>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="results" className="mt-0">
          <Section
            title="Results"
            aside={
              <Button size="sm" variant="ghost" onClick={() => setDialog('metric')} data-testid="button-add-metric"><Plus /> Measure</Button>
            }
          >
            <p className="-mt-2 mb-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">Completing tasks never changes results. <span className="text-foreground">Record contribution</span> credits a measured change (+/&minus;) to a task or milestone &mdash; your own historical attribution, not proof of cause. <span className="text-foreground">Log current value</span> is an absolute checkpoint that reconciles the total; it is never counted as extra contribution.</p>
            {goal.metrics.length === 0 ? (
              <EmptyState title="Nothing measured yet" body="Add a result measure: the number that proves this goal is working." action={<Button size="sm" onClick={() => setDialog('metric')}>Add measure</Button>} />
            ) : (
              <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
                {[{ label: 'Outcomes', hint: 'The result itself', list: outcomeMetrics }, { label: 'Activity', hint: 'Effort you control', list: leadingMetrics }].map(
                  (grp) =>
                    grp.list.length > 0 && (
                      <div key={grp.label} className="min-w-0">
                        <div className="mb-3 text-sm font-medium">{grp.label} <span className="font-normal text-muted-foreground">&middot; {grp.hint}</span></div>
                        <div className="space-y-5">
                          {grp.list.map((m) => (
                            <MetricBlock key={m.id} goal={goal} metric={m} onEdit={() => setDialog({ editMetric: m.id })} onRecord={(entryId, date) => setDialog({ record: { metricId: m.id, entryId, date } })} onLog={(date) => setDialog({ log: m.id, date })} onTarget={() => setDialog({ metricTarget: m.id })} onDelete={() => setDialog({ deleteMetric: m.id })} />
                          ))}
                        </div>
                      </div>
                    ),
                )}
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <Section title="History">
            <ol className="space-y-4" data-testid="list-history">
              {goal.history.map((e) => (
                <li key={e.id} className="relative pl-4 before:absolute before:left-0 before:top-2 before:size-1.5 before:rounded-full before:bg-foreground/25">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium">{e.summary}</span>
                    {e.source === 'review' && <span className="rounded bg-accent px-1.5 text-[0.7rem] text-accent-foreground">from review</span>}
                    <span className="font-num text-xs text-muted-foreground">{fmt(e.at.slice(0, 10), 'MMM d, yyyy')}</span>
                  </div>
                  {(e.from || e.to) && e.kind !== 'milestone' && e.kind !== 'status' ? (
                    <div className="mt-1 space-y-0.5 text-xs [overflow-wrap:anywhere]">
                      {e.from && <p className="text-muted-foreground line-through decoration-foreground/20">{e.from}</p>}
                      {e.to && <p>{e.to}</p>}
                    </div>
                  ) : e.from && e.to ? (
                    <p className="mt-1 font-num text-xs text-muted-foreground">{e.from} &rarr; {e.to}</p>
                  ) : null}
                  {e.reason && <p className="mt-1 text-xs italic text-muted-foreground">&ldquo;{e.reason}&rdquo;</p>}
                </li>
              ))}
            </ol>
          </Section>
        </TabsContent>
      </Tabs>

      {/* ---------- Dialogs ---------- */}
      {typeof dialog === 'object' && dialog && 'editMetric' in dialog && (() => {
        const metric = goal.metrics.find((m) => m.id === dialog.editMetric);
        return metric ? <EditMeasureDialog key={metric.id} goalId={goal.id} metric={metric} onClose={close} /> : null;
      })()}
      <EditGoalDialog goal={goal} open={dialog === 'edit'} onOpenChange={(o) => !o && close()} />
      <StrategyDialog goal={goal} open={dialog === 'strategy'} onClose={close} />
      <ReasonDateDialog
        open={dialog === 'target'}
        onClose={close}
        title="Move target date"
        description="Recorded in history so you can see how the plan evolved."
        initialDate={goal.targetDate}
        onSave={(date, reason) => { changeTargetDate(goal.id, date, reason); toast({ title: 'Target date updated' }); }}
      />
      {typeof dialog === 'object' && dialog && 'reschedule' in dialog && (
        <ReasonDateDialog
          open
          onClose={close}
          title="Reschedule milestone"
          description={goal.milestones.find((m) => m.id === dialog.reschedule)?.title}
          initialDate={goal.milestones.find((m) => m.id === dialog.reschedule)?.dueDate ?? today}
          onSave={(date, reason) => { rescheduleMilestone(goal.id, dialog.reschedule, date, reason); toast({ title: 'Milestone rescheduled' }); }}
        />
      )}
      {typeof dialog === 'object' && dialog && 'status' in dialog && (
        <StatusDialog goal={goal} status={dialog.status} onClose={close} />
      )}
      <MilestoneDialog goal={goal} open={dialog === 'milestone'} onClose={close} />
      <MetricDialog goal={goal} open={dialog === 'metric'} onClose={close} />
      {typeof dialog === 'object' && dialog && 'log' in dialog && (
        <LogMetricDialog goal={goal} metricId={dialog.log} initialDate={dialog.date} open onOpenChange={(o) => !o && close()} />
      )}
      {typeof dialog === 'object' && dialog && 'metricTarget' in dialog && (
        <MetricTargetDialog goal={goal} metricId={dialog.metricTarget} onClose={close} />
      )}
      <RecordResultDialog goal={goal} open={typeof dialog === 'object' && !!dialog && 'record' in dialog} target={typeof dialog === 'object' && dialog && 'record' in dialog ? dialog.record : undefined} onOpenChange={(o) => !o && close()} />
      <SplitDialog goal={goal} open={dialog === 'split'} onClose={close} onDone={(id) => navigate(`/goals/${id}`)} />
      <ConfirmDialog
        open={typeof dialog === 'object' && !!dialog && 'deleteMs' in dialog}
        onOpenChange={(o) => !o && close()}
        title="Remove milestone?"
        description="Linked actions stay but lose their milestone link. The removal is recorded in history."
        confirmLabel="Remove milestone"
        destructive
        onConfirm={() => { if (typeof dialog === 'object' && dialog && 'deleteMs' in dialog) deleteMilestone(goal.id, dialog.deleteMs); close(); }}
      />
      <ConfirmDialog
        open={typeof dialog === 'object' && !!dialog && 'deleteMetric' in dialog}
        onOpenChange={(o) => !o && close()}
        title="Stop measuring this metric?"
        description="The metric and all its logged values will be removed from this goal. Past review snapshots keep their numbers."
        confirmLabel="Remove metric"
        destructive
        onConfirm={() => { if (typeof dialog === 'object' && dialog && 'deleteMetric' in dialog) deleteMetric(goal.id, dialog.deleteMetric); close(); }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && close()}
        title={`Delete "${goal.title}"?`}
        description="The goal, its milestones, metrics and history are deleted permanently. Its tasks stay in your list without a goal. Consider pausing or cancelling instead to keep the history."
        confirmLabel="Delete goal permanently"
        destructive
        onConfirm={() => { deleteGoal(goal.id); toast({ title: 'Goal deleted' }); navigate('/goals'); }}
      />
    </div>
  );
}

function Fact({ label, value, sub, onClick, testId }: { label: string; value: string; sub: string; onClick?: () => void; testId?: string }) {
  const body = (
    <>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className="font-num text-base">{value}</div>
      <div className="truncate text-xs text-muted-foreground">{sub}</div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="bg-card p-3 text-left transition-colors sm:p-4 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" data-testid={testId}>
      {body}
    </button>
  ) : (
    <div className="bg-card p-3 sm:p-4">{body}</div>
  );
}

function MetricBlock({ goal, metric, onEdit, onRecord, onLog, onTarget, onDelete }: { goal: Goal; metric: Metric; onEdit: () => void; onRecord: (entryId?: string, date?: string) => void; onLog: (date?: string) => void; onTarget: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [viewAt, setViewAt] = useState<string | null>(null);
  const today = todayIso();
  const recurring = isRecurring(metric);
  const current = recurring ? measurementPeriod(metric) : null;
  const viewing = recurring ? measurementPeriod(metric, viewAt ?? today) : null;
  const isHistorical = !!viewing && !!current && viewing.start !== current.start;
  /** Historical period: its end. Current period: today, never a future end. */
  const at = isHistorical && viewing ? viewing.end : recurring ? today : undefined;
  const periods = recurring ? measurementPeriods(metric) : [];
  const go = (dir: -1 | 1) => {
    if (!viewing) return;
    const next = measurementPeriod(metric, addDaysIso(dir < 0 ? viewing.start : viewing.end, dir));
    if (!next || !current || next.start >= current.start) setViewAt(null);
    else setViewAt(next.end);
  };
  const base = measurementBaseline(metric);
  const target = measurementTargetAt(metric, at);
  const activePeriod = measurementActivePeriod(metric, at);
  const scheduled = activePeriod?.notStarted;
  const timeline = metricTimeline(metric, at);
  const entries = [...timeline].reverse();
  const values = timeline.map((p) => p.value);
  const lo = Math.min(base, ...values, target);
  const hi = Math.max(base, ...values, target);
  const pts = timeline.map((p, i) => {
    const x = timeline.length === 1 ? 50 : (i / (timeline.length - 1)) * 100;
    const y = hi === lo ? 50 : 100 - ((p.value - lo) / (hi - lo)) * 100;
    return `${x},${y}`;
  });
  const targetY = hi === lo ? 0 : 100 - ((target - lo) / (hi - lo)) * 100;
  const value = metricValueAt(metric, at);
  const progress = metricProgress(metric, at);
  const remaining = Math.max(0, target - value);
  const pct = Math.round(progress * 1000) / 10;
  return (
    <div className="min-w-0 w-full max-w-full" data-testid={`metric-${metric.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 break-words">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            {metric.name}
            {recurring && <span className="text-xs font-normal text-muted-foreground">target {frequencyNoun(metric.frequency)}</span>}
          </div>
          <div className="font-num text-[1.35rem] leading-tight" data-testid={`text-metric-value-${metric.id}`}>
            {formatValue(value, metric.unit)}
            <span className="text-sm text-muted-foreground">{scheduled ? ` · ${formatValue(metric.target, metric.unit)} ${frequencyNoun(metric.frequency)} from ${fmt(metric.startDate!, 'MMM d')}` : ` / ${formatValue(target, metric.unit)}`}</span>
          </div>
          {activePeriod?.partial && !scheduled && <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-partial-target-${metric.id}`}>Adjusted first target · usual commitment: {formatValue(metric.target, metric.unit)} {frequencyNoun(metric.frequency)}.</p>}
        </div>
        {timeline.length > 1 && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-10 w-16 shrink-0 overflow-visible sm:w-24" aria-hidden>
            <line x1="0" x2="100" y1={targetY} y2={targetY} stroke="currentColor" strokeDasharray="2 3" className="text-foreground/25" vectorEffect="non-scaling-stroke" />
            <polyline points={pts.join(' ')} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {recurring && viewing && (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 rounded-lg border border-border/80 p-2" data-testid={`period-nav-${metric.id}`}>
          <div className="flex min-w-0 items-center gap-1">
            <Button size="icon" variant="ghost" className="size-9 shrink-0 sm:size-8" onClick={() => go(-1)} aria-label="Previous period" data-testid={`button-period-prev-${metric.id}`}><ChevronLeft /></Button>
            <div className="min-w-0 flex-1 text-center">
              <div className="truncate text-xs font-medium" data-testid={`text-period-label-${metric.id}`}>{periodLabel(metric, at)}</div>
              <div className="font-num text-[0.7rem] text-muted-foreground" data-testid={`text-period-summary-${metric.id}`}>
                {scheduled ? 'Not started · no target due yet' : <>{remaining > 0 ? `${formatValue(remaining, metric.unit)} to go` : 'Target met'} &middot; {pct}%</>}
              </div>
            </div>
            <Button size="icon" variant="ghost" className="size-9 shrink-0 sm:size-8" onClick={() => go(1)} disabled={!isHistorical} aria-label="Next period" data-testid={`button-period-next-${metric.id}`}><ChevronRight /></Button>
          </div>
          {periods.length > 1 && (
            <Select value={periods.some((p) => p.start === viewing.start) ? viewing.start : ''} onValueChange={(v) => { const p = periods.find((x) => x.start === v); setViewAt(!p || p.start === current?.start ? null : p.end); }}>
              <SelectTrigger className="h-9 min-w-0 text-xs" data-testid={`select-period-${metric.id}`}><SelectValue placeholder="Jump to a recorded period" /></SelectTrigger>
              <SelectContent>
                {periods.map((p) => {
                  const end = p.start === current?.start ? today : p.end;
                  return (
                    <SelectItem key={p.start} value={p.start}>
                      {formatPeriod(p, metric.frequency)}{p.start === current?.start ? ' (now)' : ''} &middot; {formatValue(metricValueAt(metric, end), metric.unit)} / {formatValue(measurementTargetAt(metric, end), metric.unit)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
          {isHistorical && (
            <p className="text-[0.7rem] leading-snug text-muted-foreground">
              Viewing a past {metric.frequency === 'weekly' ? 'week' : 'month'}. New entries from here are dated {fmt(viewing.end, 'MMM d')} so they land in this period. <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setViewAt(null)} data-testid={`button-period-current-${metric.id}`}>Back to now</button>
            </p>
          )}
        </div>
      )}

      <PaceBar progress={progress} area={goal.area} className="mt-2" />
      <MetricAttribution goal={goal} metric={metric} at={at} />
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        <Button size="sm" variant="ghost" className="h-9 px-2 sm:h-8" onClick={() => onRecord(undefined, isHistorical ? at : undefined)} data-testid={`button-record-${metric.id}`}><TrendingUp /> Contribution</Button>
        <Button size="sm" variant="ghost" className="h-9 px-2 sm:h-8" onClick={() => onLog(isHistorical ? at : undefined)} data-testid={`button-log-${metric.id}`}><LineChart /> {recurring ? 'Log period total' : 'Log current value'}</Button>
        <Button size="sm" variant="ghost" className="h-9 px-2 sm:h-8" onClick={onTarget} data-testid={`button-target-${metric.id}`}><Target /> Target</Button>
        <Button size="sm" variant="ghost" className="h-9 px-2 sm:h-8" onClick={onEdit} aria-label={`Edit measure ${metric.name}`} data-testid={`button-edit-metric-${metric.id}`}><Pencil /> Edit</Button>
        <Button size="sm" variant="ghost" className="h-9 px-2 sm:h-8" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} data-testid={`button-entries-${metric.id}`}>
          {timeline.length} {recurring ? 'in period' : 'entries'} <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto h-9 px-2 text-muted-foreground sm:h-8" onClick={onDelete} aria-label={`Remove ${metric.name}`} data-testid={`button-delete-metric-${metric.id}`}><Trash2 /></Button>
      </div>
      {expanded && (
        <ul className="mt-2 grid min-w-0 grid-cols-1 gap-0.5 rounded-lg bg-muted/50 p-2 [&>li]:min-w-0" data-testid={`list-entries-${metric.id}`}>
          {entries.length === 0 && <li className="px-1 text-xs text-muted-foreground">{recurring ? `Nothing logged in this period. It counts as ${formatValue(0, metric.unit)}.` : `Nothing logged yet. Baseline ${formatValue(metric.baseline, metric.unit)}.`}</li>}
          {entries.map(({ entry }) => (
            <MetricEntryRow key={entry.id} goal={goal} metric={metric} entry={entry} onEdit={() => onRecord(entry.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StrategyDialog({ goal, open, onClose }: { goal: Goal; open: boolean; onClose: () => void }) {
  const [summary, setSummary] = useState(goal.strategy.summary);
  const [rationale, setRationale] = useState(goal.strategy.rationale);
  const [reason, setReason] = useState('');
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setSummary(goal.strategy.summary);
      setRationale(goal.strategy.rationale);
      setReason('');
    }
  }
  const isFirst = !goal.strategy.summary;
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={isFirst ? 'Write strategy' : 'Revise strategy'}
      description="The old version stays in history with your reason."
      wide
      canSubmit={!!summary.trim() && (isFirst || !!reason.trim())}
      onSubmit={() => { changeStrategy(goal.id, summary.trim(), rationale.trim(), reason.trim() || 'Initial strategy'); onClose(); }}
    >
      <Field label="Approach" htmlFor="strat-summary"><Textarea id="strat-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} data-testid="input-strategy-summary" /></Field>
      <Field label="Rationale — why this should work" htmlFor="strat-rationale"><Textarea id="strat-rationale" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} data-testid="input-strategy-rationale" /></Field>
      {!isFirst && <Field label="Reason for change (required)" htmlFor="strat-reason"><Input id="strat-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did the results tell you?" data-testid="input-strategy-reason" /></Field>}
    </FormDialog>
  );
}

function ReasonDateDialog({ open, onClose, title, description, initialDate, onSave }: { open: boolean; onClose: () => void; title: string; description?: string; initialDate: string; onSave: (date: string, reason: string) => void }) {
  const [date, setDate] = useState(initialDate);
  const [reason, setReason] = useState('');
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) { setDate(initialDate); setReason(''); }
  }
  return (
    <FormDialog open={open} onOpenChange={(o) => !o && onClose()} title={title} description={description} canSubmit={!!date && !!reason.trim() && date !== initialDate} onSubmit={() => { onSave(date, reason.trim()); onClose(); }}>
      <Field label="New date" htmlFor="rd-date"><Input id="rd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-reason-date" /></Field>
      <Field label="Reason (required)" htmlFor="rd-reason"><Input id="rd-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-reason-text" /></Field>
    </FormDialog>
  );
}

const statusCopy: Record<GoalStatus, { title: string; desc: string; cta: string }> = {
  active: { title: 'Resume this goal', desc: 'It returns to your active goals and health checks.', cta: 'Resume' },
  paused: { title: 'Pause this goal', desc: 'Pausing removes it from pace checks and Needs attention. Nothing is deleted.', cta: 'Pause goal' },
  completed: { title: 'Mark complete', desc: 'Record what was achieved. History and metrics are kept.', cta: 'Mark complete' },
  cancelled: { title: 'Cancel this goal', desc: 'Cancelled goals stay in history but stop appearing in plans. You can resume later.', cta: 'Cancel goal' },
};

function StatusDialog({ goal, status, onClose }: { goal: Goal; status: GoalStatus; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const { toast } = useToast();
  const c = statusCopy[status];
  const required = status !== 'active';
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={c.title} description={c.desc} submitLabel={c.cta} canSubmit={!required || !!reason.trim()} onSubmit={() => { setGoalStatus(goal.id, status, reason.trim()); toast({ title: `${goal.title}: ${status}` }); onClose(); }}>
      <Field label={required ? 'Reason (required)' : 'Note (optional)'} htmlFor="status-reason">
        <Textarea id="status-reason" autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-status-reason" />
      </Field>
    </FormDialog>
  );
}

function MilestoneDialog({ goal, open, onClose }: { goal: Goal; open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(addDaysIso(todayIso(), 14));
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) { setTitle(''); setDate(addDaysIso(todayIso(), 14)); }
  }
  return (
    <FormDialog open={open} onOpenChange={(o) => !o && onClose()} title="Add milestone" canSubmit={!!title.trim() && !!date} onSubmit={() => { addMilestone(goal.id, title.trim(), date); onClose(); }}>
      <Field label="Milestone" htmlFor="ms-title"><Input id="ms-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A checkpoint you can verify" data-testid="input-milestone-title" /></Field>
      <Field label="Date" htmlFor="ms-date"><Input id="ms-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-milestone-date" /></Field>
    </FormDialog>
  );
}

function MetricDialog({ goal, open, onClose }: { goal: Goal; open: boolean; onClose: () => void }) {
  const init = { name: '', unit: '', baseline: '0', target: '', kind: 'outcome' as MetricKind, frequency: 'cumulative' as Frequency, startDate: todayIso() };
  const [f, setF] = useState(init);
  const [lastOpen, setLastOpen] = useState(false);
  const { toast } = useToast();
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setF(init);
  }
  const recurring = f.frequency !== 'cumulative';
  const ok = !!f.name.trim() && f.target !== '' && Number.isFinite(Number(f.target)) && Number.isFinite(Number(f.baseline)) && (!recurring || (Number(f.target) > 0 && isMeasurementDate(f.startDate)));
  return (
    <FormDialog open={open} onOpenChange={(o) => !o && onClose()} title="Add metric" description="Outcomes prove the goal is working. Activity measures track effort you control." canSubmit={ok}
      onSubmit={() => {
        try {
          addMetric(goal.id, { name: f.name.trim(), unit: f.unit.trim(), baseline: recurring ? 0 : Number(f.baseline) || 0, target: Number(f.target), kind: f.kind, frequency: f.frequency, startDate: recurring ? f.startDate : undefined });
          onClose();
        } catch (err) {
          toast({ variant: 'destructive', title: 'Metric not added', description: err instanceof Error ? err.message : 'Check the values and try again.' });
        }
      }}>
      <Field label="Name" htmlFor="mt-name"><Input id="mt-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={recurring ? 'Deep work hours' : undefined} data-testid="input-metric-name" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as MetricKind })}>
            <SelectTrigger data-testid="select-metric-kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="outcome">Outcome (result)</SelectItem>
              <SelectItem value="leading">Activity (effort you control)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Measured" hint={recurring ? 'Starts at 0 every period. No carryover.' : 'One running total.'}>
          <FrequencySelect value={f.frequency} onChange={(v) => setF({ ...f, frequency: v })} testId="select-metric-frequency" />
        </Field>
        <Field label="Unit" htmlFor="mt-unit"><Input id="mt-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="$, kg, hours" data-testid="input-metric-unit" /></Field>
        {!recurring && <Field label="Starting value" htmlFor="mt-base"><Input id="mt-base" type="number" step="any" value={f.baseline} onChange={(e) => setF({ ...f, baseline: e.target.value })} data-testid="input-metric-baseline" /></Field>}
        <Field label={recurring ? `Target ${frequencyNoun(f.frequency)}` : 'Target'} htmlFor="mt-target" hint={recurring && f.target !== '' && Number(f.target) <= 0 ? 'Use a positive target' : recurring ? 'e.g. 30 hours each month' : undefined}>
          <Input id="mt-target" type="number" step="any" min={recurring ? 0 : undefined} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} data-testid="input-metric-target" />
        </Field>
      </div>
      {recurring && <MeasurementStartField frequency={f.frequency} target={Number(f.target)} unit={f.unit} value={f.startDate} onChange={(v) => setF({ ...f, startDate: v })} />}
    </FormDialog>
  );
}

function MetricTargetDialog({ goal, metricId, onClose }: { goal: Goal; metricId: string; onClose: () => void }) {
  const m = goal.metrics.find((x) => x.id === metricId);
  const { toast } = useToast();
  const [target, setTarget] = useState(String(m?.target ?? ''));
  const [frequency, setFrequency] = useState<Frequency>(m?.frequency ?? 'cumulative');
  const [reason, setReason] = useState('');
  if (!m) return null;
  const locked = m.entries.length > 0;
  const curFreq = m.frequency ?? 'cumulative';
  const recurring = frequency !== 'cumulative';
  const n = Number(target);
  const changed = n !== m.target || frequency !== curFreq;
  const valid = target !== '' && !Number.isNaN(n) && (!recurring || n > 0);
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={`Change target: ${m.name}`} description={`Currently ${formatValue(m.target, m.unit)} ${frequencyNoun(curFreq)}. The change and reason are recorded.${isRecurring(m) ? ' A new target applies from this period onward; past periods keep their old targets.' : ''}`}
      canSubmit={valid && changed && !!reason.trim()}
      onSubmit={() => {
        try {
          changeMetricTarget(goal.id, m.id, n, reason.trim(), locked ? undefined : frequency);
          onClose();
        } catch (err) {
          toast({ variant: 'destructive', title: 'Target not changed', description: err instanceof Error ? err.message : 'Check the values and try again.' });
        }
      }}>
      <Field label="Measured">
        <FrequencySelect value={frequency} onChange={setFrequency} disabled={locked} testId="select-metric-target-frequency" />
      </Field>
      {locked && (
        <p className="-mt-2 text-xs text-muted-foreground" data-testid="text-frequency-locked">
          Cadence is locked because this metric already has {m.entries.length} {m.entries.length === 1 ? 'entry' : 'entries'}. To measure on a different cadence, add a new measure; this one keeps its history intact.
        </p>
      )}
      <Field label={recurring ? `New target ${frequencyNoun(frequency)}` : 'New target'} htmlFor="tg-val" hint={recurring ? 'Positive; each period starts at 0.' : undefined}>
        <Input id="tg-val" type="number" step="any" autoFocus value={target} onChange={(e) => setTarget(e.target.value)} data-testid="input-metric-new-target" />
      </Field>
      <Field label="Reason (required)" htmlFor="tg-reason"><Input id="tg-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-metric-target-reason" /></Field>
      {recurring && <PeriodTag metric={{ frequency }} className="self-start" />}
    </FormDialog>
  );
}

function SplitDialog({ goal, open, onClose, onDone }: { goal: Goal; open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [ms, setMs] = useState<string[]>([]);
  const [mt, setMt] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) { setTitle(''); setOutcome(''); setMs([]); setMt([]); setReason(''); }
  }
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <FormDialog open={open} onOpenChange={(o) => !o && onClose()} title="Split goal" description="Move part of this goal into its own goal. Actions linked to moved milestones move with them." submitLabel="Split" wide
      canSubmit={!!title.trim() && !!reason.trim()}
      onSubmit={() => { const id = splitGoal(goal.id, { title: title.trim(), outcome: outcome.trim(), milestoneIds: ms, metricIds: mt, reason: reason.trim() }); onClose(); onDone(id); }}>
      <Field label="New goal" htmlFor="sp-title"><Input id="sp-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-split-title" /></Field>
      <Field label="Desired outcome" htmlFor="sp-outcome"><Textarea id="sp-outcome" rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} data-testid="input-split-outcome" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="eyebrow mb-2">Move milestones</legend>
          {goal.milestones.length === 0 && <p className="text-xs text-muted-foreground">None</p>}
          {goal.milestones.map((m) => (
            <label key={m.id} className="flex items-start gap-2 text-sm">
              <Checkbox checked={ms.includes(m.id)} onCheckedChange={() => toggle(ms, setMs, m.id)} className="mt-0.5" />
              {m.title}
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="eyebrow mb-2">Move metrics</legend>
          {goal.metrics.length === 0 && <p className="text-xs text-muted-foreground">None</p>}
          {goal.metrics.map((m) => (
            <label key={m.id} className="flex items-start gap-2 text-sm">
              <Checkbox checked={mt.includes(m.id)} onCheckedChange={() => toggle(mt, setMt, m.id)} className="mt-0.5" />
              {m.name}
            </label>
          ))}
        </fieldset>
      </div>
      <Field label="Reason (required)" htmlFor="sp-reason"><Input id="sp-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-split-reason" /></Field>
    </FormDialog>
  );
}
