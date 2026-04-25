import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  RefreshCw,
  CheckSquare,
  TrendingUp,
  DollarSign,
  Settings,
  Brain,
  Crosshair,
  Swords,
  GraduationCap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type NavColor = 'today' | 'tasks' | 'outreach' | 'renewals' | 'prep' | 'coach' | 'trends' | 'quota' | 'settings' | 'strategy' | 'dojo' | 'learn';

export interface NavItemDef {
  to: string;
  label: string;
  icon: React.ElementType;
  color: NavColor;
}

export const COLOR_VAR: Record<NavColor, string> = {
  today: 'var(--nav-today)',
  tasks: 'var(--nav-tasks)',
  outreach: 'var(--nav-outreach)',
  renewals: 'var(--nav-renewals)',
  prep: 'var(--nav-prep)',
  coach: 'var(--nav-coach)',
  trends: 'var(--nav-trends)',
  quota: 'var(--nav-quota)',
  settings: 'var(--nav-settings)',
  strategy: 'var(--nav-today)',
  dojo: 'var(--nav-coach)',
  learn: 'var(--nav-prep)',
};

export const navRow1: NavItemDef[] = [
  { to: '/strategy', label: 'Strategy', icon: Crosshair, color: 'strategy' },
  { to: '/', label: 'Today', icon: LayoutDashboard, color: 'today' },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare, color: 'tasks' },
  { to: '/outreach', label: 'New Logo', icon: Users, color: 'outreach' },
  { to: '/renewals', label: 'Renewals', icon: RefreshCw, color: 'renewals' },
];

export const navRow2: NavItemDef[] = [
  { to: '/prep', label: 'Sales Brain', icon: Brain, color: 'prep' },
  { to: '/dojo', label: 'Dojo', icon: Swords, color: 'dojo' },
  { to: '/learn', label: 'Learn', icon: GraduationCap, color: 'learn' },
  { to: '/trends', label: 'Trends', icon: TrendingUp, color: 'trends' },
  { to: '/quota', label: 'Quota', icon: DollarSign, color: 'quota' },
  { to: '/settings', label: 'Settings', icon: Settings, color: 'settings' },
];

export const ALL_NAV = [...navRow1, ...navRow2];

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
          data-testid={`nav-${item.color}`}
          className={cn(
            'relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[11px] font-medium transition-all duration-200 rounded-lg min-w-[44px] min-h-[44px]',
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

export function useActiveTabColor(): NavColor {
  const location = useLocation();
  const match = ALL_NAV.find(item =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
  );
  return match?.color || 'today';
}

/**
 * BottomNav
 *
 * Variants:
 *   - default: dual-row (10 routes), used on every page except /strategy.
 *   - condensed: single-row (5 primary routes), used on /strategy mobile so
 *     the composer + canvas reclaim ~50% of the previous nav footprint
 *     while still exposing global navigation. The remaining 5 routes are
 *     reachable via the persistent Strategy sidebar's "more" affordances
 *     (Dave / global search / breadcrumbs in other surfaces).
 *   - hidden: not rendered. Used on /strategy desktop where the
 *     `StrategyGlobalNavBar` top rail replaces it.
 */
export function BottomNav({ variant = 'default' }: { variant?: 'default' | 'condensed' | 'hidden' } = {}) {
  const navRef = useRef<HTMLElement | null>(null);
  // ─── Mobile keyboard detection ────────────────────────────────────────
  // When the on-screen keyboard opens on iOS / Android, `visualViewport.height`
  // shrinks below `window.innerHeight`. We hide the BottomNav in that state
  // so the composer sits flush on top of the keyboard (ChatGPT/iMessage feel)
  // instead of stacking under a second floating bar.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const check = () => {
      const diff = window.innerHeight - vv.height;
      setKeyboardOpen(diff > 120);
    };
    check();
    vv.addEventListener('resize', check);
    vv.addEventListener('scroll', check);
    return () => {
      vv.removeEventListener('resize', check);
      vv.removeEventListener('scroll', check);
    };
  }, []);

  // ─── Dynamic height sync ──────────────────────────────────────────────
  // The BottomNav's rendered height varies with viewport / safe-area / font
  // scaling. We measure it and publish the pixel value to
  // `--shell-nav-height` so every consumer (page padding, FAB clearance,
  // /strategy main height) stays perfectly aligned with reality. When the
  // variant is `hidden` — or the keyboard is open — we publish 0 so the
  // chat column reclaims the space.
  useEffect(() => {
    const root = document.documentElement;
    if (variant === 'hidden' || keyboardOpen) {
      root.style.setProperty('--shell-nav-height', '0');
      return () => {
        root.style.setProperty('--shell-nav-height', '101');
      };
    }
    const el = navRef.current;
    if (!el) return;
    const apply = (h: number) => {
      if (h > 0) root.style.setProperty('--shell-nav-height', String(Math.round(h)));
    };
    apply(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) apply(entry.contentRect.height);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      // Restore design-system default so other mounts start from a known baseline.
      root.style.setProperty('--shell-nav-height', '101');
    };
  }, [variant, keyboardOpen]);

  if (variant === 'hidden') return null;
  if (keyboardOpen) return null;

  const condensed = variant === 'condensed';

  return (
    <nav
      ref={navRef}
      data-testid="bottom-nav"
      data-variant={variant}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      style={{ background: 'hsl(var(--card))' }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      <div className="max-w-3xl mx-auto px-1 pb-1">
        <div className="flex items-center justify-around h-12">
          {navRow1.map(item => <NavItem key={item.to} item={item} />)}
        </div>
        {!condensed && (
          <>
            <div className="h-px bg-border/30 mx-4" />
            <div className="flex items-center justify-around h-12">
              {navRow2.map(item => <NavItem key={item.to} item={item} />)}
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
