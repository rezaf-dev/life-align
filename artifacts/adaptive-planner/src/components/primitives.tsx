import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { Area, GoalStatus } from '@/lib/store/types';
import { areaLabel } from '@/lib/store/types';
import type { Health } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';

export const areaBg: Record<Area, string> = {
  business: 'bg-area-business',
  fitness: 'bg-area-fitness',
  english: 'bg-area-english',
  personal: 'bg-area-personal',
};
export const areaText: Record<Area, string> = {
  business: 'text-area-business',
  fitness: 'text-area-fitness',
  english: 'text-area-english',
  personal: 'text-area-personal',
};

export function AreaDot({ area, goalId, className }: { area: Area; goalId?: string; className?: string }) {
  const color = useAppState().goals.find((g) => g.id === goalId)?.color;
  return <span aria-hidden style={color ? { backgroundColor: color } : undefined} className={cn('inline-block size-2 shrink-0 rounded-full', !color && areaBg[area], className)} />;
}

export function AreaTag({ area, goalId }: { area: Area; goalId?: string }) {
  return (
    <span className={cn('eyebrow inline-flex items-center gap-1.5 !text-[0.66rem]', goalId ? 'text-muted-foreground' : areaText[area])}>
      <AreaDot area={area} goalId={goalId} />
      {areaLabel(area)}
    </span>
  );
}

/** Quiet per-item sample marker; the workspace-level notice explains it. */
export function SampleMark({ className }: { className?: string }) {
  return (
    <span
      title="Sample item"
      role="img"
      aria-label="Sample item"
      className={cn('inline-block size-2 shrink-0 rounded-full border border-dashed border-foreground/50', className)}
    />
  );
}

export function SampleBadge({ className }: { className?: string }) {
  return (
    <span
      title="Sample data — remove it any time from Settings"
      className={cn(
        'inline-flex items-center rounded-full border border-dashed border-foreground/25 px-1.5 py-px font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground',
        className,
      )}
    >
      Sample
    </span>
  );
}

const healthMeta: Record<Health, { label: string; cls: string }> = {
  achieved: { label: 'Achieved', cls: 'text-success bg-success/10' },
  'on-track': { label: 'On pace', cls: 'text-success bg-success/10' },
  watch: { label: 'Watch', cls: 'text-warning bg-warning/10' },
  behind: { label: 'Behind pace', cls: 'text-destructive bg-destructive/10' },
  'no-data': { label: 'No metric', cls: 'text-muted-foreground bg-muted' },
  'not-started': { label: 'Not started', cls: 'text-muted-foreground bg-muted' },
  'just-started': { label: 'Just started', cls: 'text-muted-foreground bg-muted' },
};

export function HealthPill({ health }: { health: Health }) {
  const m = healthMeta[health];
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-medium', m.cls)}>{m.label}</span>
  );
}

const statusMeta: Record<GoalStatus, string> = {
  active: 'text-primary bg-primary/10',
  paused: 'text-warning bg-warning/10',
  completed: 'text-success bg-success/10',
  cancelled: 'text-muted-foreground bg-muted line-through',
};
export function StatusPill({ status }: { status: GoalStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-medium capitalize', statusMeta[status])}>
      {status}
    </span>
  );
}

/** Progress line with an optional expected-pace tick. */
export function PaceBar({
  progress,
  expected,
  area,
  goalId,
  className,
}: {
  progress: number;
  expected?: number;
  area: Area;
  goalId?: string;
  className?: string;
}) {
  const color = useAppState().goals.find((g) => g.id === goalId)?.color;
  return (
    <div className={cn('relative h-1.5 w-full rounded-full bg-muted', className)}>
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full origin-left transition-transform duration-700', !color && areaBg[area])}
        style={{ backgroundColor: color, width: '100%', transform: `scaleX(${Math.max(0.015, progress)})` }}
      />
      {expected !== undefined && (
        <div
          title="Where a straight line to target would be today"
          className="absolute -top-1 h-3.5 w-px bg-foreground/60"
          style={{ left: `${expected * 100}%` }}
        />
      )}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="rise mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="font-display text-[1.9rem] font-normal leading-tight md:text-[2.2rem]">{title}</h1>
        {description && <p className="mt-1 text-[0.93rem] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  body,
  action,
  mark = 'lines',
  className,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  mark?: 'lines' | 'circle';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <svg aria-hidden width="56" height="40" viewBox="0 0 56 40" className="mb-4 text-foreground/25">
        {mark === 'lines' ? (
          <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="8" y1="10" x2="48" y2="10" />
            <line x1="8" y1="20" x2="36" y2="20" />
            <line x1="8" y1="30" x2="24" y2="30" />
            <circle cx="44" cy="30" r="3" className="fill-primary stroke-primary" />
          </g>
        ) : (
          <g stroke="currentColor" strokeWidth="1.5" fill="none">
            <circle cx="28" cy="20" r="14" />
            <circle cx="28" cy="20" r="3" className="fill-primary stroke-primary" />
          </g>
        )}
      </svg>
      <p className="font-display text-lg">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Section({
  title,
  aside,
  children,
  className,
  id,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('surface rise p-5 md:p-6', className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function RuleLabel() {
  return (
    <span title="Generated by simple rules from your stored data. No AI." className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-px font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
      Rule-based
    </span>
  );
}
