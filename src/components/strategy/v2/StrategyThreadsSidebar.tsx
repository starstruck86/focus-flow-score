/**
 * StrategyThreadsSidebar — ChatGPT-style persistent left sidebar.
 *
 *   Header:    [Strategy] .................. [« collapse]
 *   Action:    [+ New thread]
 *   Search:    [search threads…]
 *   Groups:    Pinned · Today · Yesterday · Previous 7 days · Older
 *   Row:       title ........... [● running] [◇ artifact]
 *
 * Desktop: persistent sidebar, collapsible to a 14px icon rail.
 * Mobile:  hidden — opened via the StrategySidebarToggle floating button
 *          (rendered inside the StrategyShell topbar) using <Sheet>.
 *
 * The sidebar is purely additive — it does not change any thread/message/
 * artifact data flow. It reads the same `threads` array the shell already
 * has, and uses the same `setActiveThreadId` setter.
 */
import { useMemo, useState } from 'react';
import { Plus, Search, X, PanelLeftClose, PanelLeftOpen, Sparkles, Loader2, FileText, Pin } from 'lucide-react';
import type { StrategyThread } from '@/types/strategy';
import { cn } from '@/lib/utils';

interface Props {
  threads: StrategyThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** thread.id => has at least one in-flight task_run */
  runningThreadIds?: Set<string>;
  /** thread.id => has at least one completed artifact */
  artifactThreadIds?: Set<string>;
  /** Called after picking a thread on mobile (so the sheet can close) */
  onAfterSelect?: () => void;
}

function relativeBucket(updatedAt: string): 'today' | 'yesterday' | 'last7' | 'older' {
  const ts = new Date(updatedAt).getTime();
  const now = Date.now();
  const diffDays = Math.floor((now - ts) / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return 'today';
  if (diffDays < 2) return 'yesterday';
  if (diffDays < 7) return 'last7';
  return 'older';
}

const BUCKET_LABEL: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Previous 7 days',
  older: 'Older',
};

