import { useState } from 'react';
import { CircleCheck, FileDown, Pencil, Printer, Save, Trash2, Undo2 } from 'lucide-react';
import { timeUnitMinutes, type SavedTimesheet } from '@workspace/api-zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/primitives';
import { useStagedAction } from '@/components/time-tracker';
import { ErrorNote, InternalFields, SavedTimesheetEditor, draftFromForm, type ReportForm } from '@/components/saved-timesheet-editor';
import { useToast } from '@/hooks/use-toast';
import { fmt, todayIso } from '@/lib/dates';
import { formatMinutes, type Timesheet } from '@/lib/reports';
import { downloadTimesheetCsv, printTimesheet } from '@/lib/report-export';
import { deleteTimesheetReport, saveTimesheetReport, setTimesheetPayment, summarizeTimesheetPayments, timesheetReportExport } from '@/lib/store/saved-timesheets';
import { useAppState } from '@/lib/store/store';
import type { Goal } from '@/lib/store/types';
import { cn } from '@/lib/utils';

const money = (n: number, c: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: c, currencyDisplay: 'code' }).format(n);
const day = (s: string) => fmt(s, 'MMM d, yyyy');

/** Save a frozen copy of the live composer sheet. */
export function SaveTimesheetDialog({ open, onOpenChange, goal, sheet, client, preparedBy, includeNotes }: {
  open: boolean; onOpenChange: (o: boolean) => void; goal: Goal; sheet: Timesheet; client: string; preparedBy: string; includeNotes: boolean;
}) {
  const { toast } = useToast();
  const action = useStagedAction();
  const [snap, setSnap] = useState<Timesheet | null>(null);
  const [f, setF] = useState<ReportForm | null>(null);
  const [err, setErr] = useState('');
  if (open && !snap) {
    const copy = structuredClone(sheet);
    setSnap(copy);
    setF({ title: `${goal.title} timesheet, ${day(copy.start)} to ${day(copy.end)}`, client, preparedBy, includeNotes, internalNote: '', amount: '', currency: '', paymentStatus: 'unpaid', paidDate: todayIso(),
      goalTitle: copy.goalTitle, metricName: copy.metricName, start: copy.start, end: copy.end,
      rows: copy.rows.map((r) => ({ ...r, workDone: (r.workDone ?? []).join('\n'), minutes: String(r.minutes) })) });
  }
  const close = () => { if (action.frozen) return; setSnap(null); setF(null); setErr(''); action.reset(); onOpenChange(false); };
  if (!open || !snap || !f) return null;
  const submit = () => {
    setErr('');
    const d = draftFromForm(f, snap, goal.id);
    if (typeof d === 'string') { setErr(d); return; }
    void action.run(() => { saveTimesheetReport({ ...d, sheet: { ...snap, rows: d.sheet.rows, totalMinutes: d.sheet.totalMinutes } }); }, () => {
      toast({ title: 'Timesheet saved', description: 'It stays as it is now, even if logs change later.' });
      setSnap(null); setF(null); onOpenChange(false);
    });
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto" data-testid="dialog-save-timesheet">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Save this timesheet</DialogTitle>
          <DialogDescription>Keeps a fixed copy of {snap.rows.length} row{snap.rows.length === 1 ? '' : 's'} ({formatMinutes(snap.totalMinutes)}). You can correct it later without touching your logs.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={action.frozen} className="grid min-w-0 gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">Report title (shown to client)
            <Input value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} className="h-10" data-testid="input-save-title" />
          </label>
          <InternalFields f={f} set={(p) => setF({ ...f, ...p })} />
        </fieldset>
        {(err || action.error) && <ErrorNote text={err || action.error} testId="text-save-timesheet-error" />}
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={action.frozen} onClick={close} data-testid="button-save-timesheet-cancel">Cancel</Button>
          <Button disabled={action.pending} onClick={submit} data-testid="button-save-timesheet-confirm"><Save /> {action.staged ? 'Retry saving' : action.pending ? 'Saving' : 'Save report'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SavedTimesheets({ goal }: { goal: Goal }) {
  const state = useAppState();
  const all = state.savedTimesheets ?? [];
  const records = all.filter((r) => r.goalId === goal.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ record: SavedTimesheet; key: number } | null>(null);
  const [deleting, setDeleting] = useState<SavedTimesheet | null>(null);
  const [paying, setPaying] = useState<SavedTimesheet | null>(null);
  const selected = records.find((r) => r.id === selectedId) ?? records[0];
  const summary = summarizeTimesheetPayments(records);
  const unpaidAll = records.filter((r) => r.paymentStatus === 'unpaid');
  const noAmount = unpaidAll.filter((r) => r.amount == null).length;

  if (!records.length && !goal.metrics.some((metric) => timeUnitMinutes(metric.unit) != null)) return null;

  return (
    <section className="surface p-4 sm:p-5" data-testid="section-saved-timesheets">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg">Saved timesheets</h2>
        <span className="text-xs text-muted-foreground">{records.length} for this goal</span>
      </div>
      {unpaidAll.length > 0 && (
        <div className="mb-4 rounded-lg bg-primary/5 p-3 text-sm" data-testid="panel-unpaid-summary">
          <span className="font-medium" data-testid="text-unpaid-count">{unpaidAll.length} unpaid</span> <span className="text-muted-foreground">for this goal</span>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-num">
            {summary.filter((s) => s.unpaidAmount > 0).map((s) => <span key={s.currency} data-testid={`text-owed-${s.currency}`}>{money(s.unpaidAmount, s.currency)} owed</span>)}
            {noAmount > 0 && <span className="font-sans text-muted-foreground" data-testid="text-unpaid-no-amount">{noAmount} without an amount</span>}
          </div>
        </div>
      )}
      {records.length === 0 ? (
        <EmptyState className="py-6" title="No saved timesheets yet" body="Open the client timesheet above and save it to keep a fixed copy you can correct and mark as paid." />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
          <ul className="min-w-0 space-y-1" data-testid="list-saved-timesheets">
            {records.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setSelectedId(r.id)} className={cn('w-full min-w-0 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', selected?.id === r.id && 'bg-muted')} data-testid={`button-select-saved-${r.id}`}>
                  <div className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{r.title}</span>
                    <span className={cn('shrink-0 rounded-full px-2 text-xs', r.paymentStatus === 'paid' ? 'bg-primary/10 text-primary' : 'bg-accent text-accent-foreground')} data-testid={`status-saved-payment-${r.id}`}>{r.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}</span>
                  </div>
                  <div className="font-num text-xs text-muted-foreground">{day(r.sheet.start)} – {day(r.sheet.end)} · {formatMinutes(r.sheet.totalMinutes)}{r.amount != null && r.currency ? ` · ${money(r.amount, r.currency)}` : ''}</div>
                </button>
              </li>
            ))}
          </ul>
          {selected && <Preview r={selected} onEdit={() => setEditing({ record: selected, key: Date.now() })} onDelete={() => setDeleting(selected)} onPay={() => setPaying(selected)} />}
        </div>
      )}
      {editing && (
        <SavedTimesheetEditor key={editing.key} record={editing.record} latest={all.find((r) => r.id === editing.record.id)}
          onClose={() => setEditing(null)}
          onReload={() => { const l = all.find((r) => r.id === editing.record.id); if (l) setEditing({ record: l, key: Date.now() }); }} />
      )}
      {deleting && <DeleteDialog record={deleting} latest={all.find((r) => r.id === deleting.id)} onClose={() => setDeleting(null)} />}
      {paying && <PaidDialog record={paying} onClose={() => setPaying(null)} />}
    </section>
  );
}

