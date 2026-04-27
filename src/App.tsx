import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import { ReviewModeProvider } from "@/contexts/ReviewModeContext";
import { LinkedRecordProvider } from "@/contexts/LinkedRecordContext";
import { CopilotProvider } from "@/contexts/CopilotContext";
import { DataSyncProvider } from "@/components/DataSyncProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { JournalPromptManager } from "@/components/journal";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ReviewModeBanner } from "@/components/ReviewModeBanner";
import { BackgroundJobIndicator } from "@/components/jobs/BackgroundJobIndicator";
import { BackgroundJobDrawer } from "@/components/jobs/BackgroundJobDrawer";
import { SessionResumePrompt } from "@/components/SessionResumePrompt";
import { DurableJobRehydrator } from "@/components/jobs/DurableJobRehydrator";
import '@/lib/pendingWriteSync'; // Register online listener for pending write queue
import { SystemHealthBadge } from '@/components/SystemHealthBadge';
import Dashboard from "./pages/Dashboard";
import WeeklyOutreach from "./pages/WeeklyOutreach";
import Renewals from "./pages/Renewals";
import Tasks from "./pages/Tasks";
import RecurringTasks from "./pages/RecurringTasks";
import Trends from "./pages/Trends";
import Quota from "./pages/Quota";
import Settings from "./pages/Settings";
import AccountDetail from "./pages/AccountDetail";
import OpportunityDetail from "./pages/OpportunityDetail";
import Auth from "./pages/Auth";
import Coach from "./pages/Coach";
import PrepHub from "./pages/PrepHub";
import NotFound from "./pages/NotFound";

import { lazy, Suspense } from "react";

const LazyFallback = ({ text = "Loading…" }: { text?: string }) => (
  <div className="min-h-screen pt-[env(safe-area-inset-top)] flex items-center justify-center bg-background">
    <p className="text-muted-foreground">{text}</p>
  </div>
);

const Diagnostics = lazy(() => import("./pages/Diagnostics"));
const Strategy = lazy(() => import("./pages/Strategy"));
const StrategySettings = lazy(() => import("./pages/StrategySettings"));
const StrategyDebug = lazy(() => import("./pages/StrategyDebug"));
const EnrichmentVerification = lazy(() => import("./pages/EnrichmentVerification"));
const ExecuteWorkspace = lazy(() => import("./pages/ExecuteWorkspace"));
const BulkExtractRunner = lazy(() => import("./pages/BulkExtractRunner"));
const ExtractionAdmin = lazy(() => import("./pages/ExtractionAdmin"));
const Dojo = lazy(() => import("./pages/Dojo"));
const DojoSession = lazy(() => import("./pages/DojoSession"));
const DojoQA = lazy(() => import("./pages/DojoQA"));
const DojoV6QA = lazy(() => import("./pages/DojoV6QA"));
const Learn = lazy(() => import("./pages/Learn"));
const LearnLesson = lazy(() => import("./pages/LearnLesson"));
const SkillBuilderSession = lazy(() => import("./pages/SkillBuilderSession"));
const SkillBuilderAudit = lazy(() => import("./pages/SkillBuilderAudit"));
const ReliabilityQA = lazy(() => import("./pages/ReliabilityQA"));
const ObservabilityDashboard = lazy(() => import("./pages/ObservabilityDashboard"));
const SmokeTest = lazy(() => import("./pages/SmokeTest"));
const LifecycleReconciliation = lazy(() => import("./pages/LifecycleReconciliation"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});
// Expose for background stores (enrichment job store) that run outside React tree
(window as any).__QUERY_CLIENT__ = queryClient;

