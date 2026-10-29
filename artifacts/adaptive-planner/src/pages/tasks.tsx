import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { QuickAdd } from '@/components/quick-add';
import { TaskRow } from '@/components/task-row';
import { EmptyState, PageHeader } from '@/components/primitives';
import { Chip } from '@/pages/goals';
import { addDaysIso, fmt, relDay, todayIso } from '@/lib/dates';
import { isOpen, isOverdue } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';
import type { Task } from '@/lib/store/types';
import { cn } from '@/lib/utils';

type ViewKey = 'inbox' | 'today' | 'upcoming' | 'overdue' | 'open' | 'done' | 'archived';
const VIEWS: { key: ViewKey; label: string; empty: [string, string] }[] = [
  { key: 'inbox', label: 'Inbox', empty: ['Inbox is clear', 'Everything captured has a date or a home.'] },
  { key: 'today', label: 'Today', empty: ['Nothing for today', 'Capture above or pull from the inbox.'] },
  { key: 'upcoming', label: 'Upcoming', empty: ['Nothing scheduled ahead', 'Plan the week to see it here.'] },
  { key: 'overdue', label: 'Overdue', empty: ['Nothing overdue', 'Every date is still honest.'] },
  { key: 'open', label: 'All open', empty: ['No open tasks', 'A rare and quiet moment.'] },
  { key: 'done', label: 'Completed', empty: ['Nothing completed yet', 'Check something off and it lands here.'] },
  { key: 'archived', label: 'Archived', empty: ['Archive is empty', 'Archived tasks are hidden from plans but kept.'] },
];

const PRIMARY = VIEWS.filter((v) => ['inbox', 'today', 'upcoming', 'overdue'].includes(v.key));
const SECONDARY = VIEWS.filter((v) => !PRIMARY.includes(v));

export default function TasksPage() {
  const state = useAppState();
  const search = useSearch();
  const [, navigate] = useLocation();
  const initial = (new URLSearchParams(search).get('view') as ViewKey) || 'inbox';
  const [view, setView] = useState<ViewKey>(VIEWS.some((v) => v.key === initial) ? initial : 'inbox');
  const [goalFilter, setGoalFilter] = useState('all');
  const [q, setQ] = useState('');
  const today = todayIso();

  useEffect(() => {
    const v = new URLSearchParams(search).get('view') as ViewKey | null;
    if (v && VIEWS.some((x) => x.key === v)) setView(v);
  }, [search]);

  const match = (t: Task, v: ViewKey) => {
    switch (v) {
      case 'inbox': return isOpen(t) && !t.plannedDate;
      case 'today': return !t.archived && (t.plannedDate === today || (t.status === 'open' && t.dueDate === today));
      case 'upcoming': return isOpen(t) && !!t.plannedDate && t.plannedDate > today;
      case 'overdue': return isOverdue(t, today);
      case 'open': return isOpen(t);
      case 'done': return t.status === 'done' && !t.archived;
      case 'archived': return t.archived;
    }
  };

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.key, state.tasks.filter((t) => match(t, v.key)).length])), [state.tasks, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return state.tasks
      .filter((t) => match(t, view))
      .filter((t) => goalFilter === 'all' || (goalFilter === 'none' ? !t.goalId : t.goalId === goalFilter))
      .filter((t) => !ql || t.title.toLowerCase().includes(ql) || t.notes.toLowerCase().includes(ql))
      .sort((a, b) => {
        if (view === 'done') return (a.completedAt ?? '') > (b.completedAt ?? '') ? -1 : 1;
        const da = a.plannedDate ?? a.dueDate ?? '9999';
        const db = b.plannedDate ?? b.dueDate ?? '9999';
        if (da !== db) return da < db ? -1 : 1;
        const p = { high: 0, medium: 1, low: 2 };
        return p[a.priority] - p[b.priority];
      });
  }, [state.tasks, view, goalFilter, q, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    if (view !== 'upcoming' && view !== 'done') return [{ label: '', items: list }];
    const map = new Map<string, Task[]>();
    list.forEach((t) => {
      const d = view === 'done' ? (t.completedAt ?? '').slice(0, 10) : t.plannedDate!;
      const label = view === 'upcoming' && d > addDaysIso(today, 6) ? 'Later' : `${relDay(d)} · ${fmt(d, 'MMM d')}`;
      map.set(label, [...(map.get(label) ?? []), t]);
    });
    return [...map.entries()].map(([label, items]) => ({ label, items }));
  }, [list, view, today]);

  const choose = (k: ViewKey) => { setView(k); navigate(`/tasks?view=${k}`, { replace: true }); };
  const secondaryActive = SECONDARY.some((v) => v.key === view);
  const meta = VIEWS.find((v) => v.key === view)!;

  return (
    <div>
      <PageHeader title="Tasks & Inbox" description="Capture with just a title. Decide where it goes later." />
      <QuickAdd className="rise mb-4 py-2" placeholder="Capture a task, press Enter" testId="input-tasks-quick-add" />

      <div className="rise mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Task views">
          {PRIMARY.map((v) => (
            <Chip key={v.key} active={view === v.key} onClick={() => choose(v.key)} testId={`filter-view-${v.key}`}>
              {v.label} <span className="ml-1 font-num text-xs opacity-70">{counts[v.key]}</span>
            </Chip>
          ))}
          <Select value={secondaryActive ? view : ''} onValueChange={(v) => choose(v as ViewKey)}>
            <SelectTrigger
              className={cn('h-9 w-auto min-w-[6.5rem] rounded-full px-3 text-[0.85rem]', secondaryActive ? 'border-foreground/80 bg-foreground text-background' : 'text-muted-foreground')}
              aria-label="More task views"
              data-testid="select-more-views"
            >
              <SelectValue placeholder="More views" />
            </SelectTrigger>
            <SelectContent>
              {SECONDARY.map((v) => (
                <SelectItem key={v.key} value={v.key} data-testid={`filter-view-${v.key}`}>{v.label} ({counts[v.key]})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 basis-40 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search tasks" className="h-10 w-full pl-8 sm:h-9 sm:w-44" data-testid="input-task-search" />
          </div>
          <Select value={goalFilter} onValueChange={setGoalFilter}>
            <SelectTrigger className="h-10 min-w-0 flex-1 basis-40 sm:h-9 sm:w-48 sm:flex-none" aria-label="Filter by goal" data-testid="select-task-goal-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All goals</SelectItem>
              <SelectItem value="none">No goal</SelectItem>
              {state.goals.map((g) => <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="surface p-3 md:p-4">
        {list.length === 0 ? (
          <EmptyState title={q || goalFilter !== 'all' ? 'No matches' : meta.empty[0]} body={q || goalFilter !== 'all' ? 'Try clearing the search or goal filter.' : meta.empty[1]} />
        ) : (
          groups.map((g) => (
            <div key={g.label || 'all'} className="mb-2 last:mb-0">
              {g.label && <div className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">{g.label}</div>}
              <div className="divide-y divide-border/60">{g.items.map((t) => <TaskRow key={t.id} task={t} siblings={g.items} hideDate={view === 'today'} />)}</div>
            </div>
          ))
        )}
      </div>
      {view === 'inbox' && list.length > 0 && (
        <p className="mt-3 px-1 text-xs text-muted-foreground">Use the calendar button on a task to schedule it, or select several in the Planner week view.</p>
      )}
    </div>
  );
}
