import { useState } from 'react';
import { AlertTriangle, Check, CloudOff, Download, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { reloadWorkspace, retryWorkspaceSave, useWorkspaceSync } from '@/lib/workspace-sync';
import { cn } from '@/lib/utils';
import { downloadBackup } from './auth-chrome';

const LABEL = { idle: 'Synced', saved: 'Saved', saving: 'Saving', loading: 'Loading', error: 'Not saved', conflict: 'Conflict' } as const;

export function SyncStatus({ collapsed }: { collapsed?: boolean }) {
  const { status, error } = useWorkspaceSync();
  const { toast } = useToast();
  const [confirmReload, setConfirmReload] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const bad = status === 'error' || status === 'conflict';
  const Icon = status === 'saving' || status === 'loading' ? Loader2 : status === 'error' ? CloudOff : status === 'conflict' ? AlertTriangle : Check;

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              bad ? 'bg-destructive/10 text-destructive hover:bg-destructive/15' : 'text-muted-foreground hover:bg-sidebar-accent/60',
              collapsed ? 'justify-center' : 'w-full',
            )}
            aria-label={`Sync: ${LABEL[status]}`}
            data-testid="button-sync-status"
          >
            <Icon className={cn('size-3.5 shrink-0', (status === 'saving' || status === 'loading') && 'animate-spin')} />
            {!collapsed && <span data-testid="text-sync-status">{LABEL[status]}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-72 p-4">
          <div className="font-display text-lg">{status === 'conflict' ? 'Saved elsewhere too' : status === 'error' ? "Couldn't save" : 'Workspace saved'}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {status === 'conflict'
              ? 'Your workspace changed in another tab or device. Keep a backup of this version, then reload the saved one.'
              : status === 'error'
                ? error ?? 'Changes are kept on this screen. Retry, or download a backup.'
                : 'Changes save to your private account automatically.'}
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {status === 'error' && (
              <Button size="sm" disabled={retrying} onClick={async () => { setRetrying(true); try { await retryWorkspaceSave(); toast({ title: 'Saved' }); } catch (e) { toast({ title: 'Still not saved', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }); } finally { setRetrying(false); } }} data-testid="button-sync-retry">
                <RotateCcw /> Retry save
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => { downloadBackup(); toast({ title: 'Backup downloaded' }); }} data-testid="button-sync-backup"><Download /> Download backup</Button>
            {bad && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmReload(true)} data-testid="button-sync-reload">Reload saved version</Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={confirmReload}
        onOpenChange={setConfirmReload}
        title="Reload the saved version?"
        description="Unsaved changes on this device will be discarded and replaced by the version saved to your account. Download a backup first if you might need them."
        confirmLabel="Discard and reload"
        destructive
        onConfirm={async () => {
          try { await reloadWorkspace(); toast({ title: 'Saved version loaded' }); } catch (e) { toast({ title: 'Reload failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }); }
        }}
      />
    </>
  );
}