const ProtectedPage = ({ children, routeName }: { children: React.ReactNode; routeName: string }) => (
  <ProtectedRoute>
    <RouteErrorBoundary routeName={routeName}>
      <JournalPromptManager>{children}</JournalPromptManager>
    </RouteErrorBoundary>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <TooltipProvider>
        <AuthProvider>
          <ReviewModeProvider>
          <LinkedRecordProvider>
            <CopilotProvider>
            <DataSyncProvider>
              <Sonner />
              <ReviewModeBanner />
              <OfflineBanner />
              <DurableJobRehydrator />
              <BackgroundJobIndicator />
              <BackgroundJobDrawer />
              <SystemHealthBadge />
              
              
              <BrowserRouter>
                <Routes>
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/" element={<ProtectedPage routeName="Dashboard"><Dashboard /></ProtectedPage>} />
                  <Route path="/outreach" element={<ProtectedPage routeName="Outreach"><WeeklyOutreach /></ProtectedPage>} />
                  <Route path="/accounts/:id" element={<ProtectedPage routeName="Account Detail"><AccountDetail /></ProtectedPage>} />
                  <Route path="/opportunities/:id" element={<ProtectedPage routeName="Opportunity Detail"><OpportunityDetail /></ProtectedPage>} />
                  <Route path="/renewals" element={<ProtectedPage routeName="Renewals"><Renewals /></ProtectedPage>} />
                  <Route path="/tasks" element={<ProtectedPage routeName="Tasks"><Tasks /></ProtectedPage>} />
                  <Route path="/recurring" element={<ProtectedPage routeName="Recurring Tasks"><RecurringTasks /></ProtectedPage>} />
                  <Route path="/trends" element={<ProtectedPage routeName="Trends"><Trends /></ProtectedPage>} />
                  <Route path="/quota" element={<ProtectedPage routeName="Quota"><Quota /></ProtectedPage>} />
                  <Route path="/coach" element={<ProtectedPage routeName="Coach"><Coach /></ProtectedPage>} />
                  {/* Coach is no longer a nav destination — accessible via /coach for transcript grading */}
                  <Route path="/prep" element={<ProtectedPage routeName="Sales Brain OS"><PrepHub /></ProtectedPage>} />
                  <Route path="/settings" element={<ProtectedPage routeName="Settings"><Settings /></ProtectedPage>} />
                  <Route path="/strategy" element={
                    <ProtectedPage routeName="Strategy">
                      <Suspense fallback={<LazyFallback />}>
                        <Strategy />
                      </Suspense>
                    </ProtectedPage>
                  } />
                  <Route path="/strategy/settings" element={
                    <ProtectedPage routeName="Strategy Settings">
                      <Suspense fallback={<LazyFallback />}>
                        <StrategySettings />
                      </Suspense>
                    </ProtectedPage>
                  } />
                  <Route path="/strategy/settings/pill/:pillId" element={
                    <ProtectedPage routeName="Strategy Settings · Pill">
                      <Suspense fallback={<LazyFallback />}>
                        <StrategySettings />
                      </Suspense>
                    </ProtectedPage>
                  } />
                  <Route path="/strategy/debug" element={
                    <ProtectedPage routeName="Strategy Debug">
                      <Suspense fallback={<LazyFallback text="Loading debug…" />}>
                        <StrategyDebug />
                      </Suspense>
                    </ProtectedPage>
                  } />
                  <Route path="/ops" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback text="Loading diagnostics…" />}>
                        <Diagnostics />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/verify-enrichment" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback text="Loading verification…" />}>
                        <EnrichmentVerification />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/execute" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <ExecuteWorkspace />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/bulk-extract" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <BulkExtractRunner />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/extraction-admin" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <ExtractionAdmin />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/dojo" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <Dojo />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/dojo/session" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <DojoSession />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/dojo/qa" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <DojoQA />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/dojo/v6-qa" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <DojoV6QA />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/learn" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <Learn />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/learn/lesson/:id" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <LearnLesson />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/learn/skill-builder" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <SkillBuilderSession />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/learn/skill-builder-audit" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <SkillBuilderAudit />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/reliability" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <ReliabilityQA />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/observability" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <ObservabilityDashboard />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/smoke-test" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback />}>
                        <SmokeTest />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/admin/lifecycle-reconciliation" element={
                    <ProtectedRoute>
                      <Suspense fallback={<LazyFallback text="Loading reconciliation…" />}>
                        <LifecycleReconciliation />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="*" element={<NotFound />} />
                </Routes>
                <SessionResumePrompt />
              </BrowserRouter>
            </DataSyncProvider>
            </CopilotProvider>
          </LinkedRecordProvider>
          </ReviewModeProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
