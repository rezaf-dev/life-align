import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Section } from '@/components/primitives';
import { TimesheetPanel } from '@/components/goal-timesheet';
import { SavedTimesheets } from '@/components/saved-timesheets';
import { addDaysIso, fmt, monthStartIso, relDay, todayIso } from '@/lib/dates';
import { formatValue } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';
import type { Goal } from '@/lib/store/types';
import { buildGoalReport, formatMinutes, validateReportRange, type MeasureReport } from '@/lib/reports';
import { cn } from '@/lib/utils';

const day = (s: string) => fmt(s, 'MMM d, yyyy');
const signed = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '\u2212' : ''}${formatValue(Math.abs(n), unit)}`;

export function GoalReports({ goal, onViewActions }: { goal: Goal; onViewActions: () => void }) {
  const state = useAppState();
  const [start, setStart] = useState(() => monthStartIso(todayIso()));
  const [end, setEnd] = useState(() => todayIso());
  const today = todayIso();
  const error = validateReportRange(start, end);
  const report = useMemo(() => (error ? null : buildGoalReport(state, goal, start, end)), [state, goal, start, end, error]);

  return (
    <div className="min-w-0 space-y-5" data-testid="panel-goal-reports">
      <div className="surface p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">From
            <Input type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} className="h-10" data-testid="input-report-start" />
          </label>
          <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">To
            <Input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="h-10" data-testid="input-report-end" />
          </label>
          <div className="flex flex-wrap gap-1">
            {[
              { l: 'This month', s: monthStartIso(todayIso()), e: todayIso() },
              { l: 'Last 30 days', s: addDaysIso(todayIso(), -29), e: todayIso() },
              { l: 'Year to date', s: `${todayIso().slice(0, 4)}-01-01`, e: todayIso() },
            ].map((p) => (
              <Button key={p.l} size="sm" variant={start === p.s && end === p.e ? 'secondary' : 'ghost'} className="h-9" onClick={() => { setStart(p.s); setEnd(p.e); }} data-testid={`button-range-${p.l.toLowerCase().replace(/\s+/g, '-')}`}>{p.l}</Button>
            ))}
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-destructive" role="alert" data-testid="text-report-range-error">{error}</p>}
      </div>

      {report && (
        <>
          <Section title="Progress report" aside={<span className="font-num text-xs text-muted-foreground">{day(report.start)} &ndash; {day(report.end)}</span>}>
            <div className="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-[calc(var(--radius)+2px)] border border-border bg-border sm:grid-cols-3">
              <Stat label="Session time" value={formatMinutes(report.actualMinutes)} sub={`${report.sessionCount} recorded session${report.sessionCount === 1 ? '' : 's'}`} testId="stat-report-actual" />
              <Stat label="Time reserved" value={formatMinutes(report.plannedMinutes)} sub="Session reservations dated in range" testId="stat-report-planned" />
              <Stat label="Completed" value={`${report.completedTasks.length} tasks`} sub={`${report.completedMilestones.length} milestone${report.completedMilestones.length === 1 ? '' : 's'} reached`} testId="stat-report-completed" />
            </div>
            <p className="-mt-2 mb-5 text-xs text-muted-foreground">Session time is work logged in sessions, not task estimates. Time recorded directly on a measure appears under that measure and in the timesheet.</p>

            <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className="min-w-0 space-y-5">
                <ListBlock title="Tasks completed" empty="No tasks completed in this range." items={report.completedTasks.map((t) => ({ id: t.id, title: t.title, date: t.completedAt?.slice(0, 10) }))} testId="list-report-tasks" />
                <ListBlock title="Milestones reached" empty="No milestones reached in this range." items={report.completedMilestones.map((m) => ({ id: m.id, title: m.title, date: m.completedAt?.slice(0, 10) }))} testId="list-report-milestones" />
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 text-sm font-medium">Measures</h3>
                {report.measures.length === 0 ? (
                  <p className="text-sm text-muted-foreground">This goal has no result measures.</p>
                ) : (
                  <div className="space-y-4">{report.measures.map((m) => <MeasureBlock key={m.id} m={m} />)}</div>
                )}
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Change is what was measured inside your selected dates. Targets are the full weekly or monthly commitment, so a partly covered period can look short against them.</p>
              </div>
            </div>
          </Section>
          <Section title="Current next steps" aside={<span className="text-xs text-muted-foreground">as of today, not the report dates</span>}>
            <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span><span className="font-num text-lg" data-testid="text-report-open">{report.openTasks.length}</span> <span className="text-muted-foreground">open actions</span></span>
              <span className={cn(report.overdueTasks.length > 0 && 'text-destructive')}><span className="font-num text-lg" data-testid="text-report-overdue">{report.overdueTasks.length}</span> overdue</span>
              <span><span className="font-num text-lg">{report.upcomingMilestones.length}</span> <span className="text-muted-foreground">milestones to go</span></span>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
              <DueList title="Overdue actions" empty="Nothing overdue." items={report.overdueTasks.slice(0, 8).map((t) => ({ id: t.id, title: t.title, date: t.dueDate && t.dueDate < today ? t.dueDate : t.plannedDate }))} today={today} testId="list-report-overdue" />
              <DueList title="Next milestones" empty="No open milestones." items={report.upcomingMilestones.slice(0, 6).map((m) => ({ id: m.id, title: m.title, date: m.dueDate }))} today={today} testId="list-report-next-milestones" />
            </div>
            {report.openTasks.length > 0 && <Button variant="outline" size="sm" className="mt-4" onClick={onViewActions} data-testid="button-report-view-actions">View open actions</Button>}
          </Section>
          <TimesheetPanel goal={goal} start={start} end={end} />
        </>
      )}
      <SavedTimesheets goal={goal} />
    </div>
  );
}

function Stat({ label, value, sub, testId }: { label: string; value: string; sub: string; testId: string }) {
  return (
    <div className="min-w-0 bg-card p-3 sm:p-4">
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className="font-num text-lg" data-testid={testId}>{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function ListBlock({ title, empty, items, testId }: { title: string; empty: string; items: { id: string; title: string; date?: string }[]; testId: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-medium">{title} <span className="font-num font-normal text-muted-foreground">{items.length}</span></h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/60" data-testid={testId}>
          {(expanded ? items : items.slice(0, 8)).map((i) => (
            <li key={i.id} className="flex min-w-0 items-baseline justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 [overflow-wrap:anywhere]">{i.title}</span>
              {i.date && <span className="shrink-0 font-num text-xs text-muted-foreground">{fmt(i.date, 'MMM d, yyyy')}</span>}
            </li>
          ))}
        </ul>
      )}
      {items.length > 8 && <Button variant="ghost" size="sm" className="mt-1" onClick={() => setExpanded((v) => !v)} data-testid={`${testId}-toggle`}>{expanded ? 'Show less' : `Show all ${items.length}`}</Button>}
    </div>
  );
}

function DueList({ title, empty, items, today, testId }: { title: string; empty: string; items: { id: string; title: string; date?: string }[]; today: string; testId: string }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <ul className="divide-y divide-border/60" data-testid={testId}>
          {items.map((i) => (
            <li key={i.id} className="flex min-w-0 items-baseline justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 [overflow-wrap:anywhere]">{i.title}</span>
              {i.date && <span className={cn('shrink-0 font-num text-xs', i.date < today ? 'text-destructive' : 'text-muted-foreground')}>{i.date < today ? 'was due ' : ''}{relDay(i.date, today).toLowerCase()}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MeasureBlock({ m }: { m: MeasureReport }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 p-3" data-testid={`report-measure-${m.id}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium [overflow-wrap:anywhere]">{m.name}</span>
        <span className="text-xs text-muted-foreground">{m.frequency === 'cumulative' ? 'running total' : `${m.frequency} target`}</span>
      </div>
      {m.periods.length === 0 && <p className="text-xs text-muted-foreground">Not started in this range.</p>}
      <div className="space-y-2">
        {m.periods.map((p) => (
          <div key={p.start} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-sm">
            <span className="font-num text-xs text-muted-foreground">
              {m.frequency === 'cumulative' ? `${fmt(p.coveredStart, 'MMM d')} – ${fmt(p.coveredEnd, 'MMM d')}` : `${fmt(p.start, 'MMM d')} – ${fmt(p.end, 'MMM d')}`}
              {!p.fullPeriod && m.frequency !== 'cumulative' && ` · covers ${fmt(p.coveredStart, 'MMM d')} – ${fmt(p.coveredEnd, 'MMM d')}`}
            </span>
            <span className={cn('font-num text-right', p.change !== 0 && ((p.change > 0) === (p.direction === 'increase') ? 'text-primary' : 'text-destructive'))} data-testid={`text-measure-change-${m.id}-${p.start}`}>{signed(p.change, m.unit)}</span>
            <span className="col-span-2 font-num text-xs text-muted-foreground">
              {formatValue(p.startValue, m.unit)} &rarr; {formatValue(p.endValue, m.unit)} of {formatValue(p.target, m.unit)}{m.frequency === 'cumulative' ? ' target' : ' period target'}
              {p.remaining > 0 ? ` · ${formatValue(p.remaining, m.unit)} to go` : ' · target met'}
            </span>
            <progress className="col-span-2 h-1.5 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-primary" value={Math.round(p.progress * 100)} max={100} aria-label={`${m.name} progress`} />
          </div>
        ))}
      </div>
    </div>
  );
}

