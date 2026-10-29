import { MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openAssistant, type AssistantFocus } from '@/lib/ai/bus';
import { cn } from '@/lib/utils';

export function AskButton({ focus, label = 'Ask Align', className, variant = 'outline', testId = 'button-ask-align' }: { focus: AssistantFocus; label?: string; className?: string; variant?: 'outline' | 'ghost' | 'secondary'; testId?: string }) {
  return (
    <Button type="button" variant={variant} className={cn('gap-1.5', className)} onClick={() => openAssistant(focus)} data-testid={testId}>
      <MessagesSquare className="text-primary" /> <span>{label}</span>
    </Button>
  );
}