export function StrategyThreadsSidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  collapsed,
  onToggleCollapsed,
  runningThreadIds,
  artifactThreadIds,
  onAfterSelect,
}: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter(t => (t.title ?? '').toLowerCase().includes(needle));
  }, [threads, query]);

  const grouped = useMemo(() => {
    const pinned: StrategyThread[] = [];
    const buckets: Record<string, StrategyThread[]> = { today: [], yesterday: [], last7: [], older: [] };
    for (const t of filtered) {
      if (t.is_pinned) { pinned.push(t); continue; }
      buckets[relativeBucket(t.updated_at)].push(t);
    }
    return { pinned, buckets };
  }, [filtered]);

  // ────────────────────────────────────────────────────────────
  // Collapsed rail (desktop only) — keeps the new-thread + expand
  // toggle visible so the sidebar never disappears entirely.
  // ────────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside
        className="hidden md:flex flex-col items-center shrink-0 py-3 gap-2"
        style={{
          width: 44,
          borderRight: '1px solid hsl(var(--sv-hairline))',
          background: 'hsl(var(--sv-paper))',
        }}
        aria-label="Strategy threads (collapsed)"
      >
        <button
          onClick={onToggleCollapsed}
          className="h-8 w-8 rounded-[6px] sv-hover-bg flex items-center justify-center"
          style={{ color: 'hsl(var(--sv-muted))' }}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <button
          onClick={onNewThread}
          className="h-8 w-8 rounded-[6px] sv-hover-bg flex items-center justify-center"
          style={{ color: 'hsl(var(--sv-clay))' }}
          title="New thread"
          aria-label="New thread"
        >
          <Plus className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  // ────────────────────────────────────────────────────────────
  // Expanded sidebar
  // ────────────────────────────────────────────────────────────
  const handlePick = (id: string) => {
    onSelectThread(id);
    onAfterSelect?.();
  };

  return (
    <aside
      className="flex flex-col shrink-0 min-h-0"
      style={{
        width: 264,
        borderRight: '1px solid hsl(var(--sv-hairline))',
        background: 'hsl(var(--sv-paper))',
      }}
      aria-label="Strategy threads"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" style={{ color: 'hsl(var(--sv-clay))' }} />
          <span className="text-[12px] font-semibold tracking-tight" style={{ color: 'hsl(var(--sv-ink))' }}>
            Strategy
          </span>
        </div>
        <button
          onClick={onToggleCollapsed}
          className="h-7 w-7 rounded-[6px] sv-hover-bg flex items-center justify-center"
          style={{ color: 'hsl(var(--sv-muted))' }}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* New thread button */}
      <div className="px-3 pb-2 shrink-0">
        <button
          onClick={onNewThread}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-[13px] font-medium transition-colors"
          style={{
            border: '1px solid hsl(var(--sv-hairline))',
            background: 'hsl(var(--sv-paper))',
            color: 'hsl(var(--sv-ink))',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover))'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-paper))'; }}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New thread</span>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2 shrink-0">
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-[6px]"
          style={{ background: 'hsl(var(--sv-hover))' }}
        >
          <Search className="h-3 w-3 shrink-0" style={{ color: 'hsl(var(--sv-muted))' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads"
            className="flex-1 bg-transparent border-0 outline-none text-[12px] min-w-0"
            style={{ color: 'hsl(var(--sv-ink))' }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="shrink-0"
              style={{ color: 'hsl(var(--sv-muted))' }}
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-3">
        {threads.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-[12px]" style={{ color: 'hsl(var(--sv-muted))' }}>
              No threads yet. Create your first to start a strategy session.
            </p>
          </div>
        )}

        {grouped.pinned.length > 0 && (
          <ThreadGroup
            label="Pinned"
            icon={<Pin className="h-2.5 w-2.5" />}
            threads={grouped.pinned}
            activeThreadId={activeThreadId}
            onPick={handlePick}
            runningThreadIds={runningThreadIds}
            artifactThreadIds={artifactThreadIds}
          />
        )}

        {(['today', 'yesterday', 'last7', 'older'] as const).map((bucket) => (
          grouped.buckets[bucket].length > 0 && (
            <ThreadGroup
              key={bucket}
              label={BUCKET_LABEL[bucket]}
              threads={grouped.buckets[bucket]}
              activeThreadId={activeThreadId}
              onPick={handlePick}
              runningThreadIds={runningThreadIds}
              artifactThreadIds={artifactThreadIds}
            />
          )
        ))}

        {filtered.length === 0 && threads.length > 0 && (
          <p className="px-4 py-3 text-[12px]" style={{ color: 'hsl(var(--sv-muted))' }}>
            No threads match "{query}".
          </p>
        )}
      </div>
    </aside>
  );
}

function ThreadGroup({
  label,
  icon,
  threads,
  activeThreadId,
  onPick,
  runningThreadIds,
  artifactThreadIds,
}: {
  label: string;
  icon?: React.ReactNode;
  threads: StrategyThread[];
  activeThreadId: string | null;
  onPick: (id: string) => void;
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;
}) {
  return (
    <div className="mt-2 first:mt-0">
      <div
        className="px-3 pt-2 pb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: 'hsl(var(--sv-muted))' }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <ul className="space-y-px">
        {threads.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => onPick(t.id)}
              className={cn(
                'w-full text-left px-3 py-1.5 rounded-[6px] flex items-center gap-2 group transition-colors',
              )}
              style={{
                background: activeThreadId === t.id ? 'hsl(var(--sv-hover))' : 'transparent',
                color: 'hsl(var(--sv-ink))',
              }}
              onMouseEnter={(e) => {
                if (activeThreadId !== t.id) e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)';
              }}
              onMouseLeave={(e) => {
                if (activeThreadId !== t.id) e.currentTarget.style.background = 'transparent';
              }}
              title={t.title || 'Untitled thread'}
            >
              <span className="flex-1 min-w-0 truncate text-[13px]">
                {t.title || 'Untitled thread'}
              </span>
              {runningThreadIds?.has(t.id) && (
                <Loader2
                  className="h-3 w-3 shrink-0 animate-spin"
                  style={{ color: 'hsl(var(--sv-clay))' }}
                  aria-label="Run in progress"
                />
              )}
              {artifactThreadIds?.has(t.id) && !runningThreadIds?.has(t.id) && (
                <FileText
                  className="h-3 w-3 shrink-0"
                  style={{ color: 'hsl(var(--sv-clay) / 0.7)' }}
                  aria-label="Has artifact"
                />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
