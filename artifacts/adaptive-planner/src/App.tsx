import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { MotionConfig, motion } from 'framer-motion';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/app-shell';
import { AccessProvider } from '@/components/auth/access-provider';
import { AuthBackdrop } from '@/components/auth/auth-chrome';
import { PrivateRoute } from '@/components/auth/gates';
import NotFound from '@/pages/not-found';
import LandingPage from '@/pages/landing';
import OverviewPage from '@/pages/overview';
import GoalsPage from '@/pages/goals';
import GoalDetailPage from '@/pages/goal-detail';
import PlannerPage from '@/pages/planner';
import TasksPage from '@/pages/tasks';
import ReviewsPage from '@/pages/reviews';
import SettingsPage from '@/pages/settings';
import AdminPage from '@/pages/admin';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(350 50% 36%)",
    colorForeground: "hsl(224 24% 14%)",
    colorMutedForeground: "hsl(222 12% 36%)",
    colorDanger: "hsl(4 66% 45%)",
    colorBackground: "hsl(42 40% 98.5%)",
    colorInput: "hsl(42 33% 96%)",
    colorInputForeground: "hsl(224 24% 14%)",
    colorNeutral: "hsl(224 18% 30%)",
    fontFamily: "'Instrument Sans', ui-sans-serif, sans-serif",
    borderRadius: "0.6rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[hsl(42_40%_98.5%)] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[hsl(38_18%_85%)] shadow-[0_30px_80px_-40px_hsl(350_50%_36%/0.45)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: { fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400, fontSize: "1.65rem", color: "hsl(224 24% 14%)" },
    headerSubtitle: { color: "hsl(222 12% 36%)" },
    socialButtonsBlockButtonText: { color: "hsl(224 24% 14%)", fontWeight: 500 },
    formFieldLabel: { color: "hsl(224 24% 14%)", fontWeight: 500 },
    footerActionLink: { color: "hsl(350 50% 36%)", fontWeight: 600 },
    footerActionText: { color: "hsl(222 12% 36%)" },
    dividerText: { color: "hsl(222 12% 36%)" },
    identityPreviewEditButton: { color: "hsl(350 50% 36%)" },
    formFieldSuccessText: { color: "hsl(158 35% 28%)" },
    alertText: { color: "hsl(224 24% 14%)" },
    logoBox: "justify-center h-10",
    logoImage: "h-9 w-9",
    socialButtonsBlockButton: "border border-[hsl(38_18%_85%)] bg-[hsl(42_40%_98.5%)]",
    formButtonPrimary: "bg-[hsl(350_50%_36%)] text-[hsl(42_40%_97%)] shadow-none normal-case text-sm",
    formFieldInput: "bg-[hsl(42_33%_96%)] border border-[hsl(38_18%_85%)] text-[hsl(224_24%_14%)]",
    footerAction: "justify-center",
    dividerLine: "bg-[hsl(38_18%_85%)]",
    alert: "border border-[hsl(38_18%_85%)] bg-[hsl(42_33%_96%)]",
    otpCodeFieldInput: "border border-[hsl(38_18%_85%)] text-[hsl(224_24%_14%)]",
    formFieldRow: "gap-3",
    main: "gap-5",
  },
};

function SignInPage() {
  return (
    <AuthBackdrop>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthBackdrop>
  );
}

function SignUpPage() {
  return (
    <AuthBackdrop>
      <div className="flex w-full flex-col items-center gap-4">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
        <p className="max-w-[440px] text-center text-xs text-muted-foreground">New accounts are reviewed by the owner before the workspace opens.</p>
      </div>
    </AuthBackdrop>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/overview" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function PrivateApp() {
  const [location] = useLocation();
  return (
    <PrivateRoute>
      <AppShell>
        <RoutedErrorBoundary>
          <motion.div
            key={location.split('?')[0]}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <Switch>
              <Route path="/overview" component={OverviewPage} />
              <Route path="/goals" component={GoalsPage} />
              <Route path="/goals/:id" component={GoalDetailPage} />
              <Route path="/planner" component={PlannerPage} />
              <Route path="/tasks" component={TasksPage} />
              <Route path="/reviews" component={ReviewsPage} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/admin" component={AdminPage} />
              <Route component={NotFound} />
            </Switch>
          </motion.div>
        </RoutedErrorBoundary>
      </AppShell>
    </PrivateRoute>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back to Align",
            subtitle: "Sign in to your private workspace",
          },
        },
        signUp: {
          start: {
            title: "Request access to Align",
            subtitle: "Create an account. The owner approves new members.",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <AccessProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={PrivateApp} />
          </Switch>
        </AccessProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <WouterRouter base={basePath}>
          <ClerkProviderWithRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  );
}

export default App;
