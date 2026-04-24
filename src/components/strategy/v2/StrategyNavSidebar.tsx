/**
 * StrategyNavSidebar — the new operator sidebar for /strategy.
 *
 *   ChatGPT: clear sections, fast access
 *   Claude:  calm typography, artifact-first
 *   Strategy: library-grounded, reusable, operator workflow
 *
 * Locked section order (do not reorder):
 *   1. Modes      → composer hint (Brainstorm / Deep Research / Refine)
 *   2. Library    → opens /library slash command in composer
 *   3. Artifacts  → recent completed task_runs across all threads
 *   4. Projects   → promoted long-term threads (placeholder for now)
 *   5. Work       → active + recent threads
 *
 * UI ONLY. No backend, no engine, no batching, no model changes.
 */
import { useMemo, useState } from 'react';
import {
  Plus, PanelLeftClose, PanelLeftOpen, Sparkles,
  Lightbulb, Microscope, Wand2,
  BookOpen, FolderKanban, Loader2, FileText, ChevronRight, ChevronDown,
} from 'lucide-react';
import type { StrategyThread } from '@/types/strategy';
import type { UserArtifact } from '@/hooks/strategy/useUserArtifacts';
import { groupForTaskType, shortDate } from '@/hooks/strategy/useUserArtifacts';
import { cn } from '@/lib/utils';

export type StrategyMode = 'brainstorm' | 'deep_research' | 'refine' | null;

interface Props {
  // Layout
  collapsed: boolean;
  onToggleCollapsed: () => void;

  // Modes
  activeMode: StrategyMode;
  onPickMode: (m: StrategyMode) => void;

  // Library
  onOpenLibrary: () => void;

