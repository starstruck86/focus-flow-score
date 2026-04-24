/**
 * StrategyNavSidebar — pure navigation. ChatGPT-style.
 *
 * Flat top-level entries (no "Modes" abstraction):
 *   Brainstorm · Deep Research · Refine · Library · Artifacts · Projects · Work
 *
 * Clicking any of the first six switches the workspace surface. Work lives
 * directly below as the active/recent thread list. The sidebar never expands
 * inline pills, never nests, and never mixes navigation with actions.
 *
 * Work rail thread controls (lightweight, client-safe):
 *   - Double-click a thread title to rename inline (Enter saves, Escape cancels).
 *   - Hover (or active row) reveals a star icon → pin/unpin as a Project.
 *     Pinned threads sort to the top with a subtle star badge.
 *   - Pin state is persisted via `pinnedThreads` (localStorage today; the
 *     contract is shaped so a future DB column can replace it transparently).
 *
 * UI ONLY. No backend/engine changes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, PanelLeftClose, PanelLeftOpen, Sparkles,
  Lightbulb, Microscope, Wand2, BookOpen, FolderKanban, Loader2, FileText,
  Briefcase, Settings, Star,
} from 'lucide-react';
import type { StrategyThread } from '@/types/strategy';
import { displayThreadTitle, isUntitledTitle } from '@/lib/strategy/threadNaming';
import { isCleanupThread } from '@/lib/strategy/threadCleanup';
import {
  getPinnedThreadIds, togglePinnedThread, subscribePinnedThreads,
} from '@/lib/strategy/pinnedThreads';
import { cn } from '@/lib/utils';

export type StrategyMode = 'brainstorm' | 'deep_research' | 'refine' | null;

/**
 * Direct top-level surfaces. The three modes are now first-class entries
 * (no "Modes" grouping). Library/Artifacts/Projects unchanged.
 */
export type StrategySurfaceKey =
  | 'brainstorm'
  | 'deep_research'
  | 'refine'
  | 'library'
  | 'artifacts'
  | 'projects'
  | 'work';

interface Props {
  // Layout
  collapsed: boolean;
  onToggleCollapsed: () => void;

  // Surface picker
  activeSurface: StrategySurfaceKey | null;
  onPickSurface: (s: StrategySurfaceKey | null) => void;

  // Work (threads)
  threads: StrategyThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewWork: () => void;
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;
  /** Persist a renamed thread title. Caller wires this to updateThread(). */
  onRenameThread?: (id: string, nextTitle: string) => void;

  // Mobile
  onAfterSelect?: () => void;

  /** Open the Manage Strategy panel (workspaces + pills). */
  onOpenManageStrategy?: () => void;
}

const TOP_NAV: {
  key: StrategySurfaceKey;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  muted?: boolean;
}[] = [
  { key: 'brainstorm',    label: 'Brainstorm',    icon: Lightbulb },
  { key: 'deep_research', label: 'Deep Research', icon: Microscope },
  { key: 'refine',        label: 'Refine',        icon: Wand2 },
  { key: 'library',       label: 'Library',       icon: BookOpen },
  { key: 'artifacts',     label: 'Artifacts',     icon: FileText },
  { key: 'projects',      label: 'Projects',      icon: FolderKanban },
  { key: 'work',          label: 'Work',          icon: Briefcase },
];

