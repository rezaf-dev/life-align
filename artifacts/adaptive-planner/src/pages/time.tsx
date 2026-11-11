import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildTimeReport } from '@/lib/time-report';
import { formatMinutes, validateReportRange } from '@/lib/reports';
import { addDaysIso, fmt, monthEndIso, monthStartIso, relDay, todayIso, weekStartIso } from '@/lib/dates';
import { formatValue } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';
import type { WorkSession } from '@/lib/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AreaDot, EmptyState, PageHeader } from '@/components/primitives';
import { DeleteSessionDialog, GENERAL_LABEL, LogSessionDialog } from '@/components/work-sessions';
import { useWorkSessionActions } from '@/components/work-session-provider';
import { cn } from '@/lib/utils';
import { sessionWorkDone } from '@workspace/api-zod';
import { WorkDonePreview } from '@/components/work-done-editor';

type RangeKey = 'today' | 'week' | 'month' | 'custom';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'custom', label: 'Custom' },
];
const m = formatMinutes;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const clock = (stamp: string, timezone: string) => new Intl.DateTimeFormat('en', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(stamp));

export default function TimePage() {
  const state = useAppState();
  const actions = useWorkSessionActions();
  const today = todayIso();
  const [range, setRange] = useState<RangeKey>('week');
  const [cStart, setCStart] = useState(addDaysIso(today, -13));
  const [cEnd, setCEnd] = useState(today);
  const [dialog, setDialog] = useState<null | { log: WorkSession | true } | { del: WorkSession }>(null);
  const [showTable, setShowTable] = useState(false);

  const [start, end] = range === 'today' ? [today, today] : range === 'week' ? [weekStartIso(today), today]
    : range === 'month' ? [monthStartIso(today), monthEndIso(today) < today ? monthEndIso(today) : today] : [cStart, cEnd];
  const rangeErr = range === 'custom' ? validateReportRange(cStart, cEnd) : null;
  const r = useMemo(() => (rangeErr ? null : buildTimeReport(state, start, end, today)), [state, start, end, today, rangeErr]);
  const goalById = new Map(state.goals.map((g) => [g.id, g]));
  const chartData = (r?.daily ?? []).map((d) => ({ ...d, label: fmt(d.date, r && r.daily.length > 14 ? 'MMM d' : 'EEE d'), hours: d.minutes / 60 }));
  const dayMax = Math.max(1, ...(r?.dayParts ?? []).map((d) => d.minutes), r?.unknownTimeMinutes ?? 0);
  const goalMax = Math.max(1, ...(r?.goals ?? []).map((g) => g.minutes));

  return (
    <div>
      <PageHeader title="Time & performance"
        description="What you spent time on, next to what came of it. Tracking is optional, and nothing here scores you."
        actions={<>
          <Button onClick={() => actions.start({ goalId: '' })} data-testid="button-time-start"><Play /> Start timer</Button>
          <Button variant="secondary" onClick={() => setDialog({ log: true })} data-testid="button-time-add"><Plus /> Add time</Button>
        </>} />

      <div className="rise mb-5 flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-sm" role="tablist" aria-label="Date range">
          {RANGES.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={range === x.key} onClick={() => setRange(x.key)}
              className={cn('rounded-md px-3 py-1.5 transition-colors', range === x.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')} data-testid={`tab-range-${x.key}`}>{x.label}</button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" aria-label="From" value={cStart} max={cEnd} onChange={(e) => setCStart(e.target.value)} className="h-9 w-40 font-num" data-testid="input-range-start" />
            <span className="text-muted-foreground">to</span>
            <Input type="date" aria-label="To" value={cEnd} min={cStart} onChange={(e) => setCEnd(e.target.value)} className="h-9 w-40 font-num" data-testid="input-range-end" />
          </div>
        )}
        <span className="pb-1.5 font-num text-xs text-muted-foreground" data-testid="text-range-label">{rangeErr ? 'Choose a valid date range' : start === end ? fmt(start, 'EEE MMM d') : `${fmt(start, 'MMM d')} – ${fmt(end, 'MMM d, yyyy')}`}</span>
      </div>

      {rangeErr || !r ? (
        <div className="surface p-5 text-sm text-destructive" role="alert" data-testid="text-range-error">{rangeErr ?? 'This range could not be read.'}</div>
      ) : (
        <div className="space-y-5">
          {/* Headline figures */}
          <section className="surface rise grid grid-cols-2 gap-px overflow-hidden p-0 md:grid-cols-4" aria-label="Totals">
            {[
              { k: 'total', label: 'In this range', v: m(r.totalMinutes), sub: `${r.activeDays} active day${r.activeDays === 1 ? '' : 's'}` },
              { k: 'avg', label: 'Daily average', v: m(r.averageDailyMinutes), sub: 'per elapsed calendar day' },
              { k: 'week', label: 'This week', v: m(r.weekMinutes), sub: `Today: ${m(r.todayMinutes)}` },
              { k: 'all', label: 'All time', v: m(r.allTimeMinutes), sub: 'every logged entry' },
            ].map((x) => (
              <div key={x.k} className="bg-card px-4 py-4 sm:px-5">
                <div className="text-xs text-muted-foreground">{x.label}</div>
                <div className="mt-1 break-words font-num text-xl tabular-nums leading-tight md:text-[1.7rem]" data-testid={`text-time-${x.k}`}>{x.v}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{x.sub}</div>
              </div>
            ))}
          </section>
          <p className="text-xs text-muted-foreground">Totals use logged work, not task estimates or separately entered goal-measure values. Allocations and measure credits never add the same time twice.</p>

          {r.totalMinutes === 0 && r.entries.length === 0 && r.goals.length === 0 ? (
            <div className="surface rise">
              <EmptyState title="No time recorded in this range"
                body="Start a timer or add time you already spent. General work is fine, it does not need a goal."
                action={<div className="flex flex-wrap justify-center gap-2"><Button size="sm" onClick={() => actions.start({ goalId: '' })} data-testid="button-empty-start"><Play /> Start timer</Button><Button size="sm" variant="secondary" onClick={() => setDialog({ log: true })} data-testid="button-empty-add"><Plus /> Add time</Button></div>} />
            </div>
          ) : (
            <>
              <div className="grid min-w-0 gap-5 lg:grid-cols-12">
                {/* Daily totals */}
                <section className="surface rise min-w-0 p-4 sm:p-5 lg:col-span-8" aria-labelledby="daily-h">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="daily-h" className="font-display text-xl">Daily totals</h2>
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} data-testid="button-toggle-daily-table">{showTable ? 'Show chart' : 'Show as table'}</button>
                  </div>
                  {showTable || chartData.length <= 1 ? (
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-sm" data-testid="table-daily">
                        <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-normal">Day</th><th className="py-1 text-right font-normal">Actual</th><th className="py-1 text-right font-normal">From plans</th></tr></thead>
                        <tbody>
                          {r.daily.map((d) => (
                            <tr key={d.date} className="border-t border-border/60"><td className="py-1.5">{relDay(d.date)}</td><td className="py-1.5 text-right font-num">{m(d.minutes)}</td><td className="py-1.5 text-right font-num text-muted-foreground">{m(d.plannedMinutes)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="h-60" role="img" aria-label={`Daily logged time, ${r.daily.map((d) => `${fmt(d.date, 'MMM d')}: ${m(d.minutes)}`).join('; ')}`} data-testid="chart-daily">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="2 4" />
                          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" />
                          <YAxis tickLine={false} axisLine={false} allowDecimals tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} unit="h" />
                          <Tooltip cursor={{ fill: 'hsl(var(--muted) / 0.6)' }} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                            formatter={(_v, _n, p) => [m((p?.payload as { minutes: number }).minutes), 'Logged']} />
                          <Bar dataKey="hours" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} maxBarSize={36} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </section>

                {/* Planned vs unplanned */}
                <section className="surface rise min-w-0 p-4 sm:p-5 lg:col-span-4" aria-labelledby="plan-h">
                  <h2 id="plan-h" className="mb-3 font-display text-xl">Planned or not</h2>
                  <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full bg-primary" style={{ width: `${pct(r.plannedLoggedMinutes, r.totalMinutes)}%` }} />
                    <div className="h-full bg-primary/35" style={{ width: `${pct(r.unplannedMinutes, r.totalMinutes)}%` }} />
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2"><dt className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-primary" aria-hidden />From planned sessions</dt><dd className="font-num" data-testid="text-time-planned-logged">{m(r.plannedLoggedMinutes)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-primary/35" aria-hidden />Unplanned</dt><dd className="font-num" data-testid="text-time-unplanned">{m(r.unplannedMinutes)}</dd></div>
                    <div className="flex justify-between gap-2 border-t border-border/60 pt-2 text-muted-foreground"><dt>Reserved in plans</dt><dd className="font-num" data-testid="text-time-reserved">{m(r.plannedMinutes)}</dd></div>
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">Unplanned is not worse. It is the work that arrived on the day.</p>
                </section>
              </div>

              <div className="grid min-w-0 gap-5 lg:grid-cols-12">
                {/* By goal with results */}
                <section className="surface rise min-w-0 p-4 sm:p-5 lg:col-span-7" aria-labelledby="goals-h">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="goals-h" className="font-display text-xl">Effort and results</h2>
                    <span className="font-num text-xs text-muted-foreground">{r.completedTasks} tasks · {r.completedMilestones} milestones done</span>
                  </div>
                  {r.goals.length === 0 ? <p className="text-sm text-muted-foreground">No goal activity in this range.</p> : (
                    <ul className="space-y-3" data-testid="list-time-goals">
                      {r.goals.map((g) => {
                        const goal = goalById.get(g.goalId);
                        const changes = g.measures.flatMap((ms) => ms.periods.filter((p) => p.change !== 0).map((p) => `${p.change > 0 ? '+' : ''}${formatValue(p.change, ms.unit)} ${ms.name}`));
                        return (
                          <li key={g.goalId || 'general'} data-testid={`row-time-goal-${g.goalId || 'general'}`}>
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="flex min-w-0 items-center gap-2">
                                {goal ? <AreaDot area={goal.area} goalId={goal.id} /> : <span aria-hidden className="size-2 shrink-0 rounded-full border border-muted-foreground/60" />}
                                {goal ? <Link href={`/goals/${goal.id}`} className="truncate hover:underline">{g.title}</Link> : <span className="truncate">{g.goalId ? g.title : GENERAL_LABEL}</span>}
                              </span>
                              <span className="shrink-0 font-num">{m(g.minutes)}</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className={cn('h-full rounded-full', !goal?.color && 'bg-muted-foreground')} style={{ backgroundColor: goal?.color, width: `${(g.minutes / goalMax) * 100}%` }} /></div>
                            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                              {g.plannedMinutes > 0 && <span className="font-num">{m(g.plannedMinutes)} reserved</span>}
                              {g.completedTasks > 0 && <span className="font-num">{g.completedTasks} task{g.completedTasks > 1 ? 's' : ''} done</span>}
                              {g.completedMilestones > 0 && <span className="font-num">{g.completedMilestones} milestone{g.completedMilestones > 1 ? 's' : ''}</span>}
                              {changes.slice(0, 3).map((c) => <span key={c} className="font-num text-foreground/80">{c}</span>)}
                              {g.minutes > 0 && !g.completedTasks && !g.completedMilestones && !changes.length && <span>Time only so far</span>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {/* Time of day */}
                <section className="surface rise min-w-0 p-4 sm:p-5 lg:col-span-5" aria-labelledby="daypart-h">
                  <h2 id="daypart-h" className="mb-3 font-display text-xl">Time of day</h2>
                  <table className="w-full text-sm" data-testid="table-dayparts">
                    <tbody>
                      {[...r.dayParts.map((d) => ({ name: d.name, minutes: d.minutes, muted: false })), { name: 'Unspecified', minutes: r.unknownTimeMinutes, muted: true }].map((d) => (
                        <tr key={d.name} data-testid={`row-daypart-${d.name.toLowerCase()}`}>
                          <th scope="row" className={cn('w-24 py-1.5 text-left font-normal', d.muted && 'text-muted-foreground')}>{d.name}</th>
                          <td className="py-1.5 pr-3"><div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden><div className={cn('h-full rounded-full', d.muted ? 'bg-muted-foreground/40' : 'bg-primary')} style={{ width: `${(d.minutes / dayMax) * 100}%` }} /></div></td>
                          <td className="w-16 py-1.5 text-right font-num">{m(d.minutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted-foreground">Placed from exact start and end times in the time zone they were saved in. Durations entered without times, and timer days you adjusted, stay unspecified.</p>
                  {r.intervals.length > 0 && (
                    <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto border-t border-border/60 pt-2 text-xs" data-testid="list-intervals">
                      {r.intervals.map((iv, i) => (
                        <li key={`${iv.sessionId}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
                          <span className="w-14 shrink-0 font-num text-muted-foreground">{fmt(iv.date, 'MMM d')}</span>
                          <span className="shrink-0 font-num">{clock(iv.start, iv.timezone)}–{clock(iv.end, iv.timezone)}</span>
                          <span className="shrink-0 font-num text-muted-foreground">{m(iv.minutes)}</span>
                          <span className="basis-full break-words text-muted-foreground">{iv.title} · {iv.timezone}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              {/* Tasks */}
              {r.tasks.length > 0 && (
                <section className="surface rise min-w-0 p-4 sm:p-5" aria-labelledby="tasks-h">
                  <h2 id="tasks-h" className="mb-3 font-display text-xl">By task</h2>
                  <p className="mb-3 text-xs text-muted-foreground">Task allocations are part of your logged time, not additional hours. Unallocated work stays included in the totals above.</p>
                  <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2" data-testid="list-time-tasks">
                    {r.tasks.map((t) => {
                      const goal = goalById.get(t.goalId);
                      return (
                        <li key={t.taskId} className="flex items-baseline justify-between gap-3" data-testid={`row-time-task-${t.taskId}`}>
                          <span className="min-w-0 truncate">{t.title} <span className="text-xs text-muted-foreground">· {goal?.title ?? GENERAL_LABEL}</span></span>
                          <span className="shrink-0 font-num">{m(t.minutes)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Entries */}
              <section className="surface rise min-w-0 p-4 sm:p-5" aria-labelledby="entries-h">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 id="entries-h" className="font-display text-xl">Entries</h2>
                  <span className="font-num text-xs text-muted-foreground">{r.entries.length} logged</span>
                </div>
                {r.entries.length === 0 ? <p className="text-sm text-muted-foreground">No logged entries in this range.</p> : (
                  <ul className="divide-y divide-border/60" data-testid="list-time-entries">
                    {[...r.entries].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).map((s) => {
                      const goal = goalById.get(s.goalId);
                      return (
                        <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2" data-testid={`row-time-entry-${s.id}`}>
                          <span className="w-16 shrink-0 font-num text-xs text-muted-foreground">{s.date ? fmt(s.date, 'EEE d') : ''}</span>
                          <div className="min-w-0 flex-1 basis-40">
                            <span className="block truncate text-sm">{s.title}</span>
                            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{goal && <AreaDot area={goal.area} goalId={goal.id} />}{goal?.title ?? GENERAL_LABEL}{!s.timeIntervals?.length && <span>· time of day unspecified</span>}</span>
                            <WorkDonePreview items={sessionWorkDone(s).all} testId={`time-${s.id}`} />
                          </div>
                          <span className="font-num text-sm">{m(s.actualMinutes ?? 0)}</span>
                          <span className="flex">
                            <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Correct ${s.title}`} onClick={() => setDialog({ log: s })} data-testid={`button-time-edit-${s.id}`}><Pencil /></Button>
                            <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={`Delete ${s.title}`} onClick={() => setDialog({ del: s })} data-testid={`button-time-delete-${s.id}`}><Trash2 /></Button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {dialog && 'log' in dialog && <LogSessionDialog session={dialog.log === true ? undefined : dialog.log} onClose={() => setDialog(null)} />}
      {dialog && 'del' in dialog && <DeleteSessionDialog session={dialog.del} onClose={() => setDialog(null)} />}
    </div>
  );
}
