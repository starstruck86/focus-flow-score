/**
 * SurfacePanel — workspace surface for Modes / Library / Artifacts.
 *
 * The sidebar is navigation only. When the user clicks Modes, Library, or
 * Artifacts in the sidebar, the workspace switches into that surface and
 * shows tiles (for Modes selection) or pills (for actions). This is the
 * ChatGPT "Apps" interaction model: pick a surface, then pick an action.
 *
 *   surface: 'modes'      → mode tiles  → click tile → mode selected → pills
 *   surface: 'library'    → library pills (creation engine)
 *   surface: 'artifacts'  → artifact template tiles
 *
 * All pills/templates launch the same WorkflowFormSheet (Click → Configure → Run).
 *
 * Pure presentation. No backend/engine changes.
 */
import { useState } from 'react';
import {
  X, Lightbulb, Microscope, Wand2, BookOpen, FileText,
  ClipboardList, ClipboardCheck, Send, Presentation, Mail, FilePlus,
  Layers, MessageSquareQuote, Shapes, ChevronLeft, ArrowRight,
} from 'lucide-react';
import {
  MODE_PILLS, LIBRARY_DEFS, ARTIFACT_TEMPLATE_DEFS,
  type WorkflowDef,
} from './workflows/workflowRegistry';
import type { StrategyMode } from './StrategyNavSidebar';

export type StrategySurface = 'modes' | 'library' | 'artifacts' | null;

interface Props {
  surface: Exclude<StrategySurface, null>;
  /** When on 'modes' surface, the currently selected mode (or null = picker view). */
  activeMode: StrategyMode;
  onPickMode: (m: StrategyMode) => void;
  onLaunchWorkflow: (def: WorkflowDef) => void;
  onClose: () => void;
}

const MODE_TILES: {
  id: Exclude<StrategyMode, null>;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'brainstorm',
    label: 'Brainstorm',
    description: 'Generate ideas, angles, hooks, and points of view.',
    icon: Lightbulb,
  },
  {
    id: 'deep_research',
    label: 'Deep Research',
    description: 'Analyze companies, competitors, and markets in depth.',
    icon: Microscope,
  },
  {
    id: 'refine',
    label: 'Refine',
    description: 'Improve, tighten, and elevate existing output.',
    icon: Wand2,
  },
];

const MODE_HEADER: Record<Exclude<StrategyMode, null>, { label: string; icon: React.ComponentType<{ className?: string }>; description: string }> = {
  brainstorm:    { label: 'Brainstorm',    icon: Lightbulb,  description: 'Generate ideas, angles, hooks, and points of view.' },
  deep_research: { label: 'Deep Research', icon: Microscope, description: 'Analyze companies, competitors, and markets in depth.' },
  refine:        { label: 'Refine',        icon: Wand2,      description: 'Improve, tighten, and elevate existing output.' },
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
  surface, activeMode, onPickMode, onLaunchWorkflow, onClose,
}: Props) {
  // Header by surface
  let title = '';
  let subtitle = '';
  let HeaderIcon: React.ComponentType<{ className?: string }> = BookOpen;
  let showBackToModes = false;

  if (surface === 'modes') {
    if (activeMode) {
      const meta = MODE_HEADER[activeMode];
      title = meta.label;
      subtitle = meta.description;
      HeaderIcon = meta.icon;
      showBackToModes = true;
    } else {
      title = 'Modes';
      subtitle = 'Choose how Strategy should think.';
      HeaderIcon = Lightbulb;
    }
  } else if (surface === 'library') {
    title = 'Library';
    subtitle = 'Create from your knowledge.';
    HeaderIcon = BookOpen;
  } else if (surface === 'artifacts') {
    title = 'Artifacts';
    subtitle = 'Reusable document templates.';
    HeaderIcon = FileText;
  }

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
          {showBackToModes ? (
            <button
              onClick={() => onPickMode(null)}
              className="h-7 w-7 rounded-[6px] flex items-center justify-center mt-0.5 sv-hover-bg"
              style={{ color: 'hsl(var(--sv-muted))' }}
              aria-label="Back to modes"
              title="Back to modes"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            <div
              className="h-7 w-7 rounded-[6px] flex items-center justify-center mt-0.5 shrink-0"
              style={{ background: 'hsl(var(--sv-clay) / 0.10)', color: 'hsl(var(--sv-clay))' }}
            >
              <HeaderIcon className="h-4 w-4" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2
              className="text-[18px] leading-tight tracking-tight"
              style={{ fontFamily: 'var(--sv-serif)', color: 'hsl(var(--sv-ink))', fontWeight: 500 }}
            >
              {title}
            </h2>
            <p className="text-[12.5px] mt-0.5" style={{ color: 'hsl(var(--sv-muted))' }}>
              {subtitle}
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

        {/* Body by surface */}
        <div className="mt-5">
          {surface === 'modes' && !activeMode && (
            <ModeTiles onPick={onPickMode} />
          )}
          {surface === 'modes' && activeMode && (
            <PillGrid items={MODE_PILLS[activeMode]} onLaunch={onLaunchWorkflow} />
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

// ───────────────── Modes tiles ─────────────────

function ModeTiles({ onPick }: { onPick: (m: StrategyMode) => void }) {
  return (
    <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-3">
      {MODE_TILES.map((tile) => {
        const Icon = tile.icon;
        return (
          <button
            key={tile.id}
            onClick={() => onPick(tile.id)}
            className="text-left p-3.5 rounded-[10px] transition-colors group"
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
            data-testid={`mode-tile-${tile.id}`}
          >
            <div className="flex items-center gap-2">
              <div
                className="h-7 w-7 rounded-[6px] flex items-center justify-center shrink-0"
                style={{ background: 'hsl(var(--sv-clay) / 0.10)', color: 'hsl(var(--sv-clay))' }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-[14px] font-medium" style={{ color: 'hsl(var(--sv-ink))' }}>
                {tile.label}
              </span>
            </div>
            <p className="mt-2 text-[12px] leading-snug" style={{ color: 'hsl(var(--sv-muted))' }}>
              {tile.description}
            </p>
          </button>
        );
      })}
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
