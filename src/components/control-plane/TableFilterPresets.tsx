/**
 * Table Filter Presets — quick-access saved views above the resource table.
 */
import { useState } from 'react';
import { Wrench, Target, ShieldAlert, Clock, Pin, PinOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ControlPlaneFilter } from '@/lib/controlPlaneState';

interface Preset {
  id: string;
  label: string;
  icon: React.ElementType;
  filter?: ControlPlaneFilter;
  customKey?: string;
  explanation: string;
}

const PRESETS: Preset[] = [
  { id: 'cleanup', label: 'Cleanup', icon: Wrench, filter: 'needs_review', explanation: 'Blocked resources — diagnose and fix the underlying issue.' },
  { id: 'ai-ready', label: 'AI Ready', icon: Target, customKey: 'groundingEligible', explanation: 'Ready for Dave grounding — no action needed.' },
  { id: 'mismatches', label: 'Mismatches', icon: ShieldAlert, filter: 'conflicts', explanation: 'Conflicting lifecycle signals — inspect and re-run.' },
  { id: 'extract', label: 'Needs Extract', icon: Clock, filter: 'needs_extraction', explanation: 'Has content but no knowledge items — run Extract.' },
];

export const PRESET_EXPLANATIONS: Record<string, { why: string; action: string }> = {
  cleanup: { why: 'Resources blocked by missing content, failed extraction, or stale state.', action: 'Diagnose each resource and fix the underlying issue — usually re-enrich or manually review.' },
  'ai-ready': { why: 'Resources with active KIs, contexts, and no blockers — eligible for Dave grounding.', action: 'No action needed — these are ready for downstream AI use.' },
  mismatches: { why: 'Resources where lifecycle signals contradict each other or reconciliation failed.', action: 'Inspect each resource, verify the current state, and re-run the appropriate action.' },
  extract: { why: 'Resources with parseable content but no knowledge items extracted yet.', action: 'Run Extract to mine knowledge items from the available content.' },
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
  const [pinnedId, setPinnedIdLocal] = useState(() => getPinnedPreset());

  const handlePin = (id: string) => {
    const newPin = pinnedId === id ? null : id;
    setPinnedPreset(newPin);
    setPinnedIdLocal(newPin);
    onPinPreset(newPin);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground font-medium mr-1">Views:</span>
        {PRESETS.map(({ id, label, icon: Icon, filter, customKey }) => {
          const isActive = activePresetId === id || (filter ? activeFilter === filter : customFilterLabel?.includes(label.replace('AI Ready', 'Grounding-Ready')));
          const isPinned = pinnedId === id;
          return (
            <div key={id} className="flex items-center gap-0">
              <button
                onClick={() => {
                  if (customKey) onCustomPreset(customKey);
                  else if (filter) onFilterChange(isActive ? 'all' : filter);
                }}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium border transition-colors',
                  isPinned ? 'rounded-l-full' : 'rounded-full',
                  isActive
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/30',
                  isPinned && !isActive && 'border-primary/20',
                )}
              >
                <Icon className="h-2.5 w-2.5" />
                {label}
              </button>
              {/* Explicit pin toggle — only show on active or already-pinned */}
              {(isActive || isPinned) && (
                <button
                  onClick={() => handlePin(id)}
                  title={isPinned ? 'Remove as default view' : 'Set as default view'}
                  className={cn(
                    'flex items-center px-1 py-0.5 border border-l-0 rounded-r-full text-[10px] transition-colors',
                    isPinned
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/30',
                  )}
                >
                  {isPinned ? <PinOff className="h-2.5 w-2.5" /> : <Pin className="h-2.5 w-2.5" />}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* Compact one-line explanation */}
      {activePresetId && PRESETS.find(p => p.id === activePresetId) && (
        <p className="text-[10px] text-muted-foreground px-1 leading-tight">
          {PRESETS.find(p => p.id === activePresetId)!.explanation}
        </p>
      )}
    </div>
  );
}
