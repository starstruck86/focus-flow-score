import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
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
import { DayTimeline } from '@/components/tasks/DayTimeline';
import { ActivityRings } from '@/components/ActivityRings';
import { GlobalWeekStrip } from '@/components/GlobalWeekStrip';

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

// Color-coded tab system — each tab has a distinct color identity
type NavColor = 'today' | 'tasks' | 'outreach' | 'renewals' | 'prep' | 'coach' | 'trends' | 'quota' | 'settings';

interface NavItemDef {
  to: string;
  label: string;
  icon: React.ElementType;
  color: NavColor;
}

const navRow1: NavItemDef[] = [
  { to: '/', label: 'Today', icon: LayoutDashboard, color: 'today' },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare, color: 'tasks' },
  { to: '/outreach', label: 'New Logo', icon: Users, color: 'outreach' },
  { to: '/renewals', label: 'Renewals', icon: RefreshCw, color: 'renewals' },
];

const navRow2: NavItemDef[] = [
  { to: '/prep', label: 'Prep Hub', icon: FileText, color: 'prep' },
  { to: '/coach', label: 'Coach', icon: Compass, color: 'coach' },
  { to: '/trends', label: 'Trends', icon: TrendingUp, color: 'trends' },
  { to: '/quota', label: 'Quota', icon: DollarSign, color: 'quota' },
  { to: '/settings', label: 'Settings', icon: Settings, color: 'settings' },
];

const ALL_NAV = [...navRow1, ...navRow2];

// Map color token names to CSS variable references
const COLOR_VAR: Record<NavColor, string> = {
  today: 'var(--nav-today)',
  tasks: 'var(--nav-tasks)',
  outreach: 'var(--nav-outreach)',
  renewals: 'var(--nav-renewals)',
  prep: 'var(--nav-prep)',
  coach: 'var(--nav-coach)',
  trends: 'var(--nav-trends)',
  quota: 'var(--nav-quota)',
  settings: 'var(--nav-settings)',
};

function NavItem({ item }: { item: NavItemDef }) {
  const location = useLocation();
  const isActive = item.to === '/'
    ? location.pathname === '/'
    : location.pathname.startsWith(item.to);

  const colorStyle = isActive ? { color: `hsl(${COLOR_VAR[item.color]})` } : undefined;
  const glowColor = `hsl(${COLOR_VAR[item.color]} / 0.5)`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <RouterNavLink
          to={item.to}
          className={cn(
            'relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-medium transition-all duration-200 rounded-lg',
            isActive
              ? 'font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          )}
          style={colorStyle}
        >
          {isActive && (
            <span
              className="absolute -top-px left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
              style={{
                backgroundColor: `hsl(${COLOR_VAR[item.color]})`,
                boxShadow: `0 0 8px ${glowColor}`,
              }}
            />
          )}
          <item.icon
            className={cn("h-4 w-4 transition-transform duration-200", isActive && "scale-110")}
            style={isActive ? { color: `hsl(${COLOR_VAR[item.color]})` } : undefined}
          />
          <span className={cn("truncate transition-opacity", isActive ? "opacity-100" : "opacity-70")}>{item.label}</span>
        </RouterNavLink>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/** Get the active tab's color for page-level accent */
function useActiveTabColor(): NavColor {
  const location = useLocation();
  const match = ALL_NAV.find(item =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
  );
  return match?.color || 'today';
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
  const activeColor = useActiveTabColor();

  // Set page-accent CSS variable on the root element
  useEffect(() => {
    document.documentElement.style.setProperty('--page-accent', COLOR_VAR[activeColor]);
  }, [activeColor]);

  // Set page context for copilot based on current route
  useEffect(() => {
    const path = location.pathname;
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

  const headerAccentStyle = useMemo(() => ({
    borderBottomColor: `hsl(${COLOR_VAR[activeColor]} / 0.2)`,
  }), [activeColor]);

  return (
    <div className="min-h-screen bg-background flex flex-col w-full">
      {/* Top bar — minimal, color-accented */}
      <header
        className="flex items-center justify-between px-4 py-2 border-b sticky top-0 z-40 bg-background/95 backdrop-blur-md"
        style={headerAccentStyle}
      >
        <div className="flex items-center gap-2">
          <Compass className="h-5 w-5" style={{ color: `hsl(${COLOR_VAR[activeColor]})` }} />
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
      {/* Today's Blocks — visible on every page */}
      <div className="px-4 lg:px-6 max-w-4xl mx-auto w-full pt-2">
        <DayTimeline />
      </div>

      <Breadcrumbs />
      <main className="flex-1 overflow-auto pb-28">
        {children}
      </main>

      {/* Bottom Nav - 2 rows, color-coded */}
      <BottomNav />
      
      {/* Back to Today shortcut */}
      <BackToToday />
      
      {/* Floating Action Button */}
      <GlobalFAB position="bottom-right" />
    </div>
  );
}
