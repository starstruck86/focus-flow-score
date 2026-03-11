import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ActiveFilter {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

interface FilterChipsProps {
  filters: ActiveFilter[];
  onClearAll?: () => void;
  className?: string;
}

export function FilterChips({ filters, onClearAll, className }: FilterChipsProps) {
  if (filters.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap py-2", className)}>
      <span className="text-xs text-muted-foreground mr-1">Filters:</span>
      {filters.map((filter) => (
        <Badge
          key={filter.key}
          variant="secondary"
          className="gap-1 pr-1 text-xs font-normal"
        >
          <span className="text-muted-foreground">{filter.label}:</span>
          <span>{filter.value}</span>
          <button
            onClick={filter.onRemove}
            className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      {filters.length > 1 && onClearAll && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-muted-foreground hover:text-foreground px-2"
          onClick={onClearAll}
        >
          Clear all
        </Button>
      )}
    </div>
  );
}
