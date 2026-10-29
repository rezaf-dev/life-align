import { Router, type IRouter } from 'express';
import { ApplyAiOperationsBody, ChatWithPlannerBody } from '@workspace/api-zod';
import { applyOperations } from '../lib/planner-operations';
import { configured, model, streamAssistant } from '../lib/planner-assistant';
import { requireApproved } from '../middlewares/access';

const router: IRouter = Router();
router.use('/ai', requireApproved);
const requests = new Map<string, { count: number; reset: number }>();
let active = 0;

router.get('/ai/status', (_req, res) => { res.json({ configured: configured(), model: model() }); });

router.use('/ai', (req, res, next) => {
  // No cross-origin consumption of the server's key. Planning data stays browser-local.
  const origin = req.get('origin');
  const host = req.get('x-forwarded-host')?.split(',')[0]?.trim() || req.get('host');
  if (origin) {
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === host; } catch { /* null/invalid origins are not allowed */ }
    if (!sameOrigin) { res.status(403).json({ error: 'Use the assistant from this application.' }); return; }
  }
  const key = req.member!.id;
  const now = Date.now();
  for (const [k, v] of requests) if (v.reset < now) requests.delete(k);
  const current = requests.get(key) ?? { count: 0, reset: now + 60000 };
  if (current.count >= 25) { res.status(429).json({ error: 'Too many requests. Wait a minute, then retry.' }); return; }
  current.count++;
  requests.set(key, current);
  next();
});

router.post('/ai/apply', (req, res) => {
  const parsed = ApplyAiOperationsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid approval request. Review the selected items and try again.' }); return; }
  try {
    const result = applyOperations(parsed.data.state, parsed.data.operations, parsed.data.requestId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error && error.name !== 'ZodError' ? error.message : 'The workspace is not in a valid format. No changes were applied.' });
  }
});

router.post('/ai/chat', async (req, res): Promise<void> => {
  const parsed = ChatWithPlannerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Message or context is invalid. Try a shorter request.' }); return; }
  if (active >= 4) { res.status(429).json({ error: 'The assistant is busy. Please try again shortly.' }); return; }
  active++;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (event: object) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
  const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
  try {
    await streamAssistant(parsed.data, send, controller.signal);
    send({ type: 'done' });
  } catch (error) {
    send({ type: 'error', message: controller.signal.aborted ? 'The request timed out or was stopped. Retry; no planning records were changed.' :
      error instanceof SyntaxError ? 'The model returned an incomplete proposal. Please regenerate it.' :
      error instanceof Error ? error.message : 'The assistant is unavailable. Your manual planning tools still work.' });
  } finally {
    active--; clearTimeout(timeout); clearInterval(heartbeat); res.end();
  }
});

export default router;
