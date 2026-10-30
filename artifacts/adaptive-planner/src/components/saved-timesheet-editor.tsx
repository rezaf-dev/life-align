import { useState } from 'react';
import { AlertTriangle, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { SavedTimesheet } from '@workspace/api-zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useStagedAction } from '@/components/time-tracker';
import { todayIso } from '@/lib/dates';
import { formatMinutes, validateReportRange, type Timesheet, type TimesheetRow } from '@/lib/reports';
import { saveTimesheetReport, type TimesheetReportDraft } from '@/lib/store/saved-timesheets';
import { cn } from '@/lib/utils';
import { downloadBackup } from '@/components/auth/auth-chrome';
import { reloadWorkspace, useWorkspaceSync } from '@/lib/workspace-sync';

export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY'];

type RowForm = { id: string; date: string; description: string; workDone: string; minutes: string; kind: TimesheetRow['kind']; sessionTitle?: string; milestone?: string; notes?: string; sessionId?: string };
export type ReportForm = {
  title: string; client: string; preparedBy: string; includeNotes: boolean; internalNote: string;
  amount: string; currency: string; paymentStatus: 'unpaid' | 'paid'; paidDate: string;
  goalTitle: string; metricName: string; start: string; end: string; rows: RowForm[];
};

const label = 'grid min-w-0 gap-1 text-xs text-muted-foreground';

export function formFromRecord(r: SavedTimesheet): ReportForm {
  return {
    title: r.title, client: r.client ?? '', preparedBy: r.preparedBy ?? '', includeNotes: r.includeNotes,
    internalNote: r.internalNote ?? '', amount: r.amount == null ? '' : String(r.amount), currency: r.currency ?? '',
    paymentStatus: r.paymentStatus, paidDate: r.paidDate ?? todayIso(),
    goalTitle: r.sheet.goalTitle, metricName: r.sheet.metricName, start: r.sheet.start, end: r.sheet.end,
    rows: r.sheet.rows.map((x) => ({ ...(x as TimesheetRow & { sessionId?: string }), workDone: (x.workDone ?? []).join('\n'), minutes: String(Math.round(x.minutes * 100) / 100) })),
  };
}

/** Returns an error string, or the draft ready for the store. */
export function draftFromForm(f: ReportForm, base: Timesheet, goalId: string): string | TimesheetReportDraft {
  if (!f.title.trim()) return 'Give the report a title.';
  if (!f.goalTitle.trim()) return 'The project name on the report cannot be empty.';
  const range = validateReportRange(f.start, f.end);
  if (range) return range;
  if (f.rows.length === 0) return 'Keep at least one row on the report.';
  let amount: number | undefined;
  if (f.amount.trim()) {
    amount = Number(f.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) return 'Amount must be a number from 0 to 1,000,000,000.';
    if (!/^[A-Z]{3}$/.test(f.currency.trim().toUpperCase())) return 'Add a three-letter currency code (for example USD or EUR) for the amount.';
  } else if (f.currency.trim() && !/^[A-Z]{3}$/.test(f.currency.trim().toUpperCase())) return 'Currency must be a three-letter code.';
  if (f.paymentStatus === 'paid' && !/^\d{4}-\d{2}-\d{2}$/.test(f.paidDate)) return 'Choose the date it was paid.';
  const rows: TimesheetRow[] = [];
  for (const [i, r] of f.rows.entries()) {
    const n = i + 1;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date < f.start || r.date > f.end) return `Row ${n}: the date must fall within ${f.start} to ${f.end}.`;
    if (!r.description.trim()) return `Row ${n}: describe the work.`;
    const minutes = Number(r.minutes);
    if (!r.minutes.trim() || !Number.isFinite(minutes) || Math.abs(minutes) > 100000) return `Row ${n}: enter minutes as a number (negative for a correction).`;
    const workDone = r.workDone.split('\n').map((s) => s.trim()).filter(Boolean);
    const kind: TimesheetRow['kind'] = minutes < 0 ? 'adjustment' : r.kind === 'adjustment' ? 'contribution' : r.kind;
    rows.push({ ...(r.sessionId ? { sessionId: r.sessionId } : {}), id: r.id, date: r.date, description: r.description.trim(), minutes, kind,
      ...(r.sessionTitle ? { sessionTitle: r.sessionTitle } : {}), ...(r.milestone ? { milestone: r.milestone } : {}), ...(r.notes ? { notes: r.notes } : {}),
      ...(workDone.length ? { workDone } : {}) });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const sheet: Timesheet = { ...base, goalTitle: f.goalTitle.trim(), metricName: f.metricName.trim() || base.metricName, start: f.start, end: f.end, rows,
    totalMinutes: rows.reduce((t, r) => t + r.minutes, 0) };
  return {
    goalId, title: f.title.trim(), client: f.client.trim(), preparedBy: f.preparedBy.trim(), internalNote: f.internalNote.trim(),
    includeNotes: f.includeNotes, paymentStatus: f.paymentStatus, ...(f.paymentStatus === 'paid' ? { paidDate: f.paidDate } : {}),
    ...(amount != null ? { amount, currency: f.currency.trim().toUpperCase() } : {}), sheet,
  } as TimesheetReportDraft;
}

/** Shared internal fields: never exported to clients. */
export function InternalFields({ f, set, disabled }: { f: ReportForm; set: (p: Partial<ReportForm>) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 rounded-lg bg-primary/5 p-3">
      <legend className="sr-only">Private to you</legend>
      <p className="text-xs font-medium text-primary">Private to you. Never printed or exported, even with notes included.</p>
      <label className={label}>Internal note
        <Textarea value={f.internalNote} onChange={(e) => set({ internalNote: e.target.value })} maxLength={2000} rows={2} data-testid="input-saved-internal-note" />
      </label>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] gap-2">
        <label className={label}>Amount owed (optional)
          <Input inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className="h-10 font-num" data-testid="input-saved-amount" />
        </label>
        <label className={label}>Currency
          <Input list="saved-currency-codes" value={f.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} className="h-10 font-num uppercase" placeholder="e.g. USD" data-testid="input-saved-currency" />
          <datalist id="saved-currency-codes">{COMMON_CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Just a reminder of what you are owed. No rates, no invoicing, nothing is charged.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <Checkbox checked={f.paymentStatus === 'paid'} onCheckedChange={(v) => set({ paymentStatus: v === true ? 'paid' : 'unpaid', paidDate: f.paidDate || todayIso() })} data-testid="checkbox-saved-paid" />Paid
        </label>
        {f.paymentStatus === 'paid' && (
          <label className={label}>Paid on
            <Input type="date" value={f.paidDate} onChange={(e) => set({ paidDate: e.target.value })} className="h-9" data-testid="input-saved-paid-date" />
          </label>
        )}
      </div>
    </fieldset>
  );
}

export function ErrorNote({ text, testId }: { text: string; testId: string }) {
  const sync = useWorkspaceSync();
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const recover = async () => {
    setRecovering(true); setRecoveryError('');
    try { downloadBackup(); await reloadWorkspace(); window.location.reload(); }
    catch (error) { setRecoveryError(error instanceof Error ? error.message : 'Could not reload. Your draft is still here.'); setRecovering(false); }
  };
  return (
    <div role="alert" className="space-y-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive" data-testid={testId}>
      <p className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{text}</p>
      {sync.status === 'conflict' && <>
        <p className="text-xs">Back up the unsaved workspace, then reload the account's saved version. Reload replaces this on-screen draft.</p>
        <Button type="button" variant="outline" size="sm" disabled={recovering} onClick={() => void recover()} data-testid="button-report-conflict-recovery">{recovering ? 'Reloading…' : 'Back up and reload'}</Button>
      </>}
      {recoveryError && <p className="text-xs">{recoveryError}</p>}
    </div>
  );
}

/** Full editor. Mounted with a key per open, so form state is fresh from the chosen record and polls never overwrite it. */
export function SavedTimesheetEditor({ record, latest, onClose, onReload }: { record: SavedTimesheet; latest?: SavedTimesheet; onClose: () => void; onReload: () => void }) {
  const [f, setF] = useState(() => formFromRecord(record));
  const [localError, setLocalError] = useState('');
  const action = useStagedAction();
  const set = (p: Partial<ReportForm>) => setF((o) => ({ ...o, ...p }));
  const setRow = (i: number, p: Partial<RowForm>) => setF((o) => ({ ...o, rows: o.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) }));
  const stale = action.staged ? '' : !latest ? 'This report was deleted elsewhere. Copy anything you need; it cannot be saved.' : latest.revision !== record.revision ? 'This report changed since you opened it. Your edits are kept here; reopen the latest version to apply them again.' : '';
  const total = f.rows.reduce((t, r) => t + (Number(r.minutes) || 0), 0);

  const submit = () => {
    setLocalError('');
    const d = draftFromForm(f, record.sheet, record.goalId);
    if (typeof d === 'string') { setLocalError(d); return; }
    void action.run(() => { saveTimesheetReport(d, record.id, record.revision); }, onClose);
  };
  const close = (o: boolean) => { if (!o && !action.frozen) onClose(); };

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto overflow-x-hidden p-4 sm:p-6" data-testid="dialog-edit-saved-timesheet">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Edit saved report</DialogTitle>
          <DialogDescription>Changes apply only to this saved copy. Your time logs and goal progress stay exactly as they are.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={action.frozen} className="grid min-w-0 gap-4">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={cn(label, 'sm:col-span-2')}>Report title (shown to client)
              <Input value={f.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} className="h-10" data-testid="input-saved-title" />
            </label>
            <label className={label}>Client<Input value={f.client} maxLength={120} onChange={(e) => set({ client: e.target.value })} className="h-10" data-testid="input-saved-client" /></label>
            <label className={label}>Prepared by<Input value={f.preparedBy} maxLength={120} onChange={(e) => set({ preparedBy: e.target.value })} className="h-10" data-testid="input-saved-prepared-by" /></label>
            <label className={label}>Project name on report<Input value={f.goalTitle} maxLength={160} onChange={(e) => set({ goalTitle: e.target.value })} className="h-10" data-testid="input-saved-project" /></label>
            <label className={label}>Measure label<Input value={f.metricName} maxLength={120} onChange={(e) => set({ metricName: e.target.value })} className="h-10" data-testid="input-saved-measure" /></label>
            <label className={label}>Period from<Input type="date" value={f.start} onChange={(e) => set({ start: e.target.value })} className="h-10" data-testid="input-saved-start" /></label>
            <label className={label}>Period to<Input type="date" value={f.end} onChange={(e) => set({ end: e.target.value })} className="h-10" data-testid="input-saved-end" /></label>
          </div>
          <p className="text-xs text-muted-foreground">Changing the period does not pull in new logs. Every row must still fall inside it.</p>
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <Checkbox checked={f.includeNotes} onCheckedChange={(v) => set({ includeNotes: v === true })} data-testid="checkbox-saved-include-notes" />Include session notes in exports
          </label>

          <div className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">Rows</h3>
              <span className="font-num text-sm" data-testid="text-saved-editor-total">Total {formatMinutes(total)}</span>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">Correct a duration here to fix the client statement without touching the original record. Use negative minutes for a correction.</p>
            <ul className="space-y-2">
              {f.rows.map((r, i) => (
                <li key={r.id} className="grid min-w-0 grid-cols-2 gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[9rem_minmax(0,1fr)_6.5rem_auto]" data-testid={`row-saved-edit-${i}`}>
                  <Input type="date" aria-label="Row date" value={r.date} min={f.start} max={f.end} onChange={(e) => setRow(i, { date: e.target.value })} className="h-9" data-testid={`input-saved-row-date-${i}`} />
                  <Input aria-label="Work description" value={r.description} maxLength={300} onChange={(e) => setRow(i, { description: e.target.value })} className="col-span-2 h-9 sm:col-span-1 sm:row-start-1 sm:col-start-2" data-testid={`input-saved-row-description-${i}`} />
                  <Input aria-label="Minutes" inputMode="decimal" value={r.minutes} onChange={(e) => setRow(i, { minutes: e.target.value })} className={cn('h-9 font-num', Number(r.minutes) < 0 && 'text-destructive')} data-testid={`input-saved-row-minutes-${i}`} />
                  <Button type="button" variant="ghost" size="icon" className="size-9 justify-self-end" aria-label="Remove row" onClick={() => setF((o) => ({ ...o, rows: o.rows.filter((_, j) => j !== i) }))} data-testid={`button-saved-row-remove-${i}`}><Trash2 /></Button>
                  <Textarea aria-label="Work done, one per line" placeholder="Work done, one item per line" rows={2} value={r.workDone} onChange={(e) => setRow(i, { workDone: e.target.value })} className="col-span-2 min-h-0 text-xs sm:col-span-4" data-testid={`input-saved-row-workdone-${i}`} />
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setF((o) => ({ ...o, rows: [...o.rows, { id: `manual-${Date.now().toString(36)}`, date: o.end, description: '', workDone: '', minutes: '', kind: 'contribution' }] }))} data-testid="button-saved-row-add"><Plus /> Add row</Button>
          </div>
          <InternalFields f={f} set={set} />
        </fieldset>
        {stale && <ErrorNote text={stale} testId="text-saved-stale" />}
        {(localError || action.error) && <ErrorNote text={localError || action.error} testId="text-saved-editor-error" />}
        <DialogFooter className="gap-2">
          {stale && latest && <Button variant="outline" onClick={onReload} data-testid="button-saved-reopen"><RotateCcw /> Reopen latest</Button>}
          <Button variant="ghost" disabled={action.frozen} onClick={onClose} data-testid="button-saved-editor-cancel">Cancel</Button>
          <Button disabled={action.pending || (!!stale && !action.staged)} onClick={submit} data-testid="button-saved-editor-save">{action.staged ? 'Retry saving' : action.pending ? 'Saving' : 'Save changes'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
