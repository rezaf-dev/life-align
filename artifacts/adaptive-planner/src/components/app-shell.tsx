import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  CalendarRange,
  Compass,
  Inbox,
  Menu,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sun,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SampleMark } from '@/components/primitives';
import { getNavGuard, interceptNav, NAV_REQUEST_EVENT, setNavGuard } from '@/lib/nav-guard';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { setSettings } from '@/lib/store/actions';
import { inboxTasks, overdueTasks } from '@/lib/store/selectors';
import { useAppState } from '@/lib/store/store';
import { cn } from '@/lib/utils';
import { AssistantPanel } from '@/components/ai/assistant-panel';
import { openAssistant, toggleAssistant, useAssistantBus } from '@/lib/ai/bus';
import { setAiStore, useAiStore } from '@/lib/ai/conversations';
import { MessagesSquare, ShieldCheck, X } from 'lucide-react';
import { useAccess } from '@/components/auth/access-provider';
import { SignOutButton } from '@/components/auth/auth-chrome';
import { SyncStatus } from '@/components/auth/sync-status';
import { useAdminUsers } from '@/pages/admin';

const NAV = [
  { href: '/overview', label: 'Overview', icon: Compass, test: 'overview' },
  { href: '/goals', label: 'Goals', icon: Target, test: 'goals' },
  { href: '/planner', label: 'Planner', icon: CalendarRange, test: 'planner' },
  { href: '/tasks', label: 'Tasks & Inbox', icon: Inbox, test: 'tasks' },
  { href: '/reviews', label: 'Reviews', icon: NotebookPen, test: 'reviews' },
];

