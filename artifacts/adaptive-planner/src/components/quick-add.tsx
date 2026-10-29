import { useRef, useState } from 'react';
import { CornerDownLeft, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { TaskDialog } from '@/components/task-dialog';
import { addTask } from '@/lib/store/actions';
import type { Task } from '@/lib/store/types';
import { relDay } from '@/lib/dates';
import { cn } from '@/lib/utils';

export function QuickAdd({
  defaults,
  placeholder = 'Capture a task — press Enter',
  className,
  testId = 'input-quick-add',
}: {
  defaults?: Partial<Task>;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const [value, setValue] = useState('');
  const [details, setDetails] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const submit = () => {
    const title = value.trim();
    if (!title) return;
    addTask({ ...defaults, title });
    setValue('');
    toast({
      title: 'Captured',
      description: defaults?.plannedDate ? `Planned for ${relDay(defaults.plannedDate).toLowerCase()}.` : 'In your inbox.',
    });
    ref.current?.focus();
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border border-border bg-background/60 pl-3.5 pr-1.5 py-1.5 transition-colors focus-within:border-primary/50 focus-within:bg-card',
        className,
      )}
    >
      <span aria-hidden className="size-[1.05rem] shrink-0 rounded-full border-[1.5px] border-dashed border-foreground/25" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        aria-label="Quick add task"
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-1 text-[0.92rem] outline-none placeholder:text-muted-foreground/70"
        data-testid={testId}
      />
      {value.trim() ? (
        <Button size="sm" onClick={submit} className="h-8 gap-1 px-2.5" data-testid="button-quick-add">
          Add <CornerDownLeft className="!size-3" />
        </Button>
      ) : null}
      <Button
        size="icon"
        variant="ghost"
        className="size-9 sm:size-8"
        aria-label="Add with details"
        onClick={() => setDetails(true)}
        data-testid="button-quick-add-details"
      >
        <SlidersHorizontal />
      </Button>
      <TaskDialog
        open={details}
        onOpenChange={(o) => {
          setDetails(o);
          if (!o) setValue('');
        }}
        defaults={{ ...defaults, title: value }}
      />
    </div>
  );
}
