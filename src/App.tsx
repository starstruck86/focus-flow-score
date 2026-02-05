import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import WeeklyOutreach from "./pages/WeeklyOutreach";
import Renewals from "./pages/Renewals";
import Tasks from "./pages/Tasks";
import Trends from "./pages/Trends";
import Quota from "./pages/Quota";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/outreach" element={<WeeklyOutreach />} />
          <Route path="/renewals" element={<Renewals />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/quota" element={<Quota />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
