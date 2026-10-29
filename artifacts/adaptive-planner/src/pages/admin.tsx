import { useMemo, useState } from 'react';
import { Redirect } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, RefreshCw, Search, ShieldOff, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/primitives';
import { useToast } from '@/hooks/use-toast';
import { apiJson, useAccess, type Member, type MemberStatus } from '@/components/auth/access-provider';
import { cn } from '@/lib/utils';

export const ADMIN_USERS_KEY = ['admin', 'users'] as const;
type Filter = 'all' | MemberStatus;
type Action = 'approved' | 'rejected' | 'revoked';

const PILL: Record<MemberStatus, string> = {
  pending: 'bg-[hsl(38_70%_50%/0.14)] text-[hsl(30_70%_32%)] dark:text-[hsl(38_70%_65%)]',
  approved: 'bg-[hsl(158_30%_38%/0.14)] text-[hsl(158_35%_28%)] dark:text-[hsl(158_35%_60%)]',
  rejected: 'bg-muted text-muted-foreground',
  revoked: 'bg-destructive/10 text-destructive',
};

export function useAdminUsers(enabled: boolean) {
  return useQuery({ queryKey: ADMIN_USERS_KEY, queryFn: () => apiJson<Member[]>('/admin/users'), enabled, refetchInterval: 15000 });
}

export default function AdminPage() {
  const { member } = useAccess();
  if (!member || member.role !== 'admin') return <Redirect to="/overview" />;
  return <AdminInner selfId={member.id} />;
}

function AdminInner({ selfId }: { selfId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useAdminUsers(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('pending');
  const [confirm, setConfirm] = useState<{ m: Member; action: Action } | null>(null);

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Action }) => apiJson<Member>(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: (m) => {
      qc.setQueryData<Member[]>(ADMIN_USERS_KEY, (old) => old?.map((x) => (x.id === m.id ? m : x)));
      toast({ title: `${m.name || m.email} is now ${m.status}` });
    },
    onError: (e) => toast({ title: 'Update failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }),
  });

  const counts = useMemo(() => {
    const c = { all: 0, pending: 0, approved: 0, rejected: 0, revoked: 0 } as Record<Filter, number>;
    (data ?? []).forEach((m) => { c.all++; c[m.status]++; });
    return c;
  }, [data]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter((m) => filter === 'all' || m.status === filter)
      .filter((m) => !term || m.email.toLowerCase().includes(term) || m.name.toLowerCase().includes(term))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data, q, filter]);

  const act = (m: Member, action: Action) => {
    if (action === 'approved') mutation.mutate({ id: m.id, status: action });
    else setConfirm({ m, action });
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Members"
        description="Every account is private. Approving someone gives them their own empty workspace; you never see its contents."
        actions={<Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-admin-refresh"><RefreshCw className={isFetching ? 'animate-spin' : ''} /> Refresh</Button>}
      />

      {counts.pending > 0 && (
        <div className="rise mb-5 flex items-center gap-3 rounded-xl border border-[hsl(38_70%_50%/0.35)] bg-[hsl(38_70%_50%/0.08)] px-4 py-3 text-sm" data-testid="banner-pending">
          <span className="font-num grid size-7 place-items-center rounded-full bg-[hsl(38_70%_50%)] text-xs font-medium text-white">{counts.pending}</span>
          <span>{counts.pending === 1 ? 'One request is' : `${counts.pending} requests are`} waiting for your decision.</span>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="pl-9" data-testid="input-admin-search" />
        </div>
        <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {(['pending', 'approved', 'rejected', 'revoked', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              type="button"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs capitalize transition-colors', filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
              data-testid={`tab-filter-${f}`}
            >
              {f}<span className="font-num opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-card-border bg-card">
        {isLoading ? (
          <ul className="divide-y divide-border">{Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-4 p-4"><div className="size-9 animate-pulse rounded-full bg-muted" /><div className="flex-1 space-y-2"><div className="h-3.5 w-40 animate-pulse rounded bg-muted" /><div className="h-3 w-56 animate-pulse rounded bg-muted/70" /></div></li>
          ))}</ul>
        ) : isError ? (
          <div className="p-8 text-center" data-testid="state-admin-error">
            <p className="font-display text-xl">Members couldn't load</p>
            <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Unknown error'}</p>
            <Button className="mt-4" variant="outline" onClick={() => refetch()} data-testid="button-admin-retry">Try again</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center p-10 text-center" data-testid="state-admin-empty">
            <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary"><Users className="size-5" /></span>
            <p className="mt-3 font-display text-xl">{q ? 'No one matches that search' : filter === 'pending' ? 'No one is waiting' : `No ${filter === 'all' ? '' : filter + ' '}members`}</p>
            <p className="mt-1 text-sm text-muted-foreground">{filter === 'pending' && !q ? 'New sign-ups will appear here for approval.' : 'Try another filter.'}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((m) => {
              const isSelf = m.id === selfId || m.role === 'admin';
              const busy = mutation.isPending && mutation.variables?.id === m.id;
              return (
                <li key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid={`row-member-${m.id}`}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent font-display text-sm text-accent-foreground">{(m.name || m.email).slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium" data-testid={`text-member-name-${m.id}`}>{m.name || m.email.split('@')[0]}</span>
                        {m.role === 'admin' && <span className="eyebrow text-primary">Owner</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{m.email} · <span className="font-num">{new Date(m.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded-full px-2.5 py-0.5 text-xs capitalize', PILL[m.status])} data-testid={`status-member-${m.id}`}>{m.status}</span>
                    {!isSelf && (
                      <div className="flex gap-1">
                        {m.status !== 'approved' && <Button size="sm" disabled={busy} onClick={() => act(m, 'approved')} data-testid={`button-approve-${m.id}`}><Check /> {m.status === 'pending' ? 'Approve' : 'Restore'}</Button>}
                        {m.status === 'pending' && <Button size="sm" variant="outline" disabled={busy} onClick={() => act(m, 'rejected')} data-testid={`button-reject-${m.id}`}><X /> Reject</Button>}
                        {m.status === 'approved' && <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={() => act(m, 'revoked')} data-testid={`button-revoke-${m.id}`}><ShieldOff /> Revoke</Button>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.action === 'revoked' ? `Revoke access for ${confirm.m.email}?` : `Reject ${confirm?.m.email ?? ''}?`}
        description={confirm?.action === 'revoked' ? 'They will be signed out of the workspace within seconds. Their data is kept, and you can restore access later.' : 'They will see that their request was not approved. You can still approve them later.'}
        confirmLabel={confirm?.action === 'revoked' ? 'Revoke access' : 'Reject request'}
        destructive
        onConfirm={() => { if (confirm) mutation.mutate({ id: confirm.m.id, status: confirm.action }); setConfirm(null); }}
      />
    </div>
  );
}
