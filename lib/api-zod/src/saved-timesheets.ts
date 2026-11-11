import { z } from 'zod';
import { isMeasurementDate } from './measurements';
import { timeUnitMinutes, workDoneListSchema } from './work-sessions';

const date = z.string().refine(isMeasurementDate, 'Choose a real date.');
export const timesheetSnapshotSchema = z.object({
  goalId: z.string().min(1), goalTitle: z.string().trim().min(1).max(500),
  metricId: z.string(), metricName: z.string().trim().min(1).max(500),
  unit: z.string().refine((unit) => timeUnitMinutes(unit) !== null, 'Choose a time measure.'),
  start: date, end: date,
  rows: z.array(z.object({
    id: z.string().min(1), date,
    description: z.string().trim().min(1).max(5000),
    sessionId: z.string().optional(), sessionTitle: z.string().max(5000).optional(),
    milestone: z.string().max(5000).optional(), minutes: z.number().finite(),
    notes: z.string().max(20000).optional(), workDone: workDoneListSchema.optional(),
    kind: z.enum(['session', 'contribution', 'adjustment']),
  })).min(1, 'A saved timesheet needs at least one work row.').max(10000),
  totalMinutes: z.number().finite(),
  sessionCount: z.number().int().min(0),
  excludedCheckpoints: z.number().int().min(0),
}).superRefine((sheet, ctx) => {
  const days = (Date.parse(`${sheet.end}T12:00:00Z`) - Date.parse(`${sheet.start}T12:00:00Z`)) / 86400000;
  if (days < 0 || days > 3660) ctx.addIssue({ code: 'custom', message: 'Choose an ordered report period of ten years or less.' });
  if (sheet.rows.some((row) => row.date < sheet.start || row.date > sheet.end)) ctx.addIssue({ code: 'custom', message: 'Every work date must be inside the report period. Adjust the dates or the period.' });
  if (new Set(sheet.rows.map((row) => row.id)).size !== sheet.rows.length) ctx.addIssue({ code: 'custom', message: 'Each timesheet row needs its own identity.' });
  const total = sheet.rows.reduce((sum, row) => sum + row.minutes, 0);
  if (!Number.isFinite(total) || Math.abs(total - sheet.totalMinutes) > 1e-7) ctx.addIssue({ code: 'custom', message: 'The timesheet total must match its work rows.' });
});

export function currencyPrecision(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export const savedTimesheetSchema = z.object({
  id: z.string().min(1), goalId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  client: z.string().trim().max(500), preparedBy: z.string().trim().max(500),
  internalNote: z.string().max(20000),
  paymentStatus: z.enum(['unpaid', 'paid']), paidDate: date.optional(),
  amount: z.number().finite().min(0).max(1e9).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.').optional(),
  includeNotes: z.boolean(),
  sheet: timesheetSnapshotSchema,
  revision: z.number().int().min(1),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).superRefine((report, ctx) => {
  if (report.goalId !== report.sheet.goalId) ctx.addIssue({ code: 'custom', message: 'The snapshot must belong to this goal.' });
  if ((report.paymentStatus === 'paid') !== !!report.paidDate) ctx.addIssue({ code: 'custom', message: 'Paid reports need a payment date; unpaid reports must not have one.' });
  if (report.amount !== undefined) {
    if (!report.currency) ctx.addIssue({ code: 'custom', message: 'Choose a currency for the amount.' });
    else if (/^[A-Z]{3}$/.test(report.currency)) {
      const factor = 10 ** currencyPrecision(report.currency);
      if (Math.abs(report.amount * factor - Math.round(report.amount * factor)) > 1e-5) {
        ctx.addIssue({ code: 'custom', message: `Use at most ${currencyPrecision(report.currency)} decimal places for ${report.currency}.` });
      }
    }
  }
});
export type SavedTimesheet = z.infer<typeof savedTimesheetSchema>;
