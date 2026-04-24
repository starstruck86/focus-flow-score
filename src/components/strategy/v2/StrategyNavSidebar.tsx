/**
 * StrategyNavSidebar — pure navigation. ChatGPT-style.
 *
 * The sidebar lists FIVE sections in a fixed order:
 *   Modes · Library · Artifacts · Projects · Work
 *
 * Clicking Modes / Library / Artifacts switches the workspace into that
 * surface (rendered above the canvas). The sidebar itself never expands
 * inline pills, never shows nested workflow lists, and never mixes
 * navigation with actions.
 *
 * Projects: placeholder (no projects yet).
 * Work:     active + recent threads.
 *
 * UI ONLY. No backend/engine changes.
 */
import { useMemo } from 'react';
import {
  Plus, PanelLeftClose, PanelLeftOpen, Sparkles,
  Lightbulb, BookOpen, FolderKanban, Loader2, FileText, ChevronRight,
} from 'lucide-react';
import type { StrategyThread } from '@/types/strategy';
import { cn } from '@/lib/utils';

export type StrategyMode = 'brainstorm' | 'deep_research' | 'refine' | null;
export type StrategySurfaceKey = 'modes' | 'library' | 'artifacts';

interface Props {
  // Layout
  collapsed: boolean;
  onToggleCollapsed: () => void;

  // Surface picker (Modes / Library / Artifacts switches workspace)
  activeSurface: StrategySurfaceKey | null;
  onPickSurface: (s: StrategySurfaceKey | null) => void;

  // Work (threads)
  threads: StrategyThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewWork: () => void;
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;

  // Mobile
  onAfterSelect?: () => void;
}

export function StrategyNavSidebar({
  collapsed, onToggleCollapsed,
  activeSurface, onPickSurface,
  threads, activeThreadId, onSelectThread, onNewWork,
  runningThreadIds, artifactThreadIds,
  onAfterSelect,
}: Props) {
  // Filter test/benchmark threads out of Work; sort active+ready first.
  const { visibleThreads, hiddenTestCount } = useMemo(() => {
    const isTest = (t: StrategyThread) => /^\[benchmark\]/i.test(t.title || '');
    const visible = threads.filter((t) => !isTest(t));
    const hidden = threads.length - visible.length;
    const score = (t: StrategyThread) => {
      if (t.id === activeThreadId) return 0;
      if (runningThreadIds?.has(t.id)) return 1;
      if (artifactThreadIds?.has(t.id)) return 2;
      const isUntitled = !t.title || /^untitled/i.test(t.title);
      return isUntitled ? 4 : 3;
    };
    const sorted = [...visible].sort((a, b) => score(a) - score(b));
    return { visibleThreads: sorted, hiddenTestCount: hidden };
  }, [threads, activeThreadId, runningThreadIds, artifactThreadIds]);

  const handlePickSurface = (s: StrategySurfaceKey) => {
    onPickSurface(activeSurface === s ? null : s);
    onAfterSelect?.();
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
        <RailButton onClick={() => handlePickSurface('modes')} title="Modes" highlighted={activeSurface === 'modes'}><Lightbulb className="h-4 w-4" /></RailButton>
        <RailButton onClick={() => handlePickSurface('library')} title="Library" highlighted={activeSurface === 'library'}><BookOpen className="h-4 w-4" /></RailButton>
        <RailButton onClick={() => handlePickSurface('artifacts')} title="Artifacts" highlighted={activeSurface === 'artifacts'}><FileText className="h-4 w-4" /></RailButton>
        <RailButton onClick={() => { /* placeholder */ }} title="Projects"><FolderKanban className="h-4 w-4" /></RailButton>
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

      {/* ── Top-level nav (single tap → opens surface) ── */}
      <nav className="px-2 shrink-0" aria-label="Strategy sections">
        <NavRow
          icon={Lightbulb}
          label="Modes"
          active={activeSurface === 'modes'}
          onClick={() => handlePickSurface('modes')}
          testId="nav-modes"
        />
        <NavRow
          icon={BookOpen}
          label="Library"
          active={activeSurface === 'library'}
          onClick={() => handlePickSurface('library')}
          testId="nav-library"
        />
        <NavRow
          icon={FileText}
          label="Artifacts"
          active={activeSurface === 'artifacts'}
          onClick={() => handlePickSurface('artifacts')}
          testId="nav-artifacts"
        />
        <NavRow
          icon={FolderKanban}
          label="Projects"
          active={false}
          muted
          onClick={() => { /* projects placeholder */ }}
          testId="nav-projects"
          trailing={
            <span className="text-[10px] px-1.5 py-px rounded-full" style={{ background: 'hsl(var(--sv-hover))', color: 'hsl(var(--sv-muted))' }}>
              Soon
            </span>
          }
        />
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
              const isUntitled = !t.title || /^untitled/i.test(t.title);
              return (
                <li key={t.id}>
                  <button
                    onClick={() => handlePickThread(t.id)}
                    className={cn('w-full text-left pr-3 py-1.5 rounded-[6px] flex flex-col gap-0.5 transition-colors')}
                    style={{
                      background: isActive ? 'hsl(var(--sv-clay) / 0.08)' : 'transparent',
                      color: 'hsl(var(--sv-ink))',
                      paddingLeft: 10,
                      borderLeft: isActive ? '2px solid hsl(var(--sv-clay))' : '2px solid transparent',
                      opacity: isUntitled && !isActive && !isRunning && !hasArtifact ? 0.65 : 1,
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                    title={t.title || 'Untitled thread'}
                  >
                    <div className="w-full flex items-center gap-2">
                      <span className="flex-1 min-w-0 truncate text-[13px]" style={{ fontWeight: isActive ? 600 : 400 }}>
                        {t.title || 'Untitled thread'}
                      </span>
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
                        {isRunning ? 'Running…' : hasArtifact ? 'Artifact ready' : 'Chat'}
                      </span>
                      <span aria-hidden style={{ opacity: 0.5 }}>·</span>
                      <span className="shrink-0 tabular-nums">{relativeTime(t.updated_at)}</span>
                    </div>
                  </button>
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
      {trailing ?? <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />}
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
