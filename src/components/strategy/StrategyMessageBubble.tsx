import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Copy, Pin, Save, ChevronDown, ChevronUp, Database } from 'lucide-react';
import { toast } from 'sonner';
import type { StrategyMessage } from '@/types/strategy';

interface Props {
  message: StrategyMessage;
  onSaveAsMemory?: (content: string, type: string) => void;
}

export function StrategyMessageBubble({ message, onSaveAsMemory }: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system' || message.role === 'tool';
  const contentJson = message.content_json as any;
  const text = contentJson?.text || JSON.stringify(message.content_json);
  const structured = contentJson?.structured;
  const workflowType = contentJson?.workflowType;
  const sourcesUsed = contentJson?.sources_used;

  if (message.message_type === 'workflow_update') {
    return (
      <div className="flex justify-center">
        <Badge variant="outline" className="text-[10px] text-muted-foreground gap-1">
          <Database className="h-2.5 w-2.5 animate-pulse" />
          {text}
        </Badge>
      </div>
    );
  }

  if (message.message_type === 'workflow_result' || message.message_type === 'output_card') {
    return (
      <StructuredResultCard
        text={text}
        structured={structured}
        workflowType={workflowType}
        sourcesUsed={sourcesUsed}
        onSaveAsMemory={onSaveAsMemory}
      />
    );
  }

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : isSystem
              ? 'bg-muted/50 text-muted-foreground italic'
              : 'bg-muted text-foreground',
        )}
      >
        <div className="whitespace-pre-wrap">{text}</div>
        {!isUser && sourcesUsed > 0 && (
          <div className="mt-1.5 flex items-center gap-1">
            <Badge variant="secondary" className="text-[8px] px-1 py-0 gap-0.5">
              <Database className="h-2 w-2" />
              {sourcesUsed} sources
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Structured Result Card ────────────────────────────────
function StructuredResultCard({
  text, structured, workflowType, sourcesUsed, onSaveAsMemory,
}: {
  text: string;
  structured?: any;
  workflowType?: string;
  sourcesUsed?: number;
  onSaveAsMemory?: (content: string, type: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const topSummary = structured?.summary || structured?.executive_summary || structured?.deal_summary;

  return (
    <Card className="border-primary/20 bg-card">
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-[10px]">
            {workflowType?.replace(/_/g, ' ') || 'Result'}
          </Badge>
          {sourcesUsed != null && sourcesUsed > 0 && (
            <Badge variant="secondary" className="text-[8px] px-1 py-0 gap-0.5">
              <Database className="h-2 w-2" />
              {sourcesUsed} sources
            </Badge>
          )}
          <div className="flex-1" />
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>

        {/* Top summary always visible */}
        {topSummary && (
          <p className="text-xs text-foreground/90 leading-relaxed">{topSummary}</p>
        )}

        {/* Structured sections */}
        {expanded && structured && (
          <div className="space-y-2 pt-1">
            {workflowType === 'email_evaluation' && structured.overall_score != null && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Score:</span>
                <Badge variant={structured.overall_score >= 7 ? 'default' : structured.overall_score >= 4 ? 'secondary' : 'destructive'} className="text-xs">
                  {structured.overall_score}/10
                </Badge>
              </div>
            )}
            <StructuredSections structured={structured} workflowType={workflowType} />
          </div>
        )}

        {/* Fallback if no structured data */}
        {expanded && !structured && (
          <div className="text-xs whitespace-pre-wrap text-foreground/80 max-h-96 overflow-y-auto">
            {text}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 pt-1 border-t border-border">
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={copyToClipboard}>
            <Copy className="h-2.5 w-2.5" /> Copy
          </Button>
          {onSaveAsMemory && topSummary && (
            <Button
              size="sm" variant="ghost" className="h-6 text-[10px] gap-1"
              onClick={() => onSaveAsMemory(topSummary, 'fact')}
            >
              <Save className="h-2.5 w-2.5" /> Save to Memory
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section renderers by workflow type ─────────────────────
function StructuredSections({ structured, workflowType }: { structured: any; workflowType?: string }) {
  const renderList = (items: string[] | undefined, label: string) => {
    if (!items?.length) return null;
    return (
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
        <ul className="space-y-0.5">
          {items.map((item, i) => (
            <li key={i} className="text-xs text-foreground/80 pl-2 border-l-2 border-muted">{item}</li>
          ))}
        </ul>
      </div>
    );
  };

  const renderText = (text: string | undefined, label: string) => {
    if (!text) return null;
    return (
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
        <p className="text-xs text-foreground/80">{text}</p>
      </div>
    );
  };

  switch (workflowType) {
    case 'deep_research':
      return (
        <>
          {renderText(structured.company_overview, 'Company Overview')}
          {renderList(structured.key_findings, 'Key Findings')}
          {renderList(structured.strategic_implications, 'Strategic Implications')}
          {renderList(structured.risks, 'Risks')}
          {renderList(structured.opportunities, 'Opportunities')}
          {renderList(structured.recommended_actions, 'Recommended Actions')}
          {renderList(structured.cited_sources, 'Sources')}
        </>
      );
    case 'email_evaluation':
      return (
        <>
          {renderList(structured.strengths, 'Strengths')}
          {renderList(structured.weaknesses, 'Weaknesses')}
          {renderText(structured.subject_line_feedback, 'Subject Line')}
          {renderText(structured.opening_feedback, 'Opening')}
          {renderText(structured.value_prop_feedback, 'Value Proposition')}
          {renderText(structured.cta_feedback, 'Call to Action')}
          {renderText(structured.rewrite, 'Suggested Rewrite')}
        </>
      );
    case 'territory_tiering':
      return (
        <>
          {renderText(structured.methodology, 'Methodology')}
          {structured.tiers?.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Tier Results</p>
              <div className="space-y-1">
                {structured.tiers.map((t: any, i: number) => (
                  <div key={i} className="bg-muted/30 rounded px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{t.account_name}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0">{t.tier}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{t.rationale}</p>
                    <p className="text-[10px] text-primary/80 mt-0.5">→ {t.next_action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      );
    case 'account_plan':
      return (
        <>
          {renderText(structured.account_overview, 'Account Overview')}
          {renderList(structured.stakeholder_map, 'Stakeholders')}
          {renderList(structured.strategic_objectives, 'Strategic Objectives')}
          {renderList(structured.action_plan, 'Action Plan')}
          {renderList(structured.risk_factors, 'Risk Factors')}
          {renderList(structured.success_metrics, 'Success Metrics')}
        </>
      );
    case 'opportunity_strategy':
      return (
        <>
          {renderText(structured.decision_process, 'Decision Process')}
          {renderText(structured.champion_status, 'Champion Status')}
          {renderText(structured.competition_analysis, 'Competition')}
          {renderText(structured.value_alignment, 'Value Alignment')}
          {renderList(structured.risks, 'Risks')}
          {renderList(structured.next_actions, 'Next Actions')}
          {renderText(structured.close_plan, 'Close Plan')}
        </>
      );
    case 'brainstorm':
      return (
        <>
          {renderList(structured.key_insights, 'Key Insights')}
          {renderList(structured.bold_ideas, 'Bold Ideas')}
          {renderList(structured.quick_wins, 'Quick Wins')}
          {renderList(structured.strategic_bets, 'Strategic Bets')}
        </>
      );
    default:
      return null;
  }
}
