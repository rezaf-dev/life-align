import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, FileDown, Printer, Save } from 'lucide-react';
import { SaveTimesheetDialog } from '@/components/saved-timesheets';
import { timeUnitMinutes } from '@workspace/api-zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/primitives';
import { useToast } from '@/hooks/use-toast';
import { fmt } from '@/lib/dates';
import { useAppState } from '@/lib/store/store';
import type { Goal } from '@/lib/store/types';
import { buildTimesheet, formatMinutes } from '@/lib/reports';
import { downloadTimesheetCsv, printTimesheet } from '@/lib/report-export';
import { cn } from '@/lib/utils';

export function TimesheetPanel({ goal, start, end }: { goal: Goal; start: string; end: string }) {
  const state = useAppState();
  const { toast } = useToast();
  const timeMetrics = goal.metrics.filter((m) => timeUnitMinutes(m.unit) != null);
  const [metricId, setMetricId] = useState('');
  const [client, setClient] = useState('');
  const [preparedBy, setPreparedBy] = useState('');
  const [includeNotes, setIncludeNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const activeId = timeMetrics.some((m) => m.id === metricId) ? metricId : '';
  const sheet = useMemo(() => buildTimesheet(state, goal, activeId, start, end), [state, goal, activeId, start, end]);
  const empty = !sheet || sheet.rows.length === 0;
  const opts = { client: client.trim() || undefined, preparedBy: preparedBy.trim() || undefined, includeNotes };

  return (
    <Disclosure>
      <p className="-mt-2 mb-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">All recorded work on this goal is included by default, even without a measure. You can narrow it to one time measure below. Estimates and planned sessions are left out, and absolute checkpoints are not billable time. Nothing is sent; you print or download it yourself.</p>
      <div className="mb-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">Work to include
          <Select value={activeId || '__all_work__'} onValueChange={(v) => setMetricId(v === '__all_work__' ? '' : v)}>
            <SelectTrigger className="h-10" data-testid="select-timesheet-metric"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all_work__">All recorded work</SelectItem>{timeMetrics.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit}) only</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">Client (optional)
          <Input value={client} onChange={(e) => setClient(e.target.value)} maxLength={120} className="h-10" data-testid="input-timesheet-client" />
        </label>
        <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">Prepared by (optional)
          <Input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} maxLength={120} className="h-10" data-testid="input-timesheet-prepared-by" />
        </label>
      </div>
      <label className="mb-4 flex min-h-9 items-center gap-2 text-sm">
        <Checkbox checked={includeNotes} onCheckedChange={(v) => setIncludeNotes(v === true)} data-testid="checkbox-timesheet-notes" />
        Include private notes <span className="text-xs text-muted-foreground">internal, off by default. Work done items are always included.</span>
      </label>

      {empty ? (
        <EmptyState className="py-6" title="No recorded time in this range" body="Log time on this goal, choose all recorded work, or widen the dates." />
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-sm" data-testid="table-timesheet">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 font-normal">Date</th><th className="px-3 py-2 font-normal">Work</th><th className="px-3 py-2 text-right font-normal">Time</th></tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {sheet.rows.map((r) => (
                <tr key={r.id} data-testid={`row-timesheet-${r.id}`} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-num text-xs">{fmt(r.date, 'MMM d, yyyy')}</td>
                  <td className="px-3 py-2 [overflow-wrap:anywhere]">
                    {r.description}
                    {(r.sessionTitle && r.sessionTitle !== r.description) || r.milestone || r.kind !== 'session' ? (
                      <div className="text-xs text-muted-foreground">
                        {[r.kind === 'adjustment' ? 'Correction' : r.kind === 'contribution' ? 'Direct entry' : null, r.sessionTitle !== r.description ? r.sessionTitle : null, r.milestone].filter(Boolean).join(' · ')}
                      </div>
                    ) : null}
                    {r.workDone && r.workDone.length > 0 && (
                      <div className="mt-1" data-testid={`list-timesheet-workdone-${r.id}`}>
                        <div className="text-xs text-muted-foreground">Work done this session</div>
                        <ul className="ml-4 list-disc text-xs leading-relaxed">{r.workDone.map((w, i) => <li key={i}>{w}</li>)}</ul>
                      </div>
                    )}
                    {includeNotes && r.notes && <div className="mt-0.5 text-xs italic text-muted-foreground">{r.notes}</div>}
                  </td>
                  <td className={cn('whitespace-nowrap px-3 py-2 text-right font-num', r.minutes < 0 && 'text-destructive')}>{formatMinutes(r.minutes)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/50">
              <tr><td className="px-3 py-2 text-xs text-muted-foreground" colSpan={2}>Total &middot; {sheet.sessionCount} session{sheet.sessionCount === 1 ? '' : 's'}</td><td className="px-3 py-2 text-right font-num font-medium" data-testid="text-timesheet-total">{formatMinutes(sheet.totalMinutes)}</td></tr>
            </tfoot>
          </table>
        </div>
      )}
      {sheet && sheet.excludedCheckpoints > 0 && (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="text-timesheet-excluded">{sheet.excludedCheckpoints} absolute checkpoint{sheet.excludedCheckpoints === 1 ? '' : 's'} left out: they record a total, not work done.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={empty} onClick={() => { if (sheet && !printTimesheet(sheet, opts)) toast({ title: 'Print window was blocked', description: 'Allow pop-ups for this site and try again.' }); }} data-testid="button-timesheet-print"><Printer /> Print or save PDF</Button>
        <Button variant="outline" disabled={empty} onClick={() => sheet && downloadTimesheetCsv(sheet, opts)} data-testid="button-timesheet-csv"><FileDown /> Download CSV</Button>
        <Button variant="secondary" disabled={empty} onClick={() => setSaving(true)} data-testid="button-timesheet-save"><Save /> Save timesheet</Button>
      </div>
      {sheet && !empty && <SaveTimesheetDialog open={saving} onOpenChange={setSaving} goal={goal} sheet={sheet} client={client.trim()} preparedBy={preparedBy.trim()} includeNotes={includeNotes} />}
    </Disclosure>
  );
}

function Disclosure({ children }: { children: ReactNode }) {
  return (
    <details className="surface group p-4 sm:p-5" data-testid="details-client-timesheet">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden" data-testid="button-toggle-timesheet">
        <ChevronDown className="size-4 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0" />
        <span className="font-display text-lg">Client timesheet</span>
        <span className="text-xs text-muted-foreground">optional, for sharing recorded work</span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
