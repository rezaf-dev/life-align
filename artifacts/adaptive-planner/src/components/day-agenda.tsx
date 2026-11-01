import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Clock3, Play, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QuickAdd } from '@/components/quick-add';
import { TaskRow } from '@/components/task-row';
import { EmptyState } from '@/components/primitives';
import { DeleteSessionDialog, LogSessionDialog, PlanSessionDialog, SessionRow } from '@/components/work-sessions';
import { useWorkSessionActions } from '@/components/work-session-provider';
import { dayAgenda } from '@/lib/day-agenda';
import { formatMinutes } from '@/lib/reports';
import { relDay, todayIso } from '@/lib/dates';
import { useAppState } from '@/lib/store/store';
import type { WorkSession } from '@/lib/store/types';
import { cn } from '@/lib/utils';

type DialogState = null | { plan: WorkSession | true } | { log: WorkSession | true } | { del: WorkSession };

function SubHead({ label, count, detail, testId }: { label: string; count: number; detail?: string; testId: string }) {
  return (
    <h4 className="mt-2 flex items-baseline gap-2 px-1 text-xs text-muted-foreground" data-testid={testId}>
      <span className="font-medium text-foreground/80">{label}</span>
      <span className="font-num">{count}</span>
      {detail && <span className="font-num">· {detail}</span>}
    </h4>
  );
}

function Group({ id, title, count, children, tone }: { id: string; title: string; count: number; children: ReactNode; tone?: 'muted' }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h3 id={id} className={cn('flex items-baseline gap-2 px-1 font-display text-base', tone === 'muted' && 'text-muted-foreground')}>
        {title} <span className="font-num text-xs text-muted-foreground" data-testid={`text-${id}-count`}>{count}</span>
      </h3>
      {children}
    </section>
  );
}

