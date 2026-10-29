import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, PencilLine, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { QuickAdd } from '@/components/quick-add';
import { TaskRow } from '@/components/task-row';
import { AreaDot, EmptyState } from '@/components/primitives';
import {
  addDaysIso,
  addMonthsIso,
  fmt,
  monthEndIso,
  monthStartIso,
  nowStamp,
  relDay,
  todayIso,
  weekStartIso,
} from '@/lib/dates';
import { finalizeWeek, rescheduleTasks, reopenWeek, setPeriodNote, setWeekPlan } from '@/lib/store/actions';
import { dueReminders, effortLabel, inboxTasks, overdueTasks, plannedOn, tasksInRange, weekRange } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';
import { cn } from '@/lib/utils';
import { AskButton } from '@/components/ai/ask-button';

type View = 'year' | 'quarter' | 'month' | 'week' | 'today';
const VIEWS: { value: View; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'today', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
];

const quarterStart = (d: string) => {
  const y = d.slice(0, 4);
  const q = Math.floor((Number(d.slice(5, 7)) - 1) / 3);
  return `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
};
const quarterKey = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

export default function PlannerPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const initial = (new URLSearchParams(search).get('view') as View) || 'week';
  const [view, setView] = useState<View>(VIEWS.some((v) => v.value === initial) ? initial : 'week');
  const [anchor, setAnchor] = useState(todayIso());

  useEffect(() => {
    const v = new URLSearchParams(search).get('view') as View | null;
    if (v && VIEWS.some((x) => x.value === v)) setView(v);
  }, [search]);

  const changeView = (v: View) => {
    setView(v);
    navigate(`/planner?view=${v}`, { replace: true });
  };

  const step = (dir: 1 | -1) => {
    setAnchor((a) =>
      view === 'year' ? addMonthsIso(a, 12 * dir)
      : view === 'quarter' ? addMonthsIso(a, 3 * dir)
      : view === 'month' ? addMonthsIso(a, dir)
      : view === 'week' ? addDaysIso(a, 7 * dir)
      : addDaysIso(a, dir),
    );
  };

  const label =
    view === 'year' ? fmt(anchor, 'yyyy')
    : view === 'quarter' ? `${quarterKey(anchor).replace('-', ' · ')}`
    : view === 'month' ? fmt(anchor, 'MMMM yyyy')
    : view === 'week' ? `${fmt(weekStartIso(anchor), 'MMM d')} – ${fmt(addDaysIso(weekStartIso(anchor), 6), 'MMM d')}`
    : `${relDay(anchor)} · ${fmt(anchor, 'MMM d')}`;

  const drill = (v: View, d: string) => {
    setAnchor(d);
    changeView(v);
  };

  return (
    <div>
      <div className="rise mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="font-display text-[1.9rem] leading-tight md:text-[2.2rem]">Planner</h1>
        <div className="flex flex-wrap items-center gap-2">
          <AskButton focus={{ screen: 'planner', period: {
            start: view === 'week' ? weekStartIso(anchor) : view === 'month' ? monthStartIso(anchor) : view === 'quarter' ? quarterStart(anchor) : view === 'year' ? `${anchor.slice(0, 4)}-01-01` : anchor,
            end: view === 'week' ? addDaysIso(weekStartIso(anchor), 6) : view === 'month' ? monthEndIso(anchor) : view === 'quarter' ? addDaysIso(addMonthsIso(quarterStart(anchor), 3), -1) : view === 'year' ? `${anchor.slice(0, 4)}-12-31` : anchor,
            label,
          } }} label="Plan with Align" />
          <div
            role="tablist"
            aria-label="Planning horizon"
            className="inline-flex rounded-xl border border-border bg-card p-1"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = VIEWS.findIndex((v) => v.value === view);
              const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
              changeView(next.value);
              (e.currentTarget.querySelector(`[data-view="${next.value}"]`) as HTMLElement | null)?.focus();
            }}
          >
            {VIEWS.map((v, i) => (
              <button
                key={v.value}
                role="tab"
                data-view={v.value}
                aria-selected={view === v.value}
                tabIndex={view === v.value ? 0 : -1}
                onClick={() => changeView(v.value)}
                data-testid={`tab-${v.value}`}
                className={cn(
                  'min-h-9 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  i === 2 && 'ml-1',
                  view === v.value ? 'bg-foreground text-background' : i < 2 ? 'text-foreground/80 hover:text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Previous period" data-testid="button-prev-period"><ChevronLeft /></Button>
            <span className="min-w-[9.5rem] text-center font-display text-base" data-testid="text-period-label" aria-live="polite">{label}</span>
            <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Next period" data-testid="button-next-period"><ChevronRight /></Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(todayIso())} data-testid="button-period-today">Today</Button>
          </div>
        </div>
      </div>

      {view === 'year' && <YearView anchor={anchor} onDrill={drill} />}
      {view === 'quarter' && <QuarterView anchor={anchor} onDrill={drill} />}
      {view === 'month' && <MonthView anchor={anchor} onDrill={drill} />}
      {view === 'week' && <WeekView anchor={anchor} onDrill={drill} />}
      {view === 'today' && <DayView day={anchor} />}
    </div>
  );
}

/* ---------- Notes ---------- */
function SaveState({ state }: { state: 'saved' | 'dirty' | 'empty' }) {
  return (
    <span className={cn('text-xs', state === 'dirty' ? 'text-warning' : 'text-muted-foreground')} aria-live="polite" data-testid="text-save-state">
      {state === 'dirty' ? 'Unsaved, saves when you leave the field' : state === 'saved' ? 'Saved' : ''}
    </span>
  );
}

function PeriodNote({ noteKey, label, placeholder }: { noteKey: string; label: string; placeholder: string }) {
  const { periodNotes } = useAppState();
  const saved = periodNotes[noteKey] ?? '';
  const [text, setText] = useState(saved);
  const keyRef = useRef(noteKey);
  useEffect(() => {
    keyRef.current = noteKey;
    setText(periodNotes[noteKey] ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey]);
  const status = text !== saved ? 'dirty' : saved ? 'saved' : 'empty';
  return (
    <div className="surface rise p-4">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <label htmlFor={`note-${noteKey}`} className="text-sm font-medium">{label}</label>
        <SaveState state={status} />
      </div>
      <Textarea
        id={`note-${noteKey}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text !== saved) setPeriodNote(keyRef.current, text); }}
        placeholder={placeholder}
        rows={2}
        className="min-h-0 resize-none border-none bg-transparent p-0 font-display text-[1.05rem] leading-relaxed shadow-none focus-visible:ring-0"
        data-testid="input-period-note"
      />
    </div>
  );
}

