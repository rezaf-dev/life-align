import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  CalendarRange,
  ChartLine,
  Compass,
  History,
  ListTree,
  NotebookPen,
  Plus,
  RotateCcw,
  Square,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { ProposalView } from '@/components/ai/proposal';
import { closeAssistant, consumeRequest, useAssistantBus, type AssistantFocus } from '@/lib/ai/bus';
import { applyOperations, getAiStatus, streamChat } from '@/lib/ai/client';
import { buildContext } from '@/lib/ai/context';
import { getAiStore, setAiStore, updateConversation, useAiStore } from '@/lib/ai/conversations';
import { isOptional, type ChatMessage, type Conversation, type Operation, type Proposal, type Screen } from '@/lib/ai/types';
import { fmt, nextMonday, relDay, uid } from '@/lib/dates';
import { getState, replaceState, useAppState } from '@/lib/store/store';
import { flushWorkspace } from '@/lib/workspace-sync';
import { cn } from '@/lib/utils';

export const PANEL_WIDTH = 440;

export function screenFromLocation(loc: string): { screen: Screen; goalId?: string } {
  const path = loc.split('?')[0];
  const g = path.match(/^\/goals\/([^/]+)/);
  if (g) return { screen: 'goal', goalId: decodeURIComponent(g[1]) };
  if (path.startsWith('/goals')) return { screen: 'goals' };
  if (path.startsWith('/planner')) return { screen: 'planner' };
  if (path.startsWith('/tasks')) return { screen: 'tasks' };
  if (path.startsWith('/reviews')) return { screen: 'reviews' };
  if (path.startsWith('/settings')) return { screen: 'settings' };
  return { screen: 'overview' };
}

const SCREEN_LABEL: Record<Screen, string> = {
  overview: 'Overview',
  goals: 'Goals',
  goal: 'Goal',
  planner: 'Planner',
  tasks: 'Tasks',
  reviews: 'Reviews',
  settings: 'Settings',
  task: 'Task',
};

