import { useSyncExternalStore } from 'react';
import type { AppState } from './types';

const listeners = new Set<() => void>();
let writer: ((next: AppState) => void) | null = null;
export const emptyWorkspace = (): AppState => ({
  version: 1,
  settings: { name: '', theme: 'light', sidebarCollapsed: false, onboardedFresh: false },
  goals: [], tasks: [], weekPlans: {}, periodNotes: {}, reviews: [],
});

function isValidState(p: unknown): p is AppState {
  const s = p as AppState;
  return !!s && s.version === 1 && Array.isArray(s.goals) && Array.isArray(s.tasks) && Array.isArray(s.reviews);
}

// Never load anonymous data before identity/approval is established.
// The previous localStorage key is retained untouched for explicit owner import.
let state: AppState = emptyWorkspace();

function emit() {
  listeners.forEach((l) => l());
}

export function getState() {
  return state;
}

export function replaceState(next: AppState) {
  if (!writer) throw new Error('Your private workspace is not ready. Sign in and wait for approval.');
  writer(next);
  state = next;
  emit();
}

export function hydrateState(next: AppState) { state = next; emit(); }
export function setWorkspaceWriter(next: ((state: AppState) => void) | null) { writer = next; }

export function update(fn: (draft: AppState) => void) {
  const draft = structuredClone(state);
  fn(draft);
  replaceState(draft);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppState() {
  return useSyncExternalStore(subscribe, getState);
}

export { isValidState };
