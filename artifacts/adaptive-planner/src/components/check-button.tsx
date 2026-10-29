import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

export function CheckButton({
  checked,
  onToggle,
  label,
  size = 'md',
  testId,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  size?: 'sm' | 'md';
  testId?: string;
}) {
  const reduce = useReducedMotion();
  const [burst, setBurst] = useState(0);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => {
        if (!checked) setBurst((b) => b + 1);
        onToggle();
      }}
      className={cn(
        'relative grid shrink-0 before:absolute before:-inset-3 before:content-[\'\'] place-items-center rounded-full border-[1.5px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        size === 'md' ? 'size-[1.15rem]' : 'size-4',
        checked ? 'border-primary bg-primary' : 'border-foreground/30 hover:border-primary hover:bg-primary/5',
      )}
    >
      <AnimatePresence initial={false}>
        {checked && (
          <motion.svg
            key="tick"
            viewBox="0 0 16 16"
            className="size-[70%] text-primary-foreground"
            exit={{ opacity: 0 }}
          >
            <motion.path
              d="M3.5 8.5l3 3 6-7"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: reduce ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
            />
          </motion.svg>
        )}
      </AnimatePresence>
      {burst > 0 && checked && !reduce && (
        <motion.span
          key={burst}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full border border-primary"
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 2.1, opacity: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        />
      )}
    </button>
  );
}
