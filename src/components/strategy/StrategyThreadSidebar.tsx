import { useState, useMemo } from 'react';
import { Plus, Search, Pin, ChevronLeft, Building2, Target, Map, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { STRATEGY_UI } from '@/lib/strategy-ui';
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
  research: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  evaluate: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  build: 'bg-green-500/20 text-green-600 dark:text-green-400',
  strategy: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  brainstorm: 'bg-pink-500/20 text-pink-600 dark:text-pink-400',
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
    <div className={cn(STRATEGY_UI.layout.sidebar, STRATEGY_UI.surface.sidebar, 'border-r border-border/50 flex flex-col shrink-0 h-full')}>
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-border/30 flex items-center gap-2">
        <h2 className="text-[11px] font-medium text-foreground/50 tracking-wide flex-1">Threads</h2>
        <Button size="icon" variant="ghost" className="h-5 w-5 text-foreground/30" onClick={onCollapse}>
          <ChevronLeft className="h-3 w-3" />
        </Button>
      </div>

      {/* New Thread */}
      <div className="p-2.5 border-b border-border">
        <Button size="sm" className="w-full gap-1.5 font-medium" onClick={onOpenCreateDialog}>
          <Plus className="h-3.5 w-3.5" /> New Thread
        </Button>
      </div>

      {/* Search */}
      <div className="px-2.5 pb-2 pt-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-7 text-xs border-border"
          />
        </div>
      </div>

      {/* Lane Filters */}
      <div className="px-2.5 pb-1.5 flex flex-wrap gap-0.5">
        {LANE_FILTERS.map(f => (
          <button
            key={f}
            className={cn(
              'text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors capitalize',
              laneFilter === f
                ? 'bg-primary/10 text-primary'
                : 'text-foreground/30 hover:text-foreground/50 hover:bg-muted/30'
            )}
            onClick={() => onLaneFilterChange(f)}
          >
            {f === 'all' ? 'All' : f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-3 space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="h-10 rounded-md bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center p-6 space-y-3">
            <p className="text-sm text-foreground/70">No threads yet</p>
            <p className="text-xs text-muted-foreground">Create your first thread to get started</p>
            <Button size="sm" className="text-xs gap-1.5 mt-2" onClick={onOpenCreateDialog}>
              <Plus className="h-3 w-3" /> Create thread
            </Button>
          </div>
        ) : (
          <div className="pb-4">
            {pinned.length > 0 && (
              <div className="px-2 pt-2">
                <p className={cn(STRATEGY_UI.labels.micro, 'mb-1 px-1')}>Pinned</p>
                {pinned.map(t => (
                  <ThreadRow key={t.id} thread={t} isActive={t.id === activeThreadId} onClick={() => onSelectThread(t.id)} />
                ))}
              </div>
            )}

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
                  <p className={cn(STRATEGY_UI.labels.micro, 'mb-1 px-1')}>{labels[type]}</p>
                  {items.map(t => (
                    <ThreadRow key={t.id} thread={t} isActive={t.id === activeThreadId} onClick={() => onSelectThread(t.id)} />
                  ))}
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
        'w-full text-left px-2 py-1 rounded-md text-xs flex items-start gap-1.5 transition-colors',
        isActive
          ? 'bg-primary/8 text-foreground border-l-2 border-primary/40 pl-1.5'
          : 'hover:bg-muted/40 text-foreground/70 hover:text-foreground',
      )}
    >
      <Icon className={cn('h-3 w-3 mt-0.5 shrink-0', isActive ? 'text-primary/60' : 'text-muted-foreground/50')} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="truncate font-medium text-[11px]">{thread.title}</span>
          {thread.is_pinned && <Pin className="h-2 w-2 text-amber-500/70 shrink-0" />}
        </div>
        <div className="flex items-center gap-1">
          <span className={cn('text-[9px]', LANE_COLORS[thread.lane]?.split(' ').pop() || 'text-muted-foreground/50')}>
            {thread.lane}
          </span>
          <span className="text-[9px] text-muted-foreground/40">· {timeAgo}</span>
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
