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
  FileText,
  Crosshair,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type NavColor = 'today' | 'tasks' | 'outreach' | 'renewals' | 'prep' | 'coach' | 'trends' | 'quota' | 'settings';

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
};

export const navRow1: NavItemDef[] = [
  { to: '/', label: 'Today', icon: LayoutDashboard, color: 'today' },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare, color: 'tasks' },
  { to: '/outreach', label: 'New Logo', icon: Users, color: 'outreach' },
  { to: '/renewals', label: 'Renewals', icon: RefreshCw, color: 'renewals' },
];

export const navRow2: NavItemDef[] = [
  { to: '/prep', label: 'Prep Hub', icon: FileText, color: 'prep' },
  { to: '/coach', label: 'Coach', icon: Compass, color: 'coach' },
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

export function BottomNav() {
  return (
    <nav
      data-testid="bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 pb-[env(safe-area-inset-bottom)]"
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