function Preview({ r, onEdit, onDelete, onPay }: { r: SavedTimesheet; onEdit: () => void; onDelete: () => void; onPay: () => void }) {
  const { toast } = useToast();
  const unpay = useStagedAction();
  const exp = () => timesheetReportExport(r);
  return (
    <div className="min-w-0" data-testid={`preview-saved-${r.id}`}>
      <div className="mb-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {r.sheet.goalTitle} · {r.sheet.metricName}{r.client ? ` · for ${r.client}` : ''}{r.preparedBy ? ` · by ${r.preparedBy}` : ''}
      </div>
      {(r.internalNote || r.paymentStatus === 'paid') && (
        <div className="mb-2 rounded-md bg-primary/5 p-2 text-xs" data-testid={`text-saved-internal-${r.id}`}>
          <span className="font-medium text-primary">Private</span>
          {r.paymentStatus === 'paid' && r.paidDate && <span> · paid {day(r.paidDate)}</span>}
          {r.internalNote && <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.internalNote}</p>}
        </div>
      )}
      <div className="max-h-80 min-w-0 overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[440px] text-sm" data-testid={`table-saved-${r.id}`}>
          <tbody className="divide-y divide-border/60">
            {r.sheet.rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 font-num text-xs">{fmt(row.date, 'MMM d')}</td>
                <td className="px-3 py-2 [overflow-wrap:anywhere]">{row.description}
                  {row.workDone?.length ? <ul className="ml-4 mt-1 list-disc text-xs text-muted-foreground">{row.workDone.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
                </td>
                <td className={cn('whitespace-nowrap px-3 py-2 text-right font-num', row.minutes < 0 && 'text-destructive')}>{formatMinutes(row.minutes)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/50"><tr><td colSpan={2} className="px-3 py-2 text-xs text-muted-foreground">Total</td><td className="px-3 py-2 text-right font-num font-medium" data-testid={`text-saved-total-${r.id}`}>{formatMinutes(r.sheet.totalMinutes)}</td></tr></tfoot>
        </table>
      </div>
      {unpay.error && <div className="mt-2"><ErrorNote text={unpay.error} testId="text-unpay-error" /></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {r.paymentStatus === 'unpaid'
          ? <Button size="sm" onClick={onPay} data-testid={`button-mark-paid-${r.id}`}><CircleCheck /> Mark paid</Button>
          : <Button size="sm" variant="outline" disabled={unpay.pending} onClick={() => void unpay.run(() => setTimesheetPayment(r.id, 'unpaid', r.revision), () => {})} data-testid={`button-mark-unpaid-${r.id}`}><Undo2 /> {unpay.staged ? 'Retry' : 'Mark unpaid'}</Button>}
        <Button size="sm" variant="outline" onClick={onEdit} data-testid={`button-edit-saved-${r.id}`}><Pencil /> Edit</Button>
        <Button size="sm" variant="outline" onClick={() => { const e = exp(); if (!printTimesheet(e.sheet, e.options)) toast({ title: 'Print window was blocked', description: 'Allow pop-ups for this site and try again.' }); }} data-testid={`button-print-saved-${r.id}`}><Printer /> Print</Button>
        <Button size="sm" variant="outline" onClick={() => { const e = exp(); downloadTimesheetCsv(e.sheet, e.options); }} data-testid={`button-csv-saved-${r.id}`}><FileDown /> CSV</Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete} data-testid={`button-delete-saved-${r.id}`}><Trash2 /> Delete</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Exports show only the client report. Internal notes, amounts and payment status stay here.</p>
    </div>
  );
}

function PaidDialog({ record, onClose }: { record: SavedTimesheet; onClose: () => void }) {
  const [date, setDate] = useState(todayIso);
  const action = useStagedAction();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !action.frozen) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-sm" data-testid="dialog-mark-paid">
        <DialogHeader><DialogTitle className="font-display text-xl">Mark as paid</DialogTitle><DialogDescription className="[overflow-wrap:anywhere]">{record.title}</DialogDescription></DialogHeader>
        <label className="grid gap-1 text-xs text-muted-foreground">Paid on
          <Input type="date" value={date} disabled={action.frozen} onChange={(e) => setDate(e.target.value)} className="h-10" data-testid="input-paid-date" />
        </label>
        {action.error && <ErrorNote text={action.error} testId="text-paid-error" />}
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={action.frozen} onClick={onClose} data-testid="button-paid-cancel">Cancel</Button>
          <Button disabled={!valid || action.pending} onClick={() => void action.run(() => setTimesheetPayment(record.id, 'paid', record.revision, date), onClose)} data-testid="button-paid-confirm">{action.staged ? 'Retry' : 'Mark paid'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ record, latest, onClose }: { record: SavedTimesheet; latest?: SavedTimesheet; onClose: () => void }) {
  const action = useStagedAction();
  const stale = !action.staged && (!latest || latest.revision !== record.revision);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !action.frozen) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md" data-testid="dialog-delete-saved">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Delete this saved report?</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">"{record.title}" will be deleted along with its payment status and internal note. Your original time logs will remain.</DialogDescription>
        </DialogHeader>
        {stale && <ErrorNote text="This report changed since you opened this. Close and check it before deleting." testId="text-delete-stale" />}
        {action.error && <ErrorNote text={action.error} testId="text-delete-error" />}
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={action.frozen} onClick={onClose} data-testid="button-delete-saved-cancel">Cancel</Button>
          <Button variant="destructive" disabled={stale || action.pending} onClick={() => void action.run(() => deleteTimesheetReport(record.id, record.revision), onClose)} data-testid="button-delete-saved-confirm">{action.staged ? 'Retry' : 'Delete report'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
