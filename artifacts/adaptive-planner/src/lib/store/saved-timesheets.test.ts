import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { savedTimesheetSchema } from '@workspace/api-zod';
import { emptyWorkspace, getState, hydrateState, setWorkspaceWriter, update } from './store';
import { addGoal, deleteGoal, deleteMetric, removeSampleData } from './actions';
import { recordUnplannedSession, deleteWorkSession } from './sessions';
import { editLoggedWorkSession } from './time-tracking';
import { saveTimesheetReport, setTimesheetPayment, deleteTimesheetReport, summarizeTimesheetPayments, timesheetReportExport, type TimesheetReportDraft } from './saved-timesheets';
import { buildTimesheet } from '../reports';
import { timesheetCsv, timesheetHtml } from '../report-export';
import { stateSchema } from '../../../../api-server/src/lib/planner-state';
let goalId: string, metricId: string, sessionId: string;
const state = () => getState();
const report = (id: string) => state().savedTimesheets!.find((item) => item.id === id)!;
function draft(): TimesheetReportDraft {
  return {
    goalId, title: 'January client work', client: 'Client A', preparedBy: 'Consultant',
    internalNote: 'INTERNAL_REPORT_ONLY', paymentStatus: 'unpaid', amount: 100, currency: 'USD', includeNotes: false,
    sheet: buildTimesheet(state(), state().goals.find((g) => g.id === goalId)!, metricId, '2024-01-01', '2024-01-31'),
  };
}
beforeEach(() => {
  hydrateState(emptyWorkspace()); setWorkspaceWriter(() => {});
  goalId = addGoal({ title: 'Client project', outcome: '', area: 'business', priority: 'medium', targetDate: '2030-01-01',
    metric: { name: 'Project hours', unit: 'hours', kind: 'leading', baseline: 0, target: 30, startDate: '2024-01-01' } });
  metricId = state().goals[0].metrics[0].id;
  sessionId = recordUnplannedSession({ title: 'Project work', goalId, metricId, plannedMinutes: 0, recurrence: 'none', taskIds: [], notes: 'SESSION_PRIVATE' },
    { date: '2024-01-15', actualMinutes: 90, allocations: [], workDone: ['Built email templates'] });
});

test('all-work snapshots save, reload and export unmeasured time without changing source logs', () => {
  recordUnplannedSession({ title: 'Time-only work', goalId, plannedMinutes: 0, recurrence: 'none', taskIds: [], notes: 'DO_NOT_EXPORT' },
    { date: '2024-01-15', actualMinutes: 30, allocations: [], workDone: ['Client handover'] });
  const input = draft();
  input.sheet = buildTimesheet(state(), state().goals.find((g) => g.id === goalId)!, '', '2024-01-01', '2024-01-31');
  const id = saveTimesheetReport(input);
  hydrateState(stateSchema.parse(structuredClone(state())));
  assert.equal(report(id).sheet.metricId, '');
  assert.equal(report(id).sheet.totalMinutes, 120);
  const exported = timesheetReportExport(report(id));
  assert.ok(timesheetHtml(exported.sheet, exported.options).includes('Client handover'));
  assert.ok(!timesheetHtml(exported.sheet, exported.options).includes('DO_NOT_EXPORT'));
  assert.equal(state().sessions!.length, 2);
});

test('a saved timesheet is a durable independent snapshot, not a live link to time logs', () => {
  const input = draft();
  const id = saveTimesheetReport(input);
  input.sheet.rows[0].description = 'Mutated outside the store';
  assert.equal(report(id).sheet.rows[0].description, 'Project work');
  hydrateState(stateSchema.parse(structuredClone(state())));
  assert.equal(report(id).internalNote, 'INTERNAL_REPORT_ONLY');
  editLoggedWorkSession(sessionId, { title: 'Corrected log', goalId, metricId, date: '2024-01-15', actualMinutes: 120, allocations: [], workDone: ['New accomplishment'] });
  assert.equal(report(id).sheet.totalMinutes, 90);
  assert.deepEqual(report(id).sheet.rows[0].workDone, ['Built email templates']);
  deleteWorkSession(sessionId);
  deleteMetric(goalId, metricId);
  assert.equal(report(id).sheet.totalMinutes, 90);
  assert.ok(stateSchema.safeParse(state()).success);
});

test('edits recalculate report totals without changing original time or goal credit; notes can be added, edited and cleared', () => {
  const id = saveTimesheetReport(draft());
  const sessions = structuredClone(state().sessions), goals = structuredClone(state().goals);
  const changed = structuredClone(report(id));
  changed.title = 'Corrected client title'; changed.internalNote = 'Follow up Friday';
  changed.sheet.rows[0].description = 'Configured provider';
  changed.sheet.rows[0].minutes = 120; changed.sheet.totalMinutes = 9999;
  saveTimesheetReport(changed, id, 1);
  assert.equal(report(id).sheet.totalMinutes, 120);
  assert.equal(report(id).revision, 2);
  assert.equal(report(id).internalNote, 'Follow up Friday');
  assert.deepEqual(state().sessions, sessions);
  assert.deepEqual(state().goals, goals);
  saveTimesheetReport({ ...report(id), internalNote: '' }, id, 2);
  assert.equal(report(id).internalNote, '');
});

