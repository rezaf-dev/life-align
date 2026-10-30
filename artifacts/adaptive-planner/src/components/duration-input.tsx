import { useState } from 'react';
import { cn } from '@/lib/utils';

const clean = (v: string) => v.replace(/[^\d]/g, '').slice(0, 4);
const split = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return { h: String(Math.floor(s / 3600)), m: String(Math.floor((s % 3600) / 60)), s: String(s % 60) };
};

/**
 * Hours / minutes / optional seconds. Emits whole seconds so timer precision survives;
 * callers derive fractional minutes as seconds / 60. Text inputs avoid native number-step rounding.
 * State initializes once; remount with a key to reset from outside.
 */
export function DurationInput({ seconds, onChange, showSeconds, disabled, label = 'Duration', testId = 'duration', className }: {
  seconds: number; onChange: (seconds: number) => void; showSeconds?: boolean; disabled?: boolean; label?: string; testId?: string; className?: string;
}) {
  const [v, setV] = useState(() => split(seconds));
  const [reveal, setReveal] = useState(false);
  const withSec = showSeconds || reveal || Math.round(seconds) % 60 !== 0;
  const set = (k: 'h' | 'm' | 's', raw: string) => {
    const next = { ...v, [k]: clean(raw) };
    setV(next);
    onChange((Number(next.h) || 0) * 3600 + (Number(next.m) || 0) * 60 + (withSec ? Number(next.s) || 0 : 0));
  };
  const box = (k: 'h' | 'm' | 's', unit: string) => (
    <label className="flex h-10 min-w-0 flex-1 items-center rounded-md border border-input bg-background pr-2 focus-within:ring-2 focus-within:ring-ring">
      <input inputMode="numeric" pattern="[0-9]*" value={v[k]} disabled={disabled} aria-label={`${label} ${unit === 'h' ? 'hours' : unit === 'm' ? 'minutes' : 'seconds'}`}
        onChange={(e) => set(k, e.target.value)} onFocus={(e) => e.target.select()}
        className="h-full w-full min-w-0 bg-transparent px-2 text-right font-num text-sm outline-none disabled:opacity-60" data-testid={`input-${testId}-${k}`} />
      <span className="text-xs text-muted-foreground">{unit}</span>
    </label>
  );
  return (
    <div className={cn('flex gap-1.5', className)} role="group" aria-label={label}>
      {box('h', 'h')}{box('m', 'm')}{withSec ? box('s', 's') : (
        <button type="button" disabled={disabled} onClick={() => setReveal(true)} className="shrink-0 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground" data-testid={`button-${testId}-seconds`}>+ sec</button>
      )}
    </div>
  );
}