/** Today's (or any day's) tasks and work sessions, split into remaining and done. */
export function DayAgenda({ day }: { day: string }) {
  const state = useAppState();
  const actions = useWorkSessionActions();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [showDone, setShowDone] = useState(true);
  const agenda = useMemo(() => dayAgenda(state, day), [state, day]);
  const goalById = useMemo(() => new Map(state.goals.map((g) => [g.id, g])), [state.goals]);
  const { remainingTasks, doneTasks, remainingSessions, doneSessions } = agenda;
  const hasGoals = state.goals.length > 0;
  const reserved = remainingSessions.filter((s) => s.status === 'planned').reduce((a, s) => a + s.plannedMinutes, 0);
  const logged = doneSessions.filter((s) => s.status === 'logged').reduce((a, s) => a + (s.actualMinutes ?? 0), 0);
  const remainingCount = remainingTasks.length + remainingSessions.length;
  const doneCount = doneTasks.length + doneSessions.length;
  const isPastOrToday = day <= todayIso();
  const close = () => setDialog(null);
  const planDate = day >= todayIso() ? day : undefined;
  const row = (s: WorkSession) => (
    <SessionRow key={s.id} session={s} goal={goalById.get(s.goalId)} hideDate onPlan={(x) => setDialog({ plan: x })} onLog={(x) => setDialog({ log: x })} onDelete={(x) => setDialog({ del: x })} />
  );

  return (
    <div className="min-w-0" data-testid="day-agenda">
      <dl className="mb-3 flex flex-wrap gap-x-5 gap-y-1 px-1 text-xs text-muted-foreground" data-testid="text-day-agenda-summary">
        <div className="flex gap-1.5"><dt>Tasks</dt><dd className="font-num text-foreground">{doneTasks.length} done · {remainingTasks.length} left</dd></div>
        {hasGoals && <div className="flex gap-1.5"><dt>Time</dt><dd className="font-num text-foreground">{formatMinutes(logged)} logged · {formatMinutes(reserved)} reserved</dd></div>}
      </dl>

      <QuickAdd defaults={{ plannedDate: day }} placeholder={`Add to ${relDay(day).toLowerCase()}`} testId="input-day-agenda-quick-add" />

      {hasGoals && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Work session actions">
          {isPastOrToday && day === todayIso() && (
            <Button size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => actions.start({})} data-testid="button-agenda-start-timer"><Play /> Start timer</Button>
          )}
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => setDialog({ log: true })} data-testid="button-agenda-add-time"><Plus /> Add time</Button>
          {planDate && <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => setDialog({ plan: true })} data-testid="button-agenda-plan-session"><Clock3 /> Plan session</Button>}
        </div>
      )}

      <div className="mt-4 space-y-4">
        <Group id="agenda-remaining" title="Remaining" count={remainingCount}>
          {remainingCount === 0 ? (
            <EmptyState
              className="py-5"
              title={doneCount ? 'All done for the day' : 'Nothing planned'}
              body={doneCount ? 'Every task and session here is finished.' : 'Capture above, or plan a session.'}
            />
          ) : (
            <>
              {remainingTasks.length > 0 && (
                <>
                  <SubHead label="Tasks" count={remainingTasks.length} testId="text-remaining-tasks" />
                  <div className="divide-y divide-border/60">
                    {remainingTasks.map((t) => <TaskRow key={t.id} task={t} siblings={remainingTasks} hideDate />)}
                  </div>
                </>
              )}
              {remainingSessions.length > 0 && (
                <>
                  <SubHead label="Planned sessions" count={remainingSessions.length} detail={`${formatMinutes(reserved)} reserved`} testId="text-remaining-sessions" />
                  <ul className="divide-y divide-border/60">{remainingSessions.map((s) => row(s))}</ul>
                </>
              )}
            </>
          )}
        </Group>

        {doneCount > 0 && (
          <section aria-labelledby="agenda-done" className="min-w-0 overflow-hidden rounded-lg bg-muted/40 px-1 py-1.5">
            <h3 id="agenda-done">
              <button
                type="button"
                aria-expanded={showDone}
                onClick={() => setShowDone((v) => !v)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-1 font-display text-base text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
                data-testid="button-toggle-agenda-done"
              >
                <ChevronDown className={cn('size-4 transition-transform', !showDone && '-rotate-90')} />
                Done <span className="font-num text-xs" data-testid="text-agenda-done-count">{doneCount}</span>
              </button>
            </h3>
            {showDone && (
              <div className="min-w-0 overflow-hidden break-words">
                {doneTasks.length > 0 && (
                  <>
                    <SubHead label="Completed tasks" count={doneTasks.length} testId="text-done-tasks" />
                    <div className="divide-y divide-border/60">
                      {doneTasks.map((t) => <TaskRow key={t.id} task={t} siblings={doneTasks} hideDate />)}
                    </div>
                  </>
                )}
                {doneSessions.length > 0 && (
                  <>
                    <SubHead label={doneSessions.some((x) => x.remainderSessionId) ? 'Recorded sessions' : 'Done sessions'} count={doneSessions.length} detail={`${formatMinutes(logged)} logged`} testId="text-done-sessions" />
                    <ul className="divide-y divide-border/60">{doneSessions.map((s) => row(s))}</ul>
                  </>
                )}
              </div>
            )}
          </section>
        )}
        {doneCount === 0 && (
          <section aria-labelledby="agenda-done-empty" className="px-1 py-2">
            <h3 id="agenda-done-empty" className="font-display text-base text-muted-foreground">Done <span className="font-num text-xs" data-testid="text-agenda-done-count">0</span></h3>
            <p className="mt-1 text-xs text-muted-foreground">Completed tasks and logged sessions will appear here.</p>
          </section>
        )}
      </div>

      {dialog && 'plan' in dialog && <PlanSessionDialog session={dialog.plan === true ? undefined : dialog.plan} date={planDate} onClose={close} />}
      {dialog && 'log' in dialog && <LogSessionDialog session={dialog.log === true ? undefined : dialog.log} date={day} onClose={close} />}
      {dialog && 'del' in dialog && <DeleteSessionDialog session={dialog.del} onClose={close} />}
    </div>
  );
}
