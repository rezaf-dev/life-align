import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Goal, Task } from '@/lib/store/types';
import { ConvertTaskDialog } from '@/components/work-sessions';

const SessionActions = createContext<{ convert: (task: Task, goal: Goal) => void } | null>(null);
/** The confirmation must survive archiving the task row that opened it. */
export function WorkSessionProvider({ children }: { children: ReactNode }) {
  const [conversion, setConversion] = useState<{ task: Task; goal: Goal } | null>(null);
  return (
    <SessionActions.Provider value={{ convert: (task, goal) => setConversion({ task, goal }) }}>
      {children}
      {conversion && <ConvertTaskDialog task={conversion.task} goal={conversion.goal} onClose={() => setConversion(null)} />}
    </SessionActions.Provider>
  );
}
export function useWorkSessionActions() {
  const actions = useContext(SessionActions);
  if (!actions) throw new Error('Work sessions are not ready.');
  return actions;
}
