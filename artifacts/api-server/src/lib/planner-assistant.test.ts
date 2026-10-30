import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedContext, streamAssistant } from './planner-assistant';

function fixture() {
  const goal = {
    id: 'goal', title: 'First client', outcome: 'Get a paying client', area: 'business', priority: 'high',
    targetDate: '2026-11-30', status: 'active', strategy: {
      summary: 'Personalized outreach to a narrow customer segment.',
      rationale: 'Validate the offer directly before investing in video or freelance platforms.', updatedAt: '2026-10-30',
    },
    milestones: [
      { id: 'done', title: 'Validate offer', dueDate: '2026-10-20', done: true },
      { id: 'outreach', title: 'Send 100 outreach messages', dueDate: '2026-11-30', done: false },
    ],
    metrics: [{
      id: 'messages', name: 'Outreach messages', unit: 'messages', kind: 'leading', baseline: 0, target: 100,
      entries: [{ id: 'actual', date: '2026-10-29', value: 30 }],
    }],
    history: [], createdAt: '2026-10-01', isDemo: false,
  };
  const task = {
    id: 'existing', title: 'Send 10 personalized messages', goalId: 'goal', milestoneId: 'outreach',
    plannedDate: '2026-11-02', dueDate: '2026-11-02', priority: 'high', effort: 60,
    notes: 'Planned contribution: 10 messages toward Outreach messages. Not yet sent.',
    recurrence: 'none', status: 'open', archived: false, createdAt: '2026-10-30', isDemo: false,
  };
  const state = { goals: [goal], tasks: [task] };
  return { state, goal, task };
}

test('planning context bounds retain structured quantities and omit credential fields', () => {
  assert.deepEqual(boundedContext({ planning: { remaining: 70, unit: 'messages' }, password: 'not-a-credential' }), { planning: { remaining: 70, unit: 'messages' } });
});

test('tool-only task proposals surface coverage explanation without changing workspace or crediting planned results', async (t) => {
  const { state, goal } = fixture();
  const before = structuredClone(state);
  const originalFetch = globalThis.fetch;
  // Only this fake fetch is used. Do not require or modify a real credential.
  const { configured } = await import('./planner-assistant');
  if (!configured()) { t.skip('Provider not configured; no real credential needed by context tests.'); return; }
  let requestBody: Record<string, unknown> = {};
  const operations = [{
    key: 'batch', type: 'create_task', title: 'Send 20 personalized messages',
    goalId: 'goal', milestoneId: 'outreach', plannedDate: '2026-11-03', dueDate: '2026-11-03',
    notes: 'Planned contribution: 20 outreach messages, following the direct outreach strategy.',
  }];
  const explanation = 'Partial proposal: 30 recorded, 70 remaining; existing 10 plus proposed 20 leaves 40 to plan by Nov 30.';
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'propose_changes', arguments: JSON.stringify({ explanation, operations }) } }] }, finish_reason: 'tool_calls' }] },
    ];
    return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200 });
  };
  try {
    const events: object[] = [];
    await streamAssistant({
      message: 'I need tasks for this goal',
      context: { today: '2026-10-30', focusGoal: { ...goal, planning: { measures: [{ metricId: 'messages', remaining: 70 }] } } },
    }, (event) => events.push(event), new AbortController().signal);
    const messages = requestBody.messages as { role: string; content: string }[];
    assert.match(messages[0].content, /Milestone-first/);
    assert.match(messages[0].content, /coverage summary by measure and milestone/);
    assert.match(messages[0].content, /remaining 70, not another 100/);
    assert.match(messages[0].content, /not daily\/weekly recurrence with no end date/);
    assert.match(messages[1].content, /"remaining":70/);
    assert.match((events[0] as { text: string }).text, /proposed 20 leaves 40 to plan by Nov 30/);
    assert.deepEqual(events.at(-1), { type: 'proposal', operations });
    assert.deepEqual(state, before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
