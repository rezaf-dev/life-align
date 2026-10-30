import { savedTimesheetSchema, currencyPrecision, type SavedTimesheet } from '@workspace/api-zod';
import { todayIso, uid } from '@/lib/dates';
import type { Timesheet } from '@/lib/reports';
import type { TimesheetExportOptions } from '@/lib/report-export';
import { update } from './store';
import type { AppState } from './types';

export type TimesheetReportDraft = Omit<SavedTimesheet, 'id' | 'revision' | 'createdAt' | 'updatedAt'>;

function currentReport(state: AppState, id: string, revision?: number) {
  const report = state.savedTimesheets?.find((item) => item.id === id);
  if (!report) throw new Error('This saved timesheet was removed. Close this editor and check the current list.');
  if (revision !== report.revision) throw new Error('This timesheet changed elsewhere. Keep your draft, then reopen the latest version before updating it.');
  return report;
}
function normalized(input: TimesheetReportDraft): TimesheetReportDraft {
  const draft = structuredClone(input);
  draft.sheet.totalMinutes = draft.sheet.rows.reduce((total, row) => total + row.minutes, 0);
  draft.sheet.sessionCount = new Set(draft.sheet.rows.filter((row) => row.kind === 'session').map((row) => row.sessionId ?? row.id.split(':')[0])).size;
  draft.paidDate = draft.paymentStatus === 'paid' ? draft.paidDate || todayIso() : undefined;
  if (draft.paidDate && draft.paidDate > todayIso()) throw new Error('The payment date cannot be in the future.');
  if (draft.amount === undefined) draft.currency = undefined;
  return draft;
}

/** Saving copies the report. It never changes time logs or goal contributions. */
export function saveTimesheetReport(input: TimesheetReportDraft, id?: string, expectedRevision?: number): string {
  const result = id ?? uid();
  update((state) => {
    if (!state.goals.some((goal) => goal.id === input.goalId)) throw new Error('Choose an existing goal for this report.');
    const existing = id ? currentReport(state, id, expectedRevision) : undefined;
    if (existing && existing.goalId !== input.goalId) throw new Error('A saved report cannot be moved to another goal.');
    const now = new Date().toISOString();
    const report = savedTimesheetSchema.parse({
      ...normalized(input), id: result, revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    if (existing) Object.assign(existing, report);
    else {
      if ((state.savedTimesheets?.length ?? 0) >= 1000) throw new Error('This workspace has reached the limit of 1,000 saved timesheets.');
      (state.savedTimesheets ??= []).unshift(report);
    }
  });
  return result;
}

export function setTimesheetPayment(id: string, status: 'paid' | 'unpaid', expectedRevision: number, paidDate?: string) {
  update((state) => {
    const report = currentReport(state, id, expectedRevision);
    const next = savedTimesheetSchema.parse({
      ...normalized({ ...report, paymentStatus: status, paidDate }), revision: report.revision + 1,
      id: report.id, createdAt: report.createdAt, updatedAt: new Date().toISOString(),
    });
    Object.assign(report, next);
  });
}

export function deleteTimesheetReport(id: string, expectedRevision: number) {
  update((state) => {
    currentReport(state, id, expectedRevision);
    state.savedTimesheets = state.savedTimesheets!.filter((report) => report.id !== id);
  });
}

/** Explicit client-only projection: report notes and payment metadata never enter exports. */
export function timesheetReportExport(report: SavedTimesheet): { sheet: Timesheet; options: TimesheetExportOptions } {
  const source = report.sheet;
  return {
    sheet: {
      goalId: source.goalId, goalTitle: source.goalTitle, metricId: source.metricId, metricName: source.metricName,
      unit: source.unit, start: source.start, end: source.end, totalMinutes: source.totalMinutes,
      sessionCount: source.sessionCount, excludedCheckpoints: source.excludedCheckpoints,
      rows: source.rows.map((row) => ({
        id: row.id, date: row.date, description: row.description, sessionId: row.sessionId,
        sessionTitle: row.sessionTitle, milestone: row.milestone, minutes: row.minutes, kind: row.kind,
        workDone: row.workDone ? [...row.workDone] : undefined, notes: report.includeNotes ? row.notes : undefined,
      })),
    },
    options: { title: report.title, client: report.client, preparedBy: report.preparedBy, includeNotes: report.includeNotes },
  };
}

export function summarizeTimesheetPayments(reports: SavedTimesheet[]) {
  const groups = new Map<string, { currency: string; unpaidAmount: number; paidAmount: number; unpaidCount: number; paidCount: number }>();
  for (const report of reports) {
    if (report.amount === undefined || !report.currency) continue;
    const item = groups.get(report.currency) ?? { currency: report.currency, unpaidAmount: 0, paidAmount: 0, unpaidCount: 0, paidCount: 0 };
    const factor = 10 ** currencyPrecision(report.currency);
    const key = report.paymentStatus === 'paid' ? 'paidAmount' : 'unpaidAmount';
    item[key] = (Math.round(item[key] * factor) + Math.round(report.amount * factor)) / factor;
    item[report.paymentStatus === 'paid' ? 'paidCount' : 'unpaidCount']++;
    groups.set(report.currency, item);
  }
  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
