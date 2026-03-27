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

const Diagnostics = lazy(() => import("./pages/Diagnostics"));
const Cockpit = lazy(() => import("./pages/Cockpit"));

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
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <TooltipProvider>
        <AuthProvider>
          <ReviewModeProvider>
          <LinkedRecordProvider>
            <CopilotProvider>
            <DataSyncProvider>
              <Sonner />
              <ReviewModeBanner />
              <OfflineBanner />
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
                  <Route path="/prep" element={<ProtectedPage routeName="Prep Hub"><PrepHub /></ProtectedPage>} />
                  <Route path="/settings" element={<ProtectedPage routeName="Settings"><Settings /></ProtectedPage>} />
                  <Route path="/cockpit" element={
                    <ProtectedRoute>
                      <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Loading…</p></div>}>
                        <Cockpit />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="/ops" element={
                    <ProtectedRoute>
                      <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Loading diagnostics…</p></div>}>
                        <Diagnostics />
                      </Suspense>
                    </ProtectedRoute>
                  } />
                  <Route path="*" element={<NotFound />} />
                </Routes>
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
