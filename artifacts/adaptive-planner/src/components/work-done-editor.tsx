import { useEffect, useRef, useState } from 'react';
import { sessionWorkDone } from '@workspace/api-zod';
import { Copy, ListChecks, Plus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAppState } from '@/lib/store/store';
import { addTimerWorkDone, editTimerWorkDone, removeTimerWorkDone } from '@/lib/store/time-tracking';
import { retryWorkspaceSave, useWorkspaceSync } from '@/lib/workspace-sync';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export const WORK_DONE_MAX_ITEMS = 200;
export const WORK_DONE_MAX_CHARS = 2000;
export const WORK_DONE_HELP = 'Timed tasks are included automatically. Add only extra details. Client-facing; this does not complete tasks or add time.';

/** Trim and drop blank items, as saved. */
export const cleanWorkDone = (list: string[] | undefined) => (list ?? []).map((s) => s.trim()).filter(Boolean);

type Item = { id: string; text: string };

/** Presentational list: one textarea per item, explicit remove, add focuses the new row. */
export function WorkDoneRows({ items, onAdd, onEdit, onRemove, disabled, testId, label = 'Work done', hint = WORK_DONE_HELP, note }: {
  items: Item[]; onAdd: () => void; onEdit: (id: string, text: string) => void; onRemove: (id: string) => void;
  disabled?: boolean; testId: string; label?: string; hint?: string | null; note?: string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const prevLen = useRef(items.length);
  const wantFocus = useRef(false);
  useEffect(() => {
    if (wantFocus.current && items.length > prevLen.current) {
      const areas = listRef.current?.querySelectorAll('textarea');
      areas?.[areas.length - 1]?.focus();
      wantFocus.current = false;
    }
    prevLen.current = items.length;
  }, [items.length]);
  const full = items.length >= WORK_DONE_MAX_ITEMS;
  return (
    <div className="space-y-1.5" data-testid={`editor-workdone-${testId}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium"><ListChecks className="size-3.5 text-primary" /> {label}</span>
        <span className="font-num text-xs text-muted-foreground" data-testid={`text-workdone-count-${testId}`}>{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {note && <p className="rounded-md bg-accent/60 px-2 py-1 text-xs text-accent-foreground" data-testid={`text-workdone-note-${testId}`}>{note}</p>}
      {items.length > 0 && (
        <ol ref={listRef} className="space-y-1.5">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-start gap-1.5">
              <span className="mt-3 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
              <Textarea rows={1} value={it.text} maxLength={WORK_DONE_MAX_CHARS} disabled={disabled}
                aria-label={`${label} item ${i + 1}`} placeholder="What you delivered or progressed"
                className="min-h-9 flex-1 resize-y py-1.5 text-sm"
                onChange={(e) => onEdit(it.id, e.target.value.slice(0, WORK_DONE_MAX_CHARS))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !full) { e.preventDefault(); wantFocus.current = true; onAdd(); } }}
                data-testid={`input-workdone-${testId}-${i}`} />
              <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0 text-muted-foreground" disabled={disabled}
                aria-label={`Remove ${label.toLowerCase()} item ${i + 1}`} onClick={() => onRemove(it.id)} data-testid={`button-remove-workdone-${testId}-${i}`}><X /></Button>
            </li>
          ))}
        </ol>
      )}
      <Button type="button" variant="outline" size="sm" className="h-9" disabled={disabled || full}
        onClick={() => { wantFocus.current = true; onAdd(); }} data-testid={`button-add-workdone-${testId}`}>
        <Plus /> {full ? `Limit of ${WORK_DONE_MAX_ITEMS} items` : 'Add item'}
      </Button>
    </div>
  );
}

/** Local (dialog) list of strings. Blank rows allowed while drafting; cleaned on save. */
export function WorkDoneField({ value, onChange, automaticItems = [], ...rest }: { value: string[]; onChange: (v: string[]) => void; automaticItems?: string[]; disabled?: boolean; testId: string; label?: string; hint?: string | null; note?: string }) {
  const items = value.map((text, i) => ({ id: String(i), text }));
  const tasks = sessionWorkDone({ allocations: automaticItems.filter((title) => title.trim()).map((taskTitle) => ({ taskTitle, minutes: 1 })) }).tasks;
  return (
    <div className="space-y-2">
      <AutomaticTaskWork items={tasks} />
      <WorkDoneRows {...rest} items={items} label={rest.label ?? (tasks.length ? 'Additional details (optional)' : undefined)}
      onAdd={() => onChange([...value, ''])}
      onEdit={(id, text) => onChange(value.map((t, i) => (String(i) === id ? text : t)))}
      onRemove={(id) => onChange(value.filter((_, i) => String(i) !== id))} />
    </div>
  );
}

function AutomaticTaskWork({ items, pending = false }: { items: string[]; pending?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="rounded-md bg-muted/60 p-2 text-xs" data-testid="list-automatic-task-work">
      <p className="mb-1 font-medium">{pending ? 'Linked task' : 'Included from timed tasks'}</p>
      <ul className="max-h-36 list-inside list-disc space-y-1 overflow-y-auto [overflow-wrap:anywhere]">
        {items.map((title, i) => <li key={i}>{title}</li>)}
      </ul>
      <p className="mt-1 text-muted-foreground">{pending ? 'Included automatically when you save time against this task.' : 'No need to re-enter these. Change the time allocation above to change this list.'}</p>
    </div>
  );
}

/** Honest account-save status for the live timer list. */
export function WorkDoneSyncStatus({ testId = 'live' }: { testId?: string }) {
  const sync = useWorkspaceSync();
  if (sync.status === 'error' || sync.status === 'conflict') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive" data-testid={`status-workdone-sync-${testId}`}>
        <span>{sync.status === 'conflict' ? 'Changed elsewhere. Your latest work items are on this device only.' : 'Not saved to your account yet.'} {sync.error}</span>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void retryWorkspaceSave().catch(() => undefined)} data-testid={`button-workdone-retry-${testId}`}><RotateCcw /> Retry</Button>
      </div>
    );
  }
  return (
    <span className={cn('text-xs', sync.status === 'saving' ? 'text-muted-foreground' : 'text-primary/80')} data-testid={`status-workdone-sync-${testId}`} aria-live="polite">
      {sync.status === 'saving' ? 'Saving to your account…' : sync.status === 'saved' ? 'Saved to your account' : 'Saves automatically'}
    </span>
  );
}

/** Edits the persisted active-timer list directly; the workspace autosaves. Never pauses or credits time. */
export function LiveWorkDoneEditor({ compact }: { compact?: boolean }) {
  const state = useAppState();
  const timer = state.activeTimer;
  if (!timer) return null;
  const linkedTask = state.tasks.find((task) => task.id === timer.taskId);
  const items = timer.workDone ?? [];
  return (
    <div className="space-y-2" data-testid="panel-live-workdone">
      <AutomaticTaskWork items={linkedTask ? [linkedTask.title] : []} pending />
      <WorkDoneRows items={items} testId="live" hint={compact ? 'Client-facing, saved with this timer. Reviewed by day when you finish.' : WORK_DONE_HELP}
        onAdd={() => addTimerWorkDone(timer.id, '')}
        onEdit={(id, text) => editTimerWorkDone(timer.id, id, text)}
        onRemove={(id) => removeTimerWorkDone(timer.id, id)} />
      <WorkDoneSyncStatus />
    </div>
  );
}

/** Compact preview for logged session rows. */
export function WorkDonePreview({ items, testId }: { items?: string[]; testId: string }) {
  const list = cleanWorkDone(items);
  const [expanded, setExpanded] = useState(false);
  const [copying, setCopying] = useState(false);
  const { toast } = useToast();
  if (!list.length) return null;
  const copy = async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(list.map((item) => `- ${item}`).join('\n'));
      toast({ title: 'Work done copied', description: `${list.length} item${list.length === 1 ? '' : 's'} copied. Private notes are not included.` });
    } catch {
      toast({ title: 'Could not copy', description: 'Your browser blocked clipboard access. Expand the list and select the text to copy it.', variant: 'destructive' });
    } finally { setCopying(false); }
  };
  return (
    <div className="mt-2 text-xs text-muted-foreground" data-testid={`text-workdone-preview-${testId}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-foreground/80">Work done ({list.length})</span>
        <button type="button" onClick={() => void copy()} disabled={copying} aria-label="Copy all work done items"
          className="inline-flex min-h-8 items-center gap-1 rounded px-1.5 text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          data-testid={`button-copy-workdone-${testId}`}><Copy className="size-3" aria-hidden />{copying ? 'Copying…' : 'Copy all'}</button>
      </div>
      <ul id={`workdone-list-${testId}`} className="ml-4 list-disc space-y-1 leading-relaxed [overflow-wrap:anywhere]" data-testid={`list-workdone-preview-${testId}`}>
        {(expanded ? list : list.slice(0, 2)).map((item, i) => <li className="whitespace-pre-wrap" key={i}>{item}</li>)}
      </ul>
      {list.length > 2 && <button type="button" aria-expanded={expanded} aria-controls={`workdone-list-${testId}`} onClick={() => setExpanded((v) => !v)}
        className="mt-1 min-h-8 rounded px-1.5 text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`button-expand-workdone-${testId}`}>{expanded ? 'Show less' : `Show ${list.length - 2} more`}</button>}
    </div>
  );
}
