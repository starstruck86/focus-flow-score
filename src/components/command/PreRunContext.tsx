/**
 * PreRunContext — compact pre-run trust strip.
 * Clear, readable metadata. No ghosted text.
 */
import { Building2, DollarSign, FileText, Brain, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Sparkles, BookOpen, Paperclip } from 'lucide-react';
import { STRATEGY_UI } from '@/lib/strategy-ui';
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
    <div className="mt-3 px-0.5 space-y-3">
      <div className={cn(STRATEGY_UI.surface.context, 'flex items-center gap-3 flex-wrap text-xs px-4 py-2.5')}>
        {template && (
          <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
            <FileText className="h-3 w-3" />
            {template.name}
          </span>
        )}
        {account && (
          <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium">
            <Building2 className="h-3 w-3" />
            {account.name}
          </span>
        )}
        {opportunity && (
          <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
            <DollarSign className="h-3 w-3" />
            {opportunity.name}
          </span>
        )}
        {attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground font-medium">
            <Paperclip className="h-3 w-3" />
            {attachmentCount} file{attachmentCount !== 1 ? 's' : ''}
          </span>
        )}
        {(template || account || opportunity || attachmentCount > 0) && kiCount > 0 && (
          <span className="text-border">·</span>
        )}
        <button
          onClick={() => onToggleKIs(!useKIs)}
          className={cn(
            'inline-flex items-center gap-1.5 font-medium transition-colors',
            useKIs ? 'text-primary' : 'text-foreground/80 hover:text-foreground'
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
        {useKIs && ex?.playbookUsed && (
          <span className="inline-flex items-center gap-1 text-primary text-[11px] font-medium">
            <BookOpen className="h-3 w-3" />
            {ex.playbookUsed}
          </span>
        )}
        {useKIs && ex && ex.topThemes.length > 0 && (
          <button
            onClick={() => setShowKIDetail(!showKIDetail)}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showKIDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className="text-[11px]">detail</span>
          </button>
        )}
      </div>

      {showKIDetail && ex && (
        <div className={cn(STRATEGY_UI.surface.context, 'px-4 py-3.5 space-y-3 animate-in fade-in-0 slide-in-from-top-1 duration-100')}>
          <div className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-foreground/85 leading-relaxed">{ex.retrievalReasoning}</p>
          </div>
          {ex.retrievalLayers && ex.retrievalLayers.length > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
              {ex.retrievalLayers.map((layer, i) => (
                <span key={layer} className="flex items-center gap-1">
                  {i > 0 && <span className="text-border">→</span>}
                  {layer}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-4 text-xs flex-wrap">
            <span className="text-foreground font-medium">{ex.relevanceBreakdown.high} strategic</span>
            <span className="text-foreground/80">{ex.relevanceBreakdown.medium} tactical</span>
            <span className="text-muted-foreground">{ex.relevanceBreakdown.low} supporting</span>
          </div>
          {(ex.topThemes.length > 0 || ex.topFrameworks.length > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {ex.topThemes.map(theme => (
                <span key={theme} className="text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium">
                  {theme}
                </span>
              ))}
              {ex.topFrameworks.map(fw => (
                <span key={fw} className="text-[11px] px-2 py-0.5 rounded-md bg-muted text-foreground/80 font-medium">
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
