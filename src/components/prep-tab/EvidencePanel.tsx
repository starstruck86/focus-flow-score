/**
 * Evidence panel showing what grounded a generated output.
 */

import { Badge } from '@/components/ui/badge';
import { FileText, BookOpen, Brain, Paperclip, Zap, MessageSquare } from 'lucide-react';
import type { RankedResource } from './resourceRanking';
import type { ContextItem } from './contextTypes';
import type { ActionizedTactic, ActionizedPrompt } from '@/lib/actionizationEngine';

export interface EvidenceData {
  templates: RankedResource[];
  examples: RankedResource[];
  knowledgeItems: RankedResource[];
  contextItems: ContextItem[];
  tacticsInjected?: ActionizedTactic[];
  promptsInjected?: ActionizedPrompt[];
}

interface Props {
  evidence: EvidenceData | null;
}

export function EvidencePanel({ evidence }: Props) {
  if (!evidence) return null;

  const { templates, examples, knowledgeItems, contextItems, tacticsInjected = [], promptsInjected = [] } = evidence;
  const hasAnything = templates.length > 0 || examples.length > 0 || knowledgeItems.length > 0 || contextItems.length > 0 || tacticsInjected.length > 0 || promptsInjected.length > 0;

  if (!hasAnything) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Used to Generate This</p>

      {templates.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <FileText className="h-3 w-3" /> Templates
          </div>
          <div className="flex flex-wrap gap-1">
            {templates.map(t => (
              <Badge key={t.id} variant="outline" className="text-[9px] font-normal">
                {t.title}
                {t.reasons.length > 0 && (
                  <span className="ml-1 text-muted-foreground">· {t.reasons[0]}</span>
                )}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {examples.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <BookOpen className="h-3 w-3" /> Examples
          </div>
          <div className="flex flex-wrap gap-1">
            {examples.map(e => (
              <Badge key={e.id} variant="outline" className="text-[9px] font-normal">
                {e.title}
                {e.reasons.length > 0 && (
                  <span className="ml-1 text-muted-foreground">· {e.reasons[0]}</span>
                )}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {knowledgeItems.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Brain className="h-3 w-3" /> Knowledge Items
          </div>
          <div className="flex flex-wrap gap-1">
            {knowledgeItems.map(k => (
              <Badge key={k.id} variant="outline" className="text-[9px] font-normal">
                {k.title}
                {k.reasons.length > 0 && (
                  <span className="ml-1 text-muted-foreground">· {k.reasons[0]}</span>
                )}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {tacticsInjected.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Zap className="h-3 w-3" /> Tactics Injected ({tacticsInjected.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {tacticsInjected.map(t => (
              <Badge key={t.id} variant="outline" className="text-[9px] font-normal bg-amber-500/5 border-amber-500/20">
                {t.statement.slice(0, 60)}{t.statement.length > 60 ? '…' : ''}
                <span className="ml-1 text-muted-foreground">· {t.source_title}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {promptsInjected.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <MessageSquare className="h-3 w-3" /> Style Guidance ({promptsInjected.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {promptsInjected.map(p => (
              <Badge key={p.id} variant="outline" className="text-[9px] font-normal bg-primary/5 border-primary/20">
                {p.title}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {contextItems.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Paperclip className="h-3 w-3" /> Your Context
          </div>
          <div className="flex flex-wrap gap-1">
            {contextItems.map(c => (
              <Badge key={c.id} variant="secondary" className="text-[9px] font-normal">
                {c.label}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
