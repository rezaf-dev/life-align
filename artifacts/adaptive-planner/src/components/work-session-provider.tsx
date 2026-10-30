import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Goal, Task } from '@/lib/store/types';
import { ConvertTaskDialog } from '@/components/work-sessions';
import { DiscardTimerDialog, FinishTimerDialog, StartTimerDialog, TimerBar, useStagedAction, type StartRequest } from '@/components/time-tracker';
import { pauseWorkTimer } from '@/lib/store/time-tracking';
import { useAppState } from '@/lib/store/store';

type Actions = { convert: (task: Task, goal: Goal) => void; start: (req: StartRequest) => void; finish: () => void; discard: () => void; finishError: string; finishPending: boolean };
const SessionActions = createContext<Actions | null>(null);

/** Dialogs live here so they survive archiving/deleting the row that opened them and route changes. */
export function WorkSessionProvider({ children }: { children: ReactNode }) {
  const state = useAppState();
  const [conversion, setConversion] = useState<{ task: Task; goal: Goal } | null>(null);
  const [startReq, setStartReq] = useState<StartRequest | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const pausing = useStagedAction();

  const finish = () => {
    const t = state.activeTimer;
    if (!t) return;
    if (t.status === 'paused' && !pausing.staged) { setReviewing(true); return; }
    void pausing.run(() => pauseWorkTimer(), () => setReviewing(true));
  };

  return (
    <SessionActions.Provider value={{ convert: (task, goal) => setConversion({ task, goal }), start: setStartReq, finish, discard: () => setDiscarding(true), finishError: pausing.error, finishPending: pausing.pending }}>
      {children}
      {conversion && <ConvertTaskDialog task={conversion.task} goal={conversion.goal} onClose={() => setConversion(null)} />}
      {startReq && <StartTimerDialog req={startReq} onClose={() => setStartReq(null)} onFinish={finish} />}
      {reviewing && <FinishTimerDialog onClose={() => setReviewing(false)} />}
      {discarding && <DiscardTimerDialog onClose={() => setDiscarding(false)} />}
    </SessionActions.Provider>
  );
}
export function useWorkSessionActions() {
  const actions = useContext(SessionActions);
  if (!actions) throw new Error('Work sessions are not ready.');
  return actions;
}

/** Compact normal-flow timer bar; render inside the app content column. */
export function ActiveTimerControls() {
  const a = useWorkSessionActions();
  return <TimerBar onFinish={a.finish} onDiscard={a.discard} finishError={a.finishError} finishPending={a.finishPending} />;
}
