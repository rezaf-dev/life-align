import { useMemo } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Clock3 } from 'lucide-react';
import { formatMinutes } from '@/lib/reports';
import { todayIso, weekStartIso } from '@/lib/dates';
import { useAppState } from '@/lib/store/store';

/** Compact Today / This week time card for Overview. */
export function OverviewTimeCard() {
  const state = useAppState();
  const today = todayIso();
  const r = useMemo(() => {
    const logged = (state.sessions ?? []).filter((s) => s.status === 'logged');
    return {
      todayMinutes: logged.filter((s) => s.date === today).reduce((sum, s) => sum + (s.actualMinutes ?? 0), 0),
      weekMinutes: logged.filter((s) => s.date! >= weekStartIso(today) && s.date! <= today).reduce((sum, s) => sum + (s.actualMinutes ?? 0), 0),
    };
  }, [state, today]);
  return (
    <section className="surface rise p-4 sm:p-5" aria-labelledby="time-h" data-testid="card-overview-time">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="time-h" className="flex items-center gap-2 font-display text-xl"><Clock3 className="size-4 text-primary" /> Time</h2>
        <Link href="/time" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" data-testid="link-overview-time">
          Time &amp; performance <ArrowRight className="size-3" />
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/50 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">Today</dt>
          <dd className="font-num text-2xl tabular-nums" data-testid="text-overview-time-today">{formatMinutes(r.todayMinutes)}</dd>
        </div>
        <div className="rounded-lg bg-muted/50 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">This week</dt>
          <dd className="font-num text-2xl tabular-nums" data-testid="text-overview-time-week">{formatMinutes(r.weekMinutes)}</dd>
        </div>
      </dl>
      {r.weekMinutes === 0 && <p className="mt-2 text-xs text-muted-foreground">No time recorded this week. Tracking is optional.</p>}
    </section>
  );
}

/** One line of invested time for a goal, shown even when the goal has no time measure. */
export function GoalTimeSummary({ goalId }: { goalId: string }) {
  const state = useAppState();
  const today = todayIso();
  const { all, wk } = useMemo(() => {
    const logged = (state.sessions ?? []).filter((s) => s.goalId === goalId && s.status === 'logged');
    return { all: logged.reduce((sum, s) => sum + (s.actualMinutes ?? 0), 0),
      wk: logged.filter((s) => s.date! >= weekStartIso(today) && s.date! <= today).reduce((sum, s) => sum + (s.actualMinutes ?? 0), 0) };
  }, [state, today, goalId]);
  return (
    <p className="mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground" data-testid="text-goal-invested-time">
      <Clock3 className="size-3.5 text-primary" aria-hidden />
      <span><span className="font-num text-foreground">{formatMinutes(all)}</span> invested in total</span>
      <span aria-hidden>·</span>
      <span><span className="font-num text-foreground">{formatMinutes(wk)}</span> this week</span>
      <Link href="/time" className="text-primary hover:underline" data-testid="link-goal-time-report">See time report</Link>
    </p>
  );
}
