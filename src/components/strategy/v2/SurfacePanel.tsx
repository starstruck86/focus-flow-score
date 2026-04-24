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
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, Lightbulb, Microscope, Wand2, BookOpen, FileText,
  ClipboardList, ClipboardCheck, Send, Presentation, Mail, FilePlus,
  Layers, MessageSquareQuote, Shapes, ArrowRight, FolderKanban,
  Sparkles, Loader2, Briefcase, Search, Trash2, PlayCircle,
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
import { displayThreadTitle, isUntitledTitle, WORKSPACE_SHORT } from '@/lib/strategy/threadNaming';
import { isCleanupThread } from '@/lib/strategy/threadCleanup';
import type { StrategySurfaceKey } from './StrategyNavSidebar';
import type { StrategyThread } from '@/types/strategy';

/** A thread enriched with explainability metadata for display. */
interface AnnotatedThread {
  thread: StrategyThread;
  /** Decisive reason — e.g. "Strong match for Deep Research". */
  reason: string;
  /** Light grouping bucket — e.g. "Structured work". */
  group: string;
  /** Suggested next action — e.g. "expand or refine". */
  nextAction?: string;
  /** Priority weight — higher = surfaces first; first item gets a "Top match" badge. */
  priority?: number;
}

/** Confidence band derived from priority — drives subtle UI emphasis. */
type Confidence = 'high' | 'medium' | 'low';
function confidenceFromPriority(p?: number): Confidence {
  if ((p ?? 0) >= 85) return 'high';
  if ((p ?? 0) >= 60) return 'medium';
  return 'low';
}

/** Per-mode visual identity — drives density, spacing, and emphasis. */
type SurfaceVibe = {
  /** Vertical rhythm for body sections. */
  bodySpacing: string;
  /** Spacing between groups in the recent list. */
  groupSpacing: string;
  /** Spacing between rows. */
  rowSpacing: string;
  /** Row vertical padding. */
  rowPadY: string;
  /** Title font weight (heavier = more editorial). */
  titleWeight: number;
};
const SURFACE_VIBE: Partial<Record<StrategySurfaceKey, SurfaceVibe>> = {
  // Generative — airy, fast, optimistic. Looser spacing, lighter weight.
  brainstorm:    { bodySpacing: 'space-y-6',   groupSpacing: 'space-y-4',   rowSpacing: 'space-y-1.5', rowPadY: 'py-2.5', titleWeight: 400 },
  // Analytical — dense, structured, scannable. Tighter rows, more rigor.
  deep_research: { bodySpacing: 'space-y-4',   groupSpacing: 'space-y-2.5', rowSpacing: 'space-y-0.5', rowPadY: 'py-2',   titleWeight: 500 },
  // Editorial — measured, deliberate, focused on craft.
  refine:        { bodySpacing: 'space-y-5',   groupSpacing: 'space-y-3',   rowSpacing: 'space-y-1',   rowPadY: 'py-2.5', titleWeight: 500 },
};
const DEFAULT_VIBE: SurfaceVibe = { bodySpacing: 'space-y-5', groupSpacing: 'space-y-3', rowSpacing: 'space-y-1', rowPadY: 'py-2', titleWeight: 400 };

/** Short label for a surface key (used by Work origin tags). */
const SURFACE_SHORT_LABEL: Partial<Record<string, string>> = {
  brainstorm: 'Brainstorm',
  deep_research: 'Deep Research',
  refine: 'Refine',
  library: 'Library',
  artifacts: 'Artifacts',
};

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
  /** True when this surface currently owns an active thread — collapses the
   *  launcher into a compact header so the canvas can render below. */
  hasActiveThread?: boolean;
  /** Clear this surface's active thread (back to the empty/launch state). */
  onNewThreadInSurface?: () => void;
}

