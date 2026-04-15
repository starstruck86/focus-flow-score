import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Copy, Save, ChevronDown, ChevronUp, Database, FileText, Sparkles,
  Brain, Upload as UploadIcon, MessageSquare, Eye, GitBranch, Cpu,
  Mail, Target, Map, Zap, ArrowRight, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { StrategyMessage } from '@/types/strategy';
import { SourceInspectorPanel } from './SourceInspectorPanel';

interface Props {
  message: StrategyMessage;
  onSaveAsMemory?: (content: string, type: string) => void;
  onTransformOutput?: (sourceOutputId: string, targetArtifactType: string) => void;
  onBranchThread?: (title: string, content: string) => void;
  isTransforming?: boolean;
}

export function StrategyMessageBubble({ message, onSaveAsMemory, onTransformOutput, onBranchThread, isTransforming }: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system' || message.role === 'tool';
  const contentJson = (message.content_json ?? {}) as any;
  const text = extractDisplayText(contentJson);
  const structured = contentJson?.structured;
  const workflowType = contentJson?.workflowType;
  const sourcesUsed = contentJson?.sources_used;
  const retrievalMeta = contentJson?.retrieval_meta;
  const modelUsed = contentJson?.model_used;
  const providerUsed = contentJson?.provider_used;
  const fallbackUsed = contentJson?.fallback_used;

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

  // Artifact message type
  if (message.message_type === 'artifact') {
    return (
      <ArtifactCard
        contentJson={contentJson}
        onBranchThread={onBranchThread}
      />
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
        providerUsed={providerUsed}
        fallbackUsed={fallbackUsed}
        contentJson={contentJson}
        onSaveAsMemory={onSaveAsMemory}
        onTransformOutput={onTransformOutput}
        onBranchThread={onBranchThread}
        isTransforming={isTransforming}
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
        {text ? (
          <div className="whitespace-pre-wrap">{text}</div>
        ) : (
          <div className="text-muted-foreground/60 italic text-xs">Processing…</div>
        )}
        {!isUser && !isSystem && (
          <div className="mt-2 space-y-1.5">
            {/* Provider + model pill */}
            {providerUsed && (
              <div className="flex items-center gap-1 flex-wrap">
                <Badge variant="outline" className="text-[8px] px-1.5 py-0 gap-1 font-normal">
                  <Cpu className="h-2 w-2" />
                  {providerUsed === 'openai' ? 'ChatGPT' : providerUsed === 'anthropic' ? 'Claude' : providerUsed === 'perplexity' ? 'Perplexity' : providerUsed}
                  {modelUsed ? ` · ${modelUsed.split('/').pop()}` : ''}
                </Badge>
                {fallbackUsed && (
                  <Badge variant="destructive" className="text-[7px] px-1 py-0 font-normal">
                    fallback
                  </Badge>
                )}
              </div>
            )}
            {(sourcesUsed != null && sourcesUsed > 0) || retrievalMeta || modelUsed ? (
              <SourceInspectorPanel
                sourcesUsed={sourcesUsed ?? 0}
                retrievalMeta={retrievalMeta}
                modelUsed={modelUsed}
                providerUsed={providerUsed}
                fallbackUsed={fallbackUsed}
              />
            ) : null}
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

// ── Artifact Card ─────────────────────────────────────────
function ArtifactCard({ contentJson, onBranchThread }: { contentJson: any; onBranchThread?: (title: string, content: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const artifactType = contentJson?.artifactType || 'custom';
  const structured = contentJson?.structured;
  const text = contentJson?.text || '';

  const typeLabel = artifactType.replace(/_/g, ' ');
  const TypeIcon = ARTIFACT_TYPE_ICONS[artifactType] || FileText;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <Card className="border-accent/20 bg-card shadow-sm">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-2 border-b border-border/50">
          <div className="h-6 w-6 rounded-md bg-accent/10 flex items-center justify-center">
            <TypeIcon className="h-3 w-3 text-accent-foreground" />
          </div>
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 capitalize">{typeLabel}</Badge>
          <span className="text-[9px] text-muted-foreground/50">Artifact</span>
          <div className="flex-1" />
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>
        {expanded && (
          <div className="px-3.5 py-3">
            {structured ? (
              <ArtifactStructuredView type={artifactType} data={structured} />
            ) : (
              <div className="text-xs whitespace-pre-wrap text-foreground/75 max-h-96 overflow-y-auto leading-relaxed">{text}</div>
            )}
          </div>
        )}
        <div className="border-t border-border/50 bg-muted/20 rounded-b-lg flex items-center gap-1 px-3 py-2">
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground" onClick={copyToClipboard}>
            <Copy className="h-2.5 w-2.5" /> Copy
          </Button>
          {onBranchThread && (
            <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => onBranchThread(`Follow-up: ${typeLabel}`, text.slice(0, 500))}
            >
              <GitBranch className="h-2.5 w-2.5" /> Branch
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const ARTIFACT_TYPE_ICONS: Record<string, typeof FileText> = {
  email: Mail,
  account_plan: FileText,
  call_prep: Target,
  memo: FileText,
  next_steps: ArrowRight,
};

function ArtifactStructuredView({ type, data }: { type: string; data: any }) {
  const renderList = (items: any[] | undefined, label: string) => {
    if (!items?.length) return null;
    return (
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <ul className="space-y-0.5">
          {items.map((item, i) => (
            <li key={i} className="text-xs text-foreground/75 pl-2.5 border-l-2 border-accent/20 leading-relaxed">
              {typeof item === 'string' ? item : `[${(item.priority || '').toUpperCase()}] ${item.action}${item.owner ? ` (${item.owner})` : ''}${item.due ? ` — ${item.due}` : ''}`}
            </li>
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

  switch (type) {
    case 'email':
      return (
        <div className="space-y-2">
          {renderText(data.subject_line, 'Subject Line')}
          {renderText(data.body, 'Body')}
          {renderText(data.cta, 'CTA')}
        </div>
      );
    case 'account_plan':
      return (
        <div className="space-y-2">
          {renderText(data.executive_summary, 'Executive Summary')}
          {renderText(data.account_overview, 'Overview')}
          {renderList(data.objectives, 'Objectives')}
          {renderList(data.stakeholders, 'Stakeholders')}
          {renderList(data.action_plan, 'Action Plan')}
          {renderText(data.timeline, 'Timeline')}
          {renderList(data.risks, 'Risks')}
          {renderList(data.success_metrics, 'Success Metrics')}
        </div>
      );
    case 'call_prep':
      return (
        <div className="space-y-2">
          {renderList(data.objectives, 'Objectives')}
          {renderList(data.talking_points, 'Talking Points')}
          {renderList(data.questions, 'Questions')}
          {renderList(data.objections, 'Objections')}
          {renderList(data.risks, 'Risks')}
          {renderText(data.desired_outcome, 'Desired Outcome')}
        </div>
      );
    case 'memo':
      return (
        <div className="space-y-2">
          {renderText(data.summary, 'Summary')}
          {renderList(data.key_points, 'Key Points')}
          {renderList(data.recommendations, 'Recommendations')}
          {renderList(data.next_steps, 'Next Steps')}
        </div>
      );
    case 'next_steps':
      return (
        <div className="space-y-2">
          {renderText(data.context_summary, 'Context')}
          {renderList(data.steps, 'Actions')}
        </div>
      );
    default:
      return <pre className="text-[10px] text-foreground/60 overflow-auto">{JSON.stringify(data, null, 2)}</pre>;
  }
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
  providerUsed, fallbackUsed, contentJson, onSaveAsMemory, onTransformOutput, onBranchThread, isTransforming,
}: {
  text: string;
  structured?: any;
  workflowType?: string;
  sourcesUsed?: number;
  retrievalMeta?: any;
  modelUsed?: string;
  providerUsed?: string;
  fallbackUsed?: boolean;
  contentJson?: any;
  onSaveAsMemory?: (content: string, type: string) => void;
  onTransformOutput?: (sourceOutputId: string, targetArtifactType: string) => void;
  onBranchThread?: (title: string, content: string) => void;
  isTransforming?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showActions, setShowActions] = useState(false);

  const outputId = contentJson?.outputId;

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

        {/* Provenance panel */}
        {((sourcesUsed != null && sourcesUsed > 0) || retrievalMeta || modelUsed) && (
          <div className="px-3.5 pb-2">
            <SourceInspectorPanel
              sourcesUsed={sourcesUsed ?? 0}
              retrievalMeta={retrievalMeta}
              modelUsed={modelUsed}
              providerUsed={providerUsed}
              fallbackUsed={fallbackUsed}
              workflowType={workflowType}
            />
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
            {onTransformOutput && structured && outputId && (
              <Button
                size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShowActions(!showActions)}
                disabled={isTransforming}
              >
                {isTransforming ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Zap className="h-2.5 w-2.5" />}
                Turn into…
              </Button>
            )}
            {onBranchThread && structured && (
              <Button
                size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const summary = structured?.summary || structured?.executive_summary || '';
                  onBranchThread(`Follow-up: ${workflowType?.replace(/_/g, ' ') || 'result'}`, summary);
                }}
              >
                <GitBranch className="h-2.5 w-2.5" /> Branch
              </Button>
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
                  disabled={isTransforming}
                  onClick={() => {
                    if (outputId) {
                      onTransformOutput(outputId, a.key);
                    } else {
                      toast.error('No linked output found for this result');
                    }
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
