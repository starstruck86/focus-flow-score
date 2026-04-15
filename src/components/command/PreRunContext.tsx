/**
 * PreRunContext — structured pre-run context strip showing exactly what will be used.
 * Replaces the abstract "Using templates, linked context, 14k KIs" line.
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
          <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
            <FileText className="h-3 w-3" />
            {template.name}
          </span>
        )}
        {account && (
          <span className="inline-flex items-center gap-1 text-blue-400 font-medium">
            <Building2 className="h-3 w-3" />
            {account.name}
          </span>
        )}
        {opportunity && (
          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
            <DollarSign className="h-3 w-3" />
            {opportunity.name}
          </span>
        )}

        {/* KI toggle + count */}
        <button
          onClick={() => onToggleKIs(!useKIs)}
          className={cn(
            'inline-flex items-center gap-1 transition-colors',
            useKIs ? 'text-primary font-medium' : 'text-muted-foreground'
          )}
        >
          <Brain className="h-3 w-3" />
          {useKIs ? (
            <>
              <ToggleRight className="h-3.5 w-3.5" />
              {kiCount > 0 ? `${kiCount.toLocaleString()} KIs` : 'KIs on'}
            </>
          ) : (
            <>
              <ToggleLeft className="h-3.5 w-3.5" />
              KIs off
            </>
          )}
        </button>

        {/* KI detail toggle */}
        {useKIs && ex && ex.topThemes.length > 0 && (
          <button
            onClick={() => setShowKIDetail(!showKIDetail)}
            className="inline-flex items-center gap-0.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            {showKIDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className="text-[10px]">detail</span>
          </button>
        )}
      </div>

      {/* KI explainability panel */}
      {showKIDetail && ex && (
        <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 space-y-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          {/* Retrieval reasoning */}
          <div className="flex items-start gap-1.5">
            <Sparkles className="h-3 w-3 text-primary mt-0.5 shrink-0" />
            <p className="text-[10px] text-muted-foreground leading-relaxed">{ex.retrievalReasoning}</p>
          </div>

          {/* Relevance breakdown */}
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-foreground/70 font-medium">
              {ex.relevanceBreakdown.high} high
            </span>
            <span className="text-muted-foreground">
              {ex.relevanceBreakdown.medium} medium
            </span>
            <span className="text-muted-foreground/60">
              {ex.relevanceBreakdown.low} general
            </span>
            <span className="text-muted-foreground/40 ml-auto">
              from {ex.totalAvailable.toLocaleString()} total
            </span>
          </div>

          {/* Top themes */}
          {ex.topThemes.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground/60 shrink-0">Themes:</span>
              {ex.topThemes.map(theme => (
                <span key={theme} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/80 font-medium">
                  {theme}
                </span>
              ))}
            </div>
          )}

          {/* Top frameworks */}
          {ex.topFrameworks.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground/60 shrink-0">Frameworks:</span>
              {ex.topFrameworks.map(fw => (
                <span key={fw} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
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