const SURFACE_HEADER: Record<StrategySurfaceKey, {
  label: string;
  description: string;
  /** Short identity tag — communicates the "feel" of the mode. */
  tag?: string;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  brainstorm:    { label: 'Brainstorm',    icon: Lightbulb,    tag: 'Generative',  description: 'Spin up angles, hooks, and points of view fast — quantity over polish.' },
  deep_research: { label: 'Deep Research', icon: Microscope,   tag: 'Analytical',  description: 'Investigate companies, competitors, and markets with structured rigor.' },
  refine:        { label: 'Refine',        icon: Wand2,        tag: 'Editorial',   description: 'Tighten, sharpen, and elevate something you\'ve already drafted.' },
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

/** Mode-specific forward guidance — subtle nudge for next action. */
const SURFACE_GUIDANCE: Partial<Record<StrategySurfaceKey, string>> = {
  brainstorm:    'Start with an idea or pick a direction above.',
  deep_research: 'Start with a company, competitor, or question.',
  refine:        'Paste something to improve, or pick a draft above.',
  library:       'Pick a workflow above to draw from your knowledge.',
  artifacts:     'Pick a template above to start a structured doc.',
};

export function SurfacePanel({
  surface, onLaunchWorkflow, onClose,
  threads, activeThreadId, onSelectThread,
  pillsVersion, onAddPill, onEditPill,
  runningThreadIds, artifactThreadIds,
  hasActiveThread, onNewThreadInSurface,
}: Props) {
  const meta = SURFACE_HEADER[surface];
  const HeaderIcon = meta.icon;
  const vibe: SurfaceVibe = SURFACE_VIBE[surface] ?? DEFAULT_VIBE;

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

  // ── Relevant fallback (strict, per-surface, with reasons & groups) ──
  // Only show threads that *clearly belong* to this workspace's intent.
  // Each thread carries a `reason` (why it surfaced) and a `group` (light
  // bucket for visual organization). Empty is acceptable.
  const relevantFallbackWork = useMemo<AnnotatedThread[]>(() => {
    if (surface === 'work' || surface === 'projects') return [];
    if (recentThreadsForSurface.length > 0) return [];

    const tags = getAllThreadTags();

    // Universal exclusions — never surface these in mode workspaces.
    // Reuses the same `isCleanupThread` rule so what's hidden from Work's
    // default view is also hidden from per-surface fallbacks.
    const isExcluded = (t: StrategyThread) => isCleanupThread(t);

    // Already-tagged threads belong to their own surface — don't borrow.
    const candidates = threads.filter((t) => !isExcluded(t) && !tags[t.id]);
    const hasArtifact = (t: StrategyThread) => artifactThreadIds?.has(t.id) ?? false;
    const ageDays = (t: StrategyThread) =>
      (Date.now() - new Date(t.updated_at).getTime()) / 86_400_000;

    // Per-surface annotators. Returns null if the thread doesn't qualify;
    // otherwise returns a `{ reason, group, nextAction, priority }` annotation.
    // Reasons are written as decisions ("Strong match for X"), not metadata.
    type Annotation = { reason: string; group: string; nextAction?: string; priority: number };
    type Annotator = (t: StrategyThread) => Annotation | null;
    const annotators: Record<string, Annotator> = {
      brainstorm: (t) => {
        const s = (t.title || '').toLowerCase();
        if (/\b(idea|ideas|brainstorm|angle|angles|hook|hooks|pov|point of view|hypothes)\b/.test(s))
          return { reason: 'Strong match for Brainstorm', group: 'Ideation', nextAction: 'expand into a full POV', priority: 100 };
        if (/\b(messaging|campaign|pitch|positioning|narrative|theme)\b/.test(s))
          return { reason: 'Messaging direction', group: 'Messaging', nextAction: 'sharpen or test angles', priority: 80 };
        if (!hasArtifact(t) && (t.title || '').length > 0 && (t.title || '').length < 50)
          return { reason: 'Ideation-style thread', group: 'Early-stage', nextAction: 'develop further', priority: 50 };
        return null;
      },
      deep_research: (t) => {
        const s = (t.title || '').toLowerCase();
        if (hasArtifact(t) && (t.title || '').length >= 25)
          return { reason: 'Strong match for Deep Research', group: 'Structured work', nextAction: 'expand into a full brief', priority: 100 };
        if (/\b(research|analysis|analyze|brief|deep dive|deep-dive|teardown|profile)\b/.test(s))
          return { reason: 'Long-form analysis', group: 'Structured work', nextAction: 'extend or cite', priority: 90 };
        if (/\b(account|company|competitor|competitive|market|industry|landscape)\b/.test(s))
          return { reason: 'Account / market focus', group: 'Recent analysis', nextAction: 'go deeper', priority: 70 };
        if (/\b(risk|risks|gap|gaps)\b/.test(s))
          return { reason: 'Risk / gap framing', group: 'Recent analysis', nextAction: 'pressure-test', priority: 60 };
        return null;
      },
      refine: (t) => {
        const s = (t.title || '').toLowerCase();
        if (hasArtifact(t) && ageDays(t) < 3)
          return { reason: 'Recently edited draft', group: 'Drafts to polish', nextAction: 'refine for exec audience', priority: 100 };
        if (hasArtifact(t))
          return { reason: 'Draft with artifact', group: 'Drafts to polish', nextAction: 'polish or reuse', priority: 85 };
        if (/\b(refine|rewrite|edit|tighten|polish|improve|sharpen|revise)\b/.test(s))
          return { reason: 'Strong match for Refine', group: 'Edits in progress', nextAction: 'continue editing', priority: 75 };
        if (/\b(draft|email|follow.?up|exec|executive|tone|shorten|condense)\b/.test(s))
          return { reason: 'Needs polishing', group: 'Edits in progress', nextAction: 'tighten tone', priority: 65 };
        return null;
      },
      library: (t) => {
        const s = (t.title || '').toLowerCase();
        if (/\b(framework|methodology|model|playbook)\b/.test(s))
          return { reason: 'Framework work', group: 'Frameworks', nextAction: 'turn into outreach', priority: 90 };
        if (/\b(synthesis|pattern|insight|insights|principle|principles)\b/.test(s))
          return { reason: 'Synthesis / pattern', group: 'Insights', nextAction: 'apply elsewhere', priority: 75 };
        if (/\b(library|knowledge)\b/.test(s))
          return { reason: 'Knowledge work', group: 'Insights', nextAction: 'reuse', priority: 60 };
        return null;
      },
      artifacts: (t) => {
        if (!hasArtifact(t)) return null;
        const s = (t.title || '').toLowerCase();
        if (/\b(template)\b/.test(s))
          return { reason: 'Template work', group: 'Templates', nextAction: 'edit template', priority: 95 };
        if (/\b(discovery prep|deal review|outreach plan|demo plan|follow.?up|prep|plan)\b/.test(s))
          return { reason: 'Strong match for Artifacts', group: 'Generated artifacts', nextAction: 'reuse as template', priority: 85 };
        return { reason: 'Artifact attached', group: 'Generated artifacts', nextAction: 'reuse', priority: 60 };
      },
    };

    const annotate = annotators[surface];
    if (!annotate) return [];

    const annotated: AnnotatedThread[] = [];
    for (const t of candidates) {
      const a = annotate(t);
      if (!a) continue;
      annotated.push({ thread: t, reason: a.reason, group: a.group, nextAction: a.nextAction, priority: a.priority });
    }
    if (annotated.length === 0) return [];

    // Sort: priority desc, then recency. Top result becomes the "Top match".
    return annotated
      .sort((a, b) => {
        const dp = (b.priority ?? 0) - (a.priority ?? 0);
        if (dp !== 0) return dp;
        return new Date(b.thread.updated_at).getTime() - new Date(a.thread.updated_at).getTime();
      })
      .slice(0, 6);
  }, [threads, surface, recentThreadsForSurface.length, artifactThreadIds]);

  // Annotate the user's *own* tagged threads too, so they get the same
  // explainability chips/grouping as fallback threads.
  const annotatedRecentForSurface = useMemo<AnnotatedThread[]>(() => {
    if (recentThreadsForSurface.length === 0) return [];
    const hasArtifact = (t: StrategyThread) => artifactThreadIds?.has(t.id) ?? false;
    const isRunning = (t: StrategyThread) => runningThreadIds?.has(t.id) ?? false;
    return recentThreadsForSurface.map((t, idx) => {
      let reason = 'You ran this here';
      let group = 'Your work';
      let nextAction: string | undefined;
      let priority = 50;
      if (isRunning(t)) {
        reason = 'Running now'; group = 'Active'; nextAction = 'open to follow'; priority = 100;
      } else if (hasArtifact(t)) {
        reason = 'Has artifact'; group = 'With artifact'; nextAction = 'expand into a full brief'; priority = 80;
      }
      // First (most recent) gets a slight bump so it earns the "Top match" badge.
      if (idx === 0) priority += 5;
      return { thread: t, reason, group, nextAction, priority };
    });
  }, [recentThreadsForSurface, artifactThreadIds, runningThreadIds]);

  // ── Work surface: pass ALL threads through; filtering/grouping happens
  // inside WorkCommandCenter so the user can search + chip-filter without
  // losing data. Keeping this hook pure means the command center owns its
  // own UX state (query/filter) without re-running parent memos.
  const workThreads = useMemo(() => {
    if (surface !== 'work') return [];
    return threads;
  }, [surface, threads]);

  // ── Compact mode ──────────────────────────────────────────────
  // When this surface has an active thread, collapse the launcher into
  // a slim breadcrumb-style strip so the chat canvas dominates the view.
  // The user can still tap "+ New" to return to this surface's empty
  // launch state (pills, recents, etc.).
  if (hasActiveThread && surface !== 'work' && surface !== 'projects') {
    return (
      <div
        className="shrink-0 border-b"
        style={{
          background: 'hsl(var(--sv-paper))',
          borderColor: 'hsl(var(--sv-hairline))',
        }}
        data-testid={`surface-panel-${surface}`}
      >
        <div className="mx-auto w-full px-6 py-2 flex items-center gap-2" style={{ maxWidth: 920 }}>
          <div
            className="h-5 w-5 rounded-[4px] flex items-center justify-center shrink-0"
            style={{ background: 'hsl(var(--sv-clay) / 0.10)', color: 'hsl(var(--sv-clay))' }}
          >
            <HeaderIcon className="h-3 w-3" />
          </div>
          <span
            className="text-[12px] tracking-tight"
            style={{ fontFamily: 'var(--sv-serif)', color: 'hsl(var(--sv-ink))', fontWeight: 500 }}
          >
            {meta.label}
          </span>
          {meta.tag && (
            <span
              className="text-[8.5px] uppercase tracking-[0.12em] px-1 py-px rounded"
              style={{
                background: 'hsl(var(--sv-clay) / 0.10)',
                color: 'hsl(var(--sv-clay))',
                fontWeight: 600,
              }}
            >
              {meta.tag}
            </span>
          )}
          <div className="flex-1" />
          {onNewThreadInSurface && (
            <button
              onClick={onNewThreadInSurface}
              className="text-[11.5px] px-2 py-1 rounded-[4px] sv-hover-bg"
              style={{ color: 'hsl(var(--sv-muted))' }}
              data-testid={`surface-new-thread-${surface}`}
              title={`New thread in ${meta.label}`}
            >
              + New
            </button>
          )}
          <button
            onClick={onClose}
            className="h-6 w-6 rounded-[4px] flex items-center justify-center sv-hover-bg shrink-0"
            style={{ color: 'hsl(var(--sv-muted))' }}
            aria-label="Close panel"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

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
            <div className="flex items-center gap-2 flex-wrap">
              <h2
                className="text-[18px] leading-tight tracking-tight"
                style={{ fontFamily: 'var(--sv-serif)', color: 'hsl(var(--sv-ink))', fontWeight: 500 }}
              >
                {meta.label}
              </h2>
              {meta.tag && (
                <span
                  className="text-[9.5px] uppercase tracking-[0.12em] px-1.5 py-px rounded"
                  style={{
                    background: 'hsl(var(--sv-clay) / 0.10)',
                    color: 'hsl(var(--sv-clay))',
                    fontWeight: 600,
                  }}
                  data-testid={`surface-tag-${surface}`}
                >
                  {meta.tag}
                </span>
              )}
            </div>
            <p className="text-[12.5px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
              {meta.description}
            </p>
            {SURFACE_GUIDANCE[surface] && (
              <p
                className="text-[11.5px] mt-1.5 italic"
                style={{ color: 'hsl(var(--sv-clay) / 0.85)' }}
                data-testid={`surface-guidance-${surface}`}
              >
                {SURFACE_GUIDANCE[surface]}
              </p>
            )}
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

        {/* Body — spacing rhythm comes from per-surface vibe */}
        <div className={`mt-5 ${vibe.bodySpacing}`}>
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

          {/* Custom pills (per surface) — execution only.
              Creation/editing lives exclusively in /strategy/settings. */}
          {surface !== 'projects' && surface !== 'work' && customPills.length > 0 && (
            <CustomPillsRow
              pills={customPills}
              onLaunch={(p) => onLaunchWorkflow(customPillToWorkflowDef(p))}
            />
          )}

          {/* Quiet pointer to where pills are created/managed */}
          {surface !== 'projects' && surface !== 'work' && (
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'hsl(var(--sv-muted) / 0.85)' }}>
              <Sparkles className="h-3 w-3" style={{ color: 'hsl(var(--sv-clay) / 0.7)' }} />
              <span>
                {customPills.length === 0 ? 'No custom pills yet. ' : ''}
                <Link
                  to="/strategy/settings"
                  className="underline-offset-2 hover:underline"
                  style={{ color: 'hsl(var(--sv-clay))' }}
                  data-testid="manage-pills-link"
                >
                  Manage pills in Strategy Settings →
                </Link>
              </span>
            </div>
          )}
          {surface === 'work' && (
            <WorkCommandCenter
              threads={workThreads}
              activeThreadId={activeThreadId}
              onSelect={onSelectThread}
              runningThreadIds={runningThreadIds}
              artifactThreadIds={artifactThreadIds}
            />
          )}

          {/* Jump Back In — last threads from this workspace only */}
          {surface !== 'work' && surface !== 'projects' && (
            <RecentInSurface
              label={meta.label}
              ownThreads={annotatedRecentForSurface}
              surface={surface}
              activeThreadId={activeThreadId}
              onSelect={onSelectThread}
              runningThreadIds={runningThreadIds}
              artifactThreadIds={artifactThreadIds}
              vibe={vibe}
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

// ───────────────── Custom pills row (execution only) ─────────────────
//
// Workspaces render existing custom pills as run-only chips, visually
// consistent with built-in pills. All creation, editing, duplication, and
// deletion happen in /strategy/settings — never inside a workspace.

function CustomPillsRow({
  pills, onLaunch,
}: {
  pills: CustomPill[];
  onLaunch: (p: CustomPill) => void;
}) {
  if (pills.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {pills.map((p) => (
        <button
          key={p.id}
          onClick={() => onLaunch(p)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] transition-colors"
          style={{
            border: '1px solid hsl(var(--sv-clay) / 0.35)',
            background: 'hsl(var(--sv-clay) / 0.05)',
            color: 'hsl(var(--sv-ink))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'hsl(var(--sv-clay) / 0.10)';
            e.currentTarget.style.borderColor = 'hsl(var(--sv-clay) / 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'hsl(var(--sv-clay) / 0.05)';
            e.currentTarget.style.borderColor = 'hsl(var(--sv-clay) / 0.35)';
          }}
          title={p.description || p.instruction || 'Run this pill'}
          data-testid={`custom-pill-${p.id}`}
        >
          <Sparkles className="h-3 w-3" style={{ color: 'hsl(var(--sv-clay))' }} />
          <span className="truncate max-w-[180px]">{p.name}</span>
        </button>
      ))}
    </div>
  );
}

// ───────────────── Recent in surface ─────────────────

function RecentInSurface({
  label, surface, ownThreads, activeThreadId, onSelect,
  runningThreadIds, artifactThreadIds, vibe,
}: {
  label: string;
  surface: StrategySurfaceKey;
  ownThreads: AnnotatedThread[];
  /** @deprecated kept for call-site compatibility; intentionally ignored. */
  fallbackThreads?: AnnotatedThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;
  vibe: SurfaceVibe;
  /** @deprecated unused — launcher no longer auto-launches anything. */
  onLaunchWorkflow?: (def: WorkflowDef) => void;
}) {
  const [query, setQuery] = useState('');

  // "Jump Back In" — show ONLY this workspace's own threads. No fallback to
  // unrelated work threads. The user picks explicitly; we never auto-open.
  const own = ownThreads;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return own;
    return own.filter((a) => {
      const title = displayThreadTitle(a.thread).toLowerCase();
      return title.includes(q);
    });
  }, [own, query]);

  const visible = query.trim() ? filtered : filtered.slice(0, 3);
  const showSearch = own.length > 3;

  const emptyCta = (() => {
    switch (surface) {
      case 'brainstorm':    return 'Nothing here yet. Tap a pill above or just type below to start.';
      case 'deep_research': return 'Nothing here yet. Tap a pill above or just type below to start.';
      case 'refine':        return 'Nothing here yet. Tap a pill above or paste a draft below.';
      case 'library':       return 'Nothing here yet. Run a workflow above to create from your knowledge.';
      case 'artifacts':     return 'Nothing here yet. Pick a template above to draft a structured artifact.';
      default:              return `Nothing here yet. Tap a pill above to start your first ${label} thread.`;
    }
  })();

  if (own.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <span
            className="text-[10.5px] font-semibold uppercase tracking-[0.11em]"
            style={{ color: 'hsl(var(--sv-ink) / 0.7)' }}
          >
            Jump Back In
          </span>
        </div>
        <div
          className="rounded-[8px] px-3 py-2.5 text-[12px]"
          style={{
            border: '1px solid hsl(var(--sv-hairline))',
            background: 'hsl(var(--sv-paper))',
            color: 'hsl(var(--sv-muted))',
          }}
          data-testid={`jump-back-empty-${surface}`}
        >
          {emptyCta}
        </div>
      </div>
    );
  }

  return (
    <div className={vibe.groupSpacing}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[10.5px] font-semibold uppercase tracking-[0.11em]"
          style={{ color: 'hsl(var(--sv-ink) / 0.7)' }}
        >
          Jump Back In
        </span>
        <div className="flex-1 h-px" style={{ background: 'hsl(var(--sv-hairline))' }} />
        <span
          className="text-[10px] tabular-nums"
          style={{ color: 'hsl(var(--sv-muted) / 0.7)' }}
        >
          {own.length}
        </span>
      </div>

      {showSearch && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${label} threads…`}
          className="w-full h-8 px-2.5 rounded-[6px] text-[12.5px] mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            border: '1px solid hsl(var(--sv-hairline))',
            background: 'hsl(var(--sv-paper))',
            color: 'hsl(var(--sv-ink))',
          }}
          data-testid={`jump-back-search-${surface}`}
        />
      )}

      <div data-testid={`jump-back-${surface}`}>
        <ThreadRows
          items={visible}
          activeThreadId={activeThreadId}
          onSelect={onSelect}
          runningThreadIds={runningThreadIds}
          artifactThreadIds={artifactThreadIds}
          vibe={vibe}
        />
      </div>

      {showSearch && query.trim() && filtered.length === 0 && (
        <p className="text-[11.5px] mt-2" style={{ color: 'hsl(var(--sv-muted))' }}>
          No matches in {label}.
        </p>
      )}
    </div>
  );
}


// ───────────────── Top Match card (elevated) ─────────────────

function TopMatchCard({
  item, label, activeThreadId, onSelect, runningThreadIds, artifactThreadIds,
  primaryDef, onLaunchWorkflow,
}: {
  item: AnnotatedThread;
  label: string;
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;
  primaryDef: WorkflowDef | null;
  onLaunchWorkflow: (def: WorkflowDef) => void;
}) {
  const t = item.thread;
  const isActive = activeThreadId === t.id;
  const isRunning = runningThreadIds?.has(t.id) ?? false;
  const hasArtifact = artifactThreadIds?.has(t.id) ?? false;
  const conf = confidenceFromPriority(item.priority);

  // Action verb — capitalize first letter of nextAction for the button label.
  const actionLabel = item.nextAction
    ? item.nextAction.charAt(0).toUpperCase() + item.nextAction.slice(1)
    : null;

  return (
    <div data-testid={`top-match-card-${t.id}`}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-px rounded"
          style={{
            background: 'hsl(var(--sv-clay))',
            color: 'hsl(var(--sv-paper))',
            fontWeight: 700,
          }}
        >
          Top match for {label}
        </span>
        {conf === 'high' && (
          <span
            className="text-[9.5px] uppercase tracking-[0.1em]"
            style={{ color: 'hsl(var(--sv-clay) / 0.85)', fontWeight: 600 }}
          >
            · high confidence
          </span>
        )}
        <div className="flex-1 h-px" style={{ background: 'hsl(var(--sv-hairline))' }} />
      </div>

      <div
        className="rounded-[10px] p-3.5 flex flex-col gap-2"
        style={{
          background: 'hsl(var(--sv-clay) / 0.06)',
          border: '1px solid hsl(var(--sv-clay) / 0.30)',
        }}
      >
        <button
          onClick={() => onSelect(t.id)}
          className="text-left flex items-center gap-2 w-full"
          title={displayThreadTitle(t)}
          data-testid={`top-match-open-${t.id}`}
        >
          <span
            className="flex-1 min-w-0 truncate text-[14px]"
            style={{ color: 'hsl(var(--sv-ink))', fontWeight: 600 }}
          >
            {displayThreadTitle(t)}
          </span>
          {isRunning && (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: 'hsl(var(--sv-clay))' }} aria-label="Running" />
          )}
          {hasArtifact && !isRunning && (
            <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: 'hsl(var(--sv-clay) / 0.8)' }} aria-label="Has artifact" />
          )}
          <span className="text-[10.5px] shrink-0 tabular-nums" style={{ color: 'hsl(var(--sv-muted))' }}>
            {relativeTime(t.updated_at)}
          </span>
        </button>

        <div className="text-[11.5px]" style={{ color: 'hsl(var(--sv-ink) / 0.7)', fontWeight: 500 }}>
          {item.reason}
        </div>

        {(actionLabel && primaryDef) || !isActive ? (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {actionLabel && primaryDef && (
              <button
                onClick={() => onLaunchWorkflow(primaryDef)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[12px] transition-colors"
                style={{
                  background: 'hsl(var(--sv-clay))',
                  color: 'hsl(var(--sv-paper))',
                  fontWeight: 600,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-clay) / 0.88)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-clay))'; }}
                data-testid={`top-match-action-${t.id}`}
              >
                <Sparkles className="h-3 w-3" />
                <span>{actionLabel}</span>
              </button>
            )}
            <button
              onClick={() => onSelect(t.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[6px] text-[11.5px] transition-colors"
              style={{
                background: 'transparent',
                color: 'hsl(var(--sv-ink) / 0.75)',
                border: '1px solid hsl(var(--sv-hairline))',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              data-testid={`top-match-open-btn-${t.id}`}
            >
              Open thread
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
// ───────────────── Work thread list ─────────────────

// ───────────────── Work command center ─────────────────
//
// Work is the operating-system view for ALL threads — search, filter, group.
// Default layout: Continue (pinned) → Artifact Ready (pinned) → Recent (flat).
// Test/debug/regression/benchmark/scratch threads are HIDDEN by default and
// only surface when the "Needs Cleanup" chip is active.

type WorkFilterKey =
  | 'all' | 'continue' | 'artifact_ready' | 'cleanup'
  | 'brainstorm' | 'deep_research' | 'refine'
  | 'library' | 'artifacts' | 'projects';

const WORK_FILTERS: Array<{ key: WorkFilterKey; label: string }> = [
  { key: 'all',            label: 'All' },
  { key: 'continue',       label: 'Continue' },
  { key: 'artifact_ready', label: 'Artifact Ready' },
  { key: 'brainstorm',     label: 'Brainstorm' },
  { key: 'deep_research',  label: 'Deep Research' },
  { key: 'refine',         label: 'Refine' },
  { key: 'library',        label: 'Library' },
  { key: 'artifacts',      label: 'Artifacts' },
  { key: 'projects',       label: 'Projects' },
  { key: 'cleanup',        label: 'Needs Cleanup' },
];

/** Heuristic: a thread looks like junk (test/debug/regression/benchmark/scratch). */
function WorkCommandCenter({
  threads, activeThreadId, onSelect, runningThreadIds, artifactThreadIds,
}: {
  threads: StrategyThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<WorkFilterKey>('all');

  const tags = useMemo(() => getAllThreadTags(), [threads]);

  // Annotate every thread with its origin label + display title — these are
  // the fields we search against and render in rows.
  const annotated = useMemo(() => {
    return threads.map((t) => {
      const tag = tags[t.id] ?? null;
      const origin = tag ? SURFACE_SHORT_LABEL[tag] : null;
      const cleanup = isCleanupThread(t);
      const title = displayThreadTitle(t);
      const hasArtifact = artifactThreadIds?.has(t.id) ?? false;
      const isRunning = runningThreadIds?.has(t.id) ?? false;
      return {
        thread: t,
        tag,
        origin,
        title,
        cleanup,
        hasArtifact,
        isRunning,
      };
    });
  }, [threads, tags, artifactThreadIds, runningThreadIds]);

  // Cleanup chip shows ONLY junk; every other view hides junk by default.
  const visible = useMemo(() => {
    if (filter === 'cleanup') return annotated.filter((a) => a.cleanup);
    return annotated.filter((a) => !a.cleanup);
  }, [annotated, filter]);

  // Search across display title + workspace label + artifact status.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((a) => {
      if (a.title.toLowerCase().includes(q)) return true;
      if (a.origin?.toLowerCase().includes(q)) return true;
      if (a.hasArtifact && 'artifact'.includes(q)) return true;
      if (a.isRunning && 'running'.includes(q)) return true;
      return false;
    });
  }, [visible, query]);

  // Apply chip filters.
  const filtered = useMemo(() => {
    switch (filter) {
      case 'all':
      case 'cleanup':
        return searched;
      case 'continue':
        return searched.filter((a) => !a.hasArtifact);
      case 'artifact_ready':
        return searched.filter((a) => a.hasArtifact);
      case 'brainstorm':
      case 'deep_research':
      case 'refine':
      case 'library':
      case 'artifacts':
      case 'projects':
        return searched.filter((a) => a.tag === filter);
      default:
        return searched;
    }
  }, [searched, filter]);

  // Smart grouping (default = 'all'): pinned Continue + Artifact Ready, then
  // a flat "Recent" list. For specific chip filters we render a single flat
  // list — the chip itself is the group label.
  const continueItems = useMemo(() => {
    if (filter !== 'all') return [];
    // Continue = active + running + recent non-artifact threads worth returning to.
    return filtered
      .filter((a) => !a.hasArtifact)
      .sort((a, b) => {
        // active first, then running, then recency.
        const aScore = (a.thread.id === activeThreadId ? 0 : a.isRunning ? 1 : 2);
        const bScore = (b.thread.id === activeThreadId ? 0 : b.isRunning ? 1 : 2);
        if (aScore !== bScore) return aScore - bScore;
        return new Date(b.thread.updated_at).getTime() - new Date(a.thread.updated_at).getTime();
      })
      .slice(0, 5);
  }, [filtered, filter, activeThreadId]);

  const artifactItems = useMemo(() => {
    if (filter !== 'all') return [];
    return filtered
      .filter((a) => a.hasArtifact)
      .sort((a, b) => new Date(b.thread.updated_at).getTime() - new Date(a.thread.updated_at).getTime())
      .slice(0, 5);
  }, [filtered, filter]);

  const restItems = useMemo(() => {
    if (filter !== 'all') {
      return [...filtered].sort(
        (a, b) => new Date(b.thread.updated_at).getTime() - new Date(a.thread.updated_at).getTime(),
      );
    }
    const pinnedIds = new Set([
      ...continueItems.map((a) => a.thread.id),
      ...artifactItems.map((a) => a.thread.id),
    ]);
    return filtered
      .filter((a) => !pinnedIds.has(a.thread.id))
      .sort((a, b) => new Date(b.thread.updated_at).getTime() - new Date(a.thread.updated_at).getTime());
  }, [filtered, filter, continueItems, artifactItems]);

  const toRows = (
    items: typeof annotated,
  ): AnnotatedThread[] =>
    items.map((a) => ({
      thread: a.thread,
      reason: a.origin ? `From ${a.origin}` : 'Freeform',
      group: a.origin ?? 'Freeform',
    }));

  const totalCount = filtered.length;
  const hasAny = annotated.length > 0;

  return (
    <div className="space-y-4">
      {/* Search + filter chips */}
      <div className="space-y-2">
        <div
          className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5"
          style={{
            border: '1px solid hsl(var(--sv-hairline))',
            background: 'hsl(var(--sv-paper))',
          }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'hsl(var(--sv-muted))' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads, workspaces, or artifacts…"
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-foreground/50"
            style={{ color: 'hsl(var(--sv-ink))' }}
            data-testid="work-search"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{ color: 'hsl(var(--sv-muted))' }}
              aria-label="Clear search"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5" data-testid="work-filters">
          {WORK_FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="text-[11.5px] px-2.5 py-1 rounded-full transition-colors whitespace-nowrap"
                style={{
                  border: '1px solid ' + (active ? 'hsl(var(--sv-clay) / 0.35)' : 'hsl(var(--sv-hairline))'),
                  background: active ? 'hsl(var(--sv-clay) / 0.10)' : 'hsl(var(--sv-paper))',
                  color: active ? 'hsl(var(--sv-clay))' : 'hsl(var(--sv-ink) / 0.75)',
                  fontWeight: active ? 600 : 500,
                }}
                data-testid={`work-filter-${f.key}`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty states */}
      {!hasAny && (
        <WorkEmptyState
          icon={Briefcase}
          title="No work yet"
          body="Start typing below — your threads will show up here."
        />
      )}

      {hasAny && totalCount === 0 && (
        <WorkEmptyState
          icon={query ? Search : filter === 'cleanup' ? Trash2 : Briefcase}
          title={
            query
              ? `No matches for "${query}"`
              : filter === 'cleanup'
                ? 'Nothing to clean up'
                : `Nothing in ${WORK_FILTERS.find((f) => f.key === filter)?.label}`
          }
          body={
            query
              ? 'Try a different keyword, or clear the search.'
              : filter === 'cleanup'
                ? 'Your workspace is tidy. Test, debug, and untitled threads land here.'
                : 'Switch filters above, or jump into a workspace from the sidebar.'
          }
        />
      )}

      {/* Smart default layout */}
      {filter === 'all' && totalCount > 0 && (
        <>
          {continueItems.length > 0 && (
            <WorkGroup
              icon={PlayCircle}
              label="Continue"
              hint="Active and recent threads worth returning to"
              count={continueItems.length}
            >
              <ThreadRows
                items={toRows(continueItems)}
                activeThreadId={activeThreadId}
                onSelect={onSelect}
                runningThreadIds={runningThreadIds}
                artifactThreadIds={artifactThreadIds}
                showOriginTag
              />
            </WorkGroup>
          )}
          {artifactItems.length > 0 && (
            <WorkGroup
              icon={FileText}
              label="Artifact Ready"
              hint="Threads with generated artifacts"
              count={artifactItems.length}
            >
              <ThreadRows
                items={toRows(artifactItems)}
                activeThreadId={activeThreadId}
                onSelect={onSelect}
                runningThreadIds={runningThreadIds}
                artifactThreadIds={artifactThreadIds}
                showOriginTag
              />
            </WorkGroup>
          )}
          {restItems.length > 0 && (
            <WorkGroup
              icon={Briefcase}
              label="Recent"
              hint="Everything else, by last update"
              count={restItems.length}
            >
              <ThreadRows
                items={toRows(restItems)}
                activeThreadId={activeThreadId}
                onSelect={onSelect}
                runningThreadIds={runningThreadIds}
                artifactThreadIds={artifactThreadIds}
                showOriginTag
              />
            </WorkGroup>
          )}
        </>
      )}

      {/* Filter-narrowed flat list */}
      {filter !== 'all' && totalCount > 0 && (
        <ThreadRows
          items={toRows(restItems)}
          activeThreadId={activeThreadId}
          onSelect={onSelect}
          runningThreadIds={runningThreadIds}
          artifactThreadIds={artifactThreadIds}
          showOriginTag
        />
      )}
    </div>
  );
}

function WorkGroup({
  icon: Icon, label, hint, count, children,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  hint?: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2" data-testid={`work-group-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <header className="flex items-center gap-2 px-1">
        <Icon className="h-3.5 w-3.5" style={{ color: 'hsl(var(--sv-clay) / 0.85)' }} />
        <span
          className="text-[12px] tracking-tight"
          style={{ color: 'hsl(var(--sv-ink))', fontWeight: 600 }}
        >
          {label}
        </span>
        <span
          className="text-[10.5px] px-1.5 py-px rounded tabular-nums"
          style={{ background: 'hsl(var(--sv-hover) / 0.6)', color: 'hsl(var(--sv-muted))' }}
        >
          {count}
        </span>
        {hint && (
          <span className="text-[11px] truncate" style={{ color: 'hsl(var(--sv-muted))' }}>
            · {hint}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function WorkEmptyState({
  icon: Icon, title, body,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  body: string;
}) {
  return (
    <div
      className="rounded-[10px] p-5 text-center"
      style={{
        border: '1px dashed hsl(var(--sv-hairline))',
        background: 'hsl(var(--sv-hover) / 0.3)',
      }}
      data-testid="work-empty-state"
    >
      <Icon className="h-5 w-5 mx-auto mb-2" style={{ color: 'hsl(var(--sv-muted))' }} />
      <p className="text-[13px]" style={{ color: 'hsl(var(--sv-ink))' }}>
        {title}
      </p>
      <p className="mt-1 text-[11.5px]" style={{ color: 'hsl(var(--sv-muted))' }}>
        {body}
      </p>
    </div>
  );
}

function ThreadRows({
  items, activeThreadId, onSelect, runningThreadIds, artifactThreadIds,
  showReason, showOriginTag, showNextAction, showConfidence, topMatchId, topMatchLabel, vibe,
}: {
  items: AnnotatedThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  runningThreadIds?: Set<string>;
  artifactThreadIds?: Set<string>;
  /** Show the "why this surfaced" reason chip below the title. */
  showReason?: boolean;
  /** Show the originating mode tag (e.g. "→ Deep Research") inline. */
  showOriginTag?: boolean;
  /** Show the suggested next action after the reason. */
  showNextAction?: boolean;
  /** Apply subtle opacity to medium/low-confidence rows. */
  showConfidence?: boolean;
  /** ID of the thread that should display the "Top match" badge. */
  topMatchId?: string | null;
  /** Workspace label used in the top-match badge — e.g. "Deep Research". */
  topMatchLabel?: string;
  /** Surface vibe — drives row density. */
  vibe?: SurfaceVibe;
}) {
  const v = vibe ?? DEFAULT_VIBE;
  return (
    <ul className={v.rowSpacing}>
      {items.map(({ thread: t, reason, group, nextAction, priority }) => {
        const isActive = activeThreadId === t.id;
        const isRunning = runningThreadIds?.has(t.id) ?? false;
        const hasArtifact = artifactThreadIds?.has(t.id) ?? false;
        const isUntitled = isUntitledTitle(t.title);
        const isTopMatch = !!topMatchId && topMatchId === t.id;
        const conf = confidenceFromPriority(priority);
        // Subtle opacity step for confidence — high=1, medium=0.92, low=0.78
        const confOpacity = showConfidence
          ? (conf === 'high' ? 1 : conf === 'medium' ? 0.92 : 0.78)
          : 1;
        // Origin tag: only show when group looks like a real surface label
        // and not the default "Freeform"/"Your work" buckets.
        const originTag = showOriginTag && group !== 'Freeform' ? group : null;
        const displayTitle = displayThreadTitle(t);
        return (
          <li key={t.id}>
            <button
              onClick={() => onSelect(t.id)}
              className={`w-full text-left px-3 ${v.rowPadY} rounded-[8px] flex flex-col gap-0.5 transition-colors`}
              style={{
                background: isActive ? 'hsl(var(--sv-clay) / 0.08)' : (isTopMatch ? 'hsl(var(--sv-clay) / 0.03)' : 'transparent'),
                border: '1px solid ' + (isActive ? 'hsl(var(--sv-clay) / 0.30)' : (isTopMatch ? 'hsl(var(--sv-clay) / 0.22)' : 'hsl(var(--sv-hairline))')),
                color: 'hsl(var(--sv-ink))',
                opacity: (isUntitled && !isActive && !isRunning && !hasArtifact ? 0.7 : 1) * confOpacity,
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'hsl(var(--sv-hover) / 0.6)'; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = isTopMatch ? 'hsl(var(--sv-clay) / 0.03)' : 'transparent'; }}
              title={reason ? `${displayTitle} — ${reason}` : displayTitle}
              data-testid={`surface-thread-${t.id}`}
            >
              <div className="flex items-center gap-2 w-full">
                <span
                  className="flex-1 min-w-0 truncate text-[13px]"
                  style={{ fontWeight: isActive ? 600 : v.titleWeight }}
                >
                  {displayTitle}
                </span>
                {isTopMatch && (
                  <span
                    className="text-[9.5px] uppercase tracking-[0.1em] shrink-0 px-1.5 py-px rounded"
                    style={{
                      background: 'hsl(var(--sv-clay))',
                      color: 'hsl(var(--sv-paper))',
                      fontWeight: 600,
                    }}
                    data-testid={`top-match-${t.id}`}
                  >
                    {topMatchLabel ? `Top match for ${topMatchLabel}` : 'Top match'}
                  </span>
                )}
                {originTag && (
                  <span
                    className="text-[10px] shrink-0 px-1.5 py-px rounded inline-flex items-center gap-0.5"
                    style={{
                      background: 'hsl(var(--sv-clay) / 0.08)',
                      color: 'hsl(var(--sv-clay))',
                      fontWeight: 500,
                    }}
                    data-testid={`origin-tag-${t.id}`}
                  >
                    <ArrowRight className="h-2.5 w-2.5" />
                    {originTag}
                  </span>
                )}
                {isRunning && (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" style={{ color: 'hsl(var(--sv-clay))' }} aria-label="Running" />
                )}
                {hasArtifact && !isRunning && (
                  <FileText className="h-3 w-3 shrink-0" style={{ color: 'hsl(var(--sv-clay) / 0.7)' }} aria-label="Has artifact" />
                )}
                <span className="text-[10.5px] shrink-0 tabular-nums" style={{ color: 'hsl(var(--sv-muted))' }}>
                  {relativeTime(t.updated_at)}
                </span>
              </div>
              {showReason && reason && (
                <div
                  className="pl-px flex flex-col gap-0.5"
                  data-testid={`reason-${t.id}`}
                >
                  {/* Line 1: the decision / reason. */}
                  <span
                    className="text-[10.5px]"
                    style={{ color: 'hsl(var(--sv-ink) / 0.65)', fontWeight: 500 }}
                  >
                    {reason}
                  </span>
                  {/* Line 2: the suggested next move. */}
                  {showNextAction && nextAction && (
                    <span
                      className="text-[10.5px]"
                      style={{ color: 'hsl(var(--sv-clay) / 0.9)' }}
                      data-testid={`next-action-${t.id}`}
                    >
                      Next: {nextAction}
                    </span>
                  )}
                </div>
              )}
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
