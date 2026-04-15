/**
 * PreRunContext — compact pre-run trust strip showing exactly what will be used.
 * Shows template, account, opportunity, KI toggle with explainability detail.
 */
import { Building2, DollarSign, FileText, Brain, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import type { CommandToken } from '@/lib/commandTypes';
import type { KIExplainability } from '@/lib/contextAwareKIRetrieval';

interface Props {
  tokens: CommandToken[];
  useKIs: boolean;
  onToggleKIs: (val: boolean) => void;
  kiCount: number;
  lastKIExplainability?: KIExplainability | null;
}

export function PreRunContext({ tokens, useKIs, onToggleKIs, kiCount, lastKIExplainability }: Props) {
  const [showKIDetail, setShowKIDetail] = useState(false);

  const template = tokens.find(t => t.type === 'template');
  const account = tokens.find(t => t.type === 'account');
  const opportunity = tokens.find(t => t.type === 'opportunity');

  const hasAnything = template || account || opportunity || kiCount > 0;
  if (!hasAnything) return null;

  const ex = lastKIExplainability;

  return (
    <div className="mt-2 px-1 space-y-1.5">
      {/* Context strip */}
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        {template && (
          <span className="inline-flex items-center gap-1 text-amber-400/80 font-medium">
            <FileText className="h-3 w-3 opacity-70" />
            {template.name}
          </span>
        )}
        {account && (
          <span className="inline-flex items-center gap-1 text-blue-400/80 font-medium">
            <Building2 className="h-3 w-3 opacity-70" />
            {account.name}
          </span>
        )}
        {opportunity && (
          <span className="inline-flex items-center gap-1 text-emerald-400/80 font-medium">
            <DollarSign className="h-3 w-3 opacity-70" />
            {opportunity.name}
          </span>
        )}

        {/* Separator */}
        {(template || account || opportunity) && kiCount > 0 && (
          <span className="text-border/40">·</span>
        )}

        {/* KI toggle */}
        <button
          onClick={() => onToggleKIs(!useKIs)}
          className={cn(
            'inline-flex items-center gap-1 transition-colors duration-150',
            useKIs ? 'text-primary/70 font-medium' : 'text-muted-foreground/40'
          )}
        >
          <Brain className="h-3 w-3" />
          {useKIs ? (
            <>
              <ToggleRight className="h-3.5 w-3.5" />
              <span>{kiCount > 0 ? `${kiCount.toLocaleString()} KIs` : 'KIs on'}</span>
            </>
          ) : (
            <>
              <ToggleLeft className="h-3.5 w-3.5" />
              <span>KIs off</span>
            </>
          )}
        </button>

        {/* Detail toggle */}
        {useKIs && ex && ex.topThemes.length > 0 && (
          <button
            onClick={() => setShowKIDetail(!showKIDetail)}
            className="inline-flex items-center gap-0.5 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors duration-150"
          >
            {showKIDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className="text-[10px]">detail</span>
          </button>
        )}
      </div>

      {/* KI explainability panel */}
      {showKIDetail && ex && (
        <div className="rounded-lg border border-border/30 bg-card/50 px-3.5 py-2.5 space-y-2 animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {/* Retrieval reasoning */}
          <div className="flex items-start gap-2">
            <Sparkles className="h-3 w-3 text-primary/60 mt-0.5 shrink-0" />
            <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{ex.retrievalReasoning}</p>
          </div>

          {/* Relevance breakdown */}
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-foreground/60 font-medium">{ex.relevanceBreakdown.high} high</span>
            <span className="text-muted-foreground/50">{ex.relevanceBreakdown.medium} med</span>
            <span className="text-muted-foreground/30">{ex.relevanceBreakdown.low} general</span>
            <span className="text-muted-foreground/20 ml-auto text-[9px]">
              of {ex.totalAvailable.toLocaleString()}
            </span>
          </div>

          {/* Themes + Frameworks */}
          {(ex.topThemes.length > 0 || ex.topFrameworks.length > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {ex.topThemes.map(theme => (
                <span key={theme} className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/6 text-primary/60 font-medium">
                  {theme}
                </span>
              ))}
              {ex.topFrameworks.map(fw => (
                <span key={fw} className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/40 text-muted-foreground/50 font-medium">
                  {fw}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
