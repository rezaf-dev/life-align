import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, Check, ChevronDown, Info, Pause, PenLine, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field } from '@/components/form-dialog';
import { EmptyState, PageHeader, SampleMark } from '@/components/primitives';
import { addDaysIso, daysBetween, fmt, monthEndIso, monthStartIso, relDay, todayIso, weekStartIso } from '@/lib/dates';
import { deleteReview, saveReview, type ProposedAdjustment } from '@/lib/store/actions';
import { useStagedAction } from '@/components/time-tracker';
import { generateInsights } from '@/lib/store/insights';
import { computeSnapshot, formatValue } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';
import type { ReviewAnswers, ReviewSnapshot, Task } from '@/lib/store/types';
import { formatPeriod } from '@/components/measurement-period';
import { setNavGuard } from '@/lib/nav-guard';
import { cn } from '@/lib/utils';
import { AskButton } from '@/components/ai/ask-button';

const QUESTIONS: { key: keyof ReviewAnswers; q: string; help: string }[] = [
  { key: 'wins', q: 'What actually moved forward?', help: 'Results and finished work, not effort.' },
  { key: 'misses', q: 'What slipped, and why?', help: 'Time, energy, clarity, or the plan itself.' },
  { key: 'learned', q: 'What did the results tell you?', help: 'Compare completed tasks with the numbers you logged.' },
  { key: 'change', q: 'What will you change?', help: 'You can turn this into an approved change in Adjust.' },
  { key: 'focus', q: 'One focus for the next period', help: 'One sentence.' },
];

const MONTHLY_PHASES = ['Summary', 'Reflect', 'Adjust'];
const WEEKLY_PHASES = ['Wins', 'Misses', 'Carryover', 'Next focus', 'Monday'];

export default function ReviewsPage() {
  const search = useSearch();
  const start = new URLSearchParams(search).get('start');
  const [, navigate] = useLocation();
  if (start === 'weekly' || start === 'monthly') {
    return <ReviewFlow key={start} type={start} onExit={() => navigate('/reviews')} />;
  }
  return <ReviewHistory />;
}