/* ---------- Year ---------- */
function YearView({ anchor, onDrill }: { anchor: string; onDrill: (v: View, d: string) => void }) {
  const { goals } = useAppState();
  const year = anchor.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);
  const live = goals.filter((g) => g.status !== 'cancelled');
  return (
    <div className="space-y-6">
      <PeriodNote noteKey={year} label={`${year} intent`} placeholder="What should be true by the end of this year?" />
      <div className="grid gap-px overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {months.map((m) => {
          const ym = m.slice(0, 7);
          const ms = live.flatMap((g) => g.milestones.filter((x) => x.dueDate.startsWith(ym)).map((x) => ({ ...x, g })));
          const ends = live.filter((g) => g.targetDate.startsWith(ym));
          const current = todayIso().startsWith(ym);
          return (
            <button key={m} type="button" onClick={() => onDrill('month', m)} className={cn('min-h-[9rem] bg-card p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', current && 'bg-accent/40')} data-testid={`year-month-${ym}`}>
              <div className={cn('mb-2 font-display text-lg', current && 'text-primary')}>{fmt(m, 'MMMM')}</div>
              <ul className="space-y-1">
                {ends.map((g) => (
                  <li key={g.id} className="flex items-center gap-1.5 text-xs font-medium"><AreaDot area={g.area} /> <span className="truncate">Target: {g.title}</span></li>
                ))}
                {ms.slice(0, 4).map((x) => (
                  <li key={x.id} className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', x.done && 'line-through')}><AreaDot area={x.g.area} className="opacity-50" /> <span className="truncate">{x.title}</span></li>
                ))}
                {ms.length > 4 && <li className="text-xs text-muted-foreground">+{ms.length - 4} more</li>}
                {!ends.length && !ms.length && <li className="text-xs text-muted-foreground/60">Open</li>}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Quarter ---------- */
function QuarterView({ anchor, onDrill }: { anchor: string; onDrill: (v: View, d: string) => void }) {
  const { goals, tasks } = useAppState();
  const qs = quarterStart(anchor);
  const months = [0, 1, 2].map((i) => addMonthsIso(qs, i));
  const live = goals.filter((g) => g.status === 'active' || g.status === 'paused');
  return (
    <div className="space-y-6">
      <PeriodNote noteKey={quarterKey(anchor)} label={`${quarterKey(anchor).replace('-', ' ')} theme`} placeholder="One sentence that decides what this quarter is about." />
      <div className="grid gap-6 lg:grid-cols-3">
        {months.map((m) => {
          const ym = m.slice(0, 7);
          const planned = tasksInRange(tasks, m, monthEndIso(m));
          return (
            <div key={m} className="surface rise p-5">
              <button type="button" onClick={() => onDrill('month', m)} className="mb-4 font-display text-xl hover:text-primary" data-testid={`quarter-month-${ym}`}>{fmt(m, 'MMMM')}</button>
              <div className="eyebrow mb-2">Milestones</div>
              <ul className="mb-4 space-y-2">
                {live.flatMap((g) => g.milestones.filter((x) => x.dueDate.startsWith(ym)).map((x) => (
                  <li key={x.id} className="text-sm">
                    <Link href={`/goals/${g.id}`} className={cn('flex items-start gap-2 hover:text-primary', x.done && 'text-muted-foreground line-through')}>
                      <AreaDot area={g.area} className="mt-1.5" />
                      <span><span className="font-num text-xs text-muted-foreground">{fmt(x.dueDate, 'd')}</span> {x.title}</span>
                    </Link>
                  </li>
                )))}
                {!live.some((g) => g.milestones.some((x) => x.dueDate.startsWith(ym))) && <li className="text-sm text-muted-foreground">None</li>}
              </ul>
              <div className="eyebrow mb-1">Planned tasks</div>
              <p className="font-num text-sm">{planned.filter((t) => t.status === 'done').length} completed of {planned.length}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Month ---------- */
function MonthView({ anchor, onDrill }: { anchor: string; onDrill: (v: View, d: string) => void }) {
  const { goals, tasks } = useAppState();
  const ms = monthStartIso(anchor);
  const gridStart = weekStartIso(ms);
  const end = monthEndIso(anchor);
  const weeks = Math.ceil((Number(fmt(end, 'd')) + (Number(fmt(ms, 'i')) - 1)) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDaysIso(gridStart, i));
  const today = todayIso();
  const goalById = new Map(goals.map((g) => [g.id, g]));
  return (
    <div className="space-y-6">
      <PeriodNote noteKey={ms.slice(0, 7)} label={`${fmt(ms, 'MMMM')} focus`} placeholder="What would make this month a good one?" />
      <div className="surface overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="eyebrow px-2 py-2 text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const inMonth = d.startsWith(ms.slice(0, 7));
            const dayTasks = plannedOn(tasks, d);
            const milestones = goals.filter((g) => g.status === 'active').flatMap((g) => g.milestones.filter((m) => m.dueDate === d).map((m) => ({ ...m, g })));
            return (
              <button
                key={d}
                type="button"
                onClick={() => onDrill('today', d)}
                className={cn('min-h-[5.5rem] border-b border-r border-border p-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-[7rem] md:p-2', !inMonth && 'bg-muted/30 text-muted-foreground/50')}
                aria-label={`${fmt(d, 'EEEE MMM d')}: ${dayTasks.length} tasks`}
                data-testid={`month-day-${d}`}
              >
                <span className={cn('inline-grid size-6 place-items-center rounded-full font-num text-xs', d === today && 'bg-primary text-primary-foreground')}>{fmt(d, 'd')}</span>
                <ul className="mt-1 hidden space-y-0.5 md:block">
                  {milestones.map((m) => (
                    <li key={m.id} className="truncate rounded bg-accent px-1 text-[0.68rem] text-accent-foreground">{m.title}</li>
                  ))}
                  {dayTasks.slice(0, 3).map((t) => {
                    const g = t.goalId ? goalById.get(t.goalId) : undefined;
                    return (
                      <li key={t.id} className={cn('flex items-center gap-1 truncate text-[0.7rem]', t.status === 'done' && 'text-muted-foreground line-through')}>
                        {g ? <AreaDot area={g.area} className="size-1.5" /> : <span className="size-1.5 shrink-0 rounded-full bg-foreground/25" />}
                        <span className="truncate">{t.title}</span>
                      </li>
                    );
                  })}
                  {dayTasks.length > 3 && <li className="text-[0.65rem] text-muted-foreground">+{dayTasks.length - 3}</li>}
                </ul>
                {dayTasks.length > 0 && <span className="mt-1 block font-num text-[0.65rem] text-muted-foreground md:hidden">{dayTasks.length}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- Inbox picker ---------- */
function InboxPicker({ days, defaultDay }: { days: string[]; defaultDay: string }) {
  const { tasks } = useAppState();
  const { toast } = useToast();
  const inbox = useMemo(() => inboxTasks(tasks), [tasks]);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState(defaultDay);
  useEffect(() => setTarget(defaultDay), [defaultDay]);
  const live = selected.filter((id) => inbox.some((t) => t.id === id));
  return (
    <div className="surface rise p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg">Inbox</h2>
        <span className="font-num text-xs text-muted-foreground">{inbox.length} unscheduled</span>
      </div>
      <QuickAdd placeholder="Capture to inbox" testId="input-planner-inbox-add" />
      {inbox.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Select tasks, choose a day, then schedule.</p>}
      <div className="mt-3 max-h-[22rem] divide-y divide-border/60 overflow-y-auto">
        {inbox.length === 0 ? (
          <EmptyState title="Inbox zero" body="Everything captured has a place." />
        ) : (
          inbox.map((t) => (
            <TaskRow key={t.id} task={t} selectable selected={live.includes(t.id)} onSelect={(v) => setSelected((s) => (v ? [...s, t.id] : s.filter((x) => x !== t.id)))} />
          ))
        )}
      </div>
      {inbox.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-10 min-w-0 flex-1 sm:h-9" data-testid="select-inbox-target-day"><SelectValue /></SelectTrigger>
            <SelectContent>
              {days.map((d) => <SelectItem key={d} value={d}>{relDay(d)} {fmt(d, 'MMM d')}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            disabled={!live.length}
            onClick={() => {
              rescheduleTasks(live, target);
              toast({ title: `${live.length} scheduled for ${relDay(target).toLowerCase()}` });
              setSelected([]);
            }}
            data-testid="button-schedule-selected"
          >
            Schedule {live.length || ''}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------- Week ---------- */
function DayBlock({ day, today, onDrill }: { day: string; today: string; onDrill: (v: View, d: string) => void }) {
  const { tasks } = useAppState();
  const list = plannedOn(tasks, day);
  const open = list.filter((t) => t.status === 'open');
  const done = list.filter((t) => t.status === 'done');
  const past = day < today;
  const isToday = day === today;
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [expandPast, setExpandPast] = useState(false);
  const dayEffort = open.reduce((a, t) => a + t.effort, 0);
  const collapsedPast = past && !expandPast;
  return (
    <section
      id={`day-${day}`}
      className={cn('scroll-mt-20 border-b border-border/70 px-2 py-2 last:border-b-0 sm:px-3', isToday && 'bg-accent/30', past && 'bg-muted/25')}
      aria-label={fmt(day, 'EEEE MMMM d')}
      data-testid={`week-day-${day}`}
    >
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onDrill('today', day)} className={cn('flex min-h-9 items-baseline gap-2 rounded px-1 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', past && 'text-muted-foreground', isToday && 'text-primary')}>
          <span className="w-9 font-medium">{fmt(day, 'EEE')}</span>
          <span className="font-num text-xs text-muted-foreground">{fmt(day, 'MMM d')}</span>
          {isToday && <span className="text-xs font-medium">Today</span>}
        </button>
        <span className="ml-auto font-num text-xs text-muted-foreground">
          {list.length === 0 ? '' : `${open.length} open${done.length ? ` · ${done.length} done` : ''}${dayEffort ? ` · ${effortLabel(dayEffort)}` : ''}`}
        </span>
        {past && list.length > 0 && (
          <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => setExpandPast((v) => !v)} aria-expanded={expandPast} data-testid={`button-expand-${day}`}>
            {expandPast ? 'Hide' : 'Show'}
          </Button>
        )}
        {!past && (
          <Button variant="ghost" size="icon" className="size-10 text-muted-foreground sm:size-8" onClick={() => setAdding((v) => !v)} aria-expanded={adding} aria-label={`Add task to ${fmt(day, 'EEEE')}`} data-testid={`button-add-to-${day}`}>
            <Plus />
          </Button>
        )}
      </div>
      {adding && <QuickAdd className="my-1.5" defaults={{ plannedDate: day }} placeholder={`Add to ${fmt(day, 'EEEE')}`} testId={`input-week-add-${day}`} />}
      {!collapsedPast && open.length > 0 && <div className="divide-y divide-border/50">{open.map((t) => <TaskRow key={t.id} task={t} siblings={open} hideDate />)}</div>}
      {!collapsedPast && done.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="inline-flex min-h-8 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronDown className={cn('size-3.5 transition-transform', !showDone && '-rotate-90')} /> {done.length} completed
          </button>
          {showDone && <div className="divide-y divide-border/50">{done.map((t) => <TaskRow key={t.id} task={t} siblings={done} />)}</div>}
        </div>
      )}
    </section>
  );
}

function WeekView({ anchor, onDrill }: { anchor: string; onDrill: (v: View, d: string) => void }) {
  const state = useAppState();
  const { toast } = useToast();
  const ws = weekStartIso(anchor);
  const days = weekRange(ws);
  const plan = state.weekPlans[ws] ?? { weekStart: ws, focus: '', capacityMinutes: 600, finalized: false, commitments: [] };
  const weekTasks = tasksInRange(state.tasks, ws, days[6]);
  const effort = weekTasks.reduce((a, t) => a + t.effort, 0);
  const over = effort > plan.capacityMinutes;
  const [focus, setFocus] = useState(plan.focus);
  useEffect(() => setFocus(plan.focus), [ws, plan.focus]);
  const today = todayIso();
  const focusState = focus !== plan.focus ? 'dirty' : plan.focus ? 'saved' : 'empty';

  const currentIds = new Set(weekTasks.map((t) => t.id));
  const committedIds = new Set(plan.commitments.map((c) => c.taskId));
  const added = weekTasks.filter((t) => !committedIds.has(t.id)).length;
  const moved = plan.commitments.filter((c) => !currentIds.has(c.taskId)).length;
  const keptDone = plan.commitments.filter((c) => state.tasks.find((t) => t.id === c.taskId)?.status === 'done').length;

  const savePlan = () => {
    const first = !plan.commitments.length;
    finalizeWeek(ws);
    toast({
      title: 'Week plan saved',
      description: first ? `${weekTasks.length} tasks recorded as this week's plan. Reviews compare against it.` : 'Your originally saved list is unchanged.',
    });
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-12">
      <div className="min-w-0 space-y-5 xl:col-span-8">
        <div className="surface rise p-4 sm:p-5">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <label htmlFor="week-focus" className="text-sm font-medium">Week focus</label>
            <SaveState state={focusState} />
          </div>
          <Textarea
            id="week-focus"
            value={focus}
            rows={2}
            onChange={(e) => setFocus(e.target.value)}
            onBlur={() => focus !== plan.focus && setWeekPlan(ws, { focus })}
            placeholder="One sentence for this week"
            className="min-h-0 resize-none font-display text-base leading-snug"
            data-testid="input-week-focus"
          />
          <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3">
            <div className="w-36">
              <label htmlFor="week-capacity" className="mb-1 block text-xs text-muted-foreground">Available time (hours)</label>
              <Input id="week-capacity" type="number" min={0} step={0.5} value={plan.capacityMinutes / 60} onChange={(e) => setWeekPlan(ws, { capacityMinutes: Math.max(0, Math.round(Number(e.target.value) * 60)) })} className="h-10 font-num" data-testid="input-week-capacity" />
            </div>
            <div className="min-w-[12rem] flex-1">
              <div className="mb-1.5 flex justify-between font-num text-xs">
                <span className={cn(over ? 'text-destructive' : 'text-muted-foreground')}>{effortLabel(effort) || '0h'} planned</span>
                <span className="text-muted-foreground">{effortLabel(plan.capacityMinutes) || '0h'} available</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className={cn('h-full origin-left rounded-full transition-transform duration-500', over ? 'bg-destructive' : 'bg-primary')} style={{ transform: `scaleX(${Math.min(1, effort / Math.max(1, plan.capacityMinutes))})` }} />
              </div>
            </div>
            {plan.finalized ? (
              <Button variant="outline" onClick={() => { reopenWeek(ws); toast({ title: 'Plan open for changes', description: 'The originally saved list is kept for reviews.' }); }} data-testid="button-reopen-week"><PencilLine /> Adjust plan</Button>
            ) : (
              <Button onClick={savePlan} disabled={!weekTasks.length} data-testid="button-finalize-week"><Check /> Save week plan</Button>
            )}
          </div>
          {over && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-destructive" role="alert" data-testid="text-capacity-warning">
              <AlertTriangle className="size-4" /> {effortLabel(effort - plan.capacityMinutes)} more than your available time.
            </p>
          )}
          {plan.commitments.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="text-commitments">
              {plan.finalized ? 'Plan saved' : 'Plan open for changes'} &middot; saved with {plan.commitments.length} tasks: {keptDone} completed, {added} added since, {moved} moved out. Reviews compare against this saved list.
            </p>
          )}
        </div>

        {/* Seven-day overview strip */}
        <nav aria-label="Days this week" className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const list = plannedOn(state.tasks, d);
            const openN = list.filter((t) => t.status === 'open').length;
            return (
              <a
                key={d}
                href={`#day-${d}`}
                onClick={(e) => { e.preventDefault(); document.getElementById(`day-${d}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                className={cn(
                  'flex min-h-12 flex-col items-center justify-center rounded-lg border border-border bg-card py-1 text-center transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  d === today && 'border-primary/50 bg-accent/40',
                  d < today && 'opacity-60',
                )}
                aria-label={`${fmt(d, 'EEEE')}: ${openN} open of ${list.length}`}
                data-testid={`week-strip-${d}`}
              >
                <span className="text-xs">{fmt(d, 'EEEEE')}<span className="hidden sm:inline">{fmt(d, 'EEE').slice(1)}</span></span>
                <span className={cn('font-num text-sm', openN === 0 && 'text-muted-foreground/60')}>{list.length ? openN : '·'}</span>
              </a>
            );
          })}
        </nav>

        <div className="surface rise overflow-hidden">
          {days.map((d) => <DayBlock key={d} day={d} today={today} onDrill={onDrill} />)}
        </div>
      </div>
      <div className="min-w-0 xl:col-span-4">
        <div className="space-y-5 xl:sticky xl:top-6">
          <InboxPicker days={days} defaultDay={days.includes(today) ? today : days[0]} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Day ---------- */
function DayView({ day }: { day: string }) {
  const { tasks } = useAppState();
  const today = todayIso();
  const list = plannedOn(tasks, day);
  const overdue = day === today ? overdueTasks(tasks).filter((t) => t.plannedDate !== day) : [];
  const reminders = day === today ? dueReminders(tasks, nowStamp()) : [];
  const effort = list.reduce((a, t) => a + t.effort, 0);
  const ws = weekStartIso(day);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-12">
      <div className="min-w-0 space-y-6 xl:col-span-8">
        <div className="surface rise p-5 md:p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-display text-2xl">{fmt(day, 'EEEE, MMMM d')}</h2>
            <span className="font-num text-xs text-muted-foreground">{effortLabel(effort) || '0m'} planned</span>
          </div>
          <QuickAdd defaults={{ plannedDate: day }} placeholder={`Add to ${relDay(day).toLowerCase()}`} testId="input-day-quick-add" />
          <div className="mt-4 divide-y divide-border/60">
            {list.length === 0 ? <EmptyState title="Nothing planned" body="Pull from the inbox on the right." /> : list.map((t) => <TaskRow key={t.id} task={t} siblings={list} hideDate />)}
          </div>
        </div>
        {overdue.length > 0 && (
          <div className="surface rise p-5">
            <div className="mb-2 text-sm font-medium text-destructive">Carried over</div>
            <div className="divide-y divide-border/60">{overdue.map((t) => <TaskRow key={t.id} task={t} siblings={overdue} />)}</div>
          </div>
        )}
        {reminders.length > 0 && (
          <div className="surface rise p-5">
            <div className="mb-2 text-sm font-medium" title="In-app only. Align has no background notification service.">Reminders due</div>
            <div className="divide-y divide-border/60">{reminders.map((t) => <TaskRow key={t.id} task={t} siblings={reminders} />)}</div>
          </div>
        )}
      </div>
      <div className="xl:col-span-4">
        <InboxPicker days={weekRange(ws).filter((d) => d >= today || d === day)} defaultDay={day} />
      </div>
    </div>
  );
}
