/**
 * StrategyNavSidebar — Modes / Library / Artifacts / Projects / Work
 *
 * Each top section follows the same model:
 *   Click → Configure → Run
 *
 * • Modes      → behavior chips that reveal programmable workflow pills
 * • Library    → workflows that create new outputs from the user's knowledge
 * • Artifacts  → reusable document-style templates (Discovery Prep, Deal Review…)
 * • Projects   → placeholder for promoted long-term work
 * • Work       → active + recent threads (instances live here)
 *
 * UI ONLY. No backend/engine changes.
 */
import { useMemo, useState } from 'react';
import {
  Plus, PanelLeftClose, PanelLeftOpen, Sparkles,
  Lightbulb, Microscope, Wand2,
  BookOpen, FolderKanban, Loader2, FileText, ChevronRight, ChevronDown,
  ClipboardList, ClipboardCheck, Send, Presentation, Mail, FilePlus,
  Search, Layers, MessageSquareQuote, Shapes,
} from 'lucide-react';
import type { StrategyThread } from '@/types/strategy';
import { cn } from '@/lib/utils';
import {
  MODE_PILLS, LIBRARY_DEFS, ARTIFACT_TEMPLATE_DEFS,
  type WorkflowDef,
} from './workflows/workflowRegistry';

export type StrategyMode = 'brainstorm' | 'deep_research' | 'refine' | null;

interface Props {
  // Layout
  collapsed: boolean;
  onToggleCollapsed: () => void;

  // Modes
  activeMode: StrategyMode;
  onPickMode: (m: StrategyMode) => void;

  // Workflow launcher (used by all three actionable sections)
  onLaunchWorkflow: (def: WorkflowDef) => void;

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

const MODE_META: { id: Exclude<StrategyMode, null>; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; hint: string }[] = [
  { id: 'brainstorm',    label: 'Brainstorm',    icon: Lightbulb,  hint: 'Brainstorm — angles, ideas, hooks, POVs.' },
  { id: 'deep_research', label: 'Deep Research', icon: Microscope, hint: 'Deep research — companies, competitors, briefs.' },
  { id: 'refine',        label: 'Refine',        icon: Wand2,      hint: 'Refine — sharpen drafts, tighten messaging.' },
];

const LIBRARY_ICON_BY_ID: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  'library.ideas': Lightbulb,
  'library.framework': Shapes,
  'library.messaging': MessageSquareQuote,
  'library.synthesis': Layers,
};

const ARTIFACT_ICON_BY_ID: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  'artifact.discovery_prep': ClipboardList,
  'artifact.deal_review': ClipboardCheck,
  'artifact.outreach_plan': Send,
  'artifact.demo_plan': Presentation,
  'artifact.followup_email': Mail,
  'artifact.custom': FilePlus,
};

