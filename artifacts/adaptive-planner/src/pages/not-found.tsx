import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/primitives';

export default function NotFound() {
  return (
    <div className="surface mt-10">
      <EmptyState
        mark="circle"
        title="This page is off the map"
        body="The link may be old, or the item was deleted."
        action={<Button asChild><Link href="/">Back to Overview</Link></Button>}
      />
    </div>
  );
}
