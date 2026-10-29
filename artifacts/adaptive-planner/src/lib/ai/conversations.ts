import { useSyncExternalStore } from 'react';
import type { Conversation } from './types';
import { closeAssistant } from './bus';

const KEY = 'align.assistant.v1';
let scopedKey: string | null = null;
const MAX = 40;

interface AiStore {
  conversations: Conversation[];
  activeId: string | null;
  introDismissed: boolean;
}

const listeners = new Set<() => void>();

function load(): AiStore {
  try {
    const raw = scopedKey ? localStorage.getItem(scopedKey) : null;
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
  if (!scopedKey) return;
  try {
    localStorage.setItem(scopedKey, JSON.stringify(store));
  } catch {
    /* ignore quota */
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

export const getAiStore = () => store;
export function setConversationScope(userId: string | null) {
  closeAssistant();
  scopedKey = userId ? `${KEY}.user.${encodeURIComponent(userId)}` : null;
  store = load();
  listeners.forEach((l) => l());
}

export function importLegacyConversations() {
  if (!scopedKey) return;
  try {
    const previous = JSON.parse(localStorage.getItem(KEY) || 'null') as AiStore | null;
    if (!previous || !Array.isArray(previous.conversations)) return;
    const ids = new Set(store.conversations.map((c) => c.id));
    const extra = previous.conversations.filter((c) => !ids.has(c.id)).map((c) => ({
      ...c, messages: c.messages.map((m) => ({ ...m, streaming: false })),
    }));
    store = { ...store, conversations: [...store.conversations, ...extra].slice(0, MAX), introDismissed: true };
    emit();
  } catch { /* original conversation data remains untouched if invalid */ }
}

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
    if (!scopedKey || e.key !== scopedKey || !e.newValue) return;
    try {
      store = JSON.parse(e.newValue);
      listeners.forEach((l) => l());
    } catch {
      /* ignore */
    }
  });
}