function ReviewHistory() {
  const { reviews } = useAppState();
  const [openId, setOpenId] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const today = todayIso();
  const lastWeekly = reviews.find((r) => r.type === 'weekly');
  const due = !lastWeekly || daysBetween(lastWeekly.periodEnd, today) >= 6;
  return (
    <div>
      <PageHeader
        title="Reviews"
        description={due ? `A weekly review is due${lastWeekly ? `; the last one covered up to ${fmt(lastWeekly.periodEnd)}` : ''}.` : 'Up to date. Five questions, real numbers, decisions you approve.'}
        actions={
          <>
            <AskButton focus={{ screen: 'reviews' }} label="Review with Align" />
            <Button variant="outline" asChild data-testid="button-new-monthly-review"><Link href="/reviews?start=monthly">Monthly review</Link></Button>
            <Button variant={due ? 'default' : 'outline'} asChild data-testid="button-new-weekly-review"><Link href="/reviews?start=weekly">Weekly review <ArrowRight /></Link></Button>
          </>
        }
      />
      {reviews.length === 0 ? (
        <div className="surface"><EmptyState title="No reviews yet" body="Your first review takes about ten minutes and sets the rhythm." /></div>
      ) : (
        <ol className="surface divide-y divide-border overflow-hidden">
          {reviews.map((r) => {
            const open = openId === r.id;
            return (
              <li key={r.id} data-testid={`review-${r.id}`}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : r.id)}
                  aria-expanded={open}
                  aria-controls={`review-body-${r.id}`}
                  className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-display text-lg">{fmt(r.periodStart, 'MMM d')} – {fmt(r.periodEnd, 'MMM d')}</span>
                      <span className="text-xs capitalize text-muted-foreground">{r.type}</span>
                      {r.isDemo && <SampleMark />}
                    </div>
                    <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                      {r.answers.focus ? <>Focus: <span className="text-foreground">{r.answers.focus}</span></> : 'No focus written'}
                    </p>
                    <p className="mt-0.5 font-num text-xs text-muted-foreground">
                      {r.snapshot.committedDone} of {r.snapshot.committed} planned tasks completed &middot; {r.adjustments.length} {r.adjustments.length === 1 ? 'decision' : 'decisions'}
                    </p>
                  </div>
                  <ChevronDown className={cn('mt-1.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div id={`review-body-${r.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border-t border-border bg-background/40 p-4 sm:p-5">
                      <div className="grid gap-6 lg:grid-cols-12">
                        <dl className="space-y-3 lg:col-span-7">
                          {r.answers.mondayCommitment && (
                            <div>
                              <dt className="text-xs font-medium text-muted-foreground">One commitment for Monday</dt>
                              <dd className="text-[0.95rem]">{r.answers.mondayCommitment}</dd>
                            </div>
                          )}
                          {!!r.answers.carryoverTaskIds?.length && (
                            <div>
                              <dt className="text-xs font-medium text-muted-foreground">Carried over</dt>
                              <dd className="text-[0.95rem]">{r.answers.carryoverTaskIds.length} task{r.answers.carryoverTaskIds.length === 1 ? '' : 's'} moved to the next Monday</dd>
                            </div>
                          )}
                          {QUESTIONS.map((q) => (
                            <div key={q.key}>
                              <dt className="text-xs font-medium text-muted-foreground">{q.q}</dt>
                              <dd className="text-[0.95rem]">{r.answers[q.key] || <span className="text-muted-foreground">No answer</span>}</dd>
                            </div>
                          ))}
                        </dl>
                        <div className="space-y-5 lg:col-span-5">
                          <div>
                            <div className="mb-1.5 text-sm font-medium">Decisions applied</div>
                            {r.adjustments.length === 0 ? <p className="text-sm text-muted-foreground">None. Plan kept as is.</p> : (
                              <ul className="space-y-1.5 text-sm">{r.adjustments.map((a, i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-primary" />{a.summary}</li>)}</ul>
                            )}
                          </div>
                          <SnapshotView snap={r.snapshot} />
                          <p className="text-xs text-muted-foreground">Saved {fmt(r.createdAt.slice(0, 10), 'MMM d, yyyy')}. Numbers frozen at save time.</p>
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setDel(r.id)} data-testid={`button-delete-review-${r.id}`}><Trash2 /> Delete review</Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ol>
      )}
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title="Delete this review?"
        description="The answers and snapshot are removed. Changes it applied to goals stay in each goal’s history."
        confirmLabel="Delete review"
        destructive
        onConfirm={() => { if (del) deleteReview(del); setDel(null); }}
      />
    </div>
  );
}

/** Metrics grouped by goal so long titles never truncate; activity measures behind a disclosure. */
function MetricList({ list }: { list: ReviewSnapshot['metrics'] }) {
  const byGoal = new Map<string, ReviewSnapshot['metrics']>();
  list.forEach((m) => byGoal.set(m.goalTitle, [...(byGoal.get(m.goalTitle) ?? []), m]));
  return (
    <div className="space-y-2.5">
      {[...byGoal.entries()].map(([title, ms]) => (
        <div key={title}>
          <div className="text-xs text-muted-foreground">{title}</div>
          <ul>
            {ms.map((m) => (
              <li key={m.metricId} className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
                <span className="min-w-0">{m.name}{m.frequency && m.frequency !== 'cumulative' && m.periodStart && m.periodEnd && <span className="text-xs text-muted-foreground"> &middot; {formatPeriod({ start: m.periodStart, end: m.periodEnd }, m.frequency)}</span>}{m.frequency && m.frequency !== 'cumulative' && !m.periodStart && <span className="text-xs text-muted-foreground"> &middot; {m.frequency}</span>}</span>
                <span className="shrink-0 font-num">{formatValue(m.value, m.unit)} <span className="text-muted-foreground">/ {formatValue(m.target, m.unit)}</span></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SnapshotView({ snap, compact }: { snap: ReviewSnapshot; compact?: boolean }) {
  const rate = snap.committed ? Math.round((snap.committedDone / snap.committed) * 100) : 0;
  const outcomes = snap.metrics.filter((m) => m.kind === 'outcome');
  const leading = snap.metrics.filter((m) => m.kind === 'leading');
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 text-sm font-medium">Tasks <span className="font-normal text-muted-foreground">&middot; what you did</span></div>
        <div className={cn('grid gap-px overflow-hidden rounded-lg border border-border bg-border', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}>
          {[
            ['Planned', snap.committed],
            ['Completed', snap.committedDone],
            ['Done, unplanned', snap.extraDone],
            ['Overdue', snap.overdue],
          ].map(([l, v]) => (
            <div key={l} className="bg-card px-3 py-2">
              <div className="font-num text-lg leading-tight">{v}</div>
              <div className="text-xs text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
        {!compact && snap.committed > 0 && <p className="mt-1.5 text-xs text-muted-foreground">{rate}% of planned tasks completed.</p>}
      </div>
      <div>
        <div className="mb-1.5 text-sm font-medium">Results <span className="font-normal text-muted-foreground">&middot; numbers you logged</span></div>
        {outcomes.length ? <MetricList list={outcomes} /> : <p className="text-sm text-muted-foreground">No result measures.</p>}
      </div>
      {leading.length > 0 && (
        <details className="text-sm">
          <summary className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronDown className="size-3.5" /> Activity measures ({leading.length})
          </summary>
          <div className="mt-2"><MetricList list={leading} /></div>
        </details>
      )}
    </div>
  );
}

type Draft = ProposedAdjustment & { key: string; approved: boolean; unapproved?: boolean };

function ReviewFlow({ type, onExit }: { type: 'weekly' | 'monthly'; onExit: () => void }) {
  const state = useAppState();
  const action = useStagedAction();
  const PHASES = type === 'weekly' ? WEEKLY_PHASES : MONTHLY_PHASES;
  const { toast } = useToast();
  const today = todayIso();
  const thisWs = weekStartIso(today);
  const periods =
    type === 'weekly'
      ? [
          { label: 'This week', start: thisWs, end: addDaysIso(thisWs, 6) },
          { label: 'Last week', start: addDaysIso(thisWs, -7), end: addDaysIso(thisWs, -1) },
        ]
      : [
          { label: 'This month', start: monthStartIso(today), end: monthEndIso(today) },
          { label: 'Last month', start: monthStartIso(addDaysIso(monthStartIso(today), -1)), end: addDaysIso(monthStartIso(today), -1) },
        ];
  const [periodIdx, setPeriodIdx] = useState(0);
  const period = periods[periodIdx];
  const snapshot = useMemo(() => computeSnapshot(state, type, period.start, period.end), [state, type, period.start, period.end]);
  const insights = useMemo(() => generateInsights(state).slice(0, 4), [state]);
  const [phase, setPhase] = useState(0);
  const [answers, setAnswers] = useState<ReviewAnswers>({ wins: '', misses: '', learned: '', change: '', focus: '' });
  const [carry, setCarry] = useState<string[]>([]);
  const [monday, setMonday] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [applyFocus, setApplyFocus] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const activeGoals = state.goals.filter((g) => g.status === 'active');

  const dirty =
    Object.values(answers).some((v) => (typeof v === 'string' ? !!v.trim() : Array.isArray(v) && v.length > 0)) ||
    drafts.length > 0 || carry.length > 0 || !!monday.trim();

  // Guard: browser refresh / close, and in-app navigation through the shell.
  useEffect(() => {
    if (!dirty) {
      setNavGuard(null);
      return;
    }
    setNavGuard('Your review answers and proposed changes have not been saved and will be lost.');
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);
  useEffect(() => () => setNavGuard(null), []);

  const requestExit = () => (dirty ? setConfirmExit(true) : onExit());

  const addDraft = (kind: ProposedAdjustment['kind']) => {
    const g = kind === 'milestone' ? activeGoals.find((x) => x.milestones.some((m) => !m.done)) : activeGoals[0];
    if (!g) return;
    const key = Math.random().toString(36).slice(2);
    const base =
      kind === 'strategy'
        ? { kind, goalId: g.id, summary: g.strategy.summary, rationale: g.strategy.rationale, reason: answers.learned || '' }
        : kind === 'milestone'
          ? { kind, goalId: g.id, milestoneId: g.milestones.find((m) => !m.done)?.id ?? '', date: addDaysIso(today, 14), reason: answers.misses || '' }
          : { kind, goalId: g.id, reason: answers.change || '' };
    setDrafts((d) => [...d, { ...(base as ProposedAdjustment), key, approved: false }]);
  };
  /** Any edit to an approved change removes the approval visibly. */
  const patch = (key: string, p: Partial<Draft>) =>
    setDrafts((d) => d.map((x) => (x.key === key ? ({ ...x, ...p, approved: false, unapproved: x.approved || x.unapproved } as Draft) : x)));
  const setApproved = (key: string, v: boolean) => setDrafts((d) => d.map((x) => (x.key === key ? { ...x, approved: v, unapproved: false } : x)));
  const valid = (d: Draft) =>
    !!d.reason.trim() &&
    activeGoals.some((g) => g.id === d.goalId) &&
    (d.kind === 'strategy' ? !!d.summary.trim() : d.kind === 'milestone' ? !!d.milestoneId && !!d.date : true);
  const approved = drafts.filter((d) => d.approved);
  const invalidApproved = approved.filter((d) => !valid(d));
  const nextFocusWeek = 'next';
  // A late review must never move carryover back to an already missed Monday.
  const nextWs = addDaysIso(thisWs, 7);
  const carryCandidates = useMemo(
    () => state.tasks
      .filter((t) => !t.archived && t.status !== 'done' && !!(t.plannedDate ?? t.dueDate) && (t.plannedDate ?? t.dueDate)! <= period.end && (t.plannedDate ?? '') < nextWs)
      .sort((a, b) => (a.plannedDate ?? a.dueDate ?? '').localeCompare(b.plannedDate ?? b.dueDate ?? '')),
    [state.tasks, period.end, nextWs],
  );
  const carryTasks = carryCandidates.filter((t) => carry.includes(t.id));
  const willApplyFocus = type === 'weekly' && applyFocus && !!answers.focus.trim();

  const save = () => {
    if (invalidApproved.length) return;
    const finalAnswers: ReviewAnswers = type === 'weekly'
      ? { ...answers, carryoverTaskIds: carryTasks.map((t) => t.id), mondayCommitment: monday.trim() }
      : answers;
    const n = approved.length;
    void action.run(
      () => {
        saveReview(
          { type, periodStart: period.start, periodEnd: period.end, answers: finalAnswers, snapshot },
          approved.map(({ key: _k, approved: _a, unapproved: _u, ...rest }) => rest as ProposedAdjustment),
          type === 'weekly' ? { applyFocus: willApplyFocus, nextWeekStart: nextWs } : undefined,
        );
      },
      () => {
        setNavGuard(null);
        toast({ title: 'Review saved', description: n ? `${n} change${n > 1 ? 's' : ''} applied with history.` : 'No plan changes applied.' });
        onExit();
      },
    );
  };

  const adjustUI = (
            <div className="max-w-3xl">
              {type === 'monthly' ? <h1 className="font-display text-2xl">Adjust the plan</h1> : <h2 className="font-display text-xl">Adjust a goal (optional)</h2>}
              <p className="mb-4 text-sm text-muted-foreground">Only changes you approve are applied, each recorded in the goal’s history with your reason. Keeping the plan is a valid decision.</p>
              {answers.change && <blockquote className="mb-4 border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">You wrote: “{answers.change}”</blockquote>}
              <div className="mb-4 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => addDraft('strategy')} disabled={!activeGoals.length} data-testid="button-propose-strategy"><PenLine /> Edit a strategy</Button>
                <Button variant="outline" size="sm" onClick={() => addDraft('milestone')} disabled={!activeGoals.some((g) => g.milestones.some((m) => !m.done))} data-testid="button-propose-milestone"><CalendarClock /> Reschedule a milestone</Button>
                <Button variant="outline" size="sm" onClick={() => addDraft('pause')} disabled={!activeGoals.length} data-testid="button-propose-pause"><Pause /> Pause a goal</Button>
              </div>
              {drafts.length === 0 ? (
                <div className="surface"><EmptyState className="py-6" title="No changes proposed" body="Add one above, or save to keep the plan as it is." /></div>
              ) : (
                <ul className="space-y-3">
                  {drafts.map((d) => {
                    const g = state.goals.find((x) => x.id === d.goalId);
                    const ok = valid(d);
                    return (
                      <li key={d.key} className={cn('surface p-4 transition-colors', d.approved && 'border-primary/50', d.approved && !ok && 'border-destructive')} data-testid={`draft-${d.kind}`}>
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-sm font-medium">{d.kind === 'strategy' ? 'Strategy edit' : d.kind === 'milestone' ? 'Milestone reschedule' : 'Pause goal'}</span>
                          <Button variant="ghost" size="icon" className="size-9" aria-label="Remove proposal" onClick={() => setDrafts((x) => x.filter((y) => y.key !== d.key))}><X /></Button>
                        </div>
                        <div className="space-y-3">
                          <Field label="Goal">
                            <Select value={d.goalId} onValueChange={(v) => {
                              const ng = state.goals.find((x) => x.id === v);
                              if (d.kind === 'strategy') patch(d.key, { goalId: v, summary: ng?.strategy.summary ?? '', rationale: ng?.strategy.rationale ?? '' } as Partial<Draft>);
                              else if (d.kind === 'milestone') patch(d.key, { goalId: v, milestoneId: ng?.milestones.find((m) => !m.done)?.id ?? '' } as Partial<Draft>);
                              else patch(d.key, { goalId: v });
                            }}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>{activeGoals.filter((x) => d.kind !== 'milestone' || x.milestones.some((m) => !m.done)).map((x) => <SelectItem key={x.id} value={x.id}>{x.title}</SelectItem>)}</SelectContent>
                            </Select>
                          </Field>
                          {d.kind === 'strategy' && (
                            <>
                              <Field label="New approach"><Textarea rows={3} value={d.summary} onChange={(e) => patch(d.key, { summary: e.target.value } as Partial<Draft>)} data-testid="input-draft-strategy" /></Field>
                              <Field label="Rationale"><Input value={d.rationale} onChange={(e) => patch(d.key, { rationale: e.target.value } as Partial<Draft>)} /></Field>
                            </>
                          )}
                          {d.kind === 'milestone' && (
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label="Milestone">
                                <Select value={d.milestoneId} onValueChange={(v) => patch(d.key, { milestoneId: v } as Partial<Draft>)}>
                                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                                  <SelectContent>{g?.milestones.filter((m) => !m.done).map((m) => <SelectItem key={m.id} value={m.id}>{m.title} ({fmt(m.dueDate)})</SelectItem>)}</SelectContent>
                                </Select>
                              </Field>
                              <Field label="New date"><Input type="date" value={d.date} onChange={(e) => patch(d.key, { date: e.target.value } as Partial<Draft>)} data-testid="input-draft-date" /></Field>
                            </div>
                          )}
                          <Field label="Reason (required)"><Input value={d.reason} onChange={(e) => patch(d.key, { reason: e.target.value })} data-testid="input-draft-reason" /></Field>
                          {d.unapproved && !d.approved && (
                            <p className="text-xs text-warning" role="status">You edited this change, so its approval was removed. Approve it again to apply it.</p>
                          )}
                          {d.approved && !ok && (
                            <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert"><AlertTriangle className="size-3.5" /> This approved change is incomplete. Fix it or remove the approval.</p>
                          )}
                          <label className={cn('flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-sm', d.approved ? 'border-primary/50 bg-accent/50' : 'border-border', !ok && !d.approved && 'opacity-60')}>
                            <Checkbox checked={d.approved} disabled={!ok && !d.approved} onCheckedChange={(v) => setApproved(d.key, !!v)} data-testid={`checkbox-approve-${d.kind}`} />
                            <span>Approve: apply this change when I save{!ok && !d.approved && ' (complete the fields first)'}</span>
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-4 text-sm text-muted-foreground" data-testid="text-approved-count">{approved.length} of {drafts.length} changes approved.</p>
            </div>
  );

  const periodText = `${period.label}, ${fmt(period.start, 'MMM d')} – ${fmt(period.end, 'MMM d')}`;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm capitalize text-muted-foreground">{type} review</div>
          <div className="font-display text-xl" data-testid="text-review-period">{periodText}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={requestExit} disabled={action.frozen} data-testid="button-exit-review"><X /> Exit</Button>
      </div>

      <ol className={cn('mb-6 grid gap-1.5', type === 'weekly' ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-3')} aria-label="Review phases">
        {PHASES.map((p, i) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => !action.frozen && setPhase(i)}
              aria-current={phase === i ? 'step' : undefined}
              className={cn(
                'flex min-h-10 w-full items-center gap-2 border-t-2 pt-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                i <= phase ? 'border-primary text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
              )}
              data-testid={`button-phase-${p.toLowerCase().replace(' ', '-')}`}
            >
              <span className="font-num text-xs">{i + 1}</span> {p}
            </button>
          </li>
        ))}
      </ol>

      <fieldset disabled={action.frozen} className="min-w-0">
      <AnimatePresence mode="wait">
        <motion.div key={phase} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {type === 'weekly' && (
            <WeeklyStep
              step={phase}
              periods={periods}
              periodIdx={periodIdx}
              setPeriodIdx={setPeriodIdx}
              snapshot={snapshot}
              insights={insights}
              answers={answers}
              setAnswers={setAnswers}
              carryCandidates={carryCandidates}
              carry={carry}
              setCarry={setCarry}
              nextWs={nextWs}
              monday={monday}
              setMonday={setMonday}
              applyFocus={applyFocus}
              setApplyFocus={setApplyFocus}
              nextFocusWeek={nextFocusWeek}
              periodText={periodText}
              adjust={adjustUI}
              approved={approved}
              carryTasks={carryTasks}
              willApplyFocus={willApplyFocus}
            />
          )}
          {type === 'monthly' && phase === 0 && (
            <div className="grid gap-5 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h1 className="font-display text-2xl">What happened</h1>
                  <div className="inline-flex rounded-lg border border-border p-1" role="group" aria-label="Review period">
                    {periods.map((p, i) => (
                      <button key={p.label} type="button" onClick={() => setPeriodIdx(i)} aria-pressed={periodIdx === i} className={cn('min-h-8 rounded-md px-3 text-sm', periodIdx === i ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')} data-testid={`button-period-${i}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="surface p-4"><SnapshotView snap={snapshot} /></div>
              </div>
              <div className="lg:col-span-5">
                <h2 className="mb-2 text-sm font-medium">What needs a decision</h2>
                {insights.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing stands out.</p>
                ) : (
                  <ul className="space-y-2.5 text-sm">
                    {insights.map((i) => (
                      <li key={i.id} className="flex gap-2">
                        <span className="min-w-0"><span className="font-medium">{i.title}.</span> <span className="text-muted-foreground">{i.detail}</span></span>
                        <span className="ml-auto shrink-0 text-muted-foreground" title={`Rule: ${i.rule}`} aria-label={`Rule: ${i.rule}`}><Info className="size-3.5" /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {type === 'monthly' && phase === 1 && (
            <div className="grid gap-5 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-8">
                <div>
                  <h1 className="font-display text-2xl">Reflect</h1>
                  <p className="text-sm text-muted-foreground">Short answers are fine. Every question is optional.</p>
                </div>
                {QUESTIONS.map((q, i) => (
                  <div key={q.key}>
                    <label htmlFor={`q-${q.key}`} className="block text-[0.95rem] font-medium">
                      <span className="mr-1.5 font-num text-xs text-primary">{i + 1}</span>{q.q}
                    </label>
                    <p className="mb-1.5 text-xs text-muted-foreground">{q.help}</p>
                    {q.key === 'focus' ? (
                      <Input id={`q-${q.key}`} value={answers[q.key]} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} className="h-10" data-testid={`input-review-${q.key}`} />
                    ) : (
                      <Textarea id={`q-${q.key}`} autoFocus={i === 0} rows={2} value={answers[q.key]} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} className="min-h-[3.5rem] text-[0.95rem]" data-testid={`input-review-${q.key}`} />
                    )}
                  </div>
                ))}
              </div>
              <aside className="lg:col-span-4" aria-label="Actuals for reference">
                <div className="surface p-4 lg:sticky lg:top-6">
                  <div className="mb-2 text-xs text-muted-foreground">For reference &middot; {periodText}</div>
                  <SnapshotView snap={snapshot} compact />
                </div>
              </aside>
            </div>
          )}

          {type === 'monthly' && phase === 2 && adjustUI}
        </motion.div>
      </AnimatePresence>
      </fieldset>

      <div className="sticky bottom-0 z-20 -mx-4 mt-8 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-0 md:rounded-t-xl md:px-3">
        <Button variant="ghost" className="h-10" disabled={action.frozen} onClick={() => (phase === 0 ? requestExit() : setPhase((s) => s - 1))} data-testid="button-review-back">
          <ArrowLeft /> {phase === 0 ? 'Cancel' : 'Back'}
        </Button>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {invalidApproved.length > 0 ? <span className="text-warning">Fix {invalidApproved.length} approved change{invalidApproved.length > 1 ? 's' : ''} to save</span> : `Step ${phase + 1} of ${PHASES.length} · ${PHASES[phase]}`}
        </span>
        {phase < PHASES.length - 1 ? (
          <Button className="h-10" onClick={() => setPhase((s) => s + 1)} data-testid="button-review-next">Continue to {PHASES[phase + 1]} <ArrowRight /></Button>
        ) : (
          <Button className="h-10" onClick={save} disabled={invalidApproved.length > 0 || action.pending} data-testid="button-save-review"><Check /> {action.pending ? 'Saving' : action.error ? 'Retry save' : 'Save review'}</Button>
        )}
      </div>
      {action.error && <p role="alert" className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-center text-sm text-warning" data-testid="text-review-save-error">{action.error} Your answers are still here. Try saving again.</p>}
      <p className="mt-3 text-center text-xs text-muted-foreground">Answers are kept while you move between steps, but not saved until you save the review. Last saved review: {state.reviews[0] ? relDay(state.reviews[0].createdAt.slice(0, 10)).toLowerCase() : 'none'}.</p>

      <ConfirmDialog
        open={confirmExit}
        onOpenChange={setConfirmExit}
        title="Discard this review?"
        description="Your answers and proposed changes have not been saved and will be lost."
        confirmLabel="Discard review"
        destructive
        onConfirm={() => { setNavGuard(null); onExit(); }}
      />
    </div>
  );
}

type WeeklyStepProps = {
  step: number;
  periods: { label: string; start: string; end: string }[];
  periodIdx: number;
  setPeriodIdx: (i: number) => void;
  snapshot: ReviewSnapshot;
  insights: ReturnType<typeof generateInsights>;
  answers: ReviewAnswers;
  setAnswers: React.Dispatch<React.SetStateAction<ReviewAnswers>>;
  carryCandidates: Task[];
  carry: string[];
  setCarry: React.Dispatch<React.SetStateAction<string[]>>;
  nextWs: string;
  monday: string;
  setMonday: (v: string) => void;
  applyFocus: boolean;
  setApplyFocus: (v: boolean) => void;
  nextFocusWeek: string;
  periodText: string;
  adjust: React.ReactNode;
  approved: ProposedAdjustment[];
  carryTasks: Task[];
  willApplyFocus: boolean;
};

function StepHead({ title, help }: { title: string; help: string }) {
  return (
    <div className="mb-4">
      <h1 className="font-display text-2xl">{title}</h1>
      <p className="text-sm text-muted-foreground">{help}</p>
    </div>
  );
}

function Supplement({ id, label, help, value, onChange }: { id: string; label: string; help: string; value: string; onChange: (v: string) => void }) {
  return (
    <details className="mt-4 rounded-lg border border-border px-3 py-2" open={!!value}>
      <summary className="flex min-h-9 cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronDown className="size-3.5" /> {label} <span className="text-xs">(optional)</span>
      </summary>
      <p className="mb-1.5 mt-1 text-xs text-muted-foreground">{help}</p>
      <Textarea id={id} rows={2} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-[3.5rem]" data-testid={`input-review-${id}`} />
    </details>
  );
}

/** Guided weekly review: Wins, Misses, Carryover, Next focus, Monday, then a summary to confirm. Nothing changes until Save. */
function WeeklyStep(p: WeeklyStepProps) {
  const set = (k: 'wins' | 'misses' | 'learned' | 'change' | 'focus', v: string) => p.setAnswers((a) => ({ ...a, [k]: v }));
  const aside = (
    <aside className="lg:col-span-5" aria-label="Actuals for reference">
      <div className="surface p-4 lg:sticky lg:top-6">
        <div className="mb-2 text-xs text-muted-foreground">For reference &middot; {p.periodText}</div>
        <SnapshotView snap={p.snapshot} compact />
      </div>
    </aside>
  );
  if (p.step === 0)
    return (
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <StepHead title="Wins" help="What actually moved forward? Results and finished work count, effort is fine too." />
            <div className="inline-flex rounded-lg border border-border p-1" role="group" aria-label="Review period">
              {p.periods.map((x, i) => (
                <button key={x.label} type="button" onClick={() => p.setPeriodIdx(i)} aria-pressed={p.periodIdx === i} className={cn('min-h-8 rounded-md px-3 text-sm', p.periodIdx === i ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')} data-testid={`button-period-${i}`}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          <Textarea id="q-wins" autoFocus rows={4} value={p.answers.wins} onChange={(e) => set('wins', e.target.value)} placeholder="A client sign-off, a shipped feature, a good run..." data-testid="input-review-wins" />
        </div>
        {aside}
      </div>
    );
  if (p.step === 1)
    return (
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <StepHead title="Misses" help="What slipped, and why? Time, energy, clarity, or the plan itself. No judgement here." />
          <Textarea id="q-misses" autoFocus rows={4} value={p.answers.misses} onChange={(e) => set('misses', e.target.value)} data-testid="input-review-misses" />
          <Supplement id="learned" label="What did the results tell you?" help="Compare completed tasks with the numbers you logged." value={p.answers.learned} onChange={(v) => set('learned', v)} />
        </div>
        <div className="lg:col-span-5">
          <h2 className="mb-2 text-sm font-medium">What needs a decision</h2>
          {p.insights.length === 0 ? <p className="text-sm text-muted-foreground">Nothing stands out.</p> : (
            <ul className="space-y-2.5 text-sm">
              {p.insights.map((i) => (
                <li key={i.id} className="flex gap-2">
                  <span className="min-w-0"><span className="font-medium">{i.title}.</span> <span className="text-muted-foreground">{i.detail}</span></span>
                  <span className="ml-auto shrink-0 text-muted-foreground" title={`Rule: ${i.rule}`} aria-label={`Rule: ${i.rule}`}><Info className="size-3.5" /></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  if (p.step === 2) {
    const all = p.carryCandidates.length > 0 && p.carry.length === p.carryCandidates.length;
    return (
      <div className="max-w-3xl">
        <StepHead title="Carryover tasks" help={`Pick the open tasks worth carrying into Monday, ${fmt(p.nextWs, 'MMM d')}. They move only when you save the review.`} />
        {p.carryCandidates.length === 0 ? (
          <div className="surface"><EmptyState className="py-6" title="Nothing left open" body="Every planned task from this period is done or already moved." /></div>
        ) : (
          <>
            <button type="button" className="mb-2 min-h-8 text-sm text-primary hover:underline" onClick={() => p.setCarry(all ? [] : p.carryCandidates.map((t) => t.id))} data-testid="button-carry-all">
              {all ? 'Clear selection' : 'Select all'}
            </button>
            <ul className="surface divide-y divide-border overflow-hidden">
              {p.carryCandidates.map((t) => {
                const on = p.carry.includes(t.id);
                return (
                  <li key={t.id}>
                    <label className={cn('flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5', on && 'bg-accent/40')} data-testid={`row-carry-${t.id}`}>
                      <Checkbox checked={on} onCheckedChange={(v) => p.setCarry((c) => (v ? [...c, t.id] : c.filter((x) => x !== t.id)))} data-testid={`checkbox-carry-${t.id}`} />
                      <span className="min-w-0 flex-1 break-words text-sm">{t.title}</span>
                      <span className="shrink-0 font-num text-xs text-muted-foreground">{fmt((t.plannedDate ?? t.dueDate)!, 'MMM d')}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground" data-testid="text-carry-count">{p.carry.length} of {p.carryCandidates.length} selected. Unselected tasks stay where they are.</p>
          </>
        )}
      </div>
    );
  }
  if (p.step === 3)
    return (
      <div className="max-w-3xl">
        <StepHead title="Next week's focus" help="One sentence that tells future you what matters most." />
        <Input id="q-focus" autoFocus value={p.answers.focus} onChange={(e) => set('focus', e.target.value)} className="h-11 text-base" data-testid="input-review-focus" />
        {p.answers.focus.trim() && (
          <label className="mt-3 flex min-h-11 items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm">
            <Checkbox checked={p.applyFocus} onCheckedChange={(v) => p.setApplyFocus(!!v)} data-testid="checkbox-apply-focus" />
            <span>Also set it as the focus for {p.nextFocusWeek} week when I save</span>
          </label>
        )}
        <Supplement id="change" label="What will you change?" help="A note to yourself. Approve an actual goal change below if needed." value={p.answers.change} onChange={(v) => set('change', v)} />
        <div className="mt-6">{p.adjust}</div>
      </div>
    );
  const monday = (
      <div className="max-w-3xl">
        <StepHead title="One commitment for Monday" help="The first thing you will do on Monday morning. Small and concrete beats ambitious." />
        <Input id="q-monday" autoFocus value={p.monday} onChange={(e) => p.setMonday(e.target.value)} placeholder="Send the revised proposal before 10:00" className="h-11 text-base" data-testid="input-review-monday" />
        <p className="mt-2 text-xs text-muted-foreground">Saved with the review. It does not create a task.</p>
      </div>
  );
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-[0.95rem]">{value}</dd>
    </div>
  );
  const none = <span className="text-muted-foreground">Nothing written</span>;
  return (
    <div className="max-w-3xl space-y-8">
      {monday}
      <div>
      <StepHead title="Check and save" help="Nothing has changed yet. Saving records this review and applies only what is listed here." />
      <dl className="surface divide-y divide-border px-4" data-testid="list-review-summary">
        {row('Wins', p.answers.wins || none)}
        {row('Misses', p.answers.misses || none)}
        {p.answers.learned && row('Results told me', p.answers.learned)}
        {row('Carryover', p.carryTasks.length ? (
          <>Move {p.carryTasks.length} task{p.carryTasks.length === 1 ? '' : 's'} to {fmt(p.nextWs, 'EEEE, MMM d')}:<ul className="mt-1 list-disc pl-5 text-sm">{p.carryTasks.map((t) => <li key={t.id}>{t.title}</li>)}</ul></>
        ) : <span className="text-muted-foreground">No tasks moved</span>)}
        {row("Next week's focus", p.answers.focus ? <>{p.answers.focus}<div className="text-xs text-muted-foreground">{p.willApplyFocus ? `Will be set as the focus for ${p.nextFocusWeek} week` : 'Saved with the review only'}</div></> : none)}
        {p.answers.change && row('What will change', p.answers.change)}
        {row('Goal changes', p.approved.length ? <ul className="space-y-1 text-sm">{p.approved.map((a, i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-primary" />{a.kind === 'strategy' ? 'Revise strategy' : a.kind === 'milestone' ? `Move milestone to ${fmt(a.date)}` : 'Pause goal'}: {a.reason}</li>)}</ul> : <span className="text-muted-foreground">None. Plan kept as is.</span>)}
        {row('Monday commitment', p.monday || none)}
      </dl>
      </div>
    </div>
  );
}
