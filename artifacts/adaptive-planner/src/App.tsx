import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig, motion } from 'framer-motion';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/app-shell';
import NotFound from '@/pages/not-found';
import OverviewPage from '@/pages/overview';
import GoalsPage from '@/pages/goals';
import GoalDetailPage from '@/pages/goal-detail';
import PlannerPage from '@/pages/planner';
import TasksPage from '@/pages/tasks';
import ReviewsPage from '@/pages/reviews';
import SettingsPage from '@/pages/settings';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();
  return (
    <AppShell>
      <RoutedErrorBoundary>
        <motion.div
          key={location.split('?')[0]}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <Switch>
            <Route path="/" component={OverviewPage} />
            <Route path="/goals" component={GoalsPage} />
            <Route path="/goals/:id" component={GoalDetailPage} />
            <Route path="/planner" component={PlannerPage} />
            <Route path="/tasks" component={TasksPage} />
            <Route path="/reviews" component={ReviewsPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </motion.div>
      </RoutedErrorBoundary>
    </AppShell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={250}>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

export default App;
