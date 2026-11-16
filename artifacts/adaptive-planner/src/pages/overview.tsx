import { measurementTargetAt, plannedWorkMinutes } from '@workspace/api-zod';
import { DayAgenda } from '@/components/day-agenda';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Bell, Check, Flag, Info, LineChart, Star, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MissedWork } from '@/components/missed-work';
import { useTaskCompletion } from '@/components/task-completion';
import { LogMetricDialog } from '@/components/goal-dialogs';
import { AreaDot, EmptyState, HealthPill, PaceBar } from '@/components/primitives';
import { addDaysIso, daysBetween, fmt, nowStamp, relDay, todayIso, weekStartIso } from '@/lib/dates';
import { dismissReminder, rescheduleTasks } from '@/lib/store/actions';
import { generateInsights } from '@/lib/store/insights';
import {
  dueReminders,
  formatValue,
  goalExecution,
  goalHealth,
  metricValueAt,
  tasksInRange,
} from '@/lib/store/selectors';
import { isRecurring } from '@/components/measurement-period';
import { useAppState } from '@/lib/store/store';
import type { Goal } from '@/lib/store/types';
import { cn } from '@/lib/utils';
import { AskButton } from '@/components/ai/ask-button';
import { OverviewTimeCard } from '@/components/time-summary';
import { groupGoalFocus } from '@/lib/goal-focus';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function OverviewPage() {
  const state = useAppState();
  const completion = useTaskCompletion();
  const today = todayIso();
  const ws = weekStartIso(today);
  const [logGoal, setLogGoal] = useState<Goal | null>(null);

  const data = useMemo(() => {
    const reminders = dueReminders(state.tasks, nowStamp());
    const groups = groupGoalFocus(state.goals.filter((g) => g.status === 'active'));
    const active = [...groups.focus, ...groups.remaining];
    const weekTasks = tasksInRange(state.tasks, ws, addDaysIso(ws, 6));
    const plan = state.weekPlans[ws];
    const effort = plannedWorkMinutes(state, ws, addDaysIso(ws, 6));
    const milestones = active
      .flatMap((g) => g.milestones.filter((m) => !m.done).map((m) => ({ ...m, goal: g })))
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
      .slice(0, 4);
    const insights = generateInsights(state, today).slice(0, 4);
    const lastWeekly = state.reviews.find((r) => r.type === 'weekly');
    return { reminders, active, focusCount: groups.focus.length, weekTasks, plan, effort, milestones, insights, lastWeekly };
  }, [state, today, ws]);

  const weekDone = data.weekTasks.filter((t) => t.status === 'done').length;
  const capacity = data.plan?.capacityMinutes ?? 600;
  const reviewDue = !data.lastWeekly || daysBetween(data.lastWeekly.periodEnd, today) >= 6;
  const planned = !!data.plan?.finalized || data.weekTasks.length > 0;

  // One contextual primary action.
  const primary = reviewDue
    ? { href: '/reviews?start=weekly', label: 'Start weekly review', test: 'button-start-review' }
    : !planned
      ? { href: '/planner?view=week', label: 'Plan this week', test: 'button-plan-week' }
      : null;

  const summary = data.reminders.length ? `${data.reminders.length} reminder${data.reminders.length > 1 ? 's' : ''} due` : '';

  return (
    <div>
      <header className="rise mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground" data-testid="text-today-date">
            {fmt(today, 'EEEE, d MMMM')} &middot; week {fmt(today, 'I')}
          </div>
          <h1 className="font-display text-[1.7rem] font-light leading-tight md:text-[2rem]">
            {greeting()}, <span className="italic text-primary">{state.settings.name || 'friend'}</span>.
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
        <AskButton focus={{ screen: 'overview' }} />
        {primary && (
          <Button asChild data-testid={primary.test}>
            <Link href={primary.href}>
              {primary.label} <ArrowRight />
            </Link>
          </Button>
        )}
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-12">
        {/* TODAY */}
        <section className="surface rise min-w-0 p-3 sm:p-5 lg:col-span-7" aria-labelledby="today-h">
          <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
            <h2 id="today-h" className="font-display text-xl">Today</h2>
            <span className="text-xs text-muted-foreground" data-testid="text-today-progress">{summary || null}</span>
          </div>
          {data.reminders.length > 0 && (
            <ul className="mb-3 rounded-lg border border-primary/20 bg-accent/40 px-1 py-0.5" role="status" aria-label="Reminders due">
              {data.reminders.map((t) => (
                <li key={t.id} className="flex items-center gap-1 py-0.5" data-testid={`reminder-${t.id}`}>
                  <Bell className="ml-2 size-3.5 shrink-0 text-accent-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate px-1 text-sm">
                    {t.title}
                    <span className="ml-1.5 font-num text-xs text-muted-foreground">{t.reminder!.slice(11)}</span>
                  </span>
                  <Button size="icon" variant="ghost" className="size-10 sm:size-8" aria-label={`Mark ${t.title} done`} onClick={() => completion.toggle(t)} data-testid={`button-reminder-done-${t.id}`}>
                    <Check />
                  </Button>
                  {t.plannedDate !== today && (
                    <Button size="sm" variant="ghost" className="h-10 px-2 text-xs sm:h-8" onClick={() => { rescheduleTasks([t.id], today); dismissReminder(t.id); }} data-testid={`button-reminder-today-${t.id}`}>
                      Do today
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="size-10 text-muted-foreground sm:size-8" onClick={() => dismissReminder(t.id)} aria-label={`Dismiss reminder for ${t.title}`} data-testid={`button-reminder-dismiss-${t.id}`}>
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <MissedWork className="mb-4" />

          <DayAgenda day={today} />

          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border px-1 pt-4 text-sm">
            <div className="col-span-3 sm:col-span-1">
              <dt className="text-xs text-muted-foreground">Week focus</dt>
              <dd className="leading-snug" data-testid="text-week-focus">
                {data.plan?.focus || <Link href="/planner?view=week" className="text-primary hover:underline">Set a focus</Link>}
              </dd>
            </div>
            <div className="col-span-3 sm:col-span-1">
              <dt className="text-xs text-muted-foreground">Completed this week</dt>
              <dd className="font-num">{weekDone} of {data.weekTasks.length} planned</dd>
            </div>
            <div className="col-span-3 sm:col-span-1">
              <dt className="text-xs text-muted-foreground">Planned vs available time</dt>
              <dd className={cn('font-num', data.effort > capacity && 'text-destructive')}>
                {Math.round(data.effort / 6) / 10}h of {Math.round(capacity / 6) / 10}h
              </dd>
              <div className="mt-1.5 h-1 w-full rounded-full bg-muted" aria-hidden>
                <div className={cn('h-full origin-left rounded-full', data.effort > capacity ? 'bg-destructive' : 'bg-primary')} style={{ transform: `scaleX(${Math.min(1, data.effort / Math.max(1, capacity))})` }} />
              </div>
            </div>
          </dl>
        </section>

        {/* RIGHT RAIL */}
        <div className="min-w-0 space-y-5 lg:col-span-5">
          <section className="surface rise p-4 sm:p-5" style={{ animationDelay: '80ms' }} aria-labelledby="health-h">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="health-h" className="font-display text-xl">Goals</h2>
              <Link href="/goals" className="inline-flex min-h-8 items-center text-sm text-primary hover:underline" data-testid="link-all-goals">All goals</Link>
            </div>
            {data.active.length === 0 ? (
              <EmptyState mark="circle" title="No active goals" body="Set one direction to connect actions to results." action={<Button size="sm" asChild><Link href="/goals?new=1">Add a goal</Link></Button>} />
            ) : (
              <ul className="space-y-4">
                {data.active.map((g, index) => {
                  const h = goalHealth(g, today);
                  const ex = goalExecution(g.id, state.tasks);
                  const next = g.spotlight ? g.milestones.filter((m) => !m.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] : undefined;
                  return (
                    <li key={g.id} data-testid={`health-goal-${g.id}`}>
                      {index === 0 && data.focusCount > 0 && (
                        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium"><Star className="size-3.5 fill-current" aria-hidden /> In focus <span className="font-normal text-muted-foreground">· {data.focusCount}</span></h3>
                      )}
                      {index === data.focusCount && data.focusCount > 0 && <h3 className="mb-3 border-t border-border pt-3 text-sm text-muted-foreground">Other goals</h3>}
                      <div className="flex items-start justify-between gap-3">
                        <Link href={`/goals/${g.id}`} className="flex min-w-0 flex-1 items-center gap-2 hover:text-primary" data-testid={`link-goal-${g.id}`}>
                          <AreaDot area={g.area} goalId={g.id} />
                          <span className="truncate text-[0.93rem] font-medium">{g.title}</span>
                        </Link>
                        <HealthPill health={h.status} />
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <PaceBar progress={h.progress} expected={h.expected} area={g.area} goalId={g.id} className="flex-1" />
                        <span className="shrink-0 text-right font-num text-xs">
                          {h.metric ? formatValue(metricValueAt(h.metric), h.metric.unit) : 'No result yet'}{h.metric && isRecurring(h.metric) && <span className="text-muted-foreground"> {h.metric.frequency === 'weekly' ? 'this week' : 'this month'}</span>}
                          {h.metric && h.status !== 'not-started' && <span className="text-muted-foreground"> / {formatValue(measurementTargetAt(h.metric), h.metric.unit)}</span>}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate">
                          {h.metric ? h.metric.name : 'No result measure'} &middot; {ex.done} tasks done, last 14 days
                        </span>
                        <button
                          type="button"
                          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded px-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setLogGoal(g)}
                          data-testid={`button-log-metric-${g.id}`}
                        >
                          <LineChart className="size-3" /> Update result
                        </button>
                      </div>
                      {g.spotlight && (
                        <p className="mt-1 break-words text-xs text-muted-foreground" data-testid={`text-focus-milestone-${g.id}`}>
                          {next ? <>Next: <Link href={`/goals/${g.id}`} className="text-foreground/80 hover:underline">{next.title}</Link> · {relDay(next.dueDate)}</> : 'No upcoming milestone'}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {data.active.length > 0 && data.focusCount === 0 && <p className="mt-3 text-xs text-muted-foreground"><Link href="/goals" className="text-primary hover:underline">Spotlight a goal</Link> to keep your current focus at the top.</p>}
            {data.focusCount > 3 && <p className="mt-3 text-xs text-muted-foreground">For a clearer focus, consider keeping just three spotlight goals. <Link href="/goals" className="text-primary hover:underline">Manage focus</Link></p>}
            <details className="mt-4 text-xs text-muted-foreground">
              <summary className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Info className="size-3.5" /> How to read this
              </summary>
              <p className="mt-1">The bar is the result you logged. The thin tick marks an even pace toward the target date, a reference point rather than a forecast. Completing tasks never changes a result.</p>
            </details>
          </section>

          <OverviewTimeCard />

          <section className="surface rise p-4 sm:p-5" style={{ animationDelay: '140ms' }} aria-labelledby="signals-h">
            <h2 id="signals-h" className="mb-3 font-display text-xl">Needs attention</h2>
            {data.insights.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing stands out. Plans and results look consistent.</p>
            ) : (
              <ul className="space-y-3">
                {data.insights.map((i) => (
                  <li key={i.id} className="flex gap-3" data-testid={`insight-${i.id}`}>
                    <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', i.tone === 'warning' ? 'bg-destructive' : i.tone === 'positive' ? 'bg-success' : 'bg-warning')} />
                    <div className="min-w-0 text-sm">
                      {(() => {
                        const goal = i.goalId ? state.goals.find((g) => g.id === i.goalId) : undefined;
                        const name = i.goalTitle ?? goal?.title;
                        if (!name) return null;
                        return (
                          <span className="mb-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-testid={`text-insight-goal-${i.id}`}>
                            {goal && <AreaDot area={goal.area} goalId={goal.id} />}
                            {i.goalId ? <Link href={`/goals/${i.goalId}`} className="break-words font-medium text-foreground/80 hover:text-primary">{name}</Link> : <span className="break-words">{name}</span>}
                          </span>
                        );
                      })()}
                      {i.href ? <Link href={i.href} className="font-medium hover:text-primary">{i.title}</Link> : <span className="font-medium">{i.title}</span>}
                      <p className="text-muted-foreground">{i.detail}</p>
                    </div>
                    <span className="ml-auto shrink-0 self-start text-muted-foreground" title={`Rule: ${i.rule}`} aria-label={`Rule: ${i.rule}`}>
                      <Info className="size-3.5" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface rise p-4 sm:p-5" style={{ animationDelay: '200ms' }}>
            <h2 className="mb-2 flex items-center gap-1.5 font-display text-lg"><Flag className="size-4 text-muted-foreground" /> Next milestones</h2>
            {data.milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground">None scheduled.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {data.milestones.map((m) => (
                  <li key={m.id}>
                    <Link href={`/goals/${m.goal.id}`} className="flex min-h-10 items-center justify-between gap-3 py-1.5 text-sm hover:text-primary">
                      <span className="flex min-w-0 items-center gap-2"><AreaDot area={m.goal.area} goalId={m.goal.id} /><span className="truncate">{m.title}</span></span>
                      <span className={cn('shrink-0 font-num text-xs', m.dueDate < today ? 'text-destructive' : 'text-muted-foreground')}>{relDay(m.dueDate)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
              {data.lastWeekly ? `Last weekly review ${relDay(data.lastWeekly.createdAt.slice(0, 10)).toLowerCase()}.` : 'No weekly review yet.'}{' '}
              <Link href="/reviews" className="text-primary hover:underline" data-testid="link-reviews">Review history</Link>
              {' · '}
              <Link href="/reviews?start=monthly" className="text-primary hover:underline" data-testid="button-start-monthly-review">Monthly review</Link>
            </p>
          </section>
        </div>
      </div>

      {logGoal && (
        <LogMetricDialog
          goal={state.goals.find((g) => g.id === logGoal.id) ?? logGoal}
          open={!!logGoal}
          onOpenChange={(o) => !o && setLogGoal(null)}
        />
      )}
    </div>
  );
}
