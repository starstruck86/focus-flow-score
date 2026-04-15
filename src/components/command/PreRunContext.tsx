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
    <div className="mt-1.5 px-0.5 space-y-1">
      {/* Context strip */}
      <div className="flex items-center gap-2.5 flex-wrap text-[11px]">
        {template && (
          <span className="inline-flex items-center gap-1 text-amber-400/90 font-medium">
            <FileText className="h-3 w-3" />
            {template.name}
          </span>
        )}
        {account && (
          <span className="inline-flex items-center gap-1 text-blue-400/90 font-medium">
            <Building2 className="h-3 w-3" />
            {account.name}
          </span>
        )}
        {opportunity && (
          <span className="inline-flex items-center gap-1 text-emerald-400/90 font-medium">
            <DollarSign className="h-3 w-3" />
            {opportunity.name}
          </span>
        )}

        {/* Separator */}
        {(template || account || opportunity) && kiCount > 0 && (
          <span className="text-border">·</span>
        )}

        {/* KI toggle */}
        <button
          onClick={() => onToggleKIs(!useKIs)}
          className={cn(
            'inline-flex items-center gap-1 transition-colors',
            useKIs ? 'text-primary/80 font-medium' : 'text-muted-foreground/50'
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
            className="inline-flex items-center gap-0.5 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
          >
            {showKIDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className="text-[10px]">detail</span>
          </button>
        )}
      </div>

      {/* KI explainability panel */}
      {showKIDetail && ex && (
        <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 space-y-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-150">
          {/* Retrieval reasoning */}
          <div className="flex items-start gap-1.5">
            <Sparkles className="h-3 w-3 text-primary/70 mt-0.5 shrink-0" />
            <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{ex.retrievalReasoning}</p>
          </div>

          {/* Relevance breakdown — compact inline */}
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-foreground/70 font-medium">{ex.relevanceBreakdown.high} high</span>
            <span className="text-muted-foreground/70">{ex.relevanceBreakdown.medium} med</span>
            <span className="text-muted-foreground/50">{ex.relevanceBreakdown.low} general</span>
            <span className="text-muted-foreground/30 ml-auto text-[9px]">
              of {ex.totalAvailable.toLocaleString()}
            </span>
          </div>

          {/* Themes + Frameworks combined row */}
          {(ex.topThemes.length > 0 || ex.topFrameworks.length > 0) && (
            <div className="flex items-center gap-1 flex-wrap">
              {ex.topThemes.map(theme => (
                <span key={theme} className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/8 text-primary/70 font-medium">
                  {theme}
                </span>
              ))}
              {ex.topFrameworks.map(fw => (
                <span key={fw} className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/60 text-muted-foreground/70 font-medium">
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
