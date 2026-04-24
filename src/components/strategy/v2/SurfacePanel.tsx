/**
 * SurfacePanel — workspace surface for direct top-level entries.
 *
 * The sidebar exposes flat entries (Brainstorm, Deep Research, Refine,
 * Library, Artifacts, Projects, Work). Clicking one switches the workspace
 * into that surface and shows its actions/templates inline above the canvas.
 *
 *   surface: 'brainstorm'|'deep_research'|'refine' → mode pills + custom pills
 *   surface: 'library'    → library workflow pills + custom pills
 *   surface: 'artifacts'  → artifact template tiles + custom pills
 *   surface: 'projects'   → placeholder (promoted long-term work)
 *   surface: 'work'       → recent freeform threads (+ active/artifact-ready)
 *
 * Each surface ALSO shows:
 *   • "Recent in <surface>" thread list (driven by threadTags)
 *   • "+ New pill" affordance (opens PillEditorSheet)
 *   • Edit affordance on every custom pill
 *
 * All pills/templates launch the same WorkflowFormSheet (Click → Configure → Run).
 *
 * Pure presentation. No backend/engine changes.
 */
import { useMemo } from 'react';
import {
  X, Lightbulb, Microscope, Wand2, BookOpen, FileText,
  ClipboardList, ClipboardCheck, Send, Presentation, Mail, FilePlus,
  Layers, MessageSquareQuote, Shapes, ArrowRight, FolderKanban,
  Plus, Pencil, Sparkles, Loader2, Briefcase,
} from 'lucide-react';
import {
  MODE_PILLS, LIBRARY_DEFS, ARTIFACT_TEMPLATE_DEFS,
  type WorkflowDef,
} from './workflows/workflowRegistry';
import {
  listCustomPillsForSurface,
  customPillToWorkflowDef,
  type CustomPill,
} from '@/lib/strategy/customPills';
import { getAllThreadTags } from '@/lib/strategy/threadTags';
import type { StrategySurfaceKey } from './StrategyNavSidebar';
import type { StrategyThread } from '@/types/strategy';

interface Props {
  surface: StrategySurfaceKey;
  onLaunchWorkflow: (def: WorkflowDef) => void;
  onClose: () => void;
  /** All threads (for "Recent in <surface>" + Work surface). */
  threads: StrategyThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  /** Custom pills version counter — bumped after add/edit/delete to force a re-render. */
  pillsVersion: number;
  /** Open the PillEditorSheet to create a new pill in this surface. */
  onAddPill: (surface: StrategySurfaceKey) => void;
  /** Open the PillEditorSheet to edit an existing pill. */
  onEditPill: (pill: CustomPill) => void;
  /** Per-thread indicators */
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;
}

const SURFACE_HEADER: Record<StrategySurfaceKey, {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  brainstorm:    { label: 'Brainstorm',    icon: Lightbulb,    description: 'Generate ideas, angles, hooks, and points of view.' },
  deep_research: { label: 'Deep Research', icon: Microscope,   description: 'Analyze companies, competitors, and markets in depth.' },
  refine:        { label: 'Refine',        icon: Wand2,        description: 'Improve, tighten, and elevate existing output.' },
  library:       { label: 'Library',       icon: BookOpen,     description: 'Create from your knowledge.' },
  artifacts:     { label: 'Artifacts',     icon: FileText,     description: 'Reusable document templates.' },
  projects:      { label: 'Projects',      icon: FolderKanban, description: 'Promoted long-term work.' },
  work:          { label: 'Work',          icon: Briefcase,    description: 'All your recent threads.' },
};

const LIBRARY_ICON_BY_ID: Record<string, React.ComponentType<{ className?: string }>> = {
  'library.ideas': Lightbulb,
  'library.framework': Shapes,
  'library.messaging': MessageSquareQuote,
  'library.synthesis': Layers,
};

const ARTIFACT_ICON_BY_ID: Record<string, React.ComponentType<{ className?: string }>> = {
  'artifact.discovery_prep': ClipboardList,
  'artifact.deal_review': ClipboardCheck,
  'artifact.outreach_plan': Send,
  'artifact.demo_plan': Presentation,
  'artifact.followup_email': Mail,
  'artifact.custom': FilePlus,
};

