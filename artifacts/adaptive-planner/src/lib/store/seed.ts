import { addDaysIso, fmt, monthEndIso, monthStartIso, todayIso, weekStartIso } from '@/lib/dates';
import { computeSnapshot } from './selectors';
import type { AppState, Goal, HistoryEvent, Review, Task, WeekPlan } from './types';

let n = 0;
const id = (p: string) => `demo-${p}-${(n++).toString(36)}`;

export function createSeed(): AppState {
  n = 0;
  const T = todayIso();
  const d = (k: number) => addDaysIso(T, k);
  const ws = weekStartIso(T);
  const lastWs = addDaysIso(ws, -7);
  const prevWs = addDaysIso(ws, -14);
  const monthStart = monthStartIso(T);
  const monthEnd = monthEndIso(T);
  const monthName = fmt(T, 'MMMM');
  const dayOfMonth = Number(fmt(T, 'd'));
  const stamp = (date: string, time = '09:00') => `${date}T${time}`;
  const h = (at: string, e: Omit<HistoryEvent, 'id' | 'at'>): HistoryEvent => ({ id: id('h'), at, source: 'manual', ...e });

  /* ---------- Goals ---------- */
  const gBiz = id('goal');
  const gFit = id('goal');
  const gStr = id('goal');
  const gEng = id('goal');
  const gCase = id('goal');
  const gGym = id('goal');

  const msOffer = id('ms');
  const msOutreach = id('ms');
  const msCustomers = id('ms');
  const msMrr = id('ms');
  const msCall1 = id('ms');
  const msCall2 = id('ms');
  const msAssess = id('ms');

  // Workouts this month: one every ~2.5 days up to yesterday
  const workoutEntries = [] as Goal['metrics'][number]['entries'];
  let count = 0;
  for (let day = 2; day < dayOfMonth; day += 2.5) {
    count++;
    workoutEntries.push({ id: id('e'), date: addDaysIso(monthStart, Math.floor(day) - 1), value: count });
  }

  const goals: Goal[] = [
    {
      id: gBiz,
      title: 'Reach $5,000 monthly revenue',
      outcome:
        'Recurring retainers from CRM maintenance plus AI automation sprints cover $5,000 a month, with no single client above 40%.',
      area: 'business',
      priority: 'high',
      targetDate: d(68),
      status: 'active',
      strategy: {
        summary:
          'Lead with a fixed-scope CRM maintenance retainer ($900/mo) and upsell a two-week AI automation sprint ($1,800). Reach 30 hand-picked prospects (clinics and small agencies already on HubSpot or Pipedrive) with a 4-minute Loom audit of their pipeline.',
        rationale:
          'Maintenance is recurring and low-risk for buyers; the automation sprint is the margin. A personalised audit converted better than cold email in the first 6 outreaches.',
        updatedAt: stamp(d(-19)),
      },
      milestones: [
        { id: msOffer, title: 'Offer one-pager and pricing published', dueDate: addDaysIso(prevWs, 1), done: true, completedAt: stamp(addDaysIso(prevWs, 1), '16:20') },
        { id: msOutreach, title: '30 prospects contacted with a Loom audit', dueDate: d(9), done: false },
        { id: msCustomers, title: '2 retainer customers signed', dueDate: d(34), done: false },
        { id: msMrr, title: '$5,000 MRR for one full month', dueDate: d(68), done: false },
      ],
      metrics: [
        {
          id: id('m'), name: 'Monthly revenue', unit: '$', kind: 'outcome', baseline: 1400, target: 5000,
          entries: [
            { id: id('e'), date: d(-38), value: 1400, note: 'Two legacy maintenance clients' },
            { id: id('e'), date: d(-24), value: 2300, note: 'Okafor Logistics one-off sprint' },
            { id: id('e'), date: d(-6), value: 3200, note: 'Halden Dental retainer started' },
          ],
        },
        {
          id: id('m'), name: 'Customers signed', unit: '', kind: 'outcome', baseline: 0, target: 2,
          entries: [{ id: id('e'), date: d(-12), value: 1, note: 'Halden Dental — maintenance retainer' }],
        },
        {
          id: id('m'), name: 'Prospects contacted', unit: '', kind: 'leading', baseline: 0, target: 30,
          entries: [
            { id: id('e'), date: d(-20), value: 6 },
            { id: id('e'), date: d(-10), value: 14 },
            { id: id('e'), date: d(-3), value: 19 },
          ],
        },
      ],
      history: [
        h(stamp(d(-19), '20:10'), {
          kind: 'strategy', summary: 'Strategy revised',
          reason: 'Cold email alone got 0 replies from 8 sends; Loom audits got 2 calls from 6.',
          from: 'Cold email sequence offering general CRM help.',
          to: 'Lead with a fixed-scope CRM maintenance retainer and AI automation sprint, outreach via Loom audit.',
          source: 'review',
        }),
        h(stamp(d(-30), '18:00'), { kind: 'deadline', summary: 'Target date moved', reason: 'Realistic sales cycle for clinics is 3–5 weeks.', from: d(40), to: d(68) }),
        h(stamp(d(-40)), { kind: 'created', summary: 'Goal created' }),
      ],
      createdAt: stamp(d(-40)),
      isDemo: true,
    },
    {
      id: gFit,
      title: `12 strength workouts in ${monthName}`,
      outcome: 'Show up consistently: three full sessions a week, logged, no matter how the week goes at work.',
      area: 'fitness',
      priority: 'high',
      targetDate: monthEnd,
      status: 'active',
      strategy: {
        summary: 'Fixed slots Mon / Wed / Fri at 7:00 before client work. Upper-lower split, 55 minutes max. Missed sessions move to Saturday, never doubled up.',
        rationale: 'Morning slots survived last month’s client crunch; evening sessions did not.',
        updatedAt: stamp(addDaysIso(monthStart, -2)),
      },
      milestones: [
        { id: id('ms'), title: '6 sessions by mid-month', dueDate: addDaysIso(monthStart, 14), done: count >= 6, completedAt: count >= 6 ? stamp(addDaysIso(monthStart, 14)) : undefined },
        { id: id('ms'), title: '12 sessions logged', dueDate: monthEnd, done: false },
      ],
      metrics: [
        { id: id('m'), name: 'Workouts logged', unit: 'sessions', kind: 'leading', baseline: 0, target: 12, entries: workoutEntries },
      ],
      history: [h(stamp(addDaysIso(monthStart, -2)), { kind: 'created', summary: 'Goal created' })],
      createdAt: stamp(addDaysIso(monthStart, -2)),
      isDemo: true,
    },
    {
      id: gStr,
      title: 'Squat 110 kg, deadlift 140 kg',
      outcome: 'Estimated one-rep max, measured from a top set of 3 with clean form on video.',
      area: 'fitness',
      priority: 'medium',
      targetDate: d(120),
      status: 'active',
      strategy: {
        summary: 'Linear progression on the top set: +2.5 kg squat, +5 kg deadlift weekly until a stall, then a 3-week wave.',
        rationale: 'Still a novice on deadlift; squat stalls are usually depth or bracing, so film every top set.',
        updatedAt: stamp(d(-35)),
      },
      milestones: [
        { id: id('ms'), title: 'Squat 100 kg e1RM', dueDate: d(30), done: false },
        { id: id('ms'), title: 'Deadlift 130 kg e1RM', dueDate: d(45), done: false },
      ],
      metrics: [
        {
          id: id('m'), name: 'Squat e1RM', unit: 'kg', kind: 'outcome', baseline: 90, target: 110,
          entries: [
            { id: id('e'), date: d(-33), value: 90 },
            { id: id('e'), date: d(-19), value: 93.5 },
            { id: id('e'), date: d(-5), value: 96 },
          ],
        },
        {
          id: id('m'), name: 'Deadlift e1RM', unit: 'kg', kind: 'outcome', baseline: 120, target: 140,
          entries: [
            { id: id('e'), date: d(-33), value: 120 },
            { id: id('e'), date: d(-12), value: 126.5 },
          ],
        },
      ],
      history: [h(stamp(d(-35)), { kind: 'created', summary: 'Goal created' })],
      createdAt: stamp(d(-35)),
      isDemo: true,
    },
    {
      id: gEng,
      title: 'Lead client calls in English without notes',
      outcome: 'Run a 30-minute discovery and pricing call with a native speaker and score 7.5/10 on the tutor’s speaking rubric.',
      area: 'english',
      priority: 'medium',
      targetDate: d(52),
      status: 'active',
      strategy: {
        summary: '8 tutor sessions focused on real call scenarios (discovery, scope, pricing, objections) plus 2 recorded simulated calls. Shadow one client-call recording daily for 20 minutes.',
        rationale: 'Grammar drills did not transfer to live calls; rehearsing the actual sales conversation does.',
        updatedAt: stamp(d(-28)),
      },
      milestones: [
        { id: msCall1, title: 'Simulated call #1: discovery', dueDate: addDaysIso(lastWs, 2), done: true, completedAt: stamp(addDaysIso(lastWs, 2), '19:00') },
        { id: msCall2, title: 'Simulated call #2: pricing and objections', dueDate: d(3), done: false },
        { id: msAssess, title: 'Rubric assessment with tutor', dueDate: d(50), done: false },
      ],
      metrics: [
        {
          id: id('m'), name: 'Tutor sessions', unit: 'sessions', kind: 'leading', baseline: 0, target: 8,
          entries: [
            { id: id('e'), date: d(-21), value: 2 },
            { id: id('e'), date: addDaysIso(lastWs, 3), value: 4 },
          ],
        },
        {
          id: id('m'), name: 'Simulated calls', unit: 'calls', kind: 'leading', baseline: 0, target: 2,
          entries: [{ id: id('e'), date: addDaysIso(lastWs, 2), value: 1 }],
        },
        {
          id: id('m'), name: 'Speaking rubric score', unit: '/10', kind: 'outcome', baseline: 5.5, target: 7.5,
          entries: [
            { id: id('e'), date: d(-28), value: 5.5, note: 'Initial assessment' },
            { id: id('e'), date: addDaysIso(lastWs, 2), value: 6.2, note: 'After call #1: fluency up, pricing vocabulary weak' },
          ],
        },
      ],
      history: [
        h(stamp(d(-28), '21:00'), { kind: 'strategy', summary: 'Strategy revised', reason: 'Grammar app streak did not change call confidence.', from: 'Daily grammar app plus weekly tutor.', to: 'Scenario-based tutor sessions, simulated calls, daily shadowing.' }),
        h(stamp(d(-30)), { kind: 'created', summary: 'Goal created' }),
      ],
      createdAt: stamp(d(-30)),
      isDemo: true,
    },
    {
      id: gCase,
      title: 'Publish 4 client case studies',
      outcome: 'Four short write-ups with before/after numbers on the studio site.',
      area: 'business',
      priority: 'low',
      targetDate: d(90),
      status: 'paused',
      strategy: { summary: 'One case study every two weeks, drafted from call notes.', rationale: 'Proof for outreach.', updatedAt: stamp(d(-50)) },
      milestones: [{ id: id('ms'), title: 'Halden Dental case study', dueDate: d(30), done: false }],
      metrics: [{ id: id('m'), name: 'Case studies published', unit: '', kind: 'outcome', baseline: 0, target: 4, entries: [] }],
      history: [
        h(stamp(lastWs, '19:30'), { kind: 'status', summary: 'Paused', reason: 'Outreach and delivery take priority until the second customer signs.', from: 'active', to: 'paused', source: 'review' }),
        h(stamp(d(-50)), { kind: 'created', summary: 'Goal created' }),
      ],
      createdAt: stamp(d(-50)),
      isDemo: true,
    },
    {
      id: gGym,
      title: 'Set up a home training corner',
      outcome: 'Rack, bar and 140 kg of plates in the garage so sessions never depend on the commute.',
      area: 'fitness',
      priority: 'low',
      targetDate: d(-20),
      status: 'completed',
      strategy: { summary: 'Buy used from local listings; budget $650.', rationale: 'Removes the commute excuse.', updatedAt: stamp(d(-60)) },
      milestones: [{ id: id('ms'), title: 'Rack installed', dueDate: d(-25), done: true, completedAt: stamp(d(-26)) }],
      metrics: [{ id: id('m'), name: 'Spent', unit: '$', kind: 'outcome', baseline: 0, target: 650, entries: [{ id: id('e'), date: d(-26), value: 612 }] }],
      history: [
        h(stamp(d(-22)), { kind: 'status', summary: 'Marked complete', reason: 'Everything installed, $38 under budget.', from: 'active', to: 'completed' }),
        h(stamp(d(-60)), { kind: 'created', summary: 'Goal created' }),
      ],
      createdAt: stamp(d(-60)),
      isDemo: true,
    },
  ];

  /* ---------- Tasks ---------- */
  const t = (p: Partial<Task> & { title: string }): Task => ({
    id: id('task'),
    priority: 'medium',
    effort: 30,
    notes: '',
    recurrence: 'none',
    status: 'open',
    archived: false,
    createdAt: stamp(addDaysIso(prevWs, -2)),
    isDemo: true,
    ...p,
  });
  const done = (date: string, time = '17:30') => ({ status: 'done' as const, completedAt: stamp(date, time) });

  const tasks: Task[] = [
    // two weeks ago
    t({ title: 'Write CRM maintenance offer one-pager', goalId: gBiz, milestoneId: msOffer, plannedDate: prevWs, priority: 'high', effort: 120, ...done(addDaysIso(prevWs, 1)) }),
    t({ title: 'Build prospect list: 30 clinics and agencies on HubSpot/Pipedrive', goalId: gBiz, milestoneId: msOutreach, plannedDate: addDaysIso(prevWs, 1), effort: 90, ...done(addDaysIso(prevWs, 1), '18:10') }),
    t({ title: 'Lower body session', goalId: gFit, plannedDate: addDaysIso(prevWs, 2), effort: 55, ...done(addDaysIso(prevWs, 2), '08:00') }),
    t({ title: 'Tutor session: discovery-call vocabulary', goalId: gEng, plannedDate: addDaysIso(prevWs, 3), effort: 60, ...done(addDaysIso(prevWs, 3), '19:00') }),
    t({ title: 'Record reusable Loom audit template', goalId: gBiz, milestoneId: msOutreach, plannedDate: addDaysIso(prevWs, 4), effort: 90, priority: 'high', notes: 'Pipeline hygiene, duplicate contacts, one automation idea. Keep under 4 minutes.' }),
    // last week
    t({ title: 'Send 10 Loom audits (batch 1)', goalId: gBiz, milestoneId: msOutreach, plannedDate: lastWs, priority: 'high', effort: 120, createdAt: stamp(addDaysIso(lastWs, -1)), ...done(lastWs) }),
    t({ title: 'Upper body session', goalId: gFit, plannedDate: addDaysIso(lastWs, 1), effort: 55, createdAt: stamp(addDaysIso(lastWs, -1)), ...done(addDaysIso(lastWs, 1), '08:05') }),
    t({ title: 'Simulated call #1 with tutor: discovery', goalId: gEng, milestoneId: msCall1, plannedDate: addDaysIso(lastWs, 2), effort: 60, priority: 'high', createdAt: stamp(addDaysIso(lastWs, -1)), ...done(addDaysIso(lastWs, 2), '19:00') }),
    t({ title: 'Tutor session: objection-handling phrases', goalId: gEng, plannedDate: addDaysIso(lastWs, 3), effort: 60, createdAt: stamp(addDaysIso(lastWs, -1)), ...done(addDaysIso(lastWs, 3), '19:10') }),
    t({ title: 'Follow up with Halden Dental on onboarding', goalId: gBiz, plannedDate: addDaysIso(lastWs, 3), effort: 30, createdAt: stamp(addDaysIso(lastWs, -1)), ...done(addDaysIso(lastWs, 3), '11:00') }),
    t({ title: 'Lower body session', goalId: gFit, plannedDate: addDaysIso(lastWs, 4), effort: 55, createdAt: stamp(addDaysIso(lastWs, -1)) }),
    t({ title: 'Send proposal to Marlow & Finch Agency', goalId: gBiz, milestoneId: msCustomers, plannedDate: addDaysIso(lastWs, 4), dueDate: addDaysIso(lastWs, 5), priority: 'high', effort: 90, createdAt: stamp(addDaysIso(lastWs, -1)), notes: 'Maintenance retainer + automation sprint for their lead intake form.' }),
    // this week & today
    t({ title: 'Review squat form video from top set', goalId: gStr, plannedDate: d(-1), effort: 20, createdAt: stamp(ws), ...done(d(-1), '20:15') }),
    t({ title: 'Send 10 Loom audits (batch 2)', goalId: gBiz, milestoneId: msOutreach, plannedDate: T, priority: 'high', effort: 120, createdAt: stamp(ws) }),
    t({ title: 'Lower body session', goalId: gFit, plannedDate: T, effort: 55, recurrence: 'weekly', createdAt: stamp(ws), notes: 'Squat 3x3 top set, RDL 3x8, split squats.' }),
    t({ title: 'Send invoice to Halden Dental', goalId: gBiz, plannedDate: T, dueDate: d(1), effort: 15, reminder: stamp(T, '09:00'), priority: 'high', createdAt: stamp(ws) }),
    t({ title: 'Shadow one client-call recording (20 min)', goalId: gEng, plannedDate: T, effort: 20, recurrence: 'daily', createdAt: stamp(ws) }),
    t({ title: 'Tutor session: describing technical scope', goalId: gEng, plannedDate: d(1), effort: 60, createdAt: stamp(ws) }),
    t({ title: 'Prepare AI automation sprint demo (n8n + CRM webhook)', goalId: gBiz, milestoneId: msCustomers, plannedDate: d(2), effort: 180, priority: 'high', createdAt: stamp(ws) }),
    t({ title: 'Upper body session', goalId: gFit, plannedDate: d(2), effort: 55, recurrence: 'weekly', createdAt: stamp(ws) }),
    t({ title: 'Simulated call #2: pricing and objections', goalId: gEng, milestoneId: msCall2, plannedDate: d(3), dueDate: d(3), effort: 60, priority: 'high', createdAt: stamp(ws) }),
    // inbox
    t({ title: 'Ask Okafor Logistics for a referral', goalId: gBiz, createdAt: stamp(d(-2)), effort: 15 }),
    t({ title: 'Compare deload week templates', goalId: gStr, createdAt: stamp(d(-4)), effort: 30, priority: 'low' }),
    t({ title: 'Renew studio domain before it lapses', dueDate: d(3), reminder: stamp(d(2), '10:00'), createdAt: stamp(d(-5)), effort: 10 }),
    t({ title: 'Book physio check for left knee', reminder: stamp(d(-1), '18:00'), createdAt: stamp(d(-3)), effort: 10, priority: 'high' }),
    t({ title: 'Draft pricing page copy for automation sprint', goalId: gBiz, createdAt: stamp(d(-1)), effort: 60 }),
  ];

  /* ---------- Week plans ---------- */
  const snap = (start: string): WeekPlan['commitments'] => {
    const end = addDaysIso(start, 6);
    return tasks
      .filter((x) => x.plannedDate && x.plannedDate >= start && x.plannedDate <= end)
      .map((x) => ({ taskId: x.id, title: x.title, goalId: x.goalId, plannedDate: x.plannedDate, effort: x.effort }));
  };
  const weekPlans: Record<string, WeekPlan> = {
    [prevWs]: { weekStart: prevWs, focus: 'Ship the offer and build the list', capacityMinutes: 540, finalized: true, finalizedAt: stamp(addDaysIso(prevWs, -1), '19:00'), commitments: snap(prevWs) },
    [lastWs]: { weekStart: lastWs, focus: 'First outreach batch, first simulated call', capacityMinutes: 540, finalized: true, finalizedAt: stamp(addDaysIso(lastWs, -1), '19:30'), commitments: snap(lastWs) },
    [ws]: { weekStart: ws, focus: 'Finish outreach to 30 and rehearse the pricing call', capacityMinutes: 600, finalized: false, commitments: [] },
  };

  const state: AppState = {
    version: 1,
    settings: { name: 'Daniel', theme: 'light', sidebarCollapsed: false, onboardedFresh: false },
    goals,
    tasks,
    weekPlans,
    periodNotes: {
      [fmt(T, 'yyyy')]: 'A business that pays the bills from retainers, a body that is stronger than last year, and English that does not slow down a sales call.',
      [`${fmt(T, 'yyyy')}-Q${Math.ceil(Number(fmt(T, 'M')) / 3)}`]: 'Quarter theme: proof before polish. Two paying retainers matter more than a perfect website.',
    },
    reviews: [],
  };

  /* ---------- Reviews (snapshots computed from the seeded data) ---------- */
  const prevMonthStart = monthStartIso(addDaysIso(monthStart, -1));
  const prevMonthEnd = addDaysIso(monthStart, -1);
  const mk = (type: Review['type'], start: string, end: string, createdAt: string, answers: Review['answers'], adjustments: Review['adjustments']): Review => ({
    id: id('review'),
    type,
    periodStart: start,
    periodEnd: end,
    createdAt,
    answers,
    adjustments,
    snapshot: computeSnapshot(state, type, start, end, end),
    isDemo: true,
  });
  state.reviews = [
    mk('weekly', lastWs, addDaysIso(lastWs, 6), stamp(addDaysIso(lastWs, 6), '19:30'), {
      wins: 'First 10 Loom audits out. Simulated call #1 done; tutor scored fluency up to 6.2.',
      misses: 'Friday lower body session and the Marlow & Finch proposal slipped — Thursday onboarding call ran long.',
      learned: 'Revenue moved because of a retainer signed two weeks ago, not because of this week’s activity. Outreach is a lag of 2–3 weeks.',
      change: 'Pause case studies until the second customer signs. Protect Friday mornings.',
      focus: 'Finish outreach to 30 and rehearse the pricing call.',
    }, [{ kind: 'pause', goalId: gCase, summary: 'Paused "Publish 4 client case studies"' }]),
    mk('weekly', prevWs, addDaysIso(prevWs, 6), stamp(addDaysIso(prevWs, 6), '20:00'), {
      wins: 'Offer one-pager live. Prospect list built with 30 names.',
      misses: 'Loom template not recorded — underestimated editing time.',
      learned: 'Writing the offer took 2 hours, not 4. Recording takes longer than writing.',
      change: 'Batch recordings on one morning instead of spreading them.',
      focus: 'First outreach batch, first simulated call.',
    }, []),
    mk('monthly', prevMonthStart, prevMonthEnd, stamp(addDaysIso(prevMonthEnd, 1), '10:00'), {
      wins: 'Halden Dental retainer signed. Home training corner finished under budget.',
      misses: 'Cold email sequence produced nothing; English practice was grammar drills that did not help on calls.',
      learned: 'Personalised audits create conversations. Scenario rehearsal beats generic grammar for calls.',
      change: 'Switch outreach to Loom audits, switch English to call simulations.',
      focus: 'Two retainers and consistent training.',
    }, [{ kind: 'strategy', goalId: gBiz, summary: 'Strategy for "Reach $5,000 monthly revenue" revised: lead with Loom audits' }]),
  ];

  return state;
}
