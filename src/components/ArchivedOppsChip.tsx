/**
 * W2 archive affordance — surfaces archived (Acoustic-era) opportunities as a
 * one-tap Popover so they are quarantined but not hidden.
 */
import { useQuery } from '@tanstack/react-query';
import { Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getArchivedOpportunities } from '@/data/opportunities';

export function ArchivedOppsChip() {
  const { data = [] } = useQuery({
    queryKey: ['opportunities', 'archived'],
    queryFn: getArchivedOpportunities,
    staleTime: 5 * 60 * 1000,
  });

  if (!data.length) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-[11px] text-muted-foreground hover:text-foreground gap-1.5"
        >
          <Archive className="h-3 w-3" />
          Archived ({data.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-3 border-b">
          <p className="text-xs font-semibold">Archived opportunities</p>
          <p className="text-[10px] text-muted-foreground">
            Prior-role book; excluded from active pipeline views.
          </p>
        </div>
        <ScrollArea className="max-h-72">
          <ul className="p-2 space-y-1">
            {data.map((o) => (
              <li
                key={o.id}
                className="text-[11px] leading-tight px-2 py-1 rounded hover:bg-muted/50"
              >
                <div className="truncate font-medium">{o.name}</div>
                <div className="text-muted-foreground">
                  {o.stage || 'no stage'} · {o.status}
                </div>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