test('paid/unpaid status has a real payment date and stale dialogs cannot overwrite newer payment state', () => {
  const id = saveTimesheetReport(draft());
  setTimesheetPayment(id, 'paid', 1, '2024-02-05');
  assert.equal(report(id).paymentStatus, 'paid');
  assert.equal(report(id).paidDate, '2024-02-05');
  const before = structuredClone(state());
  assert.throws(() => saveTimesheetReport(draft(), id, 1));
  assert.throws(() => deleteTimesheetReport(id, 1));
  assert.throws(() => setTimesheetPayment(id, 'unpaid', 1));
  assert.deepEqual(state(), before);
  setTimesheetPayment(id, 'unpaid', 2);
  assert.equal(report(id).paidDate, undefined);
  assert.equal(report(id).paymentStatus, 'unpaid');
  assert.equal(state().sessions!.length, 1);
  assert.equal(state().sessions![0].actualMinutes, 90);
});

test('internal report notes and payment details never appear in client exports, even with session notes opted in', () => {
  const id = saveTimesheetReport({ ...draft(), amount: 987654.32, includeNotes: true, title: 'Client <script>custom</script>' });
  const exported = timesheetReportExport(report(id));
  const csv = timesheetCsv(exported.sheet, exported.options), html = timesheetHtml(exported.sheet, exported.options);
  for (const output of [csv, html, JSON.stringify(exported)]) {
    assert.ok(!output.includes('INTERNAL_REPORT_ONLY'));
    assert.ok(!output.includes('987654.32'));
    assert.ok(!output.includes('paymentStatus'));
  }
  assert.ok(csv.includes('SESSION_PRIVATE') && html.includes('SESSION_PRIVATE'));
  assert.ok(html.includes('<h1>Client &lt;script&gt;custom&lt;/script&gt;</h1>'));
  assert.ok(!html.includes('<script>'));
  saveTimesheetReport({ ...report(id), includeNotes: false }, id, 1);
  const privateOff = timesheetReportExport(report(id));
  assert.ok(!timesheetCsv(privateOff.sheet, privateOff.options).includes('SESSION_PRIVATE'));
});

test('payment summaries separate currencies and do not invent amounts for unpriced reports', () => {
  saveTimesheetReport({ ...draft(), amount: 0.1 });
  saveTimesheetReport({ ...draft(), amount: 0.2 });
  saveTimesheetReport({ ...draft(), amount: 25, currency: 'EUR' });
  const paid = saveTimesheetReport({ ...draft(), amount: 0.4 });
  setTimesheetPayment(paid, 'paid', 1, '2024-02-01');
  const unpriced = saveTimesheetReport({ ...draft(), amount: undefined });
  assert.equal(report(unpriced).currency, undefined);
  assert.deepEqual(summarizeTimesheetPayments(state().savedTimesheets!), [
    { currency: 'EUR', unpaidAmount: 25, paidAmount: 0, unpaidCount: 1, paidCount: 0 },
    { currency: 'USD', unpaidAmount: 0.3, paidAmount: 0.4, unpaidCount: 2, paidCount: 1 },
  ]);
});

test('money precision, period bounds and malformed snapshots fail atomically', () => {
  const before = structuredClone(state());
  for (const patch of [{ amount: -1 }, { amount: NaN }, { amount: 0.001 }, { currency: '' }, { currency: 'US' }, { amount: 1.5, currency: 'JPY' }]) {
    assert.throws(() => saveTimesheetReport({ ...draft(), ...patch }));
    assert.deepEqual(state(), before);
  }
  const outside = draft(); outside.sheet.start = '2024-01-16';
  assert.throws(() => saveTimesheetReport(outside));
  assert.deepEqual(state(), before);
  const id = saveTimesheetReport({ ...draft(), amount: 150, currency: 'jpy' });
  assert.equal(report(id).currency, 'JPY');
  assert.ok(savedTimesheetSchema.safeParse(report(id)).success);
});

test('deleting a report removes its notes and payment record but never its source time logs', () => {
  const id = saveTimesheetReport(draft());
  assert.throws(() => deleteGoal(goalId));
  deleteTimesheetReport(id, 1);
  assert.equal(state().savedTimesheets!.length, 0);
  assert.equal(state().sessions![0].actualMinutes, 90);
  assert.doesNotThrow(() => deleteGoal(goalId));
});

test('sample-data removal and server validation protect saved financial history', () => {
  update((s) => { s.goals[0].isDemo = true; });
  const id = saveTimesheetReport(draft());
  assert.throws(() => removeSampleData());
  assert.ok(report(id));
  const orphan = structuredClone(state()); orphan.goals = [];
  assert.ok(!stateSchema.safeParse(orphan).success);
  const duplicate = structuredClone(state()); duplicate.savedTimesheets!.push(structuredClone(report(id)));
  assert.ok(!stateSchema.safeParse(duplicate).success);
});

test('failed persistence publishes neither a new report nor changed payment state', () => {
  const id = saveTimesheetReport(draft());
  const before = structuredClone(state());
  setWorkspaceWriter(() => { throw new Error('Save unavailable'); });
  assert.throws(() => saveTimesheetReport(draft()));
  assert.throws(() => setTimesheetPayment(id, 'paid', 1, '2024-02-01'));
  assert.throws(() => deleteTimesheetReport(id, 1));
  assert.deepEqual(state(), before);
});
