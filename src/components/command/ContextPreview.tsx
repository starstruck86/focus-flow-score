/**
 * ContextPreview — lightweight inline context display before execution.
 */
import { Building2, DollarSign, Brain, ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  accountName?: string;
  opportunityName?: string;
  templateName?: string;
  useKIs: boolean;
  onToggleKIs: (val: boolean) => void;
  kiCount?: number;
}

export function ContextPreview({ accountName, opportunityName, templateName, useKIs, onToggleKIs, kiCount }: Props) {
  const hasContext = accountName || opportunityName || templateName;
  if (!hasContext) return null;

  return (
    <div className="flex items-center gap-4 px-1 py-2 flex-wrap">
      {accountName && (
        <span className="inline-flex items-center gap-1.5 text-xs text-blue-400">
          <Building2 className="h-3.5 w-3.5" />
          {accountName}
        </span>
      )}
      {opportunityName && (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
          <DollarSign className="h-3.5 w-3.5" />
          {opportunityName}
        </span>
      )}

      {/* KI toggle */}
      <button
        onClick={() => onToggleKIs(!useKIs)}
        className={cn(
          'inline-flex items-center gap-1.5 text-xs transition-colors',
          useKIs ? 'text-amber-400' : 'text-muted-foreground'
        )}
      >
        <Brain className="h-3.5 w-3.5" />
        {useKIs ? (
          <>
            <ToggleRight className="h-4 w-4" />
            KIs active{kiCount ? ` (${kiCount.toLocaleString()})` : ''}
          </>
        ) : (
          <>
            <ToggleLeft className="h-4 w-4" />
            KIs off
          </>
        )}
      </button>
    </div>
  );
}
