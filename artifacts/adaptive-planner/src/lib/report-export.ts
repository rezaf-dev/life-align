import { formatMinutes, type Timesheet } from './reports';

export interface TimesheetExportOptions { client?: string; preparedBy?: string; includeNotes?: boolean }
const html = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// Quoting alone does not stop spreadsheet formula execution, including after whitespace.
const cell = (value: string | number) => {
  const safe = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : String(value);
  return `"${safe.replace(/"/g, '""')}"`;
};
const number = (value: number) => Math.round(value * 1000000) / 1000000;

export function timesheetCsv(sheet: Timesheet, options: TimesheetExportOptions = {}): string {
  const rows: (string | number)[][] = [
    ['Timesheet', sheet.goalTitle], ['Measure', sheet.metricName], ['Period', sheet.start, sheet.end],
    ...(options.client?.trim() ? [['Client', options.client.trim()]] : []),
    ...(options.preparedBy?.trim() ? [['Prepared by', options.preparedBy.trim()]] : []),
    [],
    ['Date', 'Work performed', 'Session', 'Milestone', 'Minutes', 'Hours', 'Type', ...(options.includeNotes ? ['Notes'] : [])],
    ...sheet.rows.map((r) => [r.date, r.description, r.sessionTitle ?? '', r.milestone ?? '', number(r.minutes), number(r.minutes / 60), r.kind, ...(options.includeNotes ? [r.notes ?? ''] : [])]),
    ['', 'Total', '', '', number(sheet.totalMinutes), number(sheet.totalMinutes / 60), '', ...(options.includeNotes ? [''] : [])],
  ];
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Self-contained client document: no auth tokens, internal strategy, app chrome or external assets. */
export function timesheetHtml(sheet: Timesheet, options: TimesheetExportOptions = {}): string {
  const work = sheet.rows.map((r) => `<tr><td class="date">${html(r.date)}</td><td><strong>${html(r.description)}</strong>${r.sessionTitle && r.sessionTitle !== r.description ? `<div class="detail">${html(r.sessionTitle)}</div>` : ''}${r.milestone ? `<div class="detail">Milestone: ${html(r.milestone)}</div>` : ''}${r.kind === 'adjustment' ? '<div class="detail">Time adjustment</div>' : ''}${options.includeNotes && r.notes ? `<p class="notes">${html(r.notes)}</p>` : ''}</td><td class="duration">${html(formatMinutes(r.minutes))}</td><td class="duration">${number(r.minutes / 60)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Timesheet — ${html(sheet.goalTitle)}</title><style>
*{box-sizing:border-box}body{font:14px/1.5 system-ui,sans-serif;color:#172025;background:white;margin:0;padding:40px}main{max-width:900px;margin:auto}h1{font-size:30px;line-height:1.2;margin:0 0 8px}h2{font-size:20px;margin:0 0 24px}p{margin:4px 0}.meta{margin:20px 0 28px;color:#47515a}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{padding:12px 8px;border-bottom:1px solid #d7dcdf;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{font-size:12px;color:#47515a;font-weight:600}.date{width:108px;white-space:nowrap}.duration{width:100px;text-align:right;font-variant-numeric:tabular-nums}.detail{font-size:12px;color:#57616a;margin-top:3px}.notes{white-space:pre-wrap;font-size:12px;font-weight:400}tfoot td{border-top:2px solid #172025;font-weight:700;font-size:16px}.foot{font-size:12px;color:#57616a;margin-top:24px}button{padding:10px 16px;margin-bottom:24px;border:1px solid #bbb;background:#fff;border-radius:6px;cursor:pointer}@page{size:A4;margin:16mm}@media print{body{padding:0}button{display:none}thead{display:table-header-group}tfoot{display:table-row-group}tr{break-inside:avoid}h1,h2{break-after:avoid}}@media(max-width:600px){body{padding:16px}.date{width:86px}.duration{width:64px}th,td{padding:8px 4px;font-size:12px}}
</style></head><body><main><button type="button" onclick="window.print()">Print / Save as PDF</button><h1>Timesheet</h1><h2>${html(sheet.goalTitle)}</h2><div class="meta"><p>${html(sheet.start)} – ${html(sheet.end)} · ${html(sheet.metricName)}</p>${options.client?.trim() ? `<p>Client: ${html(options.client.trim())}</p>` : ''}${options.preparedBy?.trim() ? `<p>Prepared by: ${html(options.preparedBy.trim())}</p>` : ''}</div><table><thead><tr><th class="date">Date</th><th>Work performed</th><th class="duration">Duration</th><th class="duration">Hours</th></tr></thead><tbody>${work}</tbody><tfoot><tr><td colspan="2">Total</td><td class="duration">${html(formatMinutes(sheet.totalMinutes))}</td><td class="duration">${number(sheet.totalMinutes / 60)}</td></tr></tfoot></table><p class="foot">Actual recorded time only. Planned time and estimates are excluded.${sheet.rows.some((r) => r.kind === 'adjustment') ? ' Signed time adjustments are included in the total.' : ''} This is a timesheet, not an invoice.</p></main></body></html>`;
}
export function downloadTimesheetCsv(sheet: Timesheet, options: TimesheetExportOptions = {}) {
  const blob = new Blob([timesheetCsv(sheet, options)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const name = sheet.goalTitle.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 70) || 'project';
  link.download = `${name}-timesheet-${sheet.start}-${sheet.end}.csv`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function printTimesheet(sheet: Timesheet, options: TimesheetExportOptions = {}): boolean {
  const popup = window.open('', '_blank');
  if (!popup) return false;
  popup.opener = null;
  popup.document.open(); popup.document.write(timesheetHtml(sheet, options)); popup.document.close();
  // The isolated report has its own print button; no automatic popup/print on rendering the app.
  popup.focus();
  return true;
}
