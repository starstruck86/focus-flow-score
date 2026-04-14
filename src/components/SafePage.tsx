import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';

/**
 * SafePage — guardrail wrapper for standalone pages that render
 * outside the main <Layout> shell (Auth, Index, DojoSession, etc.).
 *
 * Applies:
 *  • min-h-screen
 *  • SHELL.top.safeArea (notch / Dynamic Island clearance)
 *  • bg-background
 *
 * Usage:
 *   <SafePage className="flex items-center justify-center">
 *     <Card>…</Card>
 *   </SafePage>
 */
export function SafePage({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'min-h-screen bg-background',
        SHELL.top.safeArea,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
