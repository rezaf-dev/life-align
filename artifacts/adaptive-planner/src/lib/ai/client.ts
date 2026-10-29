import type { AppState } from '@/lib/store/types';
import type { ApplyResponse, Operation } from './types';

/** API lives at the root /api of the shared proxy; never hard-code a host. */
const API = '/api';

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'proposal'; operations: Operation[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

export async function getAiStatus(): Promise<{ configured: boolean; model: string }> {
  const r = await fetch(`${API}/ai/status`, { credentials: 'include' });
  if (!r.ok) throw new Error(`Status check failed (${r.status})`);
  return r.json();
}

async function readError(r: Response) {
  if (r.status === 401 || r.status === 403) window.dispatchEvent(new Event('align:access-changed'));
  try {
    const j = await r.json();
    return j?.message || j?.error || `Request failed (${r.status})`;
  } catch {
    return `Request failed (${r.status})`;
  }
}

export async function streamChat(
  body: { message: string; messages: { role: 'user' | 'assistant'; content: string }[]; context: object; proposals: Operation[] },
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
) {
  const r = await fetch(`${API}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(await readError(r));
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let finished = false;
  let failed = false;
  const handle = (line: string) => {
    const l = line.trim();
    if (!l.startsWith('data:')) return;
    const payload = l.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    const ev = JSON.parse(payload) as StreamEvent;
    if (ev.type === 'done') finished = true;
    if (ev.type === 'error') failed = true;
    onEvent(ev);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    lines.forEach(handle);
  }
  if (buf) handle(buf);
  if (!finished && !failed) throw new Error('The connection ended before the response was complete. Retry; no changes were applied.');
}

export async function applyOperations(requestId: string, operations: Operation[], state: AppState): Promise<ApplyResponse> {
  const r = await fetch(`${API}/ai/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ requestId, operations, state }),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}
