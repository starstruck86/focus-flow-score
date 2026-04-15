import { useLocation } from 'react-router-dom';
import { ChevronRight, LayoutDashboard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/tasks': 'Tasks',
  '/outreach': 'New Logo Outreach',
  '/renewals': 'Renewals',
  '/trends': 'Trends',
  '/quota': 'Quota & Commission',
  '/settings': 'Settings',
  '/recurring': 'Recurring Tasks',
};

export function Breadcrumbs() {
  const location = useLocation();
  const pathname = location.pathname;

  // Don't show breadcrumbs on dashboard or strategy (strategy owns its own header)
  if (pathname === '/' || pathname === '/strategy') return null;

  const label = ROUTE_LABELS[pathname] || pathname.slice(1).replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());

  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground px-4 pt-3 pb-1">
      <Link to="/" className="flex items-center gap-1 hover:text-foreground transition-colors">
        <LayoutDashboard className="h-3.5 w-3.5" />
        <span>Home</span>
      </Link>
      <ChevronRight className="h-3 w-3" />
      <span className="text-foreground font-medium">{label}</span>
    </nav>
  );
}