export function StrategyNavSidebar({
  collapsed, onToggleCollapsed,
  activeMode, onPickMode,
  onLaunchWorkflow,
  threads, activeThreadId, onSelectThread, onNewWork,
  runningThreadIds, artifactThreadIds,
  onAfterSelect,
}: Props) {
  // Section open/close state — calm by default
  const [openModes, setOpenModes] = useState(true);
  const [openLibrary, setOpenLibrary] = useState(true);
  const [openArtifacts, setOpenArtifacts] = useState(true);
  const [openProjects, setOpenProjects] = useState(false);
  const [openWork, setOpenWork] = useState(true);

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

  const handleLaunch = (def: WorkflowDef) => {
    onLaunchWorkflow(def);
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
        <RailButton onClick={() => onPickMode('brainstorm')} title="Brainstorm" highlighted={activeMode === 'brainstorm'}><Lightbulb className="h-4 w-4" /></RailButton>
        <RailButton onClick={() => onPickMode('deep_research')} title="Deep Research" highlighted={activeMode === 'deep_research'}><Microscope className="h-4 w-4" /></RailButton>
        <RailButton onClick={() => onPickMode('refine')} title="Refine" highlighted={activeMode === 'refine'}><Wand2 className="h-4 w-4" /></RailButton>
        <RailButton onClick={() => handleLaunch(LIBRARY_DEFS[0])} title="Library"><BookOpen className="h-4 w-4" /></RailButton>
        <RailButton onClick={() => handleLaunch(ARTIFACT_TEMPLATE_DEFS[0])} title="Artifact templates"><FileText className="h-4 w-4" /></RailButton>
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
        {/* 1. Modes — chip + revealed pills */}
        <Section
          label="Modes"
          subtitle="How should Strategy think?"
          open={openModes}
          onToggle={() => setOpenModes(o => !o)}
        >
          <div className="px-2 space-y-px">
            {MODE_META.map((m) => {
              const isActive = activeMode === m.id;
              const Icon = m.icon;
              const pills = MODE_PILLS[m.id];
              return (
                <div key={m.id}>
                  <button
                    onClick={() => onPickMode(isActive ? null : m.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[6px] text-[12.5px] transition-colors text-left"
                    style={{
                      background: isActive ? 'hsl(var(--sv-clay) / 0.10)' : 'transparent',
                      color: isActive ? 'hsl(var(--sv-ink))' : 'hsl(var(--sv-ink) / 0.85)',
                      fontWeight: isActive ? 600 : 400,
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                    title={m.hint}
                    aria-expanded={isActive}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: isActive ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-muted))' }} />
                    <span className="flex-1 truncate">{m.label}</span>
                    {isActive
                      ? <ChevronDown className="h-3 w-3 shrink-0" style={{ color: 'hsl(var(--sv-clay))' }} />
                      : <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />}
                  </button>
                  {isActive && (
                    <ul className="pl-7 pr-1 pb-1.5 pt-0.5 space-y-px">
                      {pills.map((pill) => (
                        <li key={pill.id}>
                          <button
                            onClick={() => handleLaunch(pill)}
                            className="w-full text-left px-2 py-1 rounded-[5px] text-[11.5px] transition-colors flex items-center gap-1.5"
                            style={{ color: 'hsl(var(--sv-ink) / 0.78)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.7)'; e.currentTarget.style.color = 'hsl(var(--sv-ink))'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'hsl(var(--sv-ink) / 0.78)'; }}
                            title={pill.description}
                          >
                            <span className="truncate">{pill.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {!activeMode && (
              <p className="px-2 pt-1 pb-2 text-[10.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
                Pick a mode to reveal workflow shortcuts. You can always type freely.
              </p>
            )}
          </div>
        </Section>

        {/* 2. Library — creation workflows */}
        <Section
          label="Library"
          subtitle="Create from your knowledge"
          open={openLibrary}
          onToggle={() => setOpenLibrary(o => !o)}
        >
          <ul className="px-1.5 space-y-px">
            {LIBRARY_DEFS.map((def) => {
              const Icon = LIBRARY_ICON_BY_ID[def.id] ?? BookOpen;
              return (
                <li key={def.id}>
                  <button
                    onClick={() => handleLaunch(def)}
                    className="w-full text-left px-2 py-1.5 rounded-[6px] flex items-start gap-2 group transition-colors"
                    style={{ color: 'hsl(var(--sv-ink))' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    title={def.description}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 mt-[2px]" style={{ color: 'hsl(var(--sv-clay) / 0.75)' }} />
                    <span className="flex-1 min-w-0 truncate text-[12.5px]">{def.label}</span>
                    <ChevronRight className="h-3 w-3 shrink-0 mt-[3px] opacity-0 group-hover:opacity-50" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>

        {/* 3. Artifacts — reusable templates */}
        <Section
          label="Artifacts"
          subtitle="Reusable document templates"
          open={openArtifacts}
          onToggle={() => setOpenArtifacts(o => !o)}
        >
          <ul className="px-1.5 space-y-px">
            {ARTIFACT_TEMPLATE_DEFS.map((def) => {
              const Icon = ARTIFACT_ICON_BY_ID[def.id] ?? FileText;
              return (
                <li key={def.id}>
                  <button
                    onClick={() => handleLaunch(def)}
                    className="w-full text-left px-2 py-1.5 rounded-[6px] flex items-start gap-2 group transition-colors"
                    style={{ color: 'hsl(var(--sv-ink))' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    title={def.description}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 mt-[2px]" style={{ color: 'hsl(var(--sv-clay) / 0.75)' }} />
                    <div className="flex-1 min-w-0 flex flex-col">
                      <span className="truncate text-[12.5px] leading-tight">
                        {def.formTitle ?? def.label.replace(/\s+Template$/i, '')}
                      </span>
                      <span className="truncate text-[10.5px] leading-tight" style={{ color: 'hsl(var(--sv-muted))' }}>
                        Template
                      </span>
                    </div>
                    <ChevronRight className="h-3 w-3 shrink-0 mt-[3px] opacity-0 group-hover:opacity-50" />
                  </button>
                </li>
              );
            })}
          </ul>
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

        {/* 5. Work — active + recent threads */}
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
