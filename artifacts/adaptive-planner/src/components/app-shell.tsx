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

const NAV = [
  { href: '/', label: 'Overview', icon: Compass, test: 'overview' },
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
  const isActive = (href: string) => (href === '/' ? loc === '/' : loc.startsWith(href));
  const item = (n: (typeof NAV)[number] | { href: string; label: string; icon: typeof Compass; test: string }) => {
    const active = isActive(n.href);
    const badge = n.href === '/tasks' ? counts.inbox : 0;
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
        <ul>{item({ href: '/settings', label: 'Settings', icon: Settings2, test: 'settings' })}</ul>
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = settings.sidebarCollapsed;
  const hasDemo = goals.some((g) => g.isDemo);
  const [, navigate] = useLocation();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    const onReq = (e: Event) => setPendingHref((e as CustomEvent<string>).detail);
    window.addEventListener(NAV_REQUEST_EVENT, onReq);
    return () => window.removeEventListener(NAV_REQUEST_EVENT, onReq);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  const brand = (c: boolean) => (
    <Link href="/" onClick={(e) => { if (interceptNav('/')) e.preventDefault(); }} className="flex items-center gap-2.5 px-1" data-testid="link-brand">
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
        <NavList collapsed={collapsed} />
        <div className={cn('mt-2 space-y-2 border-t border-sidebar-border pt-3', collapsed && 'flex flex-col items-center')}>
          <ThemeToggle collapsed={collapsed} />
          {!collapsed && (
            <div className="px-2.5 text-xs text-muted-foreground">
              <div className="truncate font-medium text-sidebar-foreground">{settings.name || 'You'}</div>
              <div>{hasDemo ? 'Includes sample data' : 'Your data, stored in this browser'}</div>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:hidden">
          {brand(false)}
          <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)} data-testid="button-mobile-nav">
            <Menu />
          </Button>
        </header>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="flex w-72 flex-col bg-sidebar p-4">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="mb-6 mt-1">{brand(false)}</div>
            <NavList collapsed={false} onNavigate={() => setMobileOpen(false)} />
            <div className="mt-3 border-t border-sidebar-border pt-3">
              <ThemeToggle collapsed={false} />
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
    </div>
  );
}
