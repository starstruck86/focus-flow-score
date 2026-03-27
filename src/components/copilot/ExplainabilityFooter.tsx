/**
 * Copilot Explainability Layer — shows reasoning, confidence, sources
 * Feature-flagged behind ENABLE_SYSTEM_OS
 *
 * TUNED: Compact by default, only surfaces meaningful signals.
 * Hides empty sections. Truncates verbose lists. Prioritises "why" over metadata.
 */

import { memo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { 
  Eye, ChevronDown, ChevronUp,
  CheckCircle, XCircle, AlertTriangle
} from 'lucide-react';
import { isSystemOSEnabled } from '@/lib/featureFlags';
import { cn } from '@/lib/utils';

export interface ExplainabilityData {
  mode?: string;
  confidence?: number;
  topFactors?: string[];
  suppressedAlternatives?: string[];
  recentChanges?: string[];
  confidenceDrivers?: string[];
  sourcesUsed?: string[];
  sourcesIgnored?: string[];
}

interface ExplainabilityFooterProps {
  data: ExplainabilityData;
}

export const ExplainabilityFooter = memo(function ExplainabilityFooter({ data }: ExplainabilityFooterProps) {
  const [expanded, setExpanded] = useState(false);

  if (!isSystemOSEnabled()) return null;
  // Gate: only show if there's something meaningful
  if (!data.topFactors?.length && data.confidence === undefined) return null;

  const conf = data.confidence ?? 0;
  const confColor = conf >= 75 ? 'text-primary' : conf >= 55 ? 'text-amber-600' : 'text-destructive';

  // Derive the single most important "why" for the compact row
  const primaryFactor = data.topFactors?.[0];

  return (
    <div className="mt-2 border-t border-border/30 pt-1.5">
      {/* Compact Row — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 w-full text-left hover:bg-muted/20 rounded px-1 py-0.5 transition-colors"
      >
        <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
        {data.confidence !== undefined && (
          <span className={cn('text-[10px] font-mono font-medium', confColor)}>
            {conf}%
          </span>
        )}
        {primaryFactor && (
          <span className="text-[10px] text-muted-foreground truncate flex-1">
            {primaryFactor}
          </span>
        )}
        {(data.recentChanges?.length ?? 0) > 0 && (
          <AlertTriangle className="h-2.5 w-2.5 text-amber-500 shrink-0" />
        )}
        {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
      </button>

      {/* Expanded — only meaningful sections */}
      {expanded && (
        <div className="mt-1.5 space-y-2 px-1">
          {/* Why — limit to 3 */}
          {data.topFactors && data.topFactors.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Why</p>
              <div className="space-y-0.5">
                {data.topFactors.slice(0, 3).map((f, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px]">
                    <CheckCircle className="h-2.5 w-2.5 text-primary shrink-0" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What changed — only if present */}
          {data.recentChanges && data.recentChanges.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Changed</p>
              <div className="space-y-0.5">
                {data.recentChanges.slice(0, 2).map((c, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alternatives — only if present, limit to 2 */}
          {data.suppressedAlternatives && data.suppressedAlternatives.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Considered</p>
              <div className="space-y-0.5">
                {data.suppressedAlternatives.slice(0, 2).map((a, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <XCircle className="h-2.5 w-2.5 shrink-0" />
                    <span>{a}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sources — compact inline, only if >1 source */}
          {data.sourcesUsed && data.sourcesUsed.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[9px] text-muted-foreground">Sources:</span>
              {data.sourcesUsed.map((s, i) => (
                <Badge key={i} variant="secondary" className="text-[8px] h-3.5">{s.replace(/_/g, ' ')}</Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
