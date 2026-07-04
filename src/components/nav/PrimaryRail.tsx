/**
 * PrimaryRail — unified 3-item bottom rail for the P1c-REAL nav consolidation:
 *   Today  ·  Work  ·  Train
 *
 * Rendered by <Layout /> on /today, /work*, and /train-hub*. All other routes
 * continue to use the legacy dual-row BottomNav (unchanged) so nothing that
 * relied on the wider nav loses reachability this wave.
 *
 * Accents:
 *   /today       → neutral (uses page accent already set globally)
 *   /work*       → amber  (var(--nav-quota) proxy — matches Work chroma)
 *   /train-hub*  → jade   (var(--nav-coach) proxy — matches Train chroma)
 */
import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Home, Briefcase, Dumbbell } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RailItem {
  to: string;
  label: string;
  icon: React.ElementType;
  match: (path: string) => boolean;
  accent: string; // hsl string
}

const ITEMS: RailItem[] = [
  {
    to: '/today',
    label: 'Today',
    icon: Home,
    match: (p) => p === '/today' || p === '/',
    accent: 'hsl(var(--nav-today))',
  },
  {
    to: '/work',
    label: 'Work',
    icon: Briefcase,
    match: (p) => p.startsWith('/work'),
    accent: 'hsl(38 92% 58%)', // amber
  },
  {
    to: '/train-hub',
    label: 'Train',
    icon: Dumbbell,
    match: (p) => p.startsWith('/train-hub'),
    accent: 'hsl(160 66% 55%)', // jade
  },
];

export function PrimaryRail() {
  const navRef = useRef<HTMLElement | null>(null);
  const location = useLocation();

  // Mobile-keyboard hide (parity with BottomNav so composers sit flush).
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const check = () => setKeyboardOpen(window.innerHeight - vv.height > 120);
    check();
    vv.addEventListener('resize', check);
    vv.addEventListener('scroll', check);
    return () => {
      vv.removeEventListener('resize', check);
      vv.removeEventListener('scroll', check);
    };
  }, []);

  // Publish measured height so shell padding / FAB offsets stay accurate,
  // exactly like BottomNav does.
  useEffect(() => {
    const root = document.documentElement;
    if (keyboardOpen) {
      root.style.setProperty('--shell-nav-height', '0');
      return () => { root.style.setProperty('--shell-nav-height', '101'); };
    }
    const el = navRef.current;
    if (!el) return;
    const apply = (h: number) => {
      const r = Math.round(h);
      if (r > 0) root.style.setProperty('--shell-nav-height', String(r));
    };
    apply(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(entries => {
      apply(entries[0]?.target.getBoundingClientRect().height ?? 0);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--shell-nav-height', '101');
    };
  }, [keyboardOpen]);

  if (keyboardOpen) return null;

  return (
    <nav
      ref={navRef}
      data-testid="primary-rail"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      style={{ background: 'hsl(var(--card))' }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      <div className="max-w-md mx-auto px-2 pb-1">
        <div className="flex items-center justify-around h-14">
          {ITEMS.map(item => {
            const active = item.match(location.pathname);
            const style = active ? { color: item.accent } : undefined;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                data-testid={`rail-${item.label.toLowerCase()}`}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[11px] font-medium rounded-lg min-w-[64px] min-h-[44px] transition-all',
                  active ? 'font-semibold' : 'text-muted-foreground hover:text-foreground',
                )}
                style={style}
              >
                {active && (
                  <span
                    className="absolute -top-px left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-full"
                    style={{ backgroundColor: item.accent, boxShadow: `0 0 8px ${item.accent}` }}
                  />
                )}
                <item.icon className={cn('h-5 w-5 transition-transform', active && 'scale-110')} style={style} />
                <span className={cn('truncate', active ? 'opacity-100' : 'opacity-70')}>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export function isPrimaryRailRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/today' ||
    pathname.startsWith('/work') ||
    pathname.startsWith('/train-hub')
  );
}
