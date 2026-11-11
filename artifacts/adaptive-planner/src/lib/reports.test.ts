import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGoalReport, buildTimesheet, formatMinutes, validateReportRange } from './reports';
import { timesheetCsv, timesheetHtml } from './report-export';
import type { AppState, Goal, Metric, WorkSession } from './store/types';

function fixture() {
  const metric: Metric = { id: 'hours', name: 'Client work', unit: 'hours', kind: 'leading', baseline: 0, target: 30,
    frequency: 'monthly', startDate: '2024-01-01', entries: [] };
  const goal: Goal = { id: 'project', title: 'Client project', outcome: 'PRIVATE OUTCOME', area: 'business', priority: 'high',
    targetDate: '2024-12-31', status: 'active', strategy: { summary: 'PRIVATE STRATEGY', rationale: 'PRIVATE RATIONALE', updatedAt: '' },
    milestones: [], metrics: [metric], history: [], createdAt: '2024-01-01', isDemo: false };
  const state = { goals: [goal], tasks: [], sessions: [] } as unknown as AppState;
  const session: WorkSession = { id: 'session', title: 'Project work', goalId: goal.id, metricId: metric.id,
    plannedDate: '2024-01-15', plannedMinutes: 120, recurrence: 'none', taskIds: ['email'], notes: 'PRIVATE SESSION NOTE',
    status: 'logged', date: '2024-01-15', actualMinutes: 60,
    allocations: [{ taskId: 'email', taskTitle: 'Configure email', minutes: 40, milestoneTitle: 'Launch' }],
    createdAt: '2024-01-15' };
  state.sessions!.push(session);
  metric.entries.push({ id: 'mirror-task', date: '2024-01-15', value: 2 / 3, mode: 'contribution',
    source: { sessionId: session.id, sessionTitle: session.title, taskId: 'email', taskTitle: 'Configure email' } },
  { id: 'mirror-general', date: '2024-01-15', value: 1 / 3, mode: 'contribution', source: { sessionId: session.id, sessionTitle: session.title } });
  return { state, goal, metric, session };
}
test('timesheets count canonical allocations plus remainder once, not the mirrored ledger or estimates', () => {
  const { state, goal } = fixture();
  state.sessions!.push({ ...state.sessions![0], id: 'planned', status: 'planned', actualMinutes: undefined, date: undefined, allocations: [] });
  const sheet = buildTimesheet(state, goal, 'hours', '2024-01-15', '2024-01-15');
  assert.equal(sheet.totalMinutes, 60);
  assert.equal(sheet.rows.length, 2);
  assert.deepEqual(sheet.rows.map((r) => r.minutes).sort((a, b) => a - b), [20, 40]);
  assert.equal(sheet.sessionCount, 1);
});
test('timesheets scope both goal and measure, exclude time-only sessions, and include boundary dates', () => {
  const { state, goal, session } = fixture();
  state.sessions!.push({ ...session, id: 'other-metric', metricId: 'internal', actualMinutes: 120 },
    { ...session, id: 'other-goal', goalId: 'other' }, { ...session, id: 'time-only', metricId: undefined },
    { ...session, id: 'too-late', date: '2024-01-16' }, { ...session, id: 'too-early', date: '2024-01-14' });
  assert.equal(buildTimesheet(state, goal, 'hours', '2024-01-15', '2024-01-15').totalMinutes, 60);
  assert.equal(buildTimesheet(state, goal, 'hours', '2024-01-16', '2024-01-16').totalMinutes, 60);
});
test('all-work timesheets include unmeasured goal time once, preserve work done, and keep unrelated work out', () => {
  const { state, goal, session } = fixture();
  state.sessions!.push(
    { ...session, id: 'unmeasured', metricId: undefined, actualMinutes: 30, allocations: [], workDone: ['Verified DNS', 'Sent handover'] },
    { ...session, id: 'unrelated', goalId: 'other', metricId: undefined },
    { ...session, id: 'general', goalId: '', metricId: undefined },
    { ...session, id: 'planned', status: 'planned', actualMinutes: undefined, allocations: [] },
  );
  const sheet = buildTimesheet(state, goal, '', '2024-01-15', '2024-01-15');
  assert.equal(sheet.totalMinutes, 90);
  assert.equal(sheet.sessionCount, 2);
  assert.equal(sheet.metricId, '');
  assert.deepEqual(sheet.rows.find((r) => r.sessionId === 'unmeasured')!.workDone, ['Verified DNS', 'Sent handover']);
  for (const exported of [timesheetCsv(sheet), timesheetHtml(sheet)]) {
    assert.ok(exported.includes('Verified DNS'));
    assert.ok(!exported.includes('PRIVATE SESSION NOTE'));
  }
});
test('client timesheets work for goals without any time measure', () => {
  const { state, goal, session } = fixture();
  goal.metrics = [];
  session.metricId = undefined;
  const sheet = buildTimesheet(state, goal, '', '2024-01-15', '2024-01-15');
  assert.equal(sheet.totalMinutes, 60);
  assert.equal(sheet.metricName, 'All recorded work');
  assert.ok(timesheetHtml(sheet).includes('Configure email'));
});
test('manual time, signed corrections and checkpoints remain distinct from session time', () => {
  const { state, goal, metric } = fixture();
  metric.entries.push({ id: 'manual', date: '2024-01-16', mode: 'contribution', value: 0.5, source: { taskId: 'removed', taskTitle: 'Historical work' } },
    { id: 'adjustment', date: '2024-01-17', mode: 'contribution', value: -0.25 },
    { id: 'absolute', date: '2024-01-18', value: 10 });
  const sheet = buildTimesheet(state, goal, 'hours', '2024-01-01', '2024-01-31');
  assert.equal(sheet.totalMinutes, 75);
  assert.equal(sheet.excludedCheckpoints, 1);
  assert.equal(sheet.rows.find((r) => r.id === 'adjustment')!.kind, 'adjustment');
  assert.equal(sheet.rows.find((r) => r.id === 'manual')!.description, 'Historical work');
  assert.equal(buildGoalReport(state, goal, '2024-01-01', '2024-01-31').measures[0].periods[0].endValue, 10);
});
test('minute measures stay minutes and non-time or unrelated measures cannot make a timesheet', () => {
  const { state, goal, metric, session } = fixture();
  metric.unit = 'minutes';
  metric.entries = [{ id: 'manual', date: '2024-01-16', value: 15, mode: 'contribution' }];
  assert.equal(buildTimesheet(state, goal, 'hours', '2024-01-01', '2024-01-31').totalMinutes, 75);
  session.actualMinutes = 45; session.allocations[0].minutes = 30;
  assert.equal(buildTimesheet(state, goal, 'hours', '2024-01-01', '2024-01-31').totalMinutes, 60);
  metric.unit = 'customers';
  assert.throws(() => buildTimesheet(state, goal, 'hours', '2024-01-01', '2024-01-31'));
  assert.throws(() => buildTimesheet(state, goal, 'other', '2024-01-01', '2024-01-31'));
});
test('corrected and removed sessions are immediately reflected without mutating the workspace', () => {
  const { state, goal, session } = fixture();
  const before = structuredClone(state);
  buildTimesheet(state, goal, 'hours', '2024-01-01', '2024-01-31');
  buildGoalReport(state, goal, '2024-01-01', '2024-01-31');
  assert.deepEqual(state, before);
  session.date = '2024-02-01'; session.actualMinutes = 45; session.allocations[0].minutes = 30;
  assert.equal(buildTimesheet(state, goal, 'hours', '2024-01-01', '2024-01-31').totalMinutes, 0);
  assert.equal(buildTimesheet(state, goal, 'hours', '2024-02-01', '2024-02-01').totalMinutes, 45);
  state.sessions = [];
  assert.equal(buildTimesheet(state, goal, 'hours', '2024-02-01', '2024-02-01').totalMinutes, 0);
});
test('progress over monthly or weekly resets uses separate period changes rather than subtracting across periods', () => {
  const { state, goal, metric } = fixture();
  metric.entries = [{ id: 'jan', date: '2024-01-31', value: 2, mode: 'contribution' },
    { id: 'feb', date: '2024-02-01', value: 3, mode: 'contribution' }];
  let rows = buildGoalReport(state, goal, '2024-01-31', '2024-02-01').measures[0].periods;
  assert.deepEqual(rows.map((r) => r.change), [2, 3]);
  assert.deepEqual(rows.map((r) => r.startValue), [0, 0]);
  assert.ok(rows.every((r) => !r.fullPeriod));
  metric.frequency = 'weekly';
  metric.entries = [{ id: 'sun', date: '2024-01-07', value: 2, mode: 'contribution' },
    { id: 'mon', date: '2024-01-08', value: 1, mode: 'contribution' }];
  rows = buildGoalReport(state, goal, '2024-01-07', '2024-01-08').measures[0].periods;
  assert.deepEqual(rows.map((r) => r.change), [2, 1]);
});
test('selected-window change excludes preceding work while the period total and full target remain clear', () => {
  const { state, goal, metric } = fixture();
  metric.startDate = '2024-01-15';
  metric.entries.push({ id: 'extra', date: '2024-01-16', mode: 'contribution', value: 2 });
  const period = buildGoalReport(state, goal, '2024-01-16', '2024-01-17').measures[0].periods[0];
  assert.equal(period.startValue, 1); assert.equal(period.endValue, 3); assert.equal(period.change, 2);
  assert.equal(period.target, 30 * 17 / 31);
  assert.equal(buildGoalReport(state, goal, '2024-01-01', '2024-01-14').measures[0].periods.length, 0);
  metric.frequency = 'cumulative';
  const cumulative = buildGoalReport(state, goal, '2024-01-16', '2024-01-17').measures[0].periods[0];
  assert.equal(cumulative.change, 2); assert.equal(cumulative.endValue, 3);
});
test('internal session totals include time-only work and completed history without confusing plans and actuals', () => {
  const { state, goal, session } = fixture();
  state.sessions!.push({ ...session, id: 'unplanned', metricId: undefined, plannedDate: undefined, plannedMinutes: 0, actualMinutes: 15, allocations: [] });
  state.tasks.push({ id: 'done', goalId: goal.id, title: 'Delivered', status: 'done', completedAt: '2024-01-15T12:00', archived: true } as AppState['tasks'][number]);
  goal.milestones.push({ id: 'launch', title: 'Launch', dueDate: '2024-01-31', done: true, completedAt: '2024-01-15T16:00' });
  const report = buildGoalReport(state, goal, '2024-01-01', '2024-01-31');
  assert.equal(report.actualMinutes, 75); assert.equal(report.plannedMinutes, 120); assert.equal(report.sessionCount, 2);
  assert.equal(report.completedTasks.length, 1); assert.equal(report.completedMilestones.length, 1);
});
test('CSV and printable documents are share-safe by default, opt in notes, and escape hostile text', () => {
  const { state, goal, metric } = fixture();
  goal.title = '<script>bad()</script>';
  metric.entries.push({ id: 'hostile', date: '2024-01-16', mode: 'contribution', value: 1,
    source: { taskId: 'removed', taskTitle: '=HYPERLINK("evil","click")' }, note: 'PRIVATE DIRECT NOTE' });
  const sheet = buildTimesheet(state, goal, 'hours', '2024-01-01', '2024-01-31');
  const csv = timesheetCsv(sheet, { client: ' \t=evil()', preparedBy: 'ACME, "Team"' });
  assert.ok(csv.includes(`"'=HYPERLINK(""evil"",""click"")"`));
  assert.ok(csv.includes(`"'=evil()"`));
  assert.ok(csv.includes(`"ACME, ""Team"""`));
  const document = timesheetHtml(sheet, { client: '<img src=x onerror=bad()>' });
  assert.ok(document.includes('&lt;script&gt;'));
  assert.ok(document.includes('&lt;img'));
  for (const output of [csv, document]) {
    assert.ok(!output.includes('PRIVATE SESSION NOTE'));
    assert.ok(!output.includes('PRIVATE DIRECT NOTE'));
    assert.ok(!output.includes('PRIVATE STRATEGY'));
    assert.ok(!output.includes('PRIVATE OUTCOME'));
  }
  assert.ok(!document.includes('<script>bad()'));
  assert.ok(timesheetCsv(sheet, { includeNotes: true }).includes('PRIVATE SESSION NOTE'));
  assert.ok(timesheetHtml(sheet, { includeNotes: true }).includes('PRIVATE DIRECT NOTE'));
});
test('empty periods, valid leap dates and invalid date ranges are explicit', () => {
  const { state, goal } = fixture();
  assert.equal(buildTimesheet(state, goal, 'hours', '2024-02-01', '2024-02-29').totalMinutes, 0);
  assert.equal(validateReportRange('2024-02-29', '2024-02-29'), null);
  assert.ok(validateReportRange('2023-02-29', '2024-01-01'));
  assert.ok(validateReportRange('2024-02-01', '2024-01-01'));
  assert.ok(validateReportRange('2000-01-01', '2024-01-01'));
  assert.throws(() => buildGoalReport(state, goal, 'bad', '2024-01-01'));
  assert.equal(formatMinutes(80), '1h 20m'); assert.equal(formatMinutes(-15), '−15m'); assert.equal(formatMinutes(0), '0m');
});
test('remaining work and current attention are useful without mixing them into historical activity', () => {
  const { state, goal, metric } = fixture();
  state.tasks.push(
    { id: 'overdue', goalId: goal.id, title: 'Follow up', status: 'open', archived: false, dueDate: '2024-02-01' } as AppState['tasks'][number],
    { id: 'future', goalId: goal.id, title: 'Ship', status: 'open', archived: false, dueDate: '2024-04-01' } as AppState['tasks'][number]);
  goal.milestones.push({ id: 'next', title: 'Release', done: false, dueDate: '2024-04-01' });
  const report = buildGoalReport(state, goal, '2024-01-15', '2024-01-15', '2024-03-01');
  assert.equal(report.openTasks.length, 2); assert.equal(report.overdueTasks.length, 1);
  assert.equal(report.completedTasks.length, 0); assert.equal(report.upcomingMilestones[0].id, 'next');
  metric.frequency = 'cumulative'; metric.baseline = 100; metric.target = 80;
  metric.entries = [{ id: 'observation', date: '2024-01-15', value: 90 }];
  const period = buildGoalReport(state, goal, '2024-01-01', '2024-01-31').measures[0].periods[0];
  assert.equal(period.direction, 'decrease'); assert.equal(period.remaining, 10); assert.equal(period.progress, 0.5);
});
