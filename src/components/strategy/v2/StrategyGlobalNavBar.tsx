/**
 * StrategyGlobalNavBar — compact horizontal global navigation for the
 * Strategy workspace (desktop only).
 *
 * Why this exists:
 *   The dual-row BottomNav reserves ~140–150px of viewport height which
 *   competed with the Strategy composer + artifact workspace. On /strategy
 *   we replace it with a slim 36px top rail that:
 *     - keeps every global route one click away (Today, Tasks, New Logo,
 *       Renewals, Sales Brain, Dojo, Learn, Trends, Quota, Settings)
 *     - never overlaps the composer
 *     - never competes with the Strategy thread sidebar (sidebar = threads
 *       only; this rail = app navigation)
 *     - inherits the same color tokens / active treatment as BottomNav so
 *       the user's mental model carries over
 *
 * Mobile is unaffected — mobile keeps the (now-condensed) BottomNav.
 */
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { ALL_NAV, COLOR_VAR } from '@/components/layout/BottomNav';
import { cn } from '@/lib/utils';

export function StrategyGlobalNavBar() {
  const location = useLocation();

  return (
    <nav
      data-testid="strategy-global-nav"
      className="hidden md:flex shrink-0 items-center gap-0.5 px-3 h-9 border-b backdrop-blur-md"
      style={{
        background: 'hsl(var(--sv-paper))',
        borderBottomColor: 'hsl(var(--sv-hairline))',
      }}
    >
      {ALL_NAV.map(item => {
        const isActive = item.to === '/'
          ? location.pathname === '/'
          : location.pathname.startsWith(item.to);
        const accent = `hsl(${COLOR_VAR[item.color]})`;
        return (
          <RouterNavLink
            key={item.to}
            to={item.to}
            data-testid={`strategy-globalnav-${item.color}`}
            className={cn(
              'group flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] font-medium transition-colors',
              isActive
                ? 'bg-foreground/[0.04]'
                : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]'
            )}
            style={isActive ? { color: accent } : undefined}
          >
            <item.icon className="h-3.5 w-3.5" style={isActive ? { color: accent } : undefined} />
            <span className="leading-none">{item.label}</span>
          </RouterNavLink>
        );
      })}
    </nav>
  );
}
