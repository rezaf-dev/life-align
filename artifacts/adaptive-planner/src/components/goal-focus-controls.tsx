import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { setGoalPriority, setGoalSpotlight } from '@/lib/store/actions';
import type { Goal, Priority } from '@/lib/store/types';
import { cn } from '@/lib/utils';

export function GoalSpotlightButton({ goal }: { goal: Goal }) {
  const { toast } = useToast();
  const active = goal.status === 'active';
  const label = goal.spotlight ? `Remove ${goal.title} from spotlight` : `Spotlight ${goal.title}`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-10 shrink-0 gap-1.5 px-2 sm:h-9', goal.spotlight ? 'text-foreground' : 'text-muted-foreground')}
      aria-label={label}
      aria-pressed={!!goal.spotlight}
      disabled={!active && !goal.spotlight}
      title={!active && !goal.spotlight ? 'Resume this goal to put it in focus' : label}
      data-testid={`button-spotlight-${goal.id}`}
      onClick={() => {
        try { setGoalSpotlight(goal.id, !goal.spotlight); }
        catch (error) { toast({ title: 'Could not update spotlight', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' }); }
      }}
    >
      <Star className={cn('size-4', goal.spotlight && 'fill-current')} aria-hidden />
      <span>{goal.spotlight ? active ? 'In focus' : 'Spotlight saved' : 'Spotlight'}</span>
    </Button>
  );
}

export function GoalPriorityControl({ goal }: { goal: Goal }) {
  const { toast } = useToast();
  return (
    <Select value={goal.priority} onValueChange={(value) => {
      try { setGoalPriority(goal.id, value as Priority); }
      catch (error) { toast({ title: 'Could not update priority', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' }); }
    }}>
      <SelectTrigger
        className={cn('h-10 w-[140px] gap-1 border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted sm:h-9', goal.priority === 'high' ? 'font-medium text-foreground' : 'text-muted-foreground')}
        aria-label={`Priority for ${goal.title}`}
        data-testid={`select-priority-${goal.id}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="high">High priority</SelectItem>
        <SelectItem value="medium">Medium priority</SelectItem>
        <SelectItem value="low">Low priority</SelectItem>
      </SelectContent>
    </Select>
  );
}
