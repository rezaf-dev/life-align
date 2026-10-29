import { useSyncExternalStore } from 'react';
import { createSeed } from './seed';
import type { AppState } from './types';

const KEY = 'align.workspace.v1';
const listeners = new Set<() => void>();

function isValidState(p: unknown): p is AppState {
  const s = p as AppState;
  return !!s && s.version === 1 && Array.isArray(s.goals) && Array.isArray(s.tasks) && Array.isArray(s.reviews);
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidState(parsed)) return parsed;
    }
  } catch {
    /* corrupted storage falls back to seed */
  }
  return createSeed();
}

let state: AppState = load();
persist();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or unavailable; keep in memory */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function getState() {
  return state;
}

export function replaceState(next: AppState) {
  state = next;
  persist();
  emit();
}

export function update(fn: (draft: AppState) => void) {
  const draft = structuredClone(state);
  fn(draft);
  replaceState(draft);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);
      if (isValidState(parsed)) {
        state = parsed;
        emit();
      }
    } catch {
      /* ignore */
    }
  });
}

export function useAppState() {
  return useSyncExternalStore(subscribe, getState);
}

export { isValidState };
