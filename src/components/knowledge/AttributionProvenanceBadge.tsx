/**
 * Compact provenance indicator for KI attribution.
 * Shows how who/framework were determined: llm, framework_library_fill, or framework_library_override.
 * Only renders when provenance data is available.
 */
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Fingerprint } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AttributionProvenance {
  who_source?: string;
  framework_source?: string;
  signal_source?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  llm: 'LLM',
  framework_library_fill: 'Library (fill)',
  framework_library_override: 'Library (override)',
};

const SIGNAL_LABELS: Record<string, string> = {
  resource_title: 'Title',
  resource_description: 'Description',
  source_excerpt: 'Excerpt',
  tactic_summary: 'Summary',
};

function sourceLabel(src: string): string {
  return SOURCE_LABELS[src] || src;
}

function signalLabel(sig: string): string {
  return SIGNAL_LABELS[sig] || sig;
}

export function extractProvenance(activationMetadata: any): AttributionProvenance | null {
  if (!activationMetadata?.attribution) return null;
  const a = activationMetadata.attribution;
  if (!a.who_source && !a.framework_source) return null;
  return a as AttributionProvenance;
}

interface Props {
  activationMetadata: any;
  className?: string;
}

export function AttributionProvenanceBadge({ activationMetadata, className }: Props) {
  const prov = extractProvenance(activationMetadata);
  if (!prov) return null;

  const isAllLlm = prov.who_source === 'llm' && prov.framework_source === 'llm';

  const lines: string[] = [];
  if (prov.who_source) lines.push(`Who: ${sourceLabel(prov.who_source)}`);
  if (prov.framework_source) lines.push(`Framework: ${sourceLabel(prov.framework_source)}`);
  if (prov.signal_source) lines.push(`Signal: ${signalLabel(prov.signal_source)}`);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              'text-[8px] px-1.5 py-0 gap-0.5 cursor-help',
              isAllLlm
                ? 'border-muted-foreground/30 text-muted-foreground'
                : 'border-accent-foreground/30 text-accent-foreground bg-accent/10',
              className,
            )}
          >
            <Fingerprint className="h-2.5 w-2.5" />
            {isAllLlm ? 'LLM' : 'Library'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[10px] max-w-[200px]">
          <p className="font-semibold mb-0.5">Attribution Source</p>
          {lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Inline detail version for expanded views */
export function AttributionProvenanceDetail({ activationMetadata }: { activationMetadata: any }) {
  const prov = extractProvenance(activationMetadata);
  if (!prov) return null;

  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Attribution Provenance</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        {prov.who_source && (
          <span>Who: <span className="text-foreground font-medium">{sourceLabel(prov.who_source)}</span></span>
        )}
        {prov.framework_source && (
          <span>Framework: <span className="text-foreground font-medium">{sourceLabel(prov.framework_source)}</span></span>
        )}
        {prov.signal_source && (
          <span>Signal: <span className="text-foreground font-medium">{signalLabel(prov.signal_source)}</span></span>
        )}
      </div>
    </div>
  );
}
