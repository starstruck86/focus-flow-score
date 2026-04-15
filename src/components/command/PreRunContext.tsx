/**
 * PreRunContext — compact pre-run trust strip showing exactly what will be used.
 * Shows template, account, opportunity, KI toggle, playbook info, attachments.
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
    <div className="mt-1.5 px-0.5 space-y-1">
      {/* Context strip */}
      <div className="flex items-center gap-2.5 flex-wrap text-[11px]">
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

        {/* Attachments indicator */}
        {attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground/50 font-medium">
            <Paperclip className="h-3 w-3 opacity-60" />
            {attachmentCount} file{attachmentCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Separator */}
        {(template || account || opportunity || attachmentCount > 0) && kiCount > 0 && (
          <span className="text-border/30">·</span>
        )}

        {/* KI toggle */}
        <button
          onClick={() => onToggleKIs(!useKIs)}
          className={cn(
            'inline-flex items-center gap-1 transition-colors duration-100',
            useKIs ? 'text-primary/60 font-medium' : 'text-muted-foreground/30'
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
          <span className="inline-flex items-center gap-1 text-primary/40 text-[10px]">
            <BookOpen className="h-2.5 w-2.5" />
            {ex.playbookUsed}
          </span>
        )}

        {/* Detail toggle */}
        {useKIs && ex && ex.topThemes.length > 0 && (
          <button
            onClick={() => setShowKIDetail(!showKIDetail)}
            className="inline-flex items-center gap-0.5 text-muted-foreground/25 hover:text-muted-foreground/50 transition-colors duration-100"
          >
            {showKIDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className="text-[10px]">detail</span>
          </button>
        )}
      </div>

      {/* KI explainability panel */}
      {showKIDetail && ex && (
        <div className="rounded-lg border border-border/20 bg-card/30 px-3 py-2 space-y-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-100">
          {/* Retrieval reasoning */}
          <div className="flex items-start gap-2">
            <Sparkles className="h-3 w-3 text-primary/50 mt-0.5 shrink-0" />
            <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{ex.retrievalReasoning}</p>
          </div>

          {/* Retrieval layers */}
          {ex.retrievalLayers && ex.retrievalLayers.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
              {ex.retrievalLayers.map((layer, i) => (
                <span key={layer} className="flex items-center gap-1">
                  {i > 0 && <span className="text-border/30">→</span>}
                  {layer}
                </span>
              ))}
            </div>
          )}

          {/* Relevance breakdown */}
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-foreground/50 font-medium">{ex.relevanceBreakdown.high} strategic</span>
            <span className="text-muted-foreground/40">{ex.relevanceBreakdown.medium} tactical</span>
            <span className="text-muted-foreground/25">{ex.relevanceBreakdown.low} supporting</span>
            <span className="text-muted-foreground/15 ml-auto text-[9px]">
              of {ex.totalAvailable.toLocaleString()}
            </span>
          </div>

          {/* Themes + Frameworks */}
          {(ex.topThemes.length > 0 || ex.topFrameworks.length > 0) && (
            <div className="flex items-center gap-1 flex-wrap">
              {ex.topThemes.map(theme => (
                <span key={theme} className="text-[9px] px-1.5 py-0.5 rounded-md bg-primary/[0.05] text-primary/50 font-medium">
                  {theme}
                </span>
              ))}
              {ex.topFrameworks.map(fw => (
                <span key={fw} className="text-[9px] px-1.5 py-0.5 rounded-md bg-muted/30 text-muted-foreground/40 font-medium">
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