export function StrategyNavSidebar({
  collapsed, onToggleCollapsed,
  activeSurface, onPickSurface,
  threads, activeThreadId, onSelectThread, onNewWork,
  runningThreadIds, artifactThreadIds,
  onRenameThread,
  onAfterSelect,
  onOpenManageStrategy,
}: Props) {
  // Pinned threads (localStorage today; subscribe so cross-tab + same-tab
  // changes both refresh the rail).
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => getPinnedThreadIds());
  useEffect(() => {
    return subscribePinnedThreads(() => setPinnedIds(getPinnedThreadIds()));
  }, []);

  // Inline rename state — only one row may edit at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Hide cleanup/test/debug/regression/benchmark/scratch threads from the
  // default rail. Use the shared `isCleanupThread` heuristic so the legacy
  // sidebar matches what the Work command center hides by default.
  const { visibleThreads, hiddenTestCount } = useMemo(() => {
    const visible = threads.filter((t) => !isCleanupThread(t));
    const hidden = threads.length - visible.length;
    const score = (t: StrategyThread) => {
      // Pinned threads always sort first (after active).
      if (t.id === activeThreadId) return 0;
      if (pinnedIds.has(t.id)) return 0.5;
      if (runningThreadIds?.has(t.id)) return 1;
      if (artifactThreadIds?.has(t.id)) return 2;
      return isUntitledTitle(t.title) ? 4 : 3;
    };
    const sorted = [...visible].sort((a, b) => score(a) - score(b));
    return { visibleThreads: sorted, hiddenTestCount: hidden };
  }, [threads, activeThreadId, runningThreadIds, artifactThreadIds, pinnedIds]);

  const handlePickSurface = (s: StrategySurfaceKey) => {
    onPickSurface(activeSurface === s ? null : s);
    onAfterSelect?.();
  };

  const beginRename = (t: StrategyThread) => {
    setEditingId(t.id);
    setDraftTitle(displayThreadTitle(t));
    requestAnimationFrame(() => {
      const el = renameInputRef.current;
      if (el) { el.focus(); el.select(); }
    });
  };

  const commitRename = (t: StrategyThread) => {
    const next = draftTitle.trim();
    setEditingId(null);
    if (!next) return;
    if (next === displayThreadTitle(t)) return;
    onRenameThread?.(t.id, next);
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraftTitle('');
  };

  const togglePin = (id: string) => {
    togglePinnedThread(id);
    setPinnedIds(getPinnedThreadIds());
  };

  // ────────────── Collapsed rail ──────────────
  if (collapsed) {
    return (
      <aside
        className="hidden md:flex flex-col items-center shrink-0 py-3 gap-2"
        style={{
          width: 44,
          borderRight: '1px solid hsl(var(--sv-hairline))',
          background: 'hsl(var(--sv-paper))',
        }}
        aria-label="Strategy navigation (collapsed)"
      >
        <RailButton onClick={onToggleCollapsed} title="Expand sidebar"><PanelLeftOpen className="h-4 w-4" /></RailButton>
        <RailButton onClick={onNewWork} title="New Work" tone="clay"><Plus className="h-4 w-4" /></RailButton>
        <div className="h-px w-6 my-1" style={{ background: 'hsl(var(--sv-hairline))' }} />
        {TOP_NAV.map((n) => (
          <RailButton
            key={n.key}
            onClick={() => handlePickSurface(n.key)}
            title={n.label}
            highlighted={activeSurface === n.key}
          >
            <n.icon className="h-4 w-4" />
          </RailButton>
        ))}
      </aside>
    );
  }

  const handlePickThread = (id: string) => {
    onSelectThread(id);
    onAfterSelect?.();
  };

  return (
    <aside
      className="flex flex-col shrink-0 min-h-0"
      style={{
        width: 256,
        borderRight: '1px solid hsl(var(--sv-hairline))',
        background: 'hsl(var(--sv-paper))',
      }}
      aria-label="Strategy navigation"
    >
      {/* ── Header ── */}
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

      {/* ── New Work ── */}
      <div className="px-3 pb-3 shrink-0">
        <button
          onClick={() => { onNewWork(); onAfterSelect?.(); }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-[13px] font-medium transition-colors"
          style={{
            border: '1px solid hsl(var(--sv-hairline))',
            background: 'hsl(var(--sv-paper))',
            color: 'hsl(var(--sv-ink))',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover))'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-paper))'; }}
          data-testid="strategy-new-work"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Work</span>
        </button>
      </div>

      {/* ── Flat top-level nav (no group header, no nesting) ── */}
      <nav className="px-2 shrink-0 space-y-px" aria-label="Strategy sections">
        {TOP_NAV.map((n) => (
          <NavRow
            key={n.key}
            icon={n.icon}
            label={n.label}
            active={activeSurface === n.key}
            muted={n.muted}
            onClick={() => handlePickSurface(n.key)}
            testId={`nav-${n.key}`}
            trailing={
              n.key === 'projects' ? (
                <span className="text-[10px] px-1.5 py-px rounded-full" style={{ background: 'hsl(var(--sv-hover))', color: 'hsl(var(--sv-muted))' }}>
                  Soon
                </span>
              ) : null
            }
          />
        ))}

        {/* Manage Strategy — single entry point for workspaces and pills.
            "Add Mode" intentionally removed: creation lives only in
            Strategy Settings, not the navigation rail. */}
        <button
          type="button"
          onClick={() => { onOpenManageStrategy?.(); onAfterSelect?.(); }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[12px] transition-colors text-left"
          style={{ color: 'hsl(var(--sv-muted) / 0.85)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.5)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          title="Manage workspaces and pills"
          data-testid="nav-manage-strategy"
        >
          <Settings className="h-3 w-3 shrink-0" />
          <span>Manage Strategy</span>
        </button>
      </nav>

      <div className="mt-3 mx-3 h-px shrink-0" style={{ background: 'hsl(var(--sv-hairline))' }} />

      {/* ── Work — active + recent threads ── */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-4 pt-2">
        <div className="flex items-center justify-between px-3 pb-1.5">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.09em]" style={{ color: 'hsl(var(--sv-muted) / 0.85)' }}>
            Work
          </span>
          {visibleThreads.length > 0 && (
            <span
              className="text-[10px] px-1.5 py-px rounded-full tabular-nums"
              style={{ background: 'hsl(var(--sv-hover))', color: 'hsl(var(--sv-muted))' }}
            >
              {visibleThreads.length}
            </span>
          )}
        </div>

        {visibleThreads.length === 0 ? (
          <p className="px-3 pt-1 pb-2 text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
            No work yet. Click <span style={{ color: 'hsl(var(--sv-ink))' }}>New Work</span> above to start.
          </p>
        ) : (
          <ul className="px-1.5 space-y-px">
            {visibleThreads.slice(0, 30).map((t) => {
              const isActive = activeThreadId === t.id;
              const isRunning = runningThreadIds?.has(t.id) ?? false;
              const hasArtifact = artifactThreadIds?.has(t.id) ?? false;
              const isPinned = pinnedIds.has(t.id);
              const isEditing = editingId === t.id;
              const isUntitled = isUntitledTitle(t.title);
              const displayTitle = displayThreadTitle(t);
              return (
                <li key={t.id} className="group relative">
                  <button
                    onClick={() => { if (!isEditing) handlePickThread(t.id); }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      beginRename(t);
                    }}
                    className={cn('w-full text-left pr-3 py-1.5 rounded-[6px] flex flex-col gap-0.5 transition-colors')}
                    style={{
                      background: isActive
                        ? 'hsl(var(--sv-clay) / 0.08)'
                        : isPinned ? 'hsl(var(--sv-clay) / 0.04)' : 'transparent',
                      color: 'hsl(var(--sv-ink))',
                      paddingLeft: 10,
                      borderLeft: isActive
                        ? '2px solid hsl(var(--sv-clay))'
                        : isPinned ? '2px solid hsl(var(--sv-clay) / 0.45)' : '2px solid transparent',
                      opacity: isUntitled && !isActive && !isRunning && !hasArtifact && !isPinned ? 0.65 : 1,
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = isPinned ? 'hsl(var(--sv-clay) / 0.04)' : 'transparent';
                      }
                    }}
                    title={isEditing ? undefined : `${displayTitle} — double-click to rename`}
                  >
                    <div className="w-full flex items-center gap-2">
                      {isEditing ? (
                        <input
                          ref={renameInputRef}
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onBlur={() => commitRename(t)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename(t);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 truncate text-[13px] bg-transparent border-0 outline-none"
                          style={{
                            color: 'hsl(var(--sv-ink))',
                            fontWeight: isActive ? 600 : 400,
                          }}
                          aria-label="Rename thread"
                        />
                      ) : (
                        <span
                          className="flex-1 min-w-0 truncate text-[13px]"
                          style={{ fontWeight: isActive || isPinned ? 600 : 400 }}
                        >
                          {displayTitle}
                        </span>
                      )}
                      {isPinned && !isEditing && (
                        <Star
                          className="h-3 w-3 shrink-0"
                          style={{ color: 'hsl(var(--sv-clay))', fill: 'hsl(var(--sv-clay))' }}
                          aria-label="Pinned"
                        />
                      )}
                      {isRunning && (
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin" style={{ color: 'hsl(var(--sv-clay))' }} aria-label="Running" />
                      )}
                      {hasArtifact && !isRunning && (
                        <FileText className="h-3 w-3 shrink-0" style={{ color: 'hsl(var(--sv-clay) / 0.7)' }} aria-label="Has artifact" />
                      )}
                    </div>
                    <div
                      className="w-full flex items-center gap-1.5 text-[10.5px] leading-none"
                      style={{ color: 'hsl(var(--sv-muted))' }}
                    >
                      <span className="truncate">
                        {isPinned ? 'Project' : isRunning ? 'Running…' : hasArtifact ? 'Artifact ready' : 'Chat'}
                      </span>
                      <span aria-hidden style={{ opacity: 0.5 }}>·</span>
                      <span className="shrink-0 tabular-nums">{relativeTime(t.updated_at)}</span>
                    </div>
                  </button>

                  {/* Pin/unpin affordance — visible on hover, on active row,
                      or whenever the thread is already pinned. Sits over the
                      row to avoid layout shift. */}
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        togglePin(t.id);
                      }}
                      className={cn(
                        'absolute top-1 right-1 h-5 w-5 rounded-[4px] flex items-center justify-center transition-opacity',
                        isPinned || isActive
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                      )}
                      style={{
                        color: isPinned ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-muted))',
                        background: 'hsl(var(--sv-paper) / 0.9)',
                      }}
                      title={isPinned ? 'Unpin from Projects' : 'Pin as Project'}
                      aria-label={isPinned ? 'Unpin thread' : 'Pin thread as project'}
                      aria-pressed={isPinned}
                    >
                      <Star
                        className="h-3 w-3"
                        style={{ fill: isPinned ? 'hsl(var(--sv-clay))' : 'transparent' }}
                      />
                    </button>
                  )}
                </li>
              );
            })}
            {hiddenTestCount > 0 && (
              <li className="px-2 pt-1.5 pb-0.5">
                <span className="text-[10.5px]" style={{ color: 'hsl(var(--sv-muted) / 0.7)' }}>
                  {hiddenTestCount} test thread{hiddenTestCount === 1 ? '' : 's'} hidden
                </span>
              </li>
            )}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ──────────────── helpers ────────────────

