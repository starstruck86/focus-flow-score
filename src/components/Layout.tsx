import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
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
  FileText,
} from 'lucide-react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { SaveIndicator } from '@/components/SaveIndicator';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { GlobalFAB } from '@/components/fab';
import { GlobalSearch } from '@/components/GlobalSearch';
import { TerritoryCopilot } from '@/components/TerritoryCopilot';
import { VoiceCommandButton } from '@/components/VoiceCommandButton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BackToToday } from '@/components/BackToToday';
import { useCopilot, type PageContext } from '@/contexts/CopilotContext';

const PAGE_CONTEXT_MAP: Record<string, PageContext> = {
  '/': { page: 'dashboard', description: 'Today / Dashboard — daily plan, agenda, and key metrics' },
  '/tasks': { page: 'tasks', description: 'Tasks — action items, follow-ups, and to-dos' },
  '/outreach': { page: 'outreach', description: 'New Logo Outreach — prospecting accounts and pipeline building' },
  '/renewals': { page: 'renewals', description: 'Renewals — existing customer renewals and retention' },
  '/prep': { page: 'prep-hub', description: 'Prep Hub — meeting preparation and research' },
  '/coach': { page: 'coach', description: 'Sales Coach — call analysis, roleplay, and skill development' },
  '/trends': { page: 'trends', description: 'Trends — performance trends and analytics over time' },
  '/quota': { page: 'quota', description: 'Quota — quota attainment, commission, and pipeline math' },
  '/settings': { page: 'settings', description: 'Settings — app configuration and preferences' },
};

const navRow1 = [
  { to: '/', label: 'Today', icon: LayoutDashboard },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/outreach', label: 'New Logo', icon: Users },
  { to: '/renewals', label: 'Renewals', icon: RefreshCw },
];

const navRow2 = [
  { to: '/prep', label: 'Prep Hub', icon: FileText },
  { to: '/coach', label: 'Coach', icon: Compass },
  { to: '/trends', label: 'Trends', icon: TrendingUp },
  { to: '/quota', label: 'Quota', icon: DollarSign },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavItem({ item }: { item: { to: string; label: string; icon: React.ElementType } }) {
  const location = useLocation();
  const isActive = item.to === '/'
    ? location.pathname === '/'
    : location.pathname.startsWith(item.to);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <RouterNavLink
          to={item.to}
          className={cn(
            'relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-medium transition-all duration-200 rounded-lg',
            isActive
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {isActive && (
            <span className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--nav-active-glow))]" />
          )}
          <item.icon className={cn("h-4 w-4 transition-transform duration-200", isActive && "text-primary scale-110")} />
          <span className={cn("truncate transition-opacity", isActive ? "opacity-100" : "opacity-70")}>{item.label}</span>
        </RouterNavLink>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 pb-[env(safe-area-inset-bottom)]"
      style={{ background: 'linear-gradient(to top, hsl(var(--card)), hsl(var(--card) / 0.97))' }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      <div className="max-w-3xl mx-auto px-1">
        {/* Row 1 — Primary nav */}
        <div className="flex items-center justify-around h-11">
          {navRow1.map(item => <NavItem key={item.to} item={item} />)}
        </div>
        {/* Divider */}
        <div className="h-px bg-border/30 mx-4" />
        {/* Row 2 — Secondary nav */}
        <div className="flex items-center justify-around h-10">
          {navRow2.map(item => <NavItem key={item.to} item={item} />)}
        </div>
      </div>
    </nav>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const { setPageContext } = useCopilot();

  // Set page context for copilot based on current route
  useEffect(() => {
    const path = location.pathname;
    // Check exact matches first, then prefix matches for detail pages
    if (PAGE_CONTEXT_MAP[path]) {
      setPageContext(PAGE_CONTEXT_MAP[path]);
    } else if (path.startsWith('/accounts/')) {
      setPageContext({ page: 'account-detail', description: 'Account Detail — deep-dive on a specific account' });
    } else if (path.startsWith('/opportunities/')) {
      setPageContext({ page: 'opportunity-detail', description: 'Opportunity Detail — deal-level view' });
    } else {
      setPageContext({ page: 'other', description: path });
    }
  }, [location.pathname, setPageContext]);
  return (
    <div className="min-h-screen bg-background flex flex-col w-full">
      {/* Top bar — minimal, execution-focused */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border/50 sticky top-0 z-40 bg-background/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Compass className="h-5 w-5 text-primary" />
          <span className="font-display text-sm font-bold">Quota Compass</span>
          <SaveIndicator />
        </div>
        <div className="flex items-center gap-1">
          <VoiceCommandButton />
          <GlobalSearch />
          <TerritoryCopilot />
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
      <main className="flex-1 overflow-auto pb-28">
        {children}
      </main>

      {/* Bottom Nav - 2 rows */}
      <BottomNav />
      
      {/* Back to Today shortcut */}
      <BackToToday />
      
      {/* Floating Action Button */}
      <GlobalFAB position="bottom-right" />
    </div>
  );
}
