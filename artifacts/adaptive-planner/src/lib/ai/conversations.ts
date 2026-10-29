import { useSyncExternalStore } from 'react';
import type { Conversation } from './types';

const KEY = 'align.assistant.v1';
const MAX = 40;

interface AiStore {
  conversations: Conversation[];
  activeId: string | null;
  introDismissed: boolean;
}

const listeners = new Set<() => void>();

function load(): AiStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as AiStore;
      if (p && Array.isArray(p.conversations)) {
        // A reload interrupts any in-flight stream; settle those messages.
        p.conversations.forEach((c) =>
          c.messages.forEach((m) => {
            if (m.streaming) {
              m.streaming = false;
              if (!m.content && !m.proposal) m.error = 'The reply was interrupted.';
            }
          }),
        );
        return p;
      }
    }
  } catch {
    /* fall through */
  }
  return { conversations: [], activeId: null, introDismissed: false };
}

let store: AiStore = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore quota */
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

export const getAiStore = () => store;

export function setAiStore(fn: (d: AiStore) => void) {
  const d = structuredClone(store);
  fn(d);
  d.conversations = d.conversations.slice(0, MAX);
  store = d;
  emit();
}

export function updateConversation(id: string, fn: (c: Conversation) => void) {
  setAiStore((d) => {
    const c = d.conversations.find((x) => x.id === id);
    if (c) {
      fn(c);
      c.updatedAt = new Date().toISOString();
      d.conversations.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }
  });
}

export function useAiStore() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => store,
  );
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      store = JSON.parse(e.newValue);
      listeners.forEach((l) => l());
    } catch {
      /* ignore */
    }
  });
}
