import { useState, useMemo } from 'react';
import { Plus, Search, Pin, ChevronLeft, Building2, Target, Map, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { StrategyThread } from '@/types/strategy';
import { LANE_FILTERS } from '@/types/strategy';

const THREAD_TYPE_ICONS: Record<string, React.ElementType> = {
  account_linked: Building2,
  opportunity_linked: Target,
  territory_linked: Map,
  freeform: MessageSquare,
  artifact_linked: MessageSquare,
};

const LANE_COLORS: Record<string, string> = {
  research: 'bg-blue-500/20 text-blue-400',
  evaluate: 'bg-amber-500/20 text-amber-400',
  build: 'bg-green-500/20 text-green-400',
  strategy: 'bg-purple-500/20 text-purple-400',
  brainstorm: 'bg-pink-500/20 text-pink-400',
};

interface Props {
  threads: StrategyThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onOpenCreateDialog: () => void;
  laneFilter: string;
  onLaneFilterChange: (f: string) => void;
  onCollapse: () => void;
  isLoading: boolean;
}

export function StrategyThreadSidebar({
  threads, activeThreadId, onSelectThread, onOpenCreateDialog,
  laneFilter, onLaneFilterChange, onCollapse, isLoading,
}: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = threads;
    if (search) list = list.filter(t => t.title.toLowerCase().includes(search.toLowerCase()));
    if (laneFilter === 'pinned') list = list.filter(t => t.is_pinned);
    else if (laneFilter !== 'all' && !laneFilter.startsWith('has_')) {
      list = list.filter(t => t.lane === laneFilter);
    }
    return list;
  }, [threads, search, laneFilter]);

  const pinned = filtered.filter(t => t.is_pinned);
  const recent = filtered.filter(t => !t.is_pinned);

  const grouped = useMemo(() => {
    const groups: Record<string, StrategyThread[]> = {
      account_linked: [], opportunity_linked: [], territory_linked: [], freeform: [],
    };
    recent.forEach(t => {
      const key = groups[t.thread_type] ? t.thread_type : 'freeform';
      groups[key].push(t);
    });
    return groups;
  }, [recent]);

  return (
    <div className="w-60 border-r border-border flex flex-col bg-card shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground flex-1">Strategy</h2>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCollapse}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* New Thread */}
      <div className="p-2">
        <Button size="sm" className="w-full gap-1.5" onClick={onOpenCreateDialog}>
          <Plus className="h-3.5 w-3.5" /> New Thread
        </Button>
      </div>

      {/* Search */}
      <div className="px-2 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search threads…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Lane Filters */}
      <div className="px-2 pb-2 flex flex-wrap gap-1">
        {LANE_FILTERS.map(f => (
          <Badge
            key={f}
            variant={laneFilter === f ? 'default' : 'outline'}
            className="cursor-pointer text-[10px] px-1.5 py-0"
            onClick={() => onLaneFilterChange(f)}
          >
            {f === 'all' ? 'All' : f.replace('_', ' ')}
          </Badge>
        ))}
      </div>

      {/* Thread Lists */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <p className="text-xs text-muted-foreground p-3">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center p-4 space-y-2">
            <p className="text-xs text-muted-foreground">No threads yet.</p>
            <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={onOpenCreateDialog}>
              <Plus className="h-3 w-3" /> Create your first thread
            </Button>
          </div>
        ) : (
          <div className="pb-4">
            {/* Pinned */}
            {pinned.length > 0 && (
              <div className="px-2 pt-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 px-1">Pinned</p>
                {pinned.map(t => <ThreadRow key={t.id} thread={t} isActive={t.id === activeThreadId} onClick={() => onSelectThread(t.id)} />)}
              </div>
            )}

            {/* Grouped */}
            {(['account_linked', 'opportunity_linked', 'territory_linked', 'freeform'] as const).map(type => {
              const items = grouped[type];
              if (!items || items.length === 0) return null;
              const labels: Record<string, string> = {
                account_linked: 'Accounts',
                opportunity_linked: 'Opportunities',
                territory_linked: 'Territories',
                freeform: 'Freeform',
              };
              return (
                <div key={type} className="px-2 pt-3">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 px-1">{labels[type]}</p>
                  {items.map(t => <ThreadRow key={t.id} thread={t} isActive={t.id === activeThreadId} onClick={() => onSelectThread(t.id)} />)}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function ThreadRow({ thread, isActive, onClick }: { thread: StrategyThread; isActive: boolean; onClick: () => void }) {
  const Icon = THREAD_TYPE_ICONS[thread.thread_type] || MessageSquare;
  const timeAgo = formatTimeAgo(thread.updated_at);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-2 py-1.5 rounded-md text-xs flex items-start gap-2 transition-colors',
        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50 text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="truncate font-medium">{thread.title}</span>
          {thread.is_pinned && <Pin className="h-2.5 w-2.5 text-amber-400 shrink-0" />}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <Badge variant="outline" className={cn('text-[9px] px-1 py-0 leading-tight', LANE_COLORS[thread.lane])}>
            {thread.lane}
          </Badge>
          <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
        </div>
      </div>
    </button>
  );
}

function formatTimeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
