import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearch } from 'wouter';
import { ArrowUpRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NewGoalDialog } from '@/components/goal-dialogs';
import { AreaTag, EmptyState, HealthPill, PageHeader, PaceBar, SampleMark, StatusPill } from '@/components/primitives';
import { fmt, relDay, todayIso } from '@/lib/dates';
import { formatValue, goalExecution, goalHealth, metricValueAt, measurementTargetAt } from '@/lib/store/selectors';
import { isRecurring } from '@/components/measurement-period';
import { useAppState } from '@/lib/store/store';
import { AREAS } from '@/lib/store/types';
import type { Area, GoalStatus } from '@/lib/store/types';
import { cn } from '@/lib/utils';

const STATUS_FILTERS: { value: GoalStatus | 'all'; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

export function Chip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        'min-h-9 rounded-full border px-3 py-1 text-[0.85rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-foreground/80 bg-foreground text-background' : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export default function GoalsPage() {
  const state = useAppState();
  const search = useSearch();
  const [status, setStatus] = useState<GoalStatus | 'all'>('active');
  const [area, setArea] = useState<Area | 'all'>('all');
  const [creating, setCreating] = useState(new URLSearchParams(search).get('new') === '1');
  const today = todayIso();

  const goals = useMemo(
    () =>
      state.goals
        .filter((g) => (status === 'all' ? true : g.status === status))
        .filter((g) => (area === 'all' ? true : g.area === area))
        .sort((a, b) => {
          const p = { high: 0, medium: 1, low: 2 };
          return p[a.priority] - p[b.priority] || (a.targetDate < b.targetDate ? -1 : 1);
        }),
    [state.goals, status, area],
  );
  const count = (s: GoalStatus | 'all') => state.goals.filter((g) => s === 'all' || g.status === s).length;

  return (
    <div>
      <PageHeader
        title="Goals"
        description="Few, specific, and measured by results you log — not by how busy you were."
        actions={
          <Button onClick={() => setCreating(true)} data-testid="button-new-goal">
            <Plus /> New goal
          </Button>
        }
      />
      <div className="rise mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <Chip key={f.value} active={status === f.value} onClick={() => setStatus(f.value)} testId={`filter-status-${f.value}`}>
              {f.label} <span className="ml-1 font-num text-xs opacity-70">{count(f.value)}</span>
            </Chip>
          ))}
        </div>
        <Select value={area} onValueChange={(v) => setArea(v as Area | 'all')}>
          <SelectTrigger className="h-10 w-full sm:h-9 sm:w-44" aria-label="Filter by area" data-testid="select-goal-area">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="filter-area-all">All areas</SelectItem>
            {AREAS.map((a) => <SelectItem key={a.value} value={a.value} data-testid={`filter-area-${a.value}`}>{a.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {goals.length === 0 ? (
        <div className="surface">
          <EmptyState
            mark="circle"
            title={status === 'active' ? 'No active goals here' : `No ${status === 'all' ? '' : status} goals`}
            body="Goals connect what you want to the actions you schedule and the results you log."
            action={<Button onClick={() => setCreating(true)}><Plus /> New goal</Button>}
          />
        </div>
      ) : (
        <ol className="surface divide-y divide-border overflow-hidden">
          {goals.map((g, i) => {
            const h = goalHealth(g, today);
            const ex = goalExecution(g.id, state.tasks);
            const next = g.milestones.filter((m) => !m.done).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
            const msDone = g.milestones.filter((m) => m.done).length;
            return (
              <li key={g.id} className="rise" style={{ animationDelay: `${i * 40}ms` }}>
                <Link
                  href={`/goals/${g.id}`}
                  className="group grid gap-4 p-5 transition-colors hover:bg-muted/40 md:grid-cols-12 md:items-center md:p-6"
                  data-testid={`card-goal-${g.id}`}
                >
                  <div className="md:col-span-6">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <AreaTag area={g.area} goalId={g.id} />
                      {g.status !== 'active' && <StatusPill status={g.status} />}
                      {g.isDemo && <SampleMark />}
                    </div>
                    <h2 className="font-display text-xl leading-snug group-hover:text-primary md:text-[1.4rem]">
                      {g.title}
                      <ArrowUpRight className="ml-1 inline size-4 opacity-0 transition-opacity group-hover:opacity-60" />
                    </h2>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{g.outcome}</p>
                  </div>
                  <div className="md:col-span-4">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Result: {h.metric?.name ?? 'not measured yet'}</span>
                      {g.status === 'active' && <HealthPill health={h.status} />}
                    </div>
                    <PaceBar progress={h.progress} expected={g.status === 'active' ? h.expected : undefined} area={g.area} goalId={g.id} />
                    <div className="mt-2 flex justify-between font-num text-xs text-muted-foreground">
                      <span className="text-foreground">{h.metric ? formatValue(metricValueAt(h.metric), h.metric.unit) : '—'}{h.metric && isRecurring(h.metric) && <span className="text-muted-foreground"> {h.metric.frequency === 'weekly' ? 'this week' : 'this month'}</span>}</span>
                      <span>{h.metric ? h.status === 'not-started' ? `Starts ${fmt(h.metric.startDate!, 'MMM d')}` : formatValue(measurementTargetAt(h.metric), h.metric.unit) : ''}</span>
                    </div>
                  </div>
                  <div className="space-y-0.5 text-xs text-muted-foreground md:col-span-2 md:text-right">
                    <div className="font-num">Target {fmt(g.targetDate, 'MMM d')}</div>
                    <div>{msDone} of {g.milestones.length} milestones</div>
                    <div title="Tasks linked to this goal">Last 14 days: {ex.done} tasks done</div>
                    {next && (
                      <div className="text-foreground/80" title={next.title}>
                        <span className="line-clamp-2">Next: {next.title}</span>
                        <span className="font-num text-muted-foreground">{relDay(next.dueDate)}</span>
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      <NewGoalDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
