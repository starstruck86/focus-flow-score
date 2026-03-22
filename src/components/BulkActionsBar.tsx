import { useState } from 'react';
import { X, Trash2, Tag, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { REVIEW_MODE } from '@/contexts/ReviewModeContext';

interface BulkAction {
  id: string;
  label: string;
  icon?: React.ElementType;
  options?: { value: string; label: string }[];
  onExecute: (selectedIds: string[], value?: string) => void;
  variant?: 'default' | 'destructive';
}

interface BulkActionsBarProps {
  selectedCount: number;
  onClear: () => void;
  actions: BulkAction[];
  selectedIds: Set<string>;
}

export function BulkActionsBar({ selectedCount, onClear, actions, selectedIds }: BulkActionsBarProps) {
  const [activeAction, setActiveAction] = useState<string | null>(null);

  if (selectedCount === 0) return null;

  const blocked = REVIEW_MODE;

  return (
    <div className="sticky top-0 z-30 bg-primary/10 border border-primary/30 rounded-lg px-4 py-2.5 flex items-center gap-3 flex-wrap animate-in slide-in-from-top-2">
      <span className="text-sm font-medium text-primary">
        {selectedCount} selected
      </span>

      <div className="h-4 w-px bg-border" />

      {actions.map(action => {
        const Icon = action.icon;
        
        if (action.options) {
          return (
            <Select
              key={action.id}
              onValueChange={(value) => {
                if (blocked) { toast.info('Bulk actions disabled in Public Review Mode'); return; }
                action.onExecute(Array.from(selectedIds), value);
                toast.success(`Updated ${selectedCount} records`);
              }}
            >
              <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
                <SelectValue placeholder={action.label} />
              </SelectTrigger>
              <SelectContent>
                {action.options.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }

        return (
          <Button
            key={action.id}
            variant={action.variant === 'destructive' ? 'destructive' : 'secondary'}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => {
              if (blocked) { toast.info('Bulk actions disabled in Public Review Mode'); return; }
              action.onExecute(Array.from(selectedIds));
              toast.success(`${action.label} applied to ${selectedCount} records`);
            }}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {action.label}
          </Button>
        );
      })}

      <div className="flex-1" />

      <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={onClear}>
        <X className="h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  );
}
