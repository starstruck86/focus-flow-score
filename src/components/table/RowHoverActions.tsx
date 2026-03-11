import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface RowAction {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'destructive';
}

interface RowHoverActionsProps {
  actions: RowAction[];
  className?: string;
}

export function RowHoverActions({ actions, className }: RowHoverActionsProps) {
  return (
    <div className={cn(
      "absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 transition-opacity",
      "flex items-center gap-0.5 bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-sm px-1 py-0.5 z-10",
      className
    )}>
      {actions.map((action, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "h-7 w-7",
                action.variant === 'destructive' && "text-destructive hover:text-destructive hover:bg-destructive/10"
              )}
              onClick={(e) => {
                e.stopPropagation();
                action.onClick();
              }}
            >
              <action.icon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">{action.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
