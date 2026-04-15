/**
 * PreRunContext — compact pre-run trust strip.
 * Shows exactly what context will be used in the run.
 *
 * CONTRAST: All text here is informational/interactive and must be readable.
 * Uses muted-foreground (not /30 or /40).
 */
import { Building2, DollarSign, FileText, Brain, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Sparkles, BookOpen, Paperclip } from 'lucide-react';
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
  attachmentCount?: number;
}

export function PreRunContext({ tokens, useKIs, onToggleKIs, kiCount, lastKIExplainability, attachmentCount = 0 }: Props) {
  const [showKIDetail, setShowKIDetail] = useState(false);

  const template = tokens.find(t => t.type === 'template');
  const account = tokens.find(t => t.type === 'account');
  const opportunity = tokens.find(t => t.type === 'opportunity');

  const hasAnything = template || account || opportunity || kiCount > 0 || attachmentCount > 0;
  if (!hasAnything) return null;

  const ex = lastKIExplainability;

  return (
    <div className="mt-2.5 px-1 space-y-2">
      {/* Context strip */}
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        {template && (
          <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
            <FileText className="h-3 w-3 opacity-70" />
            {template.name}
          </span>
        )}
        {account && (
          <span className="inline-flex items-center gap-1 text-blue-400 font-medium">
            <Building2 className="h-3 w-3 opacity-70" />
            {account.name}
          </span>
        )}
        {opportunity && (
          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
            <DollarSign className="h-3 w-3 opacity-70" />
            {opportunity.name}
          </span>
        )}

        {attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground font-medium">
            <Paperclip className="h-3 w-3" />
            {attachmentCount} file{attachmentCount !== 1 ? 's' : ''}
          </span>
        )}

        {(template || account || opportunity || attachmentCount > 0) && kiCount > 0 && (
          <span className="text-border">·</span>
        )}

        {/* KI toggle */}
        <button
          onClick={() => onToggleKIs(!useKIs)}
          className={cn(
            'inline-flex items-center gap-1 transition-colors duration-100',
            useKIs ? 'text-primary/80 font-medium' : 'text-muted-foreground/60'
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

        {/* Playbook indicator */}
        {useKIs && ex?.playbookUsed && (
          <span className="inline-flex items-center gap-1 text-primary/70 text-[10px] font-medium">
            <BookOpen className="h-2.5 w-2.5" />
            {ex.playbookUsed}
          </span>
        )}

        {/* Detail toggle */}
        {useKIs && ex && ex.topThemes.length > 0 && (
          <button
            onClick={() => setShowKIDetail(!showKIDetail)}
            className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground/80 transition-colors duration-100"
          >
            {showKIDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className="text-[10px]">detail</span>
          </button>
        )}
      </div>

      {/* KI explainability panel */}
      {showKIDetail && ex && (
        <div className="rounded-lg border border-border/20 bg-card/40 px-4 py-3 space-y-2.5 animate-in fade-in-0 slide-in-from-top-1 duration-100">
          {/* Retrieval reasoning */}
          <div className="flex items-start gap-2">
            <Sparkles className="h-3 w-3 text-primary/60 mt-0.5 shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">{ex.retrievalReasoning}</p>
          </div>

          {/* Retrieval layers */}
          {ex.retrievalLayers && ex.retrievalLayers.length > 0 && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80">
              {ex.retrievalLayers.map((layer, i) => (
                <span key={layer} className="flex items-center gap-1">
                  {i > 0 && <span className="text-border">→</span>}
                  {layer}
                </span>
              ))}
            </div>
          )}

          {/* Relevance breakdown */}
          <div className="flex items-center gap-4 text-[11px]">
            <span className="text-foreground/80 font-medium">{ex.relevanceBreakdown.high} strategic</span>
            <span className="text-muted-foreground">{ex.relevanceBreakdown.medium} tactical</span>
            <span className="text-muted-foreground/70">{ex.relevanceBreakdown.low} supporting</span>
          </div>

          {/* Themes + Frameworks */}
          {(ex.topThemes.length > 0 || ex.topFrameworks.length > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {ex.topThemes.map(theme => (
                <span key={theme} className="text-[10px] px-2 py-0.5 rounded-md bg-primary/[0.08] text-primary/80 font-medium">
                  {theme}
                </span>
              ))}
              {ex.topFrameworks.map(fw => (
                <span key={fw} className="text-[10px] px-2 py-0.5 rounded-md bg-muted/30 text-muted-foreground font-medium">
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
