import { GripVertical, Eye, EyeOff, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { WidgetConfig } from '@/hooks/useWidgetLayout';

interface WidgetCustomizerProps {
  widgets: WidgetConfig[];
  onToggle: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onReset: () => void;
  onResize?: (id: string, size: WidgetConfig['size']) => void;
}

export function WidgetCustomizer({ widgets, onToggle, onMove, onReset, onResize }: WidgetCustomizerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1.5">
          <GripVertical className="h-3.5 w-3.5" />
          Customize
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <div className="space-y-1">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold">Dashboard Widgets</span>
            <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1" onClick={onReset}>
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
          </div>
          {widgets.map((widget, idx) => (
            <div
              key={widget.id}
              className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-muted/50"
            >
              <div className="flex flex-col gap-0.5">
                {idx > 0 && (
                  <button
                    className="text-muted-foreground hover:text-foreground text-[10px] leading-none"
                    onClick={() => onMove(idx, idx - 1)}
                  >
                    ▲
                  </button>
                )}
                {idx < widgets.length - 1 && (
                  <button
                    className="text-muted-foreground hover:text-foreground text-[10px] leading-none"
                    onClick={() => onMove(idx, idx + 1)}
                  >
                    ▼
                  </button>
                )}
              </div>
              <span className={cn("text-sm flex-1", !widget.visible && "text-muted-foreground line-through")}>
                {widget.label}
              </span>
              <Switch
                checked={widget.visible}
                onCheckedChange={() => onToggle(widget.id)}
                className="scale-75"
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
