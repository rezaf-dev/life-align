import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useClerk } from '@clerk/react';
import { Download, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { flushWorkspace } from '@/lib/workspace-sync';
import { exportJson } from '@/lib/store/actions';
import { todayIso } from '@/lib/dates';

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <rect x="1" y="1" width="26" height="26" rx="8" className="fill-primary" />
      <g stroke="hsl(var(--primary-foreground))" strokeWidth="2" strokeLinecap="round">
        <line x1="8" y1="9.5" x2="20" y2="9.5" />
        <line x1="8" y1="14" x2="16.5" y2="14" />
        <line x1="8" y1="18.5" x2="12.5" y2="18.5" />
      </g>
      <circle cx="19.5" cy="18.5" r="1.8" fill="hsl(var(--primary-foreground))" />
    </svg>
  );
}

export function PublicBrand() {
  return (
    <Link href="/" className="flex items-center gap-2.5" data-testid="link-public-brand">
      <LogoMark className="size-7" />
      <span className="font-display text-[1.35rem] italic leading-none tracking-tight">Align</span>
    </Link>
  );
}

/** Full-height paper backdrop shared by auth/status screens. */
export function AuthBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_85%_-10%,hsl(var(--primary)/0.07),transparent_60%)]" />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 md:px-8">
        <PublicBrand />
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-16">{children}</main>
    </div>
  );
}

export function downloadBackup() {
  const blob = new Blob([exportJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `align-backup-${todayIso()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Sign out with a flush guard: unsaved writes are pushed first; on failure the user chooses. */
export function useSafeSignOut(opts: { workspace: boolean }) {
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const hardSignOut = () => signOut({ redirectUrl: basePath || '/' });
  const start = async () => {
    if (!opts.workspace) return hardSignOut();
    setBusy(true);
    try {
      await flushWorkspace();
      await hardSignOut();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Latest changes could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  const dialog = failed ? (
    <div role="alertdialog" aria-modal className="fixed inset-0 z-[80] grid place-items-center bg-foreground/25 p-4 backdrop-blur-[2px]" data-testid="dialog-signout-unsaved">
      <div className="rise w-full max-w-md rounded-2xl border border-card-border bg-card p-6 shadow-xl">
        <h2 className="font-display text-2xl">Some changes aren't saved yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">{failed} If you sign out now, recent edits made on this device may be lost. Stay to retry, or download a backup first.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => downloadBackup()} data-testid="button-signout-backup"><Download /> Download backup</Button>
          <Button variant="outline" className="text-destructive" onClick={() => { setFailed(null); void hardSignOut(); }} data-testid="button-signout-anyway">Sign out anyway</Button>
          <Button onClick={() => setFailed(null)} data-testid="button-signout-stay">Stay</Button>
        </div>
      </div>
    </div>
  ) : null;
  return { signOut: start, busy, dialog };
}

export function SignOutButton({ workspace, className, compact }: { workspace: boolean; className?: string; compact?: boolean }) {
  const { signOut, busy, dialog } = useSafeSignOut({ workspace });
  return (
    <>
      <Button variant="ghost" size={compact ? 'icon' : 'sm'} className={className} disabled={busy} onClick={() => void signOut()} aria-label="Sign out" data-testid="button-sign-out">
        <LogOut />
        {!compact && <span>{busy ? 'Saving…' : 'Sign out'}</span>}
      </Button>
      {dialog}
    </>
  );
}
