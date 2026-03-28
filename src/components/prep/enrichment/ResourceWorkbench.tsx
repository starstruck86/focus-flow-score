/**
 * Resource Workbench — searchable, sortable, filterable table of resources.
 * Part 2 of the Enrichment Operator Console.
 */
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, ArrowUpDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VerifiedResource } from '@/lib/enrichmentVerification';
import type { VerifiedResource } from '@/lib/enrichmentVerification';
import type { BucketFilter } from './types';
import { mapVerifiedToBucket, BUCKET_META } from './types';

type SortKey = 'score_asc' | 'score_desc' | 'title' | 'subtype' | 'updated';

interface Props {
  resources: VerifiedResource[];
  activeBucket: BucketFilter;
  onSelectResource: (resource: VerifiedResource) => void;
  selectedId?: string | null;
}

export function ResourceWorkbench({ resources, activeBucket, onSelectResource, selectedId }: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('score_asc');
  const [subtypeFilter, setSubtypeFilter] = useState<string>('all');

  // Filter by bucket
  const bucketFiltered = useMemo(() => {
    if (activeBucket === 'all') return resources;
    return resources.filter(r => mapVerifiedToBucket(r) === activeBucket);
  }, [resources, activeBucket]);

  // Get unique subtypes
  const subtypes = useMemo(() => {
    const s = new Set(bucketFiltered.map(r => r.subtypeLabel));
    return Array.from(s).sort();
  }, [bucketFiltered]);

  // Filter + search
  const filtered = useMemo(() => {
    let list = bucketFiltered;
    if (subtypeFilter !== 'all') list = list.filter(r => r.subtypeLabel === subtypeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.subtypeLabel.toLowerCase().includes(q) ||
        r.whyNotComplete?.toLowerCase().includes(q) ||
        r.url?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [bucketFiltered, subtypeFilter, search]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sort) {
      case 'score_asc': return arr.sort((a, b) => a.qualityScore - b.qualityScore);
      case 'score_desc': return arr.sort((a, b) => b.qualityScore - a.qualityScore);
      case 'title': return arr.sort((a, b) => a.title.localeCompare(b.title));
      case 'subtype': return arr.sort((a, b) => a.subtypeLabel.localeCompare(b.subtypeLabel));
      case 'updated': return arr.sort((a, b) => (b.lastAttemptAt ?? '').localeCompare(a.lastAttemptAt ?? ''));
      default: return arr;
    }
  }, [filtered, sort]);

  const bucketLabel = BUCKET_META[activeBucket]?.label ?? 'All Resources';

  return (
    <div className="space-y-2">
      {/* Filter bar — sticky */}
      <div className="sticky top-[120px] z-10 bg-background pb-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search resources…"
              className="h-7 text-xs pl-7"
            />
          </div>
          <Select value={sort} onValueChange={v => setSort(v as SortKey)}>
            <SelectTrigger className="h-7 w-[130px] text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score_asc">Score ↑</SelectItem>
              <SelectItem value="score_desc">Score ↓</SelectItem>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="subtype">Subtype</SelectItem>
              <SelectItem value="updated">Last Updated</SelectItem>
            </SelectContent>
          </Select>
          {subtypes.length > 1 && (
            <Select value={subtypeFilter} onValueChange={setSubtypeFilter}>
              <SelectTrigger className="h-7 w-[120px] text-xs">
                <SelectValue placeholder="Subtype" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subtypes</SelectItem>
                {subtypes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-medium">{bucketLabel}</span>
          <span>·</span>
          <span>{sorted.length} resources</span>
        </div>
      </div>

      {/* Resource list */}
      <ScrollArea className="max-h-[60vh]">
        <div className="space-y-1">
          {sorted.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">No resources match the current filter</p>
          )}
          {sorted.map(r => (
            <ResourceRow
              key={r.id}
              resource={r}
              isSelected={r.id === selectedId}
              onClick={() => onSelectResource(r)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ResourceRow({ resource: r, isSelected, onClick }: { resource: VerifiedResource; isSelected: boolean; onClick: () => void }) {
  const bucket = mapVerifiedToBucket(r);
  const bucketMeta = BUCKET_META[bucket];

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded border px-3 py-2 flex items-start gap-2 transition-colors',
        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/20 hover:bg-muted/30',
      )}
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-xs font-medium text-foreground truncate">{r.title}</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-[9px] h-4">{r.subtypeLabel}</Badge>
          <Badge className={cn('text-[9px] h-4', bucketMeta.color === 'text-status-green' ? 'bg-status-green/15 text-status-green' : bucketMeta.color === 'text-primary' ? 'bg-primary/15 text-primary' : bucketMeta.color === 'text-destructive' ? 'bg-destructive/15 text-destructive' : bucketMeta.color === 'text-status-yellow' ? 'bg-status-yellow/15 text-status-yellow' : 'bg-muted text-muted-foreground')}>
            {bucketMeta.label}
          </Badge>
          <span className="text-[10px] text-muted-foreground">Score: {r.qualityScore}</span>
          {r.failureCount > 0 && <span className="text-[10px] text-destructive">{r.failureCount}× failed</span>}
        </div>
        <p className="text-[10px] text-muted-foreground truncate">{r.whyNotComplete || r.recommendedAction}</p>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
    </button>
  );
}
