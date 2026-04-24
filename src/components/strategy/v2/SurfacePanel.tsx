/**
 * SurfacePanel — workspace surface for direct top-level entries.
 *
 * The sidebar exposes flat entries (Brainstorm, Deep Research, Refine,
 * Library, Artifacts, Projects). Clicking one switches the workspace
 * into that surface and shows its actions/templates inline above the canvas.
 *
 *   surface: 'brainstorm'|'deep_research'|'refine' → mode pills
 *   surface: 'library'    → library workflow pills (creation engine)
 *   surface: 'artifacts'  → artifact template tiles
 *   surface: 'projects'   → placeholder (promoted long-term work)
 *
 * All pills/templates launch the same WorkflowFormSheet (Click → Configure → Run).
 *
 * Pure presentation. No backend/engine changes.
 */
import {
  X, Lightbulb, Microscope, Wand2, BookOpen, FileText,
  ClipboardList, ClipboardCheck, Send, Presentation, Mail, FilePlus,
  Layers, MessageSquareQuote, Shapes, ArrowRight, FolderKanban,
} from 'lucide-react';
import {
  MODE_PILLS, LIBRARY_DEFS, ARTIFACT_TEMPLATE_DEFS,
  type WorkflowDef,
} from './workflows/workflowRegistry';
import type { StrategySurfaceKey } from './StrategyNavSidebar';

interface Props {
  surface: StrategySurfaceKey;
  onLaunchWorkflow: (def: WorkflowDef) => void;
  onClose: () => void;
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

export function SurfacePanel({ surface, onLaunchWorkflow, onClose }: Props) {
  const meta = SURFACE_HEADER[surface];
  const HeaderIcon = meta.icon;

  return (
    <div
      className="border-b shrink-0"
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
        <div className="mt-5">
          {(surface === 'brainstorm' || surface === 'deep_research' || surface === 'refine') && (
            <PillGrid items={MODE_PILLS[surface]} onLaunch={onLaunchWorkflow} />
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
          {surface === 'projects' && (
            <ProjectsPlaceholder />
          )}
        </div>

        {/* Quiet footer hint */}
        <p
          className="mt-5 text-[11px] tracking-wide"
          style={{ color: 'hsl(var(--sv-muted) / 0.7)' }}
        >
          Or just type below — the composer is always ready.
        </p>
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
