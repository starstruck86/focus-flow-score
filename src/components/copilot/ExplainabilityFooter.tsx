/**
 * Copilot Explainability Layer — shows reasoning, confidence, sources
 * Feature-flagged behind ENABLE_SYSTEM_OS
 */

import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { 
  Eye, ChevronDown, ChevronUp, Brain, 
  CheckCircle, XCircle, AlertTriangle
} from 'lucide-react';
import { isSystemOSEnabled } from '@/lib/featureFlags';
import { cn } from '@/lib/utils';
import { useState } from 'react';

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
  if (!data.confidence && !data.mode && !data.topFactors?.length) return null;

  const confColor = (data.confidence ?? 0) >= 80 ? 'text-primary' : (data.confidence ?? 0) >= 55 ? 'text-amber-600' : 'text-destructive';

  return (
    <div className="mt-2 border-t border-border/30 pt-1.5">
      {/* Compact Row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 w-full text-left hover:bg-muted/20 rounded px-1 py-0.5 transition-colors"
      >
        <Eye className="h-3 w-3 text-muted-foreground" />
        {data.mode && (
          <Badge variant="outline" className="text-[8px] h-3.5">{data.mode}</Badge>
        )}
        {data.confidence !== undefined && (
          <span className={cn('text-[10px] font-mono font-medium', confColor)}>
            {data.confidence}% conf
          </span>
        )}
        {data.topFactors && data.topFactors.length > 0 && (
          <span className="text-[10px] text-muted-foreground truncate flex-1">
            — {data.topFactors[0]}
          </span>
        )}
        {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-1.5 space-y-2 px-1">
          {/* Top Factors */}
          {data.topFactors && data.topFactors.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Why this recommendation</p>
              <div className="space-y-0.5">
                {data.topFactors.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px]">
                    <CheckCircle className="h-2.5 w-2.5 text-primary shrink-0" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suppressed Alternatives */}
          {data.suppressedAlternatives && data.suppressedAlternatives.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">What was considered</p>
              <div className="space-y-0.5">
                {data.suppressedAlternatives.map((a, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <XCircle className="h-2.5 w-2.5 shrink-0" />
                    <span>{a}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Changes */}
          {data.recentChanges && data.recentChanges.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">What changed</p>
              <div className="space-y-0.5">
                {data.recentChanges.map((c, i) => (
                  <div key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confidence Drivers */}
          {data.confidenceDrivers && data.confidenceDrivers.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Confidence basis</p>
              {data.confidenceDrivers.map((d, i) => (
                <p key={i} className="text-[10px] text-muted-foreground">{d}</p>
              ))}
            </div>
          )}

          {/* Sources */}
          {(data.sourcesUsed?.length || data.sourcesIgnored?.length) ? (
            <div className="flex gap-3">
              {data.sourcesUsed && data.sourcesUsed.length > 0 && (
                <div>
                  <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Sources used</p>
                  <div className="flex gap-1 flex-wrap">
                    {data.sourcesUsed.map((s, i) => (
                      <Badge key={i} variant="secondary" className="text-[8px] h-3.5">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {data.sourcesIgnored && data.sourcesIgnored.length > 0 && (
                <div>
                  <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Ignored</p>
                  <div className="flex gap-1 flex-wrap">
                    {data.sourcesIgnored.map((s, i) => (
                      <Badge key={i} variant="outline" className="text-[8px] h-3.5 text-muted-foreground">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