export function SurfacePanel({
  surface, onLaunchWorkflow, onClose,
  threads, activeThreadId, onSelectThread,
  pillsVersion, onAddPill, onEditPill,
  runningThreadIds, artifactThreadIds,
}: Props) {
  const meta = SURFACE_HEADER[surface];
  const HeaderIcon = meta.icon;

  // ── Custom pills (per surface) ────────────────────────────────
  const customPills = useMemo<CustomPill[]>(
    () => listCustomPillsForSurface(surface),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, pillsVersion],
  );

  // ── Recent threads associated with this surface ───────────────
  const recentThreadsForSurface = useMemo(() => {
    if (surface === 'work' || surface === 'projects') return [];
    const tags = getAllThreadTags();
    const isTest = (t: StrategyThread) => /^\[benchmark\]/i.test(t.title || '');
    return threads
      .filter((t) => tags[t.id] === surface && !isTest(t))
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, surface, pillsVersion]);

  // ── Relevant fallback (contextual, per-surface scoring) ─────────
  // When the user hasn't run a pill in this surface yet, we still want the
  // workspace to feel intentional — show recent work that *matches the kind
  // of work this surface is for*, not random threads.
  //
  // Signals available per thread: artifactThreadIds (structured output),
  // runningThreadIds (in flight), title length (proxy for depth), updated_at.
  // We score against simple heuristics defined per surface.
  const relevantFallbackWork = useMemo(() => {
    if (surface === 'work' || surface === 'projects') return [];
    if (recentThreadsForSurface.length > 0) return [];
    const isTest = (t: StrategyThread) => /^\[benchmark\]/i.test(t.title || '');
    const tags = getAllThreadTags();
    const candidates = threads.filter((t) => !isTest(t) && !tags[t.id]);

    const now = Date.now();
    const recencyBoost = (t: StrategyThread) => {
      const ageH = Math.max(1, (now - new Date(t.updated_at).getTime()) / 3_600_000);
      // Smooth decay: ~1.0 for fresh, ~0.4 after a week
      return 1 / Math.log2(ageH + 2);
    };
    const titleLen = (t: StrategyThread) => (t.title || '').trim().length;
    const isUntitled = (t: StrategyThread) => !t.title || /^untitled/i.test(t.title);
    const hasArtifact = (t: StrategyThread) => artifactThreadIds?.has(t.id) ?? false;

    const score = (t: StrategyThread) => {
      const r = recencyBoost(t);
      const len = titleLen(t);
      const art = hasArtifact(t) ? 1 : 0;
      const untitled = isUntitled(t) ? 1 : 0;
      switch (surface) {
        case 'brainstorm':
          // Prefer ideation: short / no-artifact / fresh
          return (r * 1.2) + (1 - art) * 0.8 + (len > 0 && len < 40 ? 0.5 : 0) - untitled * 0.3;
        case 'deep_research':
          // Prefer depth: artifacts + longer titles
          return art * 1.4 + Math.min(len / 60, 1) * 0.8 + r * 0.6 - untitled * 0.5;
        case 'refine':
          // Prefer artifacts and recently-edited drafts
          return art * 1.6 + r * 1.0 + Math.min(len / 50, 1) * 0.4 - untitled * 0.6;
        case 'library':
        case 'artifacts':
          // Prefer threads that produced artifacts (templates/outputs)
          return art * 1.5 + r * 0.7 - untitled * 0.4;
        default:
          return r;
      }
    };

    return [...candidates]
      .map((t) => ({ t, s: score(t) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 4)
      .map((x) => x.t);
  }, [threads, surface, recentThreadsForSurface.length, artifactThreadIds]);

  // ── Work surface: all threads, sorted active/ready/recent ─────
  const workThreads = useMemo(() => {
    if (surface !== 'work') return [];
    const isTest = (t: StrategyThread) => /^\[benchmark\]/i.test(t.title || '');
    const visible = threads.filter((t) => !isTest(t));
    const score = (t: StrategyThread) => {
      if (t.id === activeThreadId) return 0;
      if (runningThreadIds?.has(t.id)) return 1;
      if (artifactThreadIds?.has(t.id)) return 2;
      const isUntitled = !t.title || /^untitled/i.test(t.title);
      return isUntitled ? 4 : 3;
    };
    return [...visible].sort((a, b) => score(a) - score(b)).slice(0, 24);
  }, [surface, threads, activeThreadId, runningThreadIds, artifactThreadIds]);

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto border-b"
      style={{
        background: 'hsl(var(--sv-paper))',
        borderColor: 'hsl(var(--sv-hairline))',
      }}
      data-testid={`surface-panel-${surface}`}
    >
      <div className="mx-auto w-full px-6 pt-5 pb-5" style={{ maxWidth: 920 }}>
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div
            className="h-7 w-7 rounded-[6px] flex items-center justify-center mt-0.5 shrink-0"
            style={{ background: 'hsl(var(--sv-clay) / 0.10)', color: 'hsl(var(--sv-clay))' }}
          >
            <HeaderIcon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              className="text-[18px] leading-tight tracking-tight"
              style={{ fontFamily: 'var(--sv-serif)', color: 'hsl(var(--sv-ink))', fontWeight: 500 }}
            >
              {meta.label}
            </h2>
            <p className="text-[12.5px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
              {meta.description}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-[6px] flex items-center justify-center sv-hover-bg shrink-0"
            style={{ color: 'hsl(var(--sv-muted))' }}
            aria-label="Close panel"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="mt-5 space-y-5">
          {/* Built-in actions */}
          {(surface === 'brainstorm' || surface === 'deep_research' || surface === 'refine') && (
            <PillGrid
              items={MODE_PILLS[surface]}
              onLaunch={onLaunchWorkflow}
            />
          )}
          {surface === 'library' && (
            <PillGrid
              items={LIBRARY_DEFS}
              iconById={LIBRARY_ICON_BY_ID}
              onLaunch={onLaunchWorkflow}
            />
          )}
          {surface === 'artifacts' && (
            <TemplateGrid items={ARTIFACT_TEMPLATE_DEFS} onLaunch={onLaunchWorkflow} />
          )}
          {surface === 'projects' && <ProjectsPlaceholder />}

          {/* Custom pills (per surface) — not on Work or Projects */}
          {surface !== 'projects' && surface !== 'work' && (
            <CustomPillsRow
              pills={customPills}
              onLaunch={(p) => onLaunchWorkflow(customPillToWorkflowDef(p))}
              onEdit={onEditPill}
              onAdd={() => onAddPill(surface)}
            />
          )}

          {/* Work surface: thread list */}
          {surface === 'work' && (
            <WorkThreadList
              threads={workThreads}
              activeThreadId={activeThreadId}
              onSelect={onSelectThread}
              runningThreadIds={runningThreadIds}
              artifactThreadIds={artifactThreadIds}
            />
          )}

          {/* Recent in <surface> */}
          {surface !== 'work' && surface !== 'projects' && (
            <RecentInSurface
              label={meta.label}
              threads={recentThreadsForSurface}
              fallbackThreads={relevantFallbackWork}
              surface={surface}
              activeThreadId={activeThreadId}
              onSelect={onSelectThread}
              runningThreadIds={runningThreadIds}
              artifactThreadIds={artifactThreadIds}
            />
          )}
        </div>

        {/* Quiet footer hint */}
        {surface !== 'work' && (
          <p
            className="mt-5 text-[11px] tracking-wide"
            style={{ color: 'hsl(var(--sv-muted) / 0.7)' }}
          >
            Or just type below — the composer is always ready.
          </p>
        )}
      </div>
    </div>
  );
}

