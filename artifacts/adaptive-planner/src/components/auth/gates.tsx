import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Redirect } from 'wouter';
import { Show } from '@clerk/react';
import { Clock, RefreshCw, ShieldOff, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { connectWorkspace, disconnectWorkspace } from '@/lib/workspace-sync';
import { setConversationScope } from '@/lib/ai/conversations';
import { AuthBackdrop, LogoMark, SignOutButton } from './auth-chrome';
import { useAccess, type Member } from './access-provider';

function Skeleton() {
  return (
    <div className="flex min-h-[100dvh] w-full" data-testid="status-access-loading" aria-busy>
      <div className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar p-5 md:block">
        <div className="mb-8 flex items-center gap-2.5"><LogoMark className="size-7 opacity-60" /><div className="h-4 w-16 animate-pulse rounded bg-muted" /></div>
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="mb-2 h-8 animate-pulse rounded-lg bg-muted/70" style={{ animationDelay: `${i * 80}ms` }} />)}
      </div>
      <div className="flex-1 px-6 pt-10 md:px-12">
        <div className="h-9 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-muted/70" />
        <div className="mt-10 grid gap-4 md:grid-cols-[2fr_1fr]">
          <div className="h-56 animate-pulse rounded-xl bg-muted/60" />
          <div className="h-56 animate-pulse rounded-xl bg-muted/40" />
        </div>
      </div>
    </div>
  );
}

const STATUS_COPY: Record<Exclude<Member['status'], 'approved'>, { icon: typeof Clock; title: string; body: string }> = {
  pending: { icon: Clock, title: 'Waiting for approval', body: 'Your account was created and is awaiting the owner’s review. You can use Align once the owner approves your request. This page checks again automatically.' },
  rejected: { icon: XCircle, title: 'Request not approved', body: 'The owner declined this access request. Nothing was stored for this account. If you think this is a mistake, reach out to the owner directly.' },
  revoked: { icon: ShieldOff, title: 'Access has been revoked', body: 'The owner turned off access for this account. Your workspace is kept private and is not loaded on this device.' },
};

function StatusScreen({ member, error, onRefresh }: { member: Member | null; error: string | null; onRefresh: () => void }) {
  const [checking, setChecking] = useState(false);
  const status = member?.status && member.status !== 'approved' ? member.status : null;
  const copy = status ? STATUS_COPY[status] : { icon: RefreshCw, title: "We couldn't confirm your access", body: error ?? 'Your account is signed in but its membership could not be read.' };
  const Icon = copy.icon;
  return (
    <AuthBackdrop>
      <section className="rise w-full max-w-lg rounded-2xl border border-card-border bg-card p-7 shadow-[0_20px_60px_-30px_hsl(var(--primary)/0.35)] md:p-9" data-testid={`card-access-${status ?? 'unknown'}`}>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"><Icon className="size-[1.1rem]" /></span>
          <span className="eyebrow" data-testid="text-access-status">{status ?? 'unverified'}</span>
        </div>
        <h1 className="mt-5 font-display text-[2rem] leading-tight">{copy.title}</h1>
        <p className="mt-2 text-[0.95rem] text-muted-foreground">{copy.body}</p>
        {member && (
          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border bg-background/60 px-4 py-3 text-sm">
            <dt className="text-muted-foreground">Account</dt><dd className="truncate" data-testid="text-access-email">{member.email}</dd>
            <dt className="text-muted-foreground">Requested</dt><dd className="font-num">{new Date(member.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</dd>
          </dl>
        )}
        {error && member && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => { setChecking(true); onRefresh(); window.setTimeout(() => setChecking(false), 900); }}
            disabled={checking}
            data-testid="button-refresh-access"
          >
            <RefreshCw className={checking ? 'animate-spin' : ''} /> {checking ? 'Checking' : 'Check again'}
          </Button>
          <SignOutButton workspace={false} className="text-muted-foreground" />
        </div>
      </section>
    </AuthBackdrop>
  );
}

/** Loads the approved account's workspace before mounting the app. Scopes AI conversations by user. */
function WorkspaceGate({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const live = useRef(0);

  useEffect(() => {
    const run = ++live.current;
    setState('loading');
    setErr(null);
    disconnectWorkspace();
    setConversationScope(null);
    connectWorkspace(userId)
      .then(() => {
        if (run !== live.current) return;
        setConversationScope(userId);
        setState('ready');
      })
      .catch((e: unknown) => {
        if (run !== live.current) return;
        setErr(e instanceof Error ? e.message : 'Could not load your workspace.');
        setState('error');
      });
    return () => {
      live.current++;
      disconnectWorkspace();
      setConversationScope(null);
    };
  }, [userId, attempt]);

  if (state === 'loading') return <Skeleton />;
  if (state === 'error') {
    return (
      <AuthBackdrop>
        <section className="rise w-full max-w-md rounded-2xl border border-card-border bg-card p-7" data-testid="card-workspace-error">
          <h1 className="font-display text-2xl">Your workspace didn't load</h1>
          <p className="mt-2 text-sm text-muted-foreground">{err} Nothing was changed. Try again in a moment.</p>
          <div className="mt-6 flex gap-2">
            <Button onClick={() => setAttempt((a) => a + 1)} data-testid="button-retry-workspace"><RefreshCw /> Retry</Button>
            <SignOutButton workspace={false} className="text-muted-foreground" />
          </div>
        </section>
      </AuthBackdrop>
    );
  }
  return <>{children}</>;
}

function ApprovedGate({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const { member, loading, error, refresh } = useAccess();
  if (loading) return <Skeleton />;
  if (!member || member.status !== 'approved') return <StatusScreen member={member} error={error} onRefresh={refresh} />;
  if (adminOnly && member.role !== 'admin') return <Redirect to="/overview" />;
  // key by id so a different account fully remounts the workspace + app tree
  return <WorkspaceGate key={member.id} userId={member.id}>{children}</WorkspaceGate>;
}

export function PrivateRoute({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in"><ApprovedGate>{children}</ApprovedGate></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}