/** Lightweight rendering for assistant text: paragraphs, bullet and numbered lists, bold. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const inline = (s: string, k: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={`${k}-${i}`} className="font-semibold">{part.slice(2, -2)}</strong> : <span key={`${k}-${i}`}>{part}</span>,
    );
  const flush = () => {
    if (!list) return;
    const L = list;
    const Tag = L.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l${blocks.length}`} className={cn('space-y-0.5 pl-4', L.ordered ? 'list-decimal' : 'list-disc marker:text-muted-foreground')}>
        {L.items.map((it, i) => <li key={i}>{inline(it, `li${i}`)}</li>)}
      </Tag>,
    );
    list = null;
  };
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (b || n) {
      const ordered = !!n;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((b ?? n)![1]);
      return;
    }
    flush();
    if (!line.trim()) return;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      <p key={`p${i}`} className={cn(h && 'font-medium')}>
        {inline(h ? h[1] : line, `p${i}`)}
      </p>,
    );
  });
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

function latestPending(c?: Conversation) {
  if (!c) return undefined;
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const p = c.messages[i].proposal;
    if (p?.status === 'pending') return p;
  }
  return undefined;
}

function historyFor(c: Conversation) {
  return c.messages
    .filter((m) => !m.error && !m.streaming && (m.content || m.proposal))
    .slice(-16)
    .map((m) => {
      let content = m.content;
      if (m.proposal) {
        const p = m.proposal;
        const titles = p.operations.map((o) => `${o.type}: ${o.title || o.summary || o.focus || o.taskId || ''}`).join('; ');
        content += `\n[Proposal ${p.status}: ${titles}]`;
      }
      return { role: m.role, content: content.trim() || '(proposal)' };
    });
}

export function AssistantPanel() {
  const bus = useAssistantBus();
  const ai = useAiStore();
  const state = useAppState();
  const [loc] = useLocation();
  const { toast } = useToast();
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [draft, setDraft] = useState('');
  const [focus, setFocus] = useState<AssistantFocus>({});
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | 'all' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const status = useQuery({ queryKey: ['ai-status'], queryFn: getAiStatus, staleTime: 60_000, retry: 1, enabled: bus.open });

  const route = screenFromLocation(loc);
  const lastLoc = useRef(loc);
  useEffect(() => {
    if (lastLoc.current !== loc) {
      lastLoc.current = loc;
      setFocus({});
    }
  }, [loc]);

  const screen: Screen = focus.taskId ? 'task' : focus.screen ?? route.screen;
  const goalId = focus.goalId ?? route.goalId;
  const focusGoal = goalId ? state.goals.find((g) => g.id === goalId) : undefined;
  const focusTask = focus.taskId ? state.tasks.find((t) => t.id === focus.taskId) : undefined;

  const active = ai.conversations.find((c) => c.id === ai.activeId);
  const busy = !!streamingId;

  // Scroll to the newest content as it streams.
  const lastLen = active?.messages.at(-1)?.content.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: busy ? 'auto' : 'smooth' });
  }, [active?.id, active?.messages.length, lastLen, busy]);

  const run = useCallback(
    async (convId: string, text: string, ctxFocus: { screen: Screen; goalId?: string; taskId?: string; period?: AssistantFocus['period'] }) => {
      const conv = getAiStore().conversations.find((c) => c.id === convId);
      if (!conv) return;
      const pending = latestPending(conv);
      const history = historyFor(conv);
      const userMsg: ChatMessage = { id: uid(), role: 'user', content: text, at: new Date().toISOString() };
      const asstId = uid();
      updateConversation(convId, (c) => {
        c.messages.push(userMsg, { id: asstId, role: 'assistant', content: '', at: new Date().toISOString(), streaming: true });
      });
      setStreamingId(asstId);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const patchMsg = (fn: (m: ChatMessage, c: Conversation) => void) =>
        updateConversation(convId, (c) => {
          const m = c.messages.find((x) => x.id === asstId);
          if (m) fn(m, c);
        });
      try {
        const context = buildContext(getState(), { ...ctxFocus, message: text, pending: pending?.operations ?? [] });
        await streamChat(
          { message: text, messages: history, context, proposals: pending?.operations ?? [] },
          (ev) => {
            if (ev.type === 'text') patchMsg((m) => { m.content += ev.text; });
            else if (ev.type === 'proposal')
              patchMsg((m, c) => {
                c.messages.forEach((x) => {
                  if (x.proposal?.status === 'pending' && x.id !== asstId) x.proposal.status = 'superseded';
                });
                const ops = (ev.operations ?? []).filter((o) => o && o.key && o.type);
                m.proposal = ops.length
                  ? { id: uid(), operations: ops, selected: ops.filter((o) => !isOptional(o)).map((o) => o.key), status: 'pending' }
                  : undefined;
              });
            else if (ev.type === 'error') patchMsg((m) => { m.error = ev.message || 'The assistant could not respond.'; });
            else if (ev.type === 'done') patchMsg((m) => { m.streaming = false; });
          },
          ctrl.signal,
        );
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError';
        patchMsg((m) => {
          if (aborted) {
            if (!m.content && !m.proposal) m.error = 'Stopped.';
          } else m.error = (e as Error).message || 'Could not reach the assistant.';
        });
      } finally {
        patchMsg((m) => { m.streaming = false; });
        setStreamingId(null);
        abortRef.current = null;
      }
    },
    [],
  );

  const ctxRef = useRef({ screen, goalId, taskId: focus.taskId, period: focus.period });
  ctxRef.current = { screen, goalId, taskId: focus.taskId, period: focus.period };

  const send = useCallback(
    (text: string, fresh = false) => {
      const msg = text.trim();
      if (!msg || streamingId) return;
      let convId = fresh ? null : getAiStore().activeId;
      if (!convId || !getAiStore().conversations.some((c) => c.id === convId)) {
        const now = new Date().toISOString();
        const c: Conversation = { id: uid(), title: msg.slice(0, 70), createdAt: now, updatedAt: now, screen: ctxRef.current.screen, messages: [] };
        convId = c.id;
        setAiStore((d) => {
          d.conversations.unshift(c);
          d.activeId = c.id;
          d.introDismissed = true;
        });
      }
      setDraft('');
      setView('chat');
      void run(convId, msg, ctxRef.current);
    },
    [run, streamingId],
  );
  const sendRef = useRef(send);
  sendRef.current = send;

  // Handle open requests from contextual entry points.
  useEffect(() => {
    const req = bus.request;
    if (!req) return;
    consumeRequest();
    setFocus({ screen: req.screen, goalId: req.goalId, taskId: req.taskId, period: req.period });
    setView('chat');
    if (req.fresh) setAiStore((d) => { d.activeId = null; });
    if (req.send) {
      const text = req.send;
      ctxRef.current = { screen: req.taskId ? 'task' : req.screen ?? route.screen, goalId: req.goalId ?? route.goalId, taskId: req.taskId, period: req.period };
      setTimeout(() => sendRef.current(text, !!req.fresh), 0);
    } else if (req.draft) setDraft(req.draft);
    setTimeout(() => inputRef.current?.focus(), 250);
  }, [bus.request]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = () => abortRef.current?.abort();

  const regenerate = (convId: string, asstId: string) => {
    if (streamingId) return;
    const conv = getAiStore().conversations.find((c) => c.id === convId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === asstId);
    let u = idx - 1;
    while (u >= 0 && conv.messages[u].role !== 'user') u--;
    if (u < 0) return;
    const text = conv.messages[u].content;
    updateConversation(convId, (c) => {
      const removed = c.messages.splice(u);
      // If we discard a live proposal, restore the one it replaced so revisions continue from it.
      if (removed.some((m) => m.proposal?.status === 'pending')) {
        for (let i = c.messages.length - 1; i >= 0; i--) {
          const p = c.messages[i].proposal;
          if (p?.status === 'superseded') { p.status = 'pending'; break; }
          if (p) break;
        }
      }
    });
    void run(convId, text, ctxRef.current);
  };

  const setProposal = (convId: string, msgId: string, fn: (p: Proposal) => Proposal | void) =>
    updateConversation(convId, (c) => {
      const m = c.messages.find((x) => x.id === msgId);
      if (m?.proposal) {
        const r = fn(m.proposal);
        if (r) m.proposal = r;
      }
    });

  const approve = async (convId: string, msgId: string) => {
    const conv = getAiStore().conversations.find((c) => c.id === convId);
    const p = conv?.messages.find((m) => m.id === msgId)?.proposal;
    if (!p || p.status !== 'pending' || applyingId) return;
    const sel = new Set(p.selected);
    const ops: Operation[] = p.operations.filter((o) => sel.has(o.key));
    const requestId = p.requestId ?? uid();
    // Persist the id first so a retry after a lost response is idempotent on the server.
    setProposal(convId, msgId, (x) => { x.requestId = requestId; x.staleNotice = false; });
    setApplyingId(p.id);
    setApplyError((e) => ({ ...e, [p.id]: '' }));
    try {
      await flushWorkspace();
      const snapshot = getState();
      if (snapshot.aiApplied?.includes(requestId)) {
        setProposal(convId, msgId, (x) => { x.status = 'applied'; x.appliedAt = new Date().toISOString(); });
        return;
      }
      const res = await applyOperations(requestId, ops, snapshot);
      if (getState() !== snapshot) {
        setProposal(convId, msgId, (x) => { x.staleNotice = true; });
        toast({ title: 'Not applied yet', description: 'Your workspace changed in the meantime. Review and approve again.' });
        return;
      }
      replaceState(res.state);
      await flushWorkspace();
      setProposal(convId, msgId, (x) => {
        x.status = 'applied';
        x.changes = res.changes;
        x.appliedAt = new Date().toISOString();
      });
      toast({ title: res.alreadyApplied ? 'Already applied' : `Applied ${res.changes.length || ops.length} change${(res.changes.length || ops.length) === 1 ? '' : 's'}` });
    } catch (e) {
      setApplyError((x) => ({ ...x, [p.id]: (e as Error).message || 'Could not apply these changes.' }));
    } finally {
      setApplyingId(null);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const quick = useMemo(() => {
    const goalName = focusGoal?.title;
    return [
      { label: 'Plan a goal', icon: Target, draft: 'I want to ' , hint: 'Describe it in a sentence' },
      { label: 'Break down a task', icon: ListTree, ...(focusTask ? { send: `Break down "${focusTask.title}" into a few concrete steps.` } : { draft: 'Break down this task: ' }), hint: focusTask ? focusTask.title : 'Steps nest under the task' },
      { label: 'Plan my week', icon: CalendarRange, send: `Help me plan the week of ${fmt(nextMonday(), 'MMMM d')} within my real capacity.`, hint: 'Uses capacity and deadlines' },
      { label: 'Plan my week around...', icon: CalendarRange, ...(goalName ? { send: `Plan my week around "${goalName}" within my real capacity.` } : { draft: 'Plan my week around ' }), hint: goalName ?? 'Name what matters most' },
      { label: 'Goal into 3 sessions', icon: Target, ...(goalName ? { send: `Turn "${goalName}" into 3 work sessions this week.` } : { draft: 'Turn this goal into 3 sessions this week: ' }), hint: goalName ?? 'Sessions you approve first' },
      { label: 'Analyze my progress', icon: ChartLine, send: goalName ? `How am I doing on "${goalName}"? Be direct.` : 'Analyze my progress across active goals over the last two weeks. Be direct.', hint: goalName ?? 'Execution against results' },
      { label: 'Improve my strategy', icon: Compass, send: goalName ? `Look at my strategy for "${goalName}" and suggest a sharper one if the evidence supports it.` : 'Which of my goals has the weakest strategy, and how would you improve it?', hint: goalName ?? 'Grounded in your metrics' },
      { label: 'Review my month', icon: NotebookPen, send: 'Review my month: what moved, what stalled, and what should change next month.', hint: 'Wins, misses, adjustments' },
    ];
  }, [focusGoal?.title, focusTask]);

  const contextChip = focusTask ? focusTask.title : screen === 'goal' && focusGoal ? focusGoal.title : SCREEN_LABEL[screen];
  const notConfigured = status.data && !status.data.configured;

  return (
    <>
      <AnimatePresence>
        {bus.open && (
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-foreground/15 backdrop-blur-[1px] 2xl:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeAssistant}
            aria-hidden
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {bus.open && (
          <motion.aside
            key="panel"
            role="complementary"
            aria-label="Planning assistant"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-[-24px_0_60px_-30px_hsl(var(--foreground)/0.25)] sm:w-[440px]"
            onKeyDown={(e) => { if (e.key === 'Escape') closeAssistant(); }}
            data-testid="panel-assistant"
          >
            <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              {view === 'history' ? (
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setView('chat')} aria-label="Back to conversation" data-testid="button-assistant-back">
                  <ArrowLeft />
                </Button>
              ) : (
                <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-primary/10 font-display text-lg italic text-primary">a</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-display text-[1.05rem] leading-tight">{view === 'history' ? 'Conversations' : 'Planning partner'}</div>
                {view === 'chat' && (
                  <div className="truncate text-[0.72rem] text-muted-foreground" data-testid="text-assistant-context">
                    Looking at <span className="text-foreground/80">{contextChip}</span>
                  </div>
                )}
              </div>
              {view === 'chat' && (
                <>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => setView('history')} aria-label="Conversation history" data-testid="button-assistant-history">
                    <History />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    disabled={busy}
                    onClick={() => { setAiStore((d) => { d.activeId = null; }); setDraft(''); inputRef.current?.focus(); }}
                    aria-label="New conversation"
                    data-testid="button-assistant-new"
                  >
                    <Plus />
                  </Button>
                </>
              )}
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={closeAssistant} aria-label="Close assistant" data-testid="button-assistant-close">
                <X />
              </Button>
            </header>

            {view === 'history' ? (
              <div className="flex-1 overflow-y-auto p-3">
                {ai.conversations.length === 0 ? (
                  <div className="mt-16 text-center text-sm text-muted-foreground">No conversations yet. They stay in this browser only.</div>
                ) : (
                  <>
                    <ul className="space-y-1">
                      {ai.conversations.map((c) => {
                        const proposals = c.messages.filter((m) => m.proposal).length;
                        const applied = c.messages.filter((m) => m.proposal?.status === 'applied').length;
                        return (
                          <li key={c.id} className={cn('group flex items-center gap-1 rounded-lg hover:bg-muted/60', c.id === ai.activeId && 'bg-muted/60')}>
                            <button
                              type="button"
                              className="min-w-0 flex-1 px-2.5 py-2 text-left"
                              onClick={() => { setAiStore((d) => { d.activeId = c.id; }); setView('chat'); }}
                              data-testid={`button-open-conversation-${c.id}`}
                            >
                              <div className="truncate text-sm">{c.title}</div>
                              <div className="font-num text-[0.7rem] text-muted-foreground">
                                {relDay(c.updatedAt.slice(0, 10))} &middot; {c.messages.length} messages{proposals ? ` · ${applied}/${proposals} applied` : ''} &middot; {SCREEN_LABEL[c.screen] ?? 'Workspace'}
                              </div>
                            </button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 text-muted-foreground opacity-70 hover:text-destructive group-hover:opacity-100"
                              onClick={() => setConfirmDelete(c.id)}
                              aria-label={`Delete conversation ${c.title}`}
                              data-testid={`button-delete-conversation-${c.id}`}
                            >
                              <Trash2 />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                      <span>Stored separately from your plans. Deleting never touches goals or tasks.</span>
                      <Button variant="ghost" size="sm" className="shrink-0 text-destructive" onClick={() => setConfirmDelete('all')} data-testid="button-delete-all-conversations">Clear all</Button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4" aria-live="polite">
                  {notConfigured && (
                    <div className="mb-3 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive" data-testid="text-ai-not-configured">
                      <AlertTriangle className="size-4 shrink-0" /> The assistant is not connected yet. An OpenRouter key needs to be configured on the server. Everything else works as usual.
                    </div>
                  )}
                  {!active || active.messages.length === 0 ? (
                    <div className="px-1" data-testid="assistant-welcome">
                      <h2 className="font-display text-[1.6rem] font-light leading-tight">
                        What are you <span className="italic text-primary">working toward</span>?
                      </h2>
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        Say it plainly. I'll shape it into goals, tasks and plans, and nothing changes until you approve it.
                      </p>
                      <div className="mt-5 grid grid-cols-2 gap-1.5">
                        {quick.map((q) => (
                          <button
                            key={q.label}
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if ('send' in q && q.send) send(q.send);
                              else {
                                setDraft(q.draft ?? '');
                                setTimeout(() => {
                                  const el = inputRef.current;
                                  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
                                }, 0);
                              }
                            }}
                            className="group flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                            data-testid={`button-quick-${q.label.toLowerCase().replace(/\s+/g, '-')}`}
                          >
                            <q.icon className="size-4 text-primary" strokeWidth={1.75} />
                            <span className="text-[0.85rem] font-medium leading-tight">{q.label}</span>
                            <span className="line-clamp-1 text-[0.7rem] text-muted-foreground">{q.hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <ol className="space-y-4">
                      {active.messages.map((m, i) => {
                        const isLastAsst = m.role === 'assistant' && i === active.messages.length - 1;
                        if (m.role === 'user')
                          return (
                            <li key={m.id} className="flex justify-end">
                              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-secondary px-3 py-2 text-[0.9rem] text-secondary-foreground" data-testid={`text-user-message-${m.id}`}>
                                {m.content}
                              </div>
                            </li>
                          );
                        return (
                          <li key={m.id} className="space-y-2" data-testid={`message-assistant-${m.id}`}>
                            {m.streaming && !m.content && !m.proposal && (
                              <div className="flex items-center gap-1 py-1" aria-label="Thinking">
                                {[0, 1, 2].map((d) => (
                                  <motion.span key={d} className="size-1.5 rounded-full bg-primary/60" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity, delay: d * 0.18 }} />
                                ))}
                              </div>
                            )}
                            {m.content && (
                              <div className="text-[0.9rem] leading-relaxed text-foreground/90">
                                <RichText text={m.content} />
                                {m.streaming && <span aria-hidden className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-primary" />}
                              </div>
                            )}
                            {m.proposal && (
                              <>
                                <ProposalView
                                  proposal={m.proposal}
                                  busy={busy}
                                  applying={applyingId === m.proposal.id}
                                  onChange={(p) => setProposal(active.id, m.id, () => p)}
                                  onApprove={() => void approve(active.id, m.id)}
                                  onReject={() => setProposal(active.id, m.id, (p) => { p.status = 'rejected'; })}
                                />
                                {applyError[m.proposal.id] && (
                                  <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive" role="alert">
                                    <AlertTriangle className="size-4 shrink-0" />
                                    <span className="flex-1">{applyError[m.proposal.id]}</span>
                                    <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => void approve(active.id, m.id)} data-testid="button-retry-apply">Retry</Button>
                                  </div>
                                )}
                              </>
                            )}
                            {m.error && (
                              <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/5 p-2 text-xs text-destructive" role="alert" data-testid={`text-message-error-${m.id}`}>
                                <AlertTriangle className="size-4 shrink-0" />
                                <span className="flex-1">{m.error}</span>
                                <Button size="sm" variant="ghost" className="h-7 text-destructive" disabled={busy} onClick={() => regenerate(active.id, m.id)} data-testid="button-retry-message">
                                  <RotateCcw /> Retry
                                </Button>
                              </div>
                            )}
                            {isLastAsst && !m.streaming && !m.error && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => regenerate(active.id, m.id)}
                                className="inline-flex items-center gap-1 rounded px-1 text-[0.72rem] text-muted-foreground hover:text-foreground disabled:opacity-50"
                                data-testid="button-regenerate"
                              >
                                <RotateCcw className="size-3" /> Regenerate
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>

                <form
                  className="border-t border-border p-3"
                  onSubmit={(e) => { e.preventDefault(); send(draft); }}
                >
                  {latestPending(active) && !busy && (
                    <div className="mb-1.5 px-1 text-[0.7rem] text-muted-foreground">Ask for changes and I'll revise the open proposal, e.g. "start next Monday".</div>
                  )}
                  <div className="flex items-end gap-2 rounded-xl border border-input bg-card p-1.5 focus-within:ring-2 focus-within:ring-ring/40">
                    <textarea
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onKey}
                      rows={Math.min(6, Math.max(1, draft.split('\n').length))}
                      placeholder={focusTask ? `Ask about "${focusTask.title}"` : 'Describe a goal, task or problem'}
                      className="max-h-40 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-[0.92rem] outline-none placeholder:text-muted-foreground"
                      aria-label="Message the assistant"
                      data-testid="input-assistant-message"
                    />
                    {busy ? (
                      <Button type="button" size="icon" variant="secondary" className="size-9 shrink-0" onClick={stop} aria-label="Stop" data-testid="button-assistant-stop">
                        <Square className="size-3.5 fill-current" />
                      </Button>
                    ) : (
                      <Button type="submit" size="icon" className="size-9 shrink-0" disabled={!draft.trim()} aria-label="Send" data-testid="button-assistant-send">
                        <ArrowUp />
                      </Button>
                    )}
                  </div>
                  <div className="mt-1.5 px-1 text-[0.66rem] text-muted-foreground">
                    Only the context for this screen is shared. Changes apply only after you approve.
                  </div>
                </form>
              </>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={confirmDelete === 'all' ? 'Clear all conversations?' : 'Delete this conversation?'}
        description="The conversation is removed from this browser. Anything you already applied stays in your plans."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const target = confirmDelete;
          setAiStore((d) => {
            if (target === 'all') { d.conversations = []; d.activeId = null; }
            else {
              d.conversations = d.conversations.filter((c) => c.id !== target);
              if (d.activeId === target) d.activeId = null;
            }
          });
          setConfirmDelete(null);
        }}
      />
    </>
  );
}
