/**
 * Horizontal stage navigation for the Deal Execution Command Center.
 */

import { cn } from '@/lib/utils';
import { STAGES } from './stageConfig';

interface Props {
  activeStage: string;
  onStageChange: (id: string) => void;
}

export function DealStageNav({ activeStage, onStageChange }: Props) {
  return (
    <div className="flex gap-0.5 overflow-x-auto pb-1 scrollbar-none">
      {STAGES.map(s => {
        const Icon = s.icon;
        const active = activeStage === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onStageChange(s.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-all shrink-0',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{s.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
