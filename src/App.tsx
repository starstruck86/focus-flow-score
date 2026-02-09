import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LinkedRecordProvider } from "@/contexts/LinkedRecordContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
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

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <LinkedRecordProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <JournalPromptManager>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/outreach" element={<ProtectedRoute><WeeklyOutreach /></ProtectedRoute>} />
                <Route path="/renewals" element={<ProtectedRoute><Renewals /></ProtectedRoute>} />
                <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
                <Route path="/recurring" element={<ProtectedRoute><RecurringTasks /></ProtectedRoute>} />
                <Route path="/trends" element={<ProtectedRoute><Trends /></ProtectedRoute>} />
                <Route path="/quota" element={<ProtectedRoute><Quota /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </JournalPromptManager>
          </BrowserRouter>
        </LinkedRecordProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