function NavRow({
  icon: Icon, label, active, muted, onClick, testId, trailing,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
  testId?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors text-left"
      style={{
        background: active ? 'hsl(var(--sv-clay) / 0.10)' : 'transparent',
        color: active ? 'hsl(var(--sv-ink))' : muted ? 'hsl(var(--sv-ink) / 0.6)' : 'hsl(var(--sv-ink) / 0.9)',
        fontWeight: active ? 600 : 500,
        borderLeft: active ? '2px solid hsl(var(--sv-clay))' : '2px solid transparent',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      aria-current={active ? 'true' : undefined}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: active ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-muted))' }} />
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

function RailButton({
  onClick, title, children, tone, highlighted,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  tone?: 'clay';
  highlighted?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="h-8 w-8 rounded-[6px] sv-hover-bg flex items-center justify-center"
      style={{
        color: tone === 'clay' ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-muted))',
        background: highlighted ? 'hsl(var(--sv-clay) / 0.10)' : 'transparent',
      }}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

function relativeTime(updatedAt: string): string {
  const ts = new Date(updatedAt).getTime();
  const now = Date.now();
  const diffMin = Math.floor((now - ts) / 60000);
  if (diffMin < 1) return 'Now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'Yesterday';
  if (diffD < 7) return `${diffD}d`;
  try {
    return new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return `${diffD}d`;
  }
}