// ───────────────── Pills (mode pills + library) ─────────────────

function PillGrid({
  items,
  iconById,
  onLaunch,
}: {
  items: WorkflowDef[];
  iconById?: Record<string, React.ComponentType<{ className?: string }>>;
  onLaunch: (def: WorkflowDef) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((def) => {
        const Icon = iconById?.[def.id];
        return (
          <button
            key={def.id}
            onClick={() => onLaunch(def)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] transition-colors"
            style={{
              border: '1px solid hsl(var(--sv-hairline))',
              background: 'hsl(var(--sv-paper))',
              color: 'hsl(var(--sv-ink))',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'hsl(var(--sv-clay) / 0.08)';
              e.currentTarget.style.borderColor = 'hsl(var(--sv-clay) / 0.35)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'hsl(var(--sv-paper))';
              e.currentTarget.style.borderColor = 'hsl(var(--sv-hairline))';
            }}
            title={def.description}
            data-testid={`pill-${def.id}`}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            <span>{def.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ───────────────── Custom pills row (with Add) ─────────────────

function CustomPillsRow({
  pills, onLaunch, onEdit, onAdd,
}: {
  pills: CustomPill[];
  onLaunch: (p: CustomPill) => void;
  onEdit: (p: CustomPill) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="h-3 w-3" style={{ color: 'hsl(var(--sv-clay) / 0.8)' }} />
        <span className="text-[10.5px] font-medium uppercase tracking-[0.09em]" style={{ color: 'hsl(var(--sv-muted))' }}>
          Your pills
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {pills.map((p) => (
          <div
            key={p.id}
            className="inline-flex items-stretch rounded-full overflow-hidden"
            style={{
              border: '1px solid hsl(var(--sv-clay) / 0.35)',
              background: 'hsl(var(--sv-clay) / 0.05)',
            }}
          >
            <button
              onClick={() => onLaunch(p)}
              className="px-3 py-1.5 text-[12.5px] inline-flex items-center gap-1.5 transition-colors"
              style={{ color: 'hsl(var(--sv-ink))' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-clay) / 0.10)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              title={p.description || p.instruction || 'Run this pill'}
              data-testid={`custom-pill-${p.id}`}
            >
              <Sparkles className="h-3 w-3" style={{ color: 'hsl(var(--sv-clay))' }} />
              <span className="truncate max-w-[180px]">{p.name}</span>
            </button>
            <button
              onClick={() => onEdit(p)}
              className="px-2 py-1.5 transition-colors"
              style={{ color: 'hsl(var(--sv-muted))', borderLeft: '1px solid hsl(var(--sv-clay) / 0.25)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-clay) / 0.10)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              aria-label={`Edit pill ${p.name}`}
              title="Edit pill"
              data-testid={`custom-pill-edit-${p.id}`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        ))}

        {/* + New pill */}
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] transition-colors border-dashed"
          style={{
            border: '1px dashed hsl(var(--sv-hairline))',
            background: 'transparent',
            color: 'hsl(var(--sv-muted))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.5)';
            e.currentTarget.style.borderColor = 'hsl(var(--sv-clay) / 0.4)';
            e.currentTarget.style.color = 'hsl(var(--sv-clay))';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'hsl(var(--sv-hairline))';
            e.currentTarget.style.color = 'hsl(var(--sv-muted))';
          }}
          data-testid="surface-add-pill"
        >
          <Plus className="h-3 w-3" />
          <span>{pills.length === 0 ? 'New pill' : 'New pill'}</span>
        </button>
      </div>
      {pills.length === 0 && (
        <p className="mt-1.5 text-[11px]" style={{ color: 'hsl(var(--sv-muted) / 0.85)' }}>
          Pills are programmable shortcuts — like lightweight custom GPTs.
        </p>
      )}
    </div>
  );
}

// ───────────────── Recent in surface ─────────────────

function RecentInSurface({
  label, threads, fallbackThreads, activeThreadId, onSelect, runningThreadIds, artifactThreadIds,
}: {
  label: string;
  threads: StrategyThread[];
  fallbackThreads: StrategyThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;
}) {
  const hasOwn = threads.length > 0;
  const hasFallback = !hasOwn && fallbackThreads.length > 0;
  const heading = hasOwn ? `Recent in ${label}` : (hasFallback ? 'From your recent work' : `Recent in ${label}`);
  const showThreads = hasOwn ? threads : (hasFallback ? fallbackThreads : []);
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.09em]" style={{ color: 'hsl(var(--sv-muted))' }}>
          {heading}
        </span>
      </div>
      {showThreads.length > 0 ? (
        <ThreadRows
          threads={showThreads}
          activeThreadId={activeThreadId}
          onSelect={onSelect}
          runningThreadIds={runningThreadIds}
          artifactThreadIds={artifactThreadIds}
        />
      ) : (
        <div
          className="rounded-[8px] px-3 py-2.5 text-[12px]"
          style={{
            border: '1px solid hsl(var(--sv-hairline))',
            background: 'hsl(var(--sv-paper))',
            color: 'hsl(var(--sv-muted))',
          }}
        >
          Tap a pill above to start your first {label} thread.
        </div>
      )}
    </div>
  );
}

// ───────────────── Work thread list ─────────────────

function WorkThreadList({
  threads, activeThreadId, onSelect, runningThreadIds, artifactThreadIds,
}: {
  threads: StrategyThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;
}) {
  if (threads.length === 0) {
    return (
      <div
        className="rounded-[10px] p-5 text-center"
        style={{
          border: '1px dashed hsl(var(--sv-hairline))',
          background: 'hsl(var(--sv-hover) / 0.3)',
        }}
      >
        <Briefcase className="h-5 w-5 mx-auto mb-2" style={{ color: 'hsl(var(--sv-muted))' }} />
        <p className="text-[13px]" style={{ color: 'hsl(var(--sv-ink))' }}>
          No work yet
        </p>
        <p className="mt-1 text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
          Start typing below — your threads will show up here.
        </p>
      </div>
    );
  }
  return (
    <ThreadRows
      threads={threads}
      activeThreadId={activeThreadId}
      onSelect={onSelect}
      runningThreadIds={runningThreadIds}
      artifactThreadIds={artifactThreadIds}
    />
  );
}

function ThreadRows({
  threads, activeThreadId, onSelect, runningThreadIds, artifactThreadIds,
}: {
  threads: StrategyThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;
}) {
  return (
    <ul className="space-y-1">
      {threads.map((t) => {
        const isActive = activeThreadId === t.id;
        const isRunning = runningThreadIds?.has(t.id) ?? false;
        const hasArtifact = artifactThreadIds?.has(t.id) ?? false;
        const isUntitled = !t.title || /^untitled/i.test(t.title);
        return (
          <li key={t.id}>
            <button
              onClick={() => onSelect(t.id)}
              className="w-full text-left px-3 py-2 rounded-[8px] flex items-center gap-2 transition-colors"
              style={{
                background: isActive ? 'hsl(var(--sv-clay) / 0.08)' : 'transparent',
                border: '1px solid ' + (isActive ? 'hsl(var(--sv-clay) / 0.30)' : 'hsl(var(--sv-hairline))'),
                color: 'hsl(var(--sv-ink))',
                opacity: isUntitled && !isActive && !isRunning && !hasArtifact ? 0.7 : 1,
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              title={t.title || 'Untitled thread'}
              data-testid={`surface-thread-${t.id}`}
            >
              <span className="flex-1 min-w-0 truncate text-[13px]" style={{ fontWeight: isActive ? 600 : 400 }}>
                {t.title || 'Untitled thread'}
              </span>
              {isRunning && (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" style={{ color: 'hsl(var(--sv-clay))' }} aria-label="Running" />
              )}
              {hasArtifact && !isRunning && (
                <FileText className="h-3 w-3 shrink-0" style={{ color: 'hsl(var(--sv-clay) / 0.7)' }} aria-label="Has artifact" />
              )}
              <span className="text-[10.5px] shrink-0 tabular-nums" style={{ color: 'hsl(var(--sv-muted))' }}>
                {relativeTime(t.updated_at)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────── Artifact template tiles ─────────────────

function TemplateGrid({
  items, onLaunch,
}: { items: WorkflowDef[]; onLaunch: (def: WorkflowDef) => void }) {
  return (
    <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((def) => {
        const Icon = ARTIFACT_ICON_BY_ID[def.id] ?? FileText;
        const label = def.formTitle ?? def.label.replace(/\s+Template$/i, '');
        return (
          <button
            key={def.id}
            onClick={() => onLaunch(def)}
            className="text-left p-3 rounded-[10px] transition-colors group"
            style={{
              border: '1px solid hsl(var(--sv-hairline))',
              background: 'hsl(var(--sv-paper))',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)';
              e.currentTarget.style.borderColor = 'hsl(var(--sv-clay) / 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'hsl(var(--sv-paper))';
              e.currentTarget.style.borderColor = 'hsl(var(--sv-hairline))';
            }}
            data-testid={`artifact-tile-${def.id}`}
          >
            <div className="flex items-start gap-2.5">
              <div
                className="h-7 w-7 rounded-[6px] flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: 'hsl(var(--sv-clay) / 0.10)', color: 'hsl(var(--sv-clay))' }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13.5px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
                    {label}
                  </span>
                  <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'hsl(var(--sv-clay))' }} />
                </div>
                <p className="mt-1 text-[11.5px] leading-snug" style={{ color: 'hsl(var(--sv-muted))' }}>
                  {def.description}
                </p>
                <span
                  className="mt-2 inline-block text-[10px] uppercase tracking-wider px-1.5 py-px rounded"
                  style={{
                    background: 'hsl(var(--sv-hover))',
                    color: 'hsl(var(--sv-muted))',
                    fontWeight: 500,
                  }}
                >
                  Template
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ───────────────── Projects placeholder ─────────────────

function ProjectsPlaceholder() {
  return (
    <div
      className="rounded-[10px] p-5 text-center"
      style={{
        border: '1px dashed hsl(var(--sv-hairline))',
        background: 'hsl(var(--sv-hover) / 0.3)',
      }}
    >
      <FolderKanban className="h-5 w-5 mx-auto mb-2" style={{ color: 'hsl(var(--sv-muted))' }} />
      <p className="text-[13px]" style={{ color: 'hsl(var(--sv-ink))' }}>
        No projects yet
      </p>
      <p className="mt-1 text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
        Promote important threads into Projects to keep working long-term.
      </p>
    </div>
  );
}

// ───────────────── helpers ─────────────────

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
