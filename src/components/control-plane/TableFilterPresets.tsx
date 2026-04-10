/**
 * Table Filter Presets — quick-access saved views above the resource table.
 */
import { Wrench, Target, ShieldAlert, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ControlPlaneFilter } from '@/lib/controlPlaneState';

interface Preset {
  id: string;
  label: string;
  icon: React.ElementType;
  filter?: ControlPlaneFilter;
  customKey?: string;
}

const PRESETS: Preset[] = [
  { id: 'cleanup', label: 'Cleanup', icon: Wrench, filter: 'needs_review' },
  { id: 'ai-ready', label: 'AI Ready', icon: Target, customKey: 'groundingEligible' },
  { id: 'mismatches', label: 'Mismatches', icon: ShieldAlert, filter: 'conflicts' },
  { id: 'extract', label: 'Needs Extract', icon: Clock, filter: 'needs_extraction' },
];

export const PRESET_EXPLANATIONS: Record<string, { why: string; action: string }> = {
  cleanup: {
    why: 'Resources blocked by missing content, failed extraction, or stale state.',
    action: 'Diagnose each resource and fix the underlying issue — usually re-enrich or manually review.',
  },
  'ai-ready': {
    why: 'Resources with active KIs, contexts, and no blockers — eligible for Dave grounding.',
    action: 'No action needed — these are ready for downstream AI use.',
  },
  mismatches: {
    why: 'Resources where lifecycle signals contradict each other or reconciliation failed.',
    action: 'Inspect each resource, verify the current state, and re-run the appropriate action.',
  },
  extract: {
    why: 'Resources with parseable content but no knowledge items extracted yet.',
    action: 'Run Extract to mine knowledge items from the available content.',
  },
};

const PINNED_KEY = 'cp-pinned-preset';

export function getPinnedPreset(): string | null {
  try { return localStorage.getItem(PINNED_KEY); } catch { return null; }
}

export function setPinnedPreset(id: string | null) {
  try {
    if (id) localStorage.setItem(PINNED_KEY, id);
    else localStorage.removeItem(PINNED_KEY);
  } catch {}
}

interface Props {
  activeFilter: ControlPlaneFilter;
  customFilterLabel: string | null;
  activePresetId: string | null;
  onFilterChange: (filter: ControlPlaneFilter) => void;
  onCustomPreset: (key: string) => void;
  onPinPreset: (id: string | null) => void;
}

export function TableFilterPresets({ activeFilter, customFilterLabel, activePresetId, onFilterChange, onCustomPreset, onPinPreset }: Props) {
  const pinnedId = getPinnedPreset();

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground font-medium mr-1">Quick:</span>
        {PRESETS.map(({ id, label, icon: Icon, filter, customKey }) => {
          const isActive = activePresetId === id || (filter ? activeFilter === filter : customFilterLabel?.includes(label.replace('AI Ready', 'Grounding-Ready')));
          const isPinned = pinnedId === id;
          return (
            <button
              key={id}
              onClick={() => {
                if (customKey) onCustomPreset(customKey);
                else if (filter) onFilterChange(isActive ? 'all' : filter);
              }}
              onDoubleClick={() => {
                const newPin = isPinned ? null : id;
                setPinnedPreset(newPin);
                onPinPreset(newPin);
              }}
              title={isPinned ? 'Default view (double-click to unpin)' : 'Double-click to set as default view'}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
                isActive
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/30',
                isPinned && !isActive && 'border-primary/20',
              )}
            >
              <Icon className="h-2.5 w-2.5" />
              {label}
              {isPinned && <span className="text-[8px]">📌</span>}
            </button>
          );
        })}
      </div>
      {activePresetId && PRESET_EXPLANATIONS[activePresetId] && (
        <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-md bg-muted/40 border border-border text-[10px]">
          <span className="text-muted-foreground leading-tight">
            <span className="font-medium text-foreground">Why:</span> {PRESET_EXPLANATIONS[activePresetId].why}{' '}
            <span className="font-medium text-foreground">Action:</span> {PRESET_EXPLANATIONS[activePresetId].action}
          </span>
        </div>
      )}
    </div>
  );
}
