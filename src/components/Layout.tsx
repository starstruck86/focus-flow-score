import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  RefreshCw, 
  CheckSquare, 
  TrendingUp,
  DollarSign,
  Settings,
  Compass,
  LogOut,
  Search,
} from 'lucide-react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { SaveIndicator } from '@/components/SaveIndicator';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { GlobalFAB } from '@/components/fab';
import { WorkdayCheckInButton } from '@/components/WorkdayCheckInButton';
import { GlobalSearch } from '@/components/GlobalSearch';
import { ThemeToggle } from '@/components/ThemeToggle';
import { TerritoryCopilot } from '@/components/TerritoryCopilot';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const navItems = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/outreach', label: 'New Logo', icon: Users },
  { to: '/renewals', label: 'Renewals', icon: RefreshCw },
  { to: '/trends', label: 'Trends', icon: TrendingUp },
  { to: '/quota', label: 'Quota', icon: DollarSign },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function BottomNav() {
  const location = useLocation();
  const { signOut } = useAuth();
  
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around h-14 max-w-3xl mx-auto px-1">
        {navItems.map((item) => {
          const isActive = item.to === '/' 
            ? location.pathname === '/' 
            : location.pathname.startsWith(item.to);
          return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <RouterNavLink
                  to={item.to}
                  className={cn(
                    'flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-medium transition-colors rounded-lg',
                    isActive
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                  <span className="truncate">{item.label}</span>
                </RouterNavLink>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  
  return (
    <div className="min-h-screen bg-background flex flex-col w-full">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border/50 sticky top-0 z-40 bg-background/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Compass className="h-5 w-5 text-primary" />
          <span className="font-display text-sm font-bold">Quota Compass</span>
        </div>
        <div className="flex items-center gap-2">
          <SaveIndicator />
          <GlobalSearch />
          <ThemeToggle />
          <WorkdayCheckInButton />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Sign Out</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Main Content */}
      <Breadcrumbs />
      <main className="flex-1 overflow-auto pb-20">
        {children}
      </main>

      {/* Bottom Nav - always visible */}
      <BottomNav />
      
      {/* Floating Action Button */}
      <GlobalFAB position="bottom-right" />
    </div>
  );
}