export function BrandMark({ className }: { className?: string }) {
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

function useCounts() {
  const s = useAppState();
  return useMemo(() => ({ inbox: inboxTasks(s.tasks).length, overdue: overdueTasks(s.tasks).length }), [s.tasks]);
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const [loc] = useLocation();
  const counts = useCounts();
  const { member } = useAccess();
  const isAdmin = member?.role === 'admin' && member.status === 'approved';
  const { data: users } = useAdminUsers(isAdmin);
  const pending = isAdmin ? (users ?? []).filter((u) => u.status === 'pending').length : 0;
  const isActive = (href: string) => (loc.startsWith(href));
  const item = (n: (typeof NAV)[number] | { href: string; label: string; icon: typeof Compass; test: string }) => {
    const active = isActive(n.href);
    const badge = n.href === '/tasks' ? counts.inbox : n.href === '/admin' ? pending : 0;
    const link = (
      <Link
        href={n.href}
        onClick={(e) => {
          if (interceptNav(n.href)) e.preventDefault();
          onNavigate?.();
        }}
        data-testid={`link-nav-${n.test}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[0.9rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          active ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        {active && <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />}
        <n.icon className={cn('size-[1.05rem] shrink-0', active && 'text-primary')} strokeWidth={1.75} />
        {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
        {!collapsed && badge > 0 && <span className="font-num text-[0.7rem] text-muted-foreground">{badge}</span>}
        {collapsed && badge > 0 && <span aria-hidden className="absolute right-2 top-1.5 size-1.5 rounded-full bg-primary" />}
      </Link>
    );
    if (!collapsed) return <li key={n.href}>{link}</li>;
    return (
      <li key={n.href}>
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right">{n.label}</TooltipContent>
        </Tooltip>
      </li>
    );
  };
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col">
      <ul className="space-y-0.5">{NAV.map(item)}</ul>
      <div className="mt-auto pt-4">
        <ul>
          {isAdmin && item({ href: '/admin', label: 'Members', icon: ShieldCheck, test: 'admin' })}
          {item({ href: '/settings', label: 'Settings', icon: Settings2, test: 'settings' })}
        </ul>
      </div>
    </nav>
  );
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { settings } = useAppState();
  const dark = settings.theme === 'dark';
  return (
    <Button
      variant="ghost"
      size={collapsed ? 'icon' : 'sm'}
      className={cn('text-sidebar-foreground/70', !collapsed && 'w-full justify-start gap-3 px-2.5')}
      onClick={() => setSettings({ theme: dark ? 'light' : 'dark' })}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      data-testid="button-theme-toggle"
    >
      {dark ? <Sun /> : <Moon />}
      {!collapsed && <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
    </Button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { settings, goals } = useAppState();
  const { member } = useAccess();
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = settings.sidebarCollapsed;
  const hasDemo = goals.some((g) => g.isDemo);
  const [location, navigate] = useLocation();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const assistant = useAssistantBus();
  const aiStore = useAiStore();
  const showIntro = !location.startsWith('/admin') && !aiStore.introDismissed && aiStore.conversations.length === 0 && !assistant.open;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleAssistant();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onReq = (e: Event) => setPendingHref((e as CustomEvent<string>).detail);
    window.addEventListener(NAV_REQUEST_EVENT, onReq);
    return () => window.removeEventListener(NAV_REQUEST_EVENT, onReq);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  const brand = (c: boolean) => (
    <Link href="/overview" onClick={(e) => { if (interceptNav('/overview')) e.preventDefault(); }} className="flex items-center gap-2.5 px-1" data-testid="link-brand">
      <BrandMark className="size-7 shrink-0" />
      {!c && <span className="font-display text-[1.35rem] italic leading-none tracking-tight">Align</span>}
    </Link>
  );

  return (
    <div className="flex min-h-[100dvh] w-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside
        className={cn(
          'sticky top-0 hidden h-[100dvh] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 transition-[width] duration-300 md:flex',
          collapsed ? 'w-[4.25rem]' : 'w-60',
        )}
      >
        <div className={cn('mb-8 flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
          {brand(collapsed)}
          {!collapsed && (
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Collapse sidebar" onClick={() => setSettings({ sidebarCollapsed: true })} data-testid="button-collapse-sidebar">
              <PanelLeftClose />
            </Button>
          )}
        </div>
        {collapsed && (
          <Button variant="ghost" size="icon" className="mx-auto mb-4 size-8 text-muted-foreground" aria-label="Expand sidebar" onClick={() => setSettings({ sidebarCollapsed: false })} data-testid="button-expand-sidebar">
            <PanelLeftOpen />
          </Button>
        )}
        <Button
          variant="outline"
          className={cn('mb-4 border-primary/25 bg-primary/[0.05] text-foreground hover:bg-primary/10', collapsed ? 'mx-auto size-9 p-0' : 'w-full justify-start gap-2.5 px-2.5')}
          onClick={() => openAssistant({})}
          aria-label="Open planning assistant"
          data-testid="button-open-assistant"
        >
          <MessagesSquare className="text-primary" />
          {!collapsed && <span className="flex-1 text-left">Ask Align</span>}
          {!collapsed && <kbd className="font-num text-[0.65rem] text-muted-foreground">Ctrl J</kbd>}
        </Button>
        <NavList collapsed={collapsed} />
        <div className={cn('mt-2 space-y-2 border-t border-sidebar-border pt-3', collapsed && 'flex flex-col items-center')}>
          <SyncStatus collapsed={collapsed} />
          <ThemeToggle collapsed={collapsed} />
          <div className={cn('flex items-center gap-1', collapsed ? 'flex-col' : 'pl-2.5')}>
            {!collapsed && (
              <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                <div className="truncate font-medium text-sidebar-foreground" data-testid="text-account-name">{settings.name || member?.name || 'You'}</div>
                <div className="truncate" data-testid="text-account-email">{member?.email ?? (hasDemo ? 'Includes sample data' : 'Private workspace')}</div>
              </div>
            )}
            <SignOutButton workspace compact className="size-8 shrink-0 text-muted-foreground" />
          </div>
        </div>
      </aside>

      <div className={cn('flex min-w-0 flex-1 flex-col transition-[padding] duration-300', assistant.open && '2xl:pr-[440px]')}>
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:hidden">
          {brand(false)}
          <div className="flex items-center gap-2">
            <SyncStatus collapsed />
            <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)} data-testid="button-mobile-nav">
              <Menu />
            </Button>
          </div>
        </header>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="flex w-72 flex-col bg-sidebar p-4">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="mb-6 mt-1">{brand(false)}</div>
            <NavList collapsed={false} onNavigate={() => setMobileOpen(false)} />
            <div className="mt-3 space-y-1 border-t border-sidebar-border pt-3">
              <SyncStatus />
              <ThemeToggle collapsed={false} />
              <SignOutButton workspace className="w-full justify-start gap-3 px-2.5 text-sidebar-foreground/70" />
            </div>
          </SheetContent>
        </Sheet>
        <main id="main" className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-20 pt-6 md:px-8 md:pt-10 lg:px-12">
          {hasDemo && (
            <p className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground" data-testid="text-sample-notice">
              <SampleMark />
              <span>Sample workspace <span className="hidden sm:inline">· dashed dots mark sample items</span></span>
              <Link href="/settings" onClick={(e) => { if (interceptNav('/settings')) e.preventDefault(); }} className="ml-auto font-medium text-primary hover:underline">Manage samples</Link>
            </p>
          )}
          {children}
        </main>
        <ConfirmDialog
          open={!!pendingHref}
          onOpenChange={(o) => !o && setPendingHref(null)}
          title="Leave without saving?"
          description={getNavGuard() ?? 'Unsaved changes on this screen will be lost.'}
          confirmLabel="Discard and leave"
          destructive
          onConfirm={() => {
            const href = pendingHref;
            setNavGuard(null);
            setPendingHref(null);
            if (href) navigate(href);
          }}
        />
      </div>
      <AssistantPanel />
      {!assistant.open && (
        <div className="fixed bottom-4 right-4 z-30 flex flex-col items-end gap-2">
          {showIntro && (
            <div className="rise w-72 rounded-xl border border-card-border bg-card p-3.5 shadow-lg" data-testid="card-assistant-intro">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="font-display text-[1.05rem]">Plan by just saying it.</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">Describe a goal, a messy week or a task. Align drafts the records; you approve each change.</p>
                </div>
                <button type="button" aria-label="Dismiss" onClick={() => setAiStore((d) => { d.introDismissed = true; })} className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted" data-testid="button-dismiss-assistant-intro">
                  <X className="size-3.5" />
                </button>
              </div>
              <Button size="sm" className="mt-2.5 w-full" onClick={() => openAssistant({})} data-testid="button-intro-open-assistant">Try it</Button>
            </div>
          )}
          <Button size="icon" className="size-12 rounded-full shadow-lg md:hidden" onClick={() => openAssistant({})} aria-label="Open planning assistant" data-testid="button-fab-assistant">
            <MessagesSquare />
          </Button>
        </div>
      )}
    </div>
  );
}
