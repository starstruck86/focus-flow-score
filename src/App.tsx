import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import { LinkedRecordProvider } from "@/contexts/LinkedRecordContext";
import { CopilotProvider } from "@/contexts/CopilotContext";
import { DataSyncProvider } from "@/components/DataSyncProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { JournalPromptManager } from "@/components/journal";
import { OfflineBanner } from "@/components/OfflineBanner";
import { JournalPromptManager } from "@/components/journal";
import Dashboard from "./pages/Dashboard";
import WeeklyOutreach from "./pages/WeeklyOutreach";
import Renewals from "./pages/Renewals";
import Tasks from "./pages/Tasks";
import RecurringTasks from "./pages/RecurringTasks";
import Trends from "./pages/Trends";
import Quota from "./pages/Quota";
import Settings from "./pages/Settings";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

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

const ProtectedPage = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <JournalPromptManager>{children}</JournalPromptManager>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <TooltipProvider>
        <AuthProvider>
          <LinkedRecordProvider>
            <CopilotProvider>
            <DataSyncProvider>
              <Toaster />
              <Sonner />
              <OfflineBanner />
              <BrowserRouter>
                <Routes>
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
                  <Route path="/outreach" element={<ProtectedPage><WeeklyOutreach /></ProtectedPage>} />
                  <Route path="/renewals" element={<ProtectedPage><Renewals /></ProtectedPage>} />
                  <Route path="/tasks" element={<ProtectedPage><Tasks /></ProtectedPage>} />
                  <Route path="/recurring" element={<ProtectedPage><RecurringTasks /></ProtectedPage>} />
                  <Route path="/trends" element={<ProtectedPage><Trends /></ProtectedPage>} />
                  <Route path="/quota" element={<ProtectedPage><Quota /></ProtectedPage>} />
                  <Route path="/settings" element={<ProtectedPage><Settings /></ProtectedPage>} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </DataSyncProvider>
            </CopilotProvider>
          </LinkedRecordProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