  // Artifacts
  artifacts: UserArtifact[];
  onOpenArtifact: (a: UserArtifact) => void;

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

const MODES: { id: Exclude<StrategyMode, null>; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; hint: string }[] = [
  { id: 'brainstorm',    label: 'Brainstorm',    icon: Lightbulb,  hint: 'Brainstorm mode · think out loud, explore angles, no structure required.' },
  { id: 'deep_research', label: 'Deep Research', icon: Microscope, hint: 'Deep Research mode · ask anything, paste notes, or start with an account or company.' },
  { id: 'refine',        label: 'Refine',        icon: Wand2,      hint: 'Refine mode · paste a draft, an output, or a snippet — I will sharpen it.' },
];

const LIBRARY_EXAMPLES = ['Generate ideas', 'Create framework', 'Build messaging', 'Turn resources into content'];

export function StrategyNavSidebar({
  collapsed, onToggleCollapsed,
  activeMode, onPickMode,
  onOpenLibrary,
  artifacts, onOpenArtifact,
  threads, activeThreadId, onSelectThread, onNewWork,
  runningThreadIds, artifactThreadIds,
  onAfterSelect,
}: Props) {
  // Section open/close state — calm by default, no junk drawer
  const [openModes, setOpenModes] = useState(true);
  const [openLibrary, setOpenLibrary] = useState(true);
  const [openArtifacts, setOpenArtifacts] = useState(true);
  const [openProjects, setOpenProjects] = useState(false);
  const [openWork, setOpenWork] = useState(true);

  // Group artifacts by task type
  const artifactsGrouped = useMemo(() => {
    const m = new Map<string, UserArtifact[]>();
    for (const a of artifacts) {
      const g = groupForTaskType(a.task_type);
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(a);
    }
    return Array.from(m.entries());
  }, [artifacts]);

  // Filter test/benchmark threads out of Work; sort active+ready first.
  const { visibleThreads, hiddenTestCount } = useMemo(() => {
    const isTest = (t: StrategyThread) => /^\[benchmark\]/i.test(t.title || '');
    const visible = threads.filter((t) => !isTest(t));
    const hidden = threads.length - visible.length;
    // Stable sort: active > running > artifact-ready > untitled-deprio > rest (by updated_at order which is already DB-sorted)
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
        <RailButton onClick={() => onPickMode('brainstorm')} title="Brainstorm" highlighted={activeMode === 'brainstorm'}><Lightbulb className="h-4 w-4" /></RailButton>
        <RailButton onClick={() => onPickMode('deep_research')} title="Deep Research" highlighted={activeMode === 'deep_research'}><Microscope className="h-4 w-4" /></RailButton>
        <RailButton onClick={() => onPickMode('refine')} title="Refine" highlighted={activeMode === 'refine'}><Wand2 className="h-4 w-4" /></RailButton>
        <RailButton onClick={onOpenLibrary} title="Library"><BookOpen className="h-4 w-4" /></RailButton>
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
        width: 272,
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
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Work</span>
        </button>
      </div>

      {/* ── Sections ── */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-4">
        {/* 1. Modes */}
        <Section
          label="Modes"
          subtitle="How should Strategy think?"
          open={openModes}
          onToggle={() => setOpenModes(o => !o)}
        >
          <div className="px-2 space-y-px">
            {MODES.map((m) => {
              const isActive = activeMode === m.id;
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  onClick={() => { onPickMode(isActive ? null : m.id); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[6px] text-[12.5px] transition-colors text-left"
                  style={{
                    background: isActive ? 'hsl(var(--sv-clay) / 0.10)' : 'transparent',
                    color: isActive ? 'hsl(var(--sv-ink))' : 'hsl(var(--sv-ink) / 0.85)',
                    fontWeight: isActive ? 600 : 400,
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  title={m.hint}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: isActive ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-muted))' }} />
                  <span className="flex-1 truncate">{m.label}</span>
                  {isActive && (
                    <span className="text-[9px] uppercase tracking-wide" style={{ color: 'hsl(var(--sv-clay))' }}>on</span>
                  )}
                </button>
              );
            })}
          </div>
        </Section>

        {/* 2. Library */}
        <Section
          label="Library"
          subtitle="Create from your knowledge"
          open={openLibrary}
          onToggle={() => setOpenLibrary(o => !o)}
        >
          <div className="px-3">
            <button
              onClick={() => { onOpenLibrary(); onAfterSelect?.(); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-[12.5px] font-medium transition-colors"
              style={{
                background: 'hsl(var(--sv-clay) / 0.08)',
                color: 'hsl(var(--sv-ink))',
                border: '1px solid hsl(var(--sv-clay) / 0.15)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-clay) / 0.14)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-clay) / 0.08)'; }}
            >
              <BookOpen className="h-3.5 w-3.5" style={{ color: 'hsl(var(--sv-clay))' }} />
              <span className="flex-1 text-left">Create from Library</span>
            </button>
            <ul className="mt-1.5 space-y-px">
              {LIBRARY_EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button
                    onClick={() => { onOpenLibrary(); onAfterSelect?.(); }}
                    className="w-full text-left px-2 py-1 rounded-[4px] text-[11.5px] transition-colors"
                    style={{ color: 'hsl(var(--sv-muted))' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; e.currentTarget.style.color = 'hsl(var(--sv-ink))'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'hsl(var(--sv-muted))'; }}
                  >
                    · {ex}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* 3. Artifacts */}
        <Section
          label="Artifacts"
          subtitle={artifacts.length === 0 ? 'Outputs land here' : undefined}
          count={artifacts.length}
          open={openArtifacts}
          onToggle={() => setOpenArtifacts(o => !o)}
        >
          {artifacts.length === 0 ? (
            <p className="px-3 pt-1 pb-2 text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
              No artifacts yet. Discovery preps and deal reviews will appear here.
            </p>
          ) : (
            <div className="px-1.5 space-y-1.5">
              {artifactsGrouped.map(([groupName, items]) => (
                <div key={groupName}>
                  <div
                    className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-[0.06em]"
                    style={{ color: 'hsl(var(--sv-muted) / 0.75)' }}
                  >
                    {groupName}
                  </div>
                  <ul className="space-y-px">
                    {items.slice(0, 3).map((a) => (
                      <li key={a.id}>
                        <button
                          onClick={() => { onOpenArtifact(a); onAfterSelect?.(); }}
                          className="w-full text-left px-2 py-1.5 rounded-[6px] flex items-start gap-2 group transition-colors"
                          style={{ color: 'hsl(var(--sv-ink))' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          title={a.title}
                        >
                          <FileText className="h-3 w-3 shrink-0 mt-[3px]" style={{ color: 'hsl(var(--sv-clay) / 0.7)' }} />
                          <div className="flex-1 min-w-0 flex flex-col gap-px">
                            <span className="truncate text-[12.5px] leading-tight">
                              {a.context ? a.context : a.type_label}
                            </span>
                            <span
                              className="truncate text-[10.5px] leading-tight"
                              style={{ color: 'hsl(var(--sv-muted))' }}
                            >
                              {a.context ? `${a.type_label} · ${shortDate(a.completed_at ?? a.created_at)}` : shortDate(a.completed_at ?? a.created_at)}
                            </span>
                          </div>
                          <ChevronRight className="h-3 w-3 shrink-0 mt-[3px] opacity-0 group-hover:opacity-50" />
                        </button>
                      </li>
                    ))}
                    {items.length > 3 && (
                      <li>
                        <span
                          className="block px-2 py-0.5 text-[10.5px]"
                          style={{ color: 'hsl(var(--sv-muted) / 0.7)' }}
                        >
                          +{items.length - 3} more
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 4. Projects */}
        <Section
          label="Projects"
          subtitle="Long-term work"
          open={openProjects}
          onToggle={() => setOpenProjects(o => !o)}
        >
          <div className="px-3 pt-1 pb-2 flex flex-col gap-1.5">
            <div
              className="flex items-center gap-2 px-2.5 py-2 rounded-[6px]"
              style={{ background: 'hsl(var(--sv-hover) / 0.5)' }}
            >
              <FolderKanban className="h-3.5 w-3.5 shrink-0" style={{ color: 'hsl(var(--sv-muted))' }} />
              <span className="text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
                No projects yet
              </span>
            </div>
            <p className="text-[11px] leading-snug px-1" style={{ color: 'hsl(var(--sv-muted))' }}>
              Promote important threads into Projects to keep working long-term.
            </p>
          </div>
        </Section>

        {/* 5. Work — benchmark/test threads filtered, active/artifact-ready ranked first */}
        <Section
          label="Work"
          subtitle={visibleThreads.length === 0 ? 'Active and recent threads' : undefined}
          count={visibleThreads.length}
          open={openWork}
          onToggle={() => setOpenWork(o => !o)}
        >
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
        </Section>
      </div>
    </aside>
  );
}

// ──────────────── helpers ────────────────

function Section({
  label, subtitle, count, open, onToggle, children,
}: {
  label: string;
  subtitle?: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-0.5 first:mt-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 pt-2.5 pb-1 group"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" style={{ color: 'hsl(var(--sv-muted) / 0.6)' }} />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" style={{ color: 'hsl(var(--sv-muted) / 0.6)' }} />
        )}
        <span className="text-[10.5px] font-medium uppercase tracking-[0.09em]" style={{ color: 'hsl(var(--sv-muted) / 0.85)' }}>
          {label}
        </span>
        {typeof count === 'number' && count > 0 && (
          <span
            className="ml-auto text-[10px] px-1.5 py-px rounded-full tabular-nums"
            style={{ background: 'hsl(var(--sv-hover))', color: 'hsl(var(--sv-muted))' }}
          >
            {count}
          </span>
        )}
      </button>
      {open && subtitle && (
        <p className="px-3 pb-1 text-[10.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
          {subtitle}
        </p>
      )}
      {open && children}
    </section>
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
