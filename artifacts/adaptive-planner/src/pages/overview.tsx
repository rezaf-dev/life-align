import { measurementTargetAt, plannedWorkMinutes } from '@workspace/api-zod';
import { DayAgenda } from '@/components/day-agenda';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Bell, Check, Compass, Flag, Info, LineChart, X } from 'lucide-react';
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
import { getGoalPaceFeedback } from '@/lib/goal-pace';
import { formatMinutes } from '@/lib/reports';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The top of the day: this week's focus, today's sessions, reserved vs logged time, and one next step. */
function TodayPlan({ focus, reviewDue }: { focus?: string; reviewDue: boolean }) {
  const state = useAppState();
  const today = todayIso();
  const sessions = (state.sessions ?? []).filter((s) => s.plannedDate === today && s.status === 'planned')
    .sort((a, b) => (a.plannedTime ?? '99').localeCompare(b.plannedTime ?? '99'));
  const reserved = sessions.reduce((a, s) => a + s.plannedMinutes, 0);
  const logged = (state.sessions ?? []).filter((s) => s.status === 'logged' && s.date === today).reduce((a, s) => a + (s.actualMinutes ?? 0), 0);
  const openToday = state.tasks.filter((t) => !t.archived && t.status !== 'done' && (t.plannedDate === today || t.dueDate === today));
  const next = state.activeTimer
    ? { text: `Continue "${state.activeTimer.title}" using the timer above`, href: '', cta: '' }
    : sessions[0]
      ? { text: `Begin "${sessions[0].title}"${sessions[0].plannedTime ? ` at ${sessions[0].plannedTime}` : ''}`, href: '/planner?view=day', cta: 'Open today' }
      : openToday[0]
        ? { text: `Finish "${openToday[0].title}"`, href: '/tasks?view=today', cta: 'Open today’s tasks' }
        : !focus
          ? { text: 'Choose one focus so the week has a direction', href: '/planner?view=week', cta: 'Choose focus' }
          : reviewDue
            ? { text: 'Close last week with a short review', href: '/reviews?start=weekly', cta: 'Start review' }
            : { text: 'Nothing remaining today. Reserve a session if you want to do more', href: '/planner?view=day', cta: 'Plan today' };
  const total = Math.max(1, reserved, logged);
  return (
    <div className="mb-4 rounded-xl bg-accent/35 p-3 sm:p-4" data-testid="panel-today-plan">
      <div className="flex items-start gap-2.5">
        <Compass className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">This week's focus</div>
          {focus ? (
            <p className="font-display text-lg leading-snug" data-testid="text-week-focus">{focus}</p>
          ) : (
            <Link href="/planner?view=week" className="inline-flex min-h-8 items-center gap-1 font-display text-lg text-primary hover:underline" data-testid="link-choose-focus">
              Choose this week's focus <ArrowRight className="size-4" />
            </Link>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs text-muted-foreground">Planned sessions today</div>
          <p className="text-sm" data-testid="text-today-sessions">
            {sessions.length === 0 ? 'None reserved' : `${sessions.length} session${sessions.length === 1 ? '' : 's'}: ${sessions.slice(0, 3).map((s) => (s.plannedTime ? `${s.plannedTime} ${s.title}` : s.title)).join(', ')}${sessions.length > 3 ? ` and ${sessions.length - 3} more` : ''}`}
          </p>
        </div>
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            Reserved vs logged
            <details className="relative">
              <summary className="inline-flex size-6 cursor-pointer items-center justify-center rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="What reserved and logged mean" data-testid="button-reserved-help"><Info className="size-3.5" /></summary>
              <p className="absolute right-0 z-10 mt-1 w-60 max-w-[calc(100vw-3rem)] rounded-lg border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
                Reserved is time you set aside in planned sessions, an intention. Logged is time you actually recorded as worked. Only logged time counts as real work in reports.
              </p>
            </details>
          </div>
          <div className="mt-1 space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-16 text-muted-foreground">Reserved</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background/70" aria-hidden><div className="h-full w-full origin-left rounded-full bg-primary/40" style={{ transform: `scaleX(${reserved / total})` }} /></div>
              <span className="w-14 text-right font-num" data-testid="text-today-reserved">{formatMinutes(reserved)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-16 text-muted-foreground">Logged</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background/70" aria-hidden><div className="h-full w-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${logged / total})` }} /></div>
              <span className="w-14 text-right font-num" data-testid="text-today-logged">{formatMinutes(logged)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-primary/10 pt-3">
        <p className="min-w-0 text-sm"><span className="text-muted-foreground">Next: </span><span className="font-medium" data-testid="text-next-action">{next.text}.</span></p>
        {next.href && (
          <Button size="sm" variant="secondary" asChild data-testid="button-next-action"><Link href={next.href}>{next.cta} <ArrowRight /></Link></Button>
        )}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const state = useAppState();
  const completion = useTaskCompletion();
  const today = todayIso();
  const ws = weekStartIso(today);
  const [logGoal, setLogGoal] = useState<Goal | null>(null);

  const data = useMemo(() => {
    const reminders = dueReminders(state.tasks, nowStamp());
    const active = state.goals.filter((g) => g.status === 'active');
    const weekTasks = tasksInRange(state.tasks, ws, addDaysIso(ws, 6));
    const plan = state.weekPlans[ws];
    const effort = plannedWorkMinutes(state, ws, addDaysIso(ws, 6));
    const milestones = active
      .flatMap((g) => g.milestones.filter((m) => !m.done).map((m) => ({ ...m, goal: g })))
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
      .slice(0, 4);
    const insights = generateInsights(state, today).slice(0, 4);
    const lastWeekly = state.reviews.find((r) => r.type === 'weekly');
    return { reminders, active, weekTasks, plan, effort, milestones, insights, lastWeekly };
  }, [state, today, ws]);

  const weekDone = data.weekTasks.filter((t) => t.status === 'done').length;
  const capacity = data.plan?.capacityMinutes ?? 600;
  const reviewDue = !data.lastWeekly || daysBetween(data.lastWeekly.periodEnd, today) >= 6;
  const planned = !!data.plan?.finalized || data.weekTasks.length > 0;

  // One contextual primary action.
  // Review and focus prompts live in Today's plan; the header only nudges planning.
  const primary = reviewDue
    ? null
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

          <TodayPlan focus={data.plan?.focus} reviewDue={reviewDue} />

          <MissedWork className="mb-4" />

          <DayAgenda day={today} />

          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border px-1 pt-4 text-sm">
            <div className="col-span-3 sm:col-span-1 sm:col-start-2">
              <dt className="text-xs text-muted-foreground">Completed this week</dt>
              <dd className="font-num">{weekDone} of {data.weekTasks.length} planned</dd>
            </div>
            <div className="col-span-3 sm:col-span-1">
              <dt className="text-xs text-muted-foreground">Planned vs available time</dt>
              <dd className={cn('font-num', data.effort > capacity && 'text-warning')}>
                {Math.round(data.effort / 6) / 10}h of {Math.round(capacity / 6) / 10}h
              </dd>
              <div className="mt-1.5 h-1 w-full rounded-full bg-muted" aria-hidden>
                <div className={cn('h-full origin-left rounded-full', data.effort > capacity ? 'bg-warning' : 'bg-primary')} style={{ transform: `scaleX(${Math.min(1, data.effort / Math.max(1, capacity))})` }} />
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
                {data.active.map((g) => {
                  const h = goalHealth(g, today);
                  const ex = goalExecution(g.id, state.tasks);
                  return (
                    <li key={g.id} data-testid={`health-goal-${g.id}`}>
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
                      <p className="mt-1 text-xs leading-snug text-foreground/80" data-testid={`text-pace-${g.id}`}>{getGoalPaceFeedback(g, today).recommendation}</p>
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
                    </li>
                  );
                })}
              </ul>
            )}
            <details className="mt-4 text-xs text-muted-foreground">
              <summary className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Info className="size-3.5" /> How to read this
              </summary>
              <p className="mt-1">The bar is the result you logged. The thin tick shows where a steady path to the target date would be today. The line under it is a gentle suggestion, open the goal for the full picture. Completing tasks never changes a result.</p>
            </details>
          </section>

          <OverviewTimeCard />

          <section className="surface rise p-4 sm:p-5" style={{ animationDelay: '140ms' }} aria-labelledby="signals-h">
            <h2 id="signals-h" className="mb-3 font-display text-xl">What needs a decision</h2>
            {data.insights.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing stands out. Plans and results look consistent.</p>
            ) : (
              <ul className="space-y-3">
                {data.insights.map((i) => (
                  <li key={i.id} className="flex gap-3" data-testid={`insight-${i.id}`}>
                    <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', i.tone === 'warning' ? 'bg-warning' : i.tone === 'positive' ? 'bg-success' : 'bg-warning')} />
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
                      <span className={cn('shrink-0 font-num text-xs', m.dueDate < today ? 'text-warning' : 'text-muted-foreground')}>{relDay(m.dueDate)}</span>
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
