// "Back to Today" floating button — shown on detail/sub-pages for quick return to dashboard
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SHELL } from '@/lib/layout';
export function BackToToday() {
  const location = useLocation();
  const navigate = useNavigate();

  // Only show on non-dashboard pages
  if (location.pathname === '/') return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={`fixed ${TW_BACK_BOTTOM} left-3 z-40 h-8 w-8 rounded-full shadow-lg bg-card/95 backdrop-blur-sm border-primary/20 hover:border-primary/40`}
          onClick={() => navigate('/')}
        >
          <LayoutDashboard className="h-3.5 w-3.5 text-primary" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">Back to Dashboard</TooltipContent>
    </Tooltip>
  );
}
