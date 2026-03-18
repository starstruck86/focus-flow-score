import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CollapsibleWidgetSectionProps {
  label: string;
  collapsed?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleWidgetSection({
  label,
  collapsed = false,
  onToggle,
  children,
  className,
}: CollapsibleWidgetSectionProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onToggle}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
        >
          <ChevronDown
            className={cn('h-4 w-4 text-muted-foreground transition-transform', collapsed && '-rotate-90')}
          />
        </Button>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {collapsed ? (
          <motion.button
            key="collapsed"
            type="button"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={onToggle}
            className="w-full rounded-lg border border-border/50 bg-card/50 px-4 py-2 text-left"
          >
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
          </motion.button>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
