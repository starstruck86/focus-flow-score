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

interface Props {
  activeFilter: ControlPlaneFilter;
  customFilterLabel: string | null;
  onFilterChange: (filter: ControlPlaneFilter) => void;
  onCustomPreset: (key: string) => void;
}

export function TableFilterPresets({ activeFilter, customFilterLabel, onFilterChange, onCustomPreset }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground font-medium mr-1">Quick:</span>
      {PRESETS.map(({ id, label, icon: Icon, filter, customKey }) => {
        const isActive = filter ? activeFilter === filter : customFilterLabel?.includes(label.replace('AI Ready', 'Grounding-Ready'));
        return (
          <button
            key={id}
            onClick={() => {
              if (customKey) onCustomPreset(customKey);
              else if (filter) onFilterChange(isActive ? 'all' : filter);
            }}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
              isActive
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/30',
            )}
          >
            <Icon className="h-2.5 w-2.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
