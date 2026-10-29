import { useSyncExternalStore } from 'react';
import { emptyWorkspace, getState, hydrateState, isValidState, setWorkspaceWriter } from './store/store';
import type { AppState } from './store/types';
import { importLegacyConversations } from './ai/conversations';

type Sync = { status: 'idle' | 'loading' | 'saved' | 'saving' | 'error' | 'conflict'; error?: string };
type Connection = {
  id: string; revision: number; version: number; saved: number; timer?: ReturnType<typeof setTimeout>;
  running?: Promise<void>; conflict: boolean; importing: boolean; controller: AbortController;
  poll?: ReturnType<typeof setInterval>;
};
let current: Connection | null = null;
let sync: Sync = { status: 'idle' };
const listeners = new Set<() => void>();
function report(status: Sync['status'], error?: string) {
  sync = { status, error }; listeners.forEach((l) => l());
}
export function useWorkspaceSync() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => sync);
}
class SyncError extends Error { constructor(message: string, public status: number) { super(message); } }
async function request(path: string, c: Connection, init?: RequestInit) {
  const res = await fetch(`/api${path}`, { credentials: 'include', signal: c.controller.signal, ...init,
    headers: { 'Content-Type': 'application/json', 'X-Align-User': c.id, ...init?.headers } });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) window.dispatchEvent(new Event('align:access-changed'));
    const data = await res.json().catch(() => ({}));
    throw new SyncError(data.error || 'Your workspace could not be saved. Retry or download a backup.', res.status);
  }
  return res.json();
}
function ensure(c: Connection) {
  if (current !== c) throw new Error('The signed-in account changed. No other account was modified.');
}
async function save(c: Connection) {
  if (c.conflict) throw new Error(sync.error || 'Reload the saved version after backing up your unsaved changes.');
  try {
    while (current === c && c.saved < c.version) {
      const version = c.version;
      const state = getState();
      report('saving');
      const result = await request('/workspace', c, { method: 'PUT', body: JSON.stringify({ state, revision: c.revision }) });
      ensure(c);
      c.revision = result.revision; c.saved = version;
    }
    if (current === c) report('saved');
  } catch (error) {
    if (current === c) {
      c.conflict = error instanceof SyncError && error.status === 409;
      report(c.conflict ? 'conflict' : 'error', error instanceof Error ? error.message : 'Save failed.');
    }
    throw error;
  }
}
export async function flushWorkspace(): Promise<void> {
  const c = current;
  if (!c) return;
  clearTimeout(c.timer);
  if (c.running) await c.running;
  ensure(c);
  if (c.saved >= c.version) return;
  const run = save(c);
  c.running = run;
  try { await run; } finally { if (c.running === run) c.running = undefined; }
}
export async function retryWorkspaceSave() { await flushWorkspace(); }
export function disconnectWorkspace() {
  const c = current;
  current = null;
  if (c) { clearTimeout(c.timer); clearInterval(c.poll); c.controller.abort(); }
  setWorkspaceWriter(null);
  hydrateState(emptyWorkspace());
  report('idle');
}
export async function connectWorkspace(userId: string) {
  disconnectWorkspace();
  const c: Connection = { id: userId, revision: 0, version: 0, saved: 0, conflict: false, importing: false, controller: new AbortController() };
  current = c; report('loading');
  try {
    const result = await request('/workspace', c);
    ensure(c);
    if (result.userId !== c.id) throw new Error('Your sign-in changed while loading. Refresh this page to continue safely.');
    if (!isValidState(result.state)) throw new Error('Your saved workspace is invalid. Contact the owner; no data was replaced.');
    c.revision = result.revision;
    hydrateState(result.state);
    setWorkspaceWriter(() => {
      ensure(c);
      if (c.importing) throw new Error('Wait for the workspace import to finish.');
      c.version++;
      if (!c.conflict) report('saving');
      clearTimeout(c.timer);
      c.timer = setTimeout(() => { void flushWorkspace().catch(() => { /* visible in sync status */ }); }, 400);
    });
    report('saved');
    c.poll = setInterval(() => { void refreshIfClean(c); }, 15000);
  } catch (error) {
    if (current === c) report('error', error instanceof Error ? error.message : 'Could not load your workspace.');
    throw error;
  }
}
async function refreshIfClean(c: Connection) {
  if (current !== c || c.running || c.importing || c.version !== c.saved) return;
  const version = c.version;
  try {
    const result = await request('/workspace', c);
    if (current !== c || c.running || c.version !== version || result.userId !== c.id || result.revision === c.revision) return;
    if (!isValidState(result.state)) return;
    c.revision = result.revision;
    hydrateState(result.state);
    report('saved');
  } catch { /* existing saved state remains usable; access errors refresh the gate */ }
}
export async function reloadWorkspace() {
  const c = current;
  if (!c) throw new Error('Sign in first.');
  clearTimeout(c.timer);
  if (c.running) await c.running.catch(() => {});
  const version = c.version;
  const result = await request('/workspace', c);
  ensure(c);
  if (result.userId !== c.id) throw new Error('Your sign-in changed. Nothing was replaced.');
  if (c.version !== version) throw new Error('You made another edit while reloading. Back it up before trying again.');
  if (!isValidState(result.state)) throw new Error('The saved workspace could not be read.');
  c.revision = result.revision; c.version = 0; c.saved = 0; c.conflict = false;
  hydrateState(result.state); report('saved');
}
function legacyState(): AppState | null {
  try {
    const raw = localStorage.getItem('align.workspace.v1');
    const parsed = raw ? JSON.parse(raw) : null;
    return isValidState(parsed) ? parsed : null;
  } catch { return null; }
}
export function hasLegacyWorkspace() { return legacyState() !== null; }
export async function importLegacyWorkspace() {
  const state = legacyState();
  const c = current;
  if (!state || !c) throw new Error('No previous workspace was found in this browser.');
  await flushWorkspace();
  ensure(c); c.importing = true;
  try {
    const result = await request('/workspace/import', c, { method: 'POST', body: JSON.stringify({ state, revision: c.revision }) });
    ensure(c);
    c.revision = result.revision; c.version = 0; c.saved = 0; c.conflict = false;
    hydrateState(state);
    importLegacyConversations();
    report('saved');
  } finally { c.importing = false; }
}
window.addEventListener('focus', () => { if (current) void refreshIfClean(current); });
window.addEventListener('beforeunload', (event) => {
  if (current && current.version > current.saved) { event.preventDefault(); event.returnValue = ''; }
});
