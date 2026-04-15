import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Copy, Save, ChevronDown, ChevronUp, Database, FileText, Sparkles,
  Brain, Upload as UploadIcon, MessageSquare, Eye, GitBranch,
  Mail, Target, Map, Zap, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import type { StrategyMessage } from '@/types/strategy';

interface Props {
  message: StrategyMessage;
  onSaveAsMemory?: (content: string, type: string) => void;
  onTransformOutput?: (workflowType: string, structured: any, action: string) => void;
  onBranchThread?: (workflowType: string, structured: any) => void;
}

export function StrategyMessageBubble({ message, onSaveAsMemory, onTransformOutput, onBranchThread }: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system' || message.role === 'tool';
  const contentJson = (message.content_json ?? {}) as any;
  const text = contentJson?.text || '';
  const structured = contentJson?.structured;
  const workflowType = contentJson?.workflowType;
  const sourcesUsed = contentJson?.sources_used;
  const retrievalMeta = contentJson?.retrieval_meta;
  const modelUsed = contentJson?.model_used;

  if (message.message_type === 'workflow_update') {
    return (
      <div className="flex justify-center py-1">
        <Badge variant="outline" className="text-[10px] text-muted-foreground gap-1.5 py-0.5 px-2.5 font-normal">
          <Database className="h-2.5 w-2.5 animate-pulse text-primary/60" />
          {text || 'Processing…'}
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
        retrievalMeta={retrievalMeta}
        modelUsed={modelUsed}
        onSaveAsMemory={onSaveAsMemory}
        onTransformOutput={onTransformOutput}
        onBranchThread={onBranchThread}
      />
    );
  }

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : isSystem
              ? 'bg-muted/30 text-muted-foreground italic text-xs'
              : 'bg-muted/60 text-foreground rounded-bl-sm',
        )}
      >
        <div className="whitespace-pre-wrap">{text || JSON.stringify(message.content_json)}</div>
        {!isUser && !isSystem && (
          <div className="mt-2 space-y-1.5">
            {sourcesUsed != null && sourcesUsed > 0 && (
              <SourceInspector sourcesUsed={sourcesUsed} retrievalMeta={retrievalMeta} />
            )}
            {onSaveAsMemory && text && (
              <Button
                size="sm" variant="ghost"
                className="h-5 text-[9px] px-1.5 gap-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => onSaveAsMemory(text.slice(0, 500), 'fact')}
              >
                <Save className="h-2 w-2" /> Save
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Source Inspector (collapsible) ────────────────────────
function SourceInspector({ sourcesUsed, retrievalMeta }: { sourcesUsed: number; retrievalMeta?: any }) {
  const [expanded, setExpanded] = useState(false);

  if (!retrievalMeta) {
    return (
      <Badge variant="secondary" className="text-[8px] px-1.5 py-0 gap-1 font-normal">
        <Database className="h-2 w-2" />
        {sourcesUsed} sources
      </Badge>
    );
  }

  const memCount = retrievalMeta.memoriesScored ?? 0;
  const upCount = retrievalMeta.uploadsIncluded ?? 0;
  const outCount = retrievalMeta.outputsIncluded ?? 0;
  const msgCount = retrievalMeta.messagesIncluded ?? 0;
  const total = memCount + upCount + outCount + msgCount;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[9px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        <Eye className="h-2.5 w-2.5" />
        <span>{total} sources used</span>
        {expanded ? <ChevronUp className="h-2 w-2" /> : <ChevronDown className="h-2 w-2" />}
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {memCount > 0 && (
            <Badge variant="secondary" className="text-[8px] px-1.5 py-0 gap-0.5 font-normal">
              <Brain className="h-2 w-2" /> {memCount} memory
            </Badge>
          )}
          {upCount > 0 && (
            <Badge variant="secondary" className="text-[8px] px-1.5 py-0 gap-0.5 font-normal">
              <UploadIcon className="h-2 w-2" /> {upCount} uploads
            </Badge>
          )}
          {outCount > 0 && (
            <Badge variant="secondary" className="text-[8px] px-1.5 py-0 gap-0.5 font-normal">
              <FileText className="h-2 w-2" /> {outCount} outputs
            </Badge>
          )}
          {msgCount > 0 && (
            <Badge variant="secondary" className="text-[8px] px-1.5 py-0 gap-0.5 font-normal">
              <MessageSquare className="h-2 w-2" /> {msgCount} history
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

// ── Output Action Buttons ─────────────────────────────────
const OUTPUT_ACTIONS = [
  { key: 'account_plan', label: 'Account Plan', icon: FileText },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'call_prep', label: 'Call Prep', icon: Target },
  { key: 'memo', label: 'Memo', icon: FileText },
  { key: 'next_steps', label: 'Next Steps', icon: ArrowRight },
];

// ── Structured Result Card ────────────────────────────────
function StructuredResultCard({
  text, structured, workflowType, sourcesUsed, retrievalMeta, modelUsed,
  onSaveAsMemory, onTransformOutput, onBranchThread,
}: {
  text: string;
  structured?: any;
  workflowType?: string;
  sourcesUsed?: number;
  retrievalMeta?: any;
  modelUsed?: string;
  onSaveAsMemory?: (content: string, type: string) => void;
  onTransformOutput?: (workflowType: string, structured: any, action: string) => void;
  onBranchThread?: (workflowType: string, structured: any) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showActions, setShowActions] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(text || JSON.stringify(structured, null, 2));
    toast.success('Copied to clipboard');
  };

  const topSummary = structured?.summary || structured?.executive_summary || structured?.deal_summary;
  const workflowLabel = workflowType?.replace(/_/g, ' ') || 'Result';
  const WorkflowIcon = getWorkflowIcon(workflowType);

  return (
    <Card className="border-primary/15 bg-card shadow-sm">
      <CardContent className="p-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-2 border-b border-border/50">
          <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center">
            <WorkflowIcon className="h-3 w-3 text-primary" />
          </div>
          <span className="text-xs font-semibold capitalize flex-1">{workflowLabel}</span>
          {sourcesUsed != null && sourcesUsed > 0 && (
            <SourceInspector sourcesUsed={sourcesUsed} retrievalMeta={retrievalMeta} />
          )}
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>

        {/* Top summary */}
        {topSummary && (
          <div className="px-3.5 pt-2.5 pb-2">
            <p className="text-xs text-foreground/85 leading-relaxed">{topSummary}</p>
          </div>
        )}

        {/* Structured sections */}
        {expanded && structured && (
          <div className="px-3.5 pb-3 space-y-3">
            {workflowType === 'email_evaluation' && structured.overall_score != null && (
              <ScoreDisplay score={structured.overall_score} />
            )}
            <StructuredSections structured={structured} workflowType={workflowType} />
          </div>
        )}

        {/* Fallback text */}
        {expanded && !structured && text && (
          <div className="px-3.5 pb-3">
            <div className="text-xs whitespace-pre-wrap text-foreground/75 max-h-96 overflow-y-auto leading-relaxed">
              {text}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="border-t border-border/50 bg-muted/20 rounded-b-lg">
          <div className="flex items-center gap-1 px-3 py-2">
            <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground" onClick={copyToClipboard}>
              <Copy className="h-2.5 w-2.5" /> Copy
            </Button>
            {onSaveAsMemory && topSummary && (
              <Button
                size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => onSaveAsMemory(topSummary, 'fact')}
              >
                <Save className="h-2.5 w-2.5" /> Save
              </Button>
            )}
            {onTransformOutput && structured && (
              <Button
                size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShowActions(!showActions)}
              >
                <Zap className="h-2.5 w-2.5" /> Turn into…
              </Button>
            )}
            {onBranchThread && structured && (
              <Button
                size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => onBranchThread(workflowType || '', structured)}
              >
                <GitBranch className="h-2.5 w-2.5" /> Branch
              </Button>
            )}
            {modelUsed && (
              <span className="ml-auto text-[8px] text-muted-foreground/40 font-mono">{modelUsed.split('/').pop()}</span>
            )}
          </div>
          {/* Artifact transform actions */}
          {showActions && onTransformOutput && (
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              {OUTPUT_ACTIONS.map(a => (
                <Button
                  key={a.key}
                  size="sm"
                  variant="outline"
                  className="h-6 text-[9px] gap-1 px-2"
                  onClick={() => {
                    onTransformOutput(workflowType || '', structured, a.key);
                    setShowActions(false);
                  }}
                >
                  <a.icon className="h-2.5 w-2.5" /> {a.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreDisplay({ score }: { score: number }) {
  const color = score >= 7 ? 'text-green-400 bg-green-500/10 border-green-500/20'
    : score >= 4 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
    : 'text-red-400 bg-red-500/10 border-red-500/20';
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-lg border px-3 py-1.5', color)}>
      <span className="text-lg font-bold">{score}</span>
      <span className="text-[10px] font-medium opacity-70">/10</span>
    </div>
  );
}

function getWorkflowIcon(workflowType?: string) {
  const icons: Record<string, typeof Sparkles> = {
    deep_research: FileText,
    email_evaluation: Mail,
    territory_tiering: Map,
    account_plan: FileText,
    opportunity_strategy: Target,
    brainstorm: Zap,
  };
  return icons[workflowType || ''] || Sparkles;
}

// ── Section renderers ─────────────────────────────────────
function StructuredSections({ structured, workflowType }: { structured: any; workflowType?: string }) {
  const renderList = (items: string[] | undefined, label: string) => {
    if (!items?.length) return null;
    return (
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-xs text-foreground/75 pl-2.5 border-l-2 border-primary/20 leading-relaxed">{item}</li>
          ))}
        </ul>
      </div>
    );
  };

  const renderText = (text: string | undefined, label: string) => {
    if (!text) return null;
    return (
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
        <p className="text-xs text-foreground/75 leading-relaxed">{text}</p>
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
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Tier Results</p>
              <div className="space-y-1.5">
                {structured.tiers.map((t: any, i: number) => (
                  <div key={i} className="bg-muted/30 rounded-lg px-3 py-2 border border-border/30">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium flex-1">{t.account_name || 'Unknown'}</span>
                      <TierBadge tier={t.tier} />
                    </div>
                    {t.rationale && <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{t.rationale}</p>}
                    {t.next_action && <p className="text-[10px] text-primary/70 mt-1 font-medium">→ {t.next_action}</p>}
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

function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return null;
  const colors: Record<string, string> = {
    'Tier 1': 'bg-green-500/15 text-green-400 border-green-500/20',
    'Tier 2': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    'Tier 3': 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    'Tier 4': 'bg-red-500/15 text-red-400 border-red-500/20',
  };
  return (
    <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded border', colors[tier] || 'bg-muted text-muted-foreground')}>
      {tier}
    </span>
  );
}
