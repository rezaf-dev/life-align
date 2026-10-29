import { useSyncExternalStore } from 'react';
import type { Screen } from './types';

export interface AssistantFocus {
  screen?: Screen;
  goalId?: string;
  taskId?: string;
  period?: { start: string; end: string; label: string };
  /** Message to send immediately on open. */
  send?: string;
  /** Text to place in the composer without sending. */
  draft?: string;
  /** Start a fresh conversation. */
  fresh?: boolean;
}

interface BusState {
  open: boolean;
  focus: AssistantFocus;
  request: (AssistantFocus & { nonce: number }) | null;
}

let bus: BusState = { open: false, focus: {}, request: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let nonce = 0;

export function openAssistant(focus: AssistantFocus = {}) {
  bus = { open: true, focus: { screen: focus.screen, goalId: focus.goalId, taskId: focus.taskId, period: focus.period }, request: { ...focus, nonce: ++nonce } };
  emit();
}

export function closeAssistant() {
  bus = { ...bus, open: false };
  emit();
}

export function toggleAssistant() {
  if (bus.open) closeAssistant();
  else openAssistant({});
}

export function consumeRequest() {
  bus = { ...bus, request: null };
}

export function useAssistantBus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => bus,
  );
}
