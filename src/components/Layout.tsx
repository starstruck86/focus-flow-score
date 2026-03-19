import { NavLink as RouterNavLink, useLocation, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
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
  Mic,
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
import { DaveConversationMode } from '@/components/DaveConversationMode';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BackToToday } from '@/components/BackToToday';
import { useCopilot, type PageContext } from '@/contexts/CopilotContext';
import { DayTimeline } from '@/components/tasks/DayTimeline';
import { ActivityRings } from '@/components/ActivityRings';
import { GlobalWeekStrip } from '@/components/GlobalWeekStrip';
import { useDaveContext, type DaveSessionData } from '@/hooks/useDaveContext';
import { motion, AnimatePresence } from 'framer-motion';

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
            'relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[11px] font-medium transition-all duration-200 rounded-lg',
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
            className={cn("h-5 w-5 transition-transform duration-200", isActive && "scale-110")}
            style={isActive ? { color: `hsl(${COLOR_VAR[item.color]})` } : undefined}
          />
          <span className={cn("truncate transition-opacity", isActive ? "opacity-100" : "opacity-70")}>{item.label}</span>
        </RouterNavLink>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">{item.label}</TooltipContent>
    </Tooltip>
  );
}

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
      <div className="max-w-3xl mx-auto px-1 pb-1">
        <div className="flex items-center justify-around h-12">
          {navRow1.map(item => <NavItem key={item.to} item={item} />)}
        </div>
        <div className="h-px bg-border/30 mx-4" />
        <div className="flex items-center justify-around h-12">
          {navRow2.map(item => <NavItem key={item.to} item={item} />)}
        </div>
      </div>
    </nav>
  );
}

/** Tap-to-talk prompt for ?dave=1 URL opens (Siri Shortcuts) */
function DaveTapPrompt({ onTap }: { onTap: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[99] bg-black/90 flex flex-col items-center justify-center gap-6"
    >
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onTap}
        className="w-32 h-32 rounded-full bg-primary/20 flex items-center justify-center text-primary shadow-[0_0_60px_20px_rgba(16,185,129,0.2)]"
      >
        <Mic className="h-12 w-12" />
      </motion.button>
      <p className="text-white/70 text-lg font-medium">Tap to talk to Dave</p>
    </motion.div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setPageContext } = useCopilot();
  const activeColor = useActiveTabColor();
  
  // Dave state
  const [daveOpen, setDaveOpen] = useState(false);
  const [showDaveTapPrompt, setShowDaveTapPrompt] = useState(false);
  const [daveSessionData, setDaveSessionData] = useState<DaveSessionData | null>(null);
  const { getSession: getDaveSession } = useDaveContext();

  // Handle ?dave=1 from Siri Shortcuts
  useEffect(() => {
    if (searchParams.get('dave') === '1') {
      setShowDaveTapPrompt(true);
      const next = new URLSearchParams(searchParams);
      next.delete('dave');
      setSearchParams(next, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.style.setProperty('--page-accent', COLOR_VAR[activeColor]);
  }, [activeColor]);

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

  const handleOpenDave = useCallback(async () => {
    setShowDaveTapPrompt(false);
    try {
      const session = await getDaveSession();
      setDaveSessionData(session);
      setDaveOpen(true);
    } catch (err: any) {
      console.error('[Dave] Failed to pre-fetch session:', err);
      toast.error('Could not start Dave', { description: err.message });
    }
  }, [getDaveSession]);

  const handleCloseDave = useCallback(() => {
    setDaveOpen(false);
    setDaveSessionData(null);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col w-full pt-[env(safe-area-inset-top)]">
      <header
        className="flex items-center justify-between px-4 py-2 border-b sticky top-0 z-40 bg-background/95 backdrop-blur-md"
        style={headerAccentStyle}
      >
        <div className="flex items-center gap-2">
          <Compass className="h-5 w-5" style={{ color: `hsl(${COLOR_VAR[activeColor]})` }} />
          <span className="font-display text-sm font-bold">Quota Compass</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[10px] text-muted-foreground/60 hidden sm:inline cursor-default">
                Updated {formatDistanceToNow(new Date(__BUILD_TIMESTAMP__), { addSuffix: true })}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Build: {new Date(__BUILD_TIMESTAMP__).toLocaleString()}
            </TooltipContent>
          </Tooltip>
          <SaveIndicator />
        </div>
        <div className="flex items-center gap-1">
          <VoiceCommandButton onOpenDave={handleOpenDave} />
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

      <div className="px-4 lg:px-6 max-w-4xl mx-auto w-full pt-2 space-y-2">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <GlobalWeekStrip />
          </div>
          <ActivityRings />
        </div>
        <DayTimeline />
      </div>

      <Breadcrumbs />
      <main className="flex-1 overflow-auto pb-[calc(8rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      <BottomNav />
      <BackToToday />
      <GlobalFAB position="bottom-right" />

      {/* Dave Tap Prompt for Siri Shortcut opens */}
      <AnimatePresence>
        {showDaveTapPrompt && !daveOpen && (
          <DaveTapPrompt onTap={handleOpenDave} />
        )}
      </AnimatePresence>

      {/* Dave Conversational AI Overlay — key forces remount with fresh overrides */}
      {daveOpen && daveSessionData && (
        <DaveConversationMode
          key={daveSessionData.signed_url}
          isOpen={daveOpen}
          onClose={handleCloseDave}
          sessionData={daveSessionData}
        />
      )}
    </div>
  );
}
