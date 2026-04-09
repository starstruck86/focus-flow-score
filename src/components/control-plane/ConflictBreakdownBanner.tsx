/**
 * Conflict Breakdown Banner — groups conflicts by type with category filters.
 */
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ConflictInfo } from '@/lib/controlPlaneState';
import type { ControlPlaneFilter } from '@/lib/controlPlaneState';

// Conflict categories with human labels
const CONFLICT_CATEGORIES: { pattern: string; label: string; color: string }[] = [
  { pattern: 'content-backed but blocked for empty', label: 'Content ↔ Empty', color: 'text-amber-600' },
  { pattern: 'knowledge items but lifecycle stage', label: 'KIs ↔ Stage', color: 'text-blue-600' },
  { pattern: 'enriched but has no usable content', label: 'Enriched ↔ No Content', color: 'text-primary' },
  { pattern: 'active KIs with contexts but stage', label: 'Contexts ↔ Stage', color: 'text-emerald-600' },
  { pattern: 'active KIs but is blocked', label: 'Active ↔ Blocked', color: 'text-destructive' },
];

function categorizeConflict(conflict: string): string {
  for (const cat of CONFLICT_CATEGORIES) {
    if (conflict.toLowerCase().includes(cat.pattern.toLowerCase())) return cat.label;
  }
  return 'Other';
}

interface Props {
  conflicts: ConflictInfo[];
  activeFilter: ControlPlaneFilter;
  onFilterConflicts: () => void;
  onFilterConflictCategory: (resourceIds: Set<string>) => void;
}

export function ConflictBreakdownBanner({ conflicts, activeFilter, onFilterConflicts, onFilterConflictCategory }: Props) {
  const [expanded, setExpanded] = useState(false);

  const grouped = useMemo(() => {
    const groups = new Map<string, { label: string; color: string; resources: ConflictInfo[] }>();
    
    for (const c of conflicts) {
      for (const conflict of c.conflicts) {
        const cat = categorizeConflict(conflict);
        if (!groups.has(cat)) {
          const meta = CONFLICT_CATEGORIES.find(cc => cc.label === cat);
          groups.set(cat, {
            label: cat,
            color: meta?.color ?? 'text-muted-foreground',
            resources: [],
          });
        }
        // Avoid duplicating resource in same category
        const group = groups.get(cat)!;
        if (!group.resources.find(r => r.resource_id === c.resource_id)) {
          group.resources.push(c);
        }
      }
    }

    return Array.from(groups.values()).sort((a, b) => b.resources.length - a.resources.length);
  }, [conflicts]);

  if (conflicts.length === 0) return null;

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-destructive/10 transition-colors"
      >
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-destructive shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-destructive shrink-0" />
        }
        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span className="text-xs text-destructive font-medium">
          {conflicts.length} resource{conflicts.length !== 1 ? 's' : ''} with conflicting lifecycle signals
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {grouped.map(g => (
            <Badge key={g.label} variant="outline" className={cn('text-[10px] px-1.5 py-0', g.color)}>
              {g.resources.length}
            </Badge>
          ))}
        </div>
      </button>

      {/* Expanded: category breakdown */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-destructive/20 pt-2">
          {grouped.map(group => (
            <button
              key={group.label}
              onClick={() => {
                const ids = new Set(group.resources.map(r => r.resource_id));
                onFilterConflictCategory(ids);
              }}
              className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-destructive/10 transition-colors"
            >
              <Badge variant="outline" className={cn('text-[10px] shrink-0', group.color)}>
                {group.resources.length}
              </Badge>
              <span className="text-xs font-medium text-foreground">{group.label}</span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                Click to filter
              </span>
            </button>
          ))}
          <button
            onClick={onFilterConflicts}
            className="text-[10px] text-destructive/70 hover:text-destructive underline ml-2"
          >
            Show all {conflicts.length} conflicted resources
          </button>
        </div>
      )}
    </div>
  );
}
