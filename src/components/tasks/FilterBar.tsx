import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Workstream } from '@/types';

export type GroupMode = 'status' | 'account';

interface FilterBarProps {
  filterWorkstream: 'all' | Workstream;
  setFilterWorkstream: (v: 'all' | Workstream) => void;
  filterDue: 'all' | 'today' | 'week';
  setFilterDue: (v: 'all' | 'today' | 'week') => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  groupMode: GroupMode;
  setGroupMode: (v: GroupMode) => void;
}

export function FilterBar({
  filterWorkstream, setFilterWorkstream,
  filterDue, setFilterDue,
  searchQuery, setSearchQuery,
  groupMode, setGroupMode,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-4">
      {/* Workstream */}
      <div className="flex rounded-md border border-border overflow-hidden">
        {([
          { value: 'pg' as const, label: 'PG' },
          { value: 'renewals' as const, label: 'RN' },
          { value: 'all' as const, label: 'All' },
        ]).map(w => (
          <button
            key={w.value}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium transition-colors",
              filterWorkstream === w.value
                ? "bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted text-muted-foreground"
            )}
            onClick={() => setFilterWorkstream(w.value)}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* Due filter */}
      <div className="flex rounded-md border border-border overflow-hidden">
        {([
          { value: 'all' as const, label: 'All' },
          { value: 'today' as const, label: 'Today' },
          { value: 'week' as const, label: 'Week' },
        ]).map(f => (
          <button
            key={f.value}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium transition-colors",
              filterDue === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted text-muted-foreground"
            )}
            onClick={() => setFilterDue(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Group mode */}
      <div className="flex rounded-md border border-border overflow-hidden">
        {([
          { value: 'status' as const, label: 'Status' },
          { value: 'account' as const, label: 'Account' },
        ]).map(g => (
          <button
            key={g.value}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium transition-colors",
              groupMode === g.value
                ? "bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted text-muted-foreground"
            )}
            onClick={() => setGroupMode(g.value)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative flex-1 min-w-[140px] max-w-[200px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="h-7 pl-7 text-[11px]"
        />
      </div>
    </div>
  );
}
