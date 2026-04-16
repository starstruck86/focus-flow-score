import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeft, FileText, MessageSquareWarning, Check, X as XIcon,
  ChevronDown, ChevronUp, Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskRunResult, Redline } from '@/hooks/strategy/useTaskExecution';
import { RedlineCard } from './RedlineCard';

interface Props {
  result: TaskRunResult;
  onBack: () => void;
  onApplyRedline: (runId: string, sectionId: string, proposedText: string) => void;
  onRejectRedline: (redlineId: string) => void;
}

type Tab = 'draft' | 'review';

const SECTION_LABELS: Record<string, string> = {
  cover: 'Prep Doc — Cover',
  participants: 'Participants',
  cx_audit: 'CX Audit',
  value_selling: 'Value Selling Observations Framework',
  discovery_questions: 'Discovery-1 Questions',
  customer_examples: 'Customer Examples',
  pivot_statements: 'Pivot Statements',
  objection_handling: 'Objection Handling',
  marketing_team: 'Marketing Team Members',
  exit_criteria: 'Exit Criteria, MEDDPICC, Deal Inspection',
};

function renderSectionContent(section: any) {
  const content = section.content;
  if (!content) return <p className="text-xs text-muted-foreground italic">No content generated</p>;

  switch (section.id) {
    case 'cover':
      return (
        <div className="space-y-1">
          {Object.entries(content).map(([k, v]) => (
            <div key={k} className="flex gap-2 text-xs">
              <span className="font-medium text-foreground/70 min-w-[120px] capitalize">{k.replace(/_/g, ' ')}:</span>
              <span className="text-foreground">{String(v) || 'Unknown'}</span>
            </div>
          ))}
        </div>
      );

    case 'participants':
      return (
        <div className="space-y-3">
          {content.prospect?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Prospect</p>
              <div className="border border-border/20 rounded-lg overflow-hidden">
                <div className="grid grid-cols-3 gap-px bg-primary/10 text-[10px] font-medium text-primary-foreground px-2 py-1">
                  <span>Name</span><span>Title</span><span>Role</span>
                </div>
                {content.prospect.map((p: any, i: number) => (
                  <div key={i} className="grid grid-cols-3 gap-px text-xs px-2 py-1.5 border-t border-border/10">
                    <span>{p.name}</span><span className="text-muted-foreground">{p.title}</span><span className="text-muted-foreground">{p.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {content.internal?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Internal</p>
              <div className="border border-border/20 rounded-lg overflow-hidden">
                {content.internal.map((p: any, i: number) => (
                  <div key={i} className="flex gap-2 text-xs px-2 py-1.5 border-t border-border/10 first:border-0">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">{p.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );

    case 'value_selling':
      const vsKeys = [
        { key: 'money', label: 'How do they make money?' },
        { key: 'compete', label: 'Who do they compete with?' },
        { key: 'pain_hypothesis', label: 'Pain hypothesis' },
        { key: 'csuite_initiative', label: 'C-Suite initiative & Business Objectives' },
        { key: 'current_state', label: 'Current State' },
        { key: 'industry_pressures', label: 'Industry pressures' },
        { key: 'problems_and_pain', label: 'Problems & Pain → C-Suite translation' },
        { key: 'ideal_state', label: 'Ideal State' },
        { key: 'value_driver', label: 'Value Driver' },
        { key: 'pov', label: 'POV (3-5 sentences)' },
      ];
      return (
        <div className="border border-border/20 rounded-lg overflow-hidden">
          {vsKeys.map(({ key, label }) => (
            <div key={key} className="border-t border-border/10 first:border-0">
              <div className="grid grid-cols-[1fr_1.5fr] gap-px">
                <div className="bg-muted/15 px-2.5 py-2 text-[11px] font-medium text-foreground/70">{label}</div>
                <div className="px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap">{content[key] || 'Unknown'}</div>
              </div>
            </div>
          ))}
        </div>
      );

    case 'discovery_questions':
      return (
        <div className="space-y-3">
          <div className="space-y-1.5">
            {(content.questions || []).map((q: string, i: number) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="font-semibold text-primary/60 shrink-0">{i + 1}.</span>
                <span>{q}</span>
              </div>
            ))}
          </div>
          {content.value_flow && (
            <div className="mt-3 pt-3 border-t border-border/10">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Value Creation Discovery Flow</p>
              <div className="flex flex-wrap gap-1.5">
                {['current_state', 'problem', 'impact', 'ideal_solution', 'business_benefit'].map((step, i) => (
                  <div key={step} className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[9px] bg-primary/5 border-primary/20">
                      {step.replace(/_/g, ' ').toUpperCase()}
                    </Badge>
                    {i < 4 && <span className="text-muted-foreground text-[10px]">→</span>}
                  </div>
                ))}
              </div>
              <div className="mt-2 space-y-1">
                {Object.entries(content.value_flow).map(([k, v]) => (
                  <div key={k} className="text-xs">
                    <span className="font-medium capitalize">{k.replace(/_/g, ' ')}:</span>{' '}
                    <span className="text-muted-foreground">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );

    case 'customer_examples':
      return (
        <div className="border border-border/20 rounded-lg overflow-hidden">
          <div className="grid grid-cols-3 gap-px bg-primary/10 text-[10px] font-medium px-2 py-1">
            <span>Customer</span><span>Case Study</span><span>Relevance</span>
          </div>
          {(Array.isArray(content) ? content : []).map((ex: any, i: number) => (
            <div key={i} className="grid grid-cols-3 gap-px text-xs px-2 py-1.5 border-t border-border/10">
              <span className="font-medium">{ex.customer}</span>
              <span className="text-muted-foreground truncate">{ex.link || '—'}</span>
              <span className="text-muted-foreground">{ex.relevance}</span>
            </div>
          ))}
        </div>
      );

    case 'pivot_statements':
      return (
        <div className="border border-border/20 rounded-lg overflow-hidden">
          <div className="grid grid-cols-2 gap-px">
            <div className="bg-primary/10 px-2.5 py-1.5 text-[10px] font-semibold">Pain Statement</div>
            <div className="bg-primary/10 px-2.5 py-1.5 text-[10px] font-semibold">FOMO Statement</div>
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-border/10">
            <div className="px-2.5 py-2 text-xs">{content.pain_statement || 'Unknown'}</div>
            <div className="px-2.5 py-2 text-xs">{content.fomo_statement || 'Unknown'}</div>
          </div>
        </div>
      );

    case 'objection_handling':
      return (
        <div className="border border-border/20 rounded-lg overflow-hidden">
          <div className="grid grid-cols-2 gap-px bg-primary/10 text-[10px] font-semibold px-2 py-1.5">
            <span>Anticipated Objection</span><span>Response</span>
          </div>
          {(Array.isArray(content) ? content : []).map((obj: any, i: number) => (
            <div key={i} className="grid grid-cols-2 gap-px text-xs border-t border-border/10">
              <div className="px-2.5 py-2 font-medium">{obj.objection}</div>
              <div className="px-2.5 py-2 text-muted-foreground">{obj.response}</div>
            </div>
          ))}
        </div>
      );

    case 'marketing_team':
      return (
        <div className="space-y-1">
          {(Array.isArray(content) ? content : []).map((m: any, i: number) => (
            <div key={i} className="text-xs flex gap-2">
              <span className="font-medium">{m.name}</span>
              {m.title && <span className="text-muted-foreground">— {m.title}</span>}
            </div>
          ))}
        </div>
      );

    case 'exit_criteria':
      return (
        <div className="space-y-2">
          {content.known?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-green-600 mb-1">✅ Known</p>
              <ul className="space-y-0.5">{content.known.map((k: string, i: number) => <li key={i} className="text-xs text-foreground/80 pl-3">• {k}</li>)}</ul>
            </div>
          )}
          {content.gaps?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-amber-600 mb-1">❓ Gaps to Fill</p>
              <ul className="space-y-0.5">{content.gaps.map((g: string, i: number) => <li key={i} className="text-xs text-foreground/80 pl-3">• {g}</li>)}</ul>
            </div>
          )}
          {content.meddpicc_gaps?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-red-600 mb-1">🔴 MEDDPICC Gaps</p>
              <ul className="space-y-0.5">{content.meddpicc_gaps.map((m: string, i: number) => <li key={i} className="text-xs text-foreground/80 pl-3">• {m}</li>)}</ul>
            </div>
          )}
        </div>
      );

    default:
      return <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{typeof content === 'string' ? content : JSON.stringify(content, null, 2)}</pre>;
  }
}

export function TaskOutputViewer({ result, onBack, onApplyRedline, onRejectRedline }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('draft');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(
    result.draft.sections?.map((s: any) => s.id) || []
  ));

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pendingRedlines = result.review.redlines?.filter(r => r.status === 'pending') || [];
  const acceptedCount = result.review.redlines?.filter(r => r.status === 'accepted').length || 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-border/10 flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <FileText className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-sm font-semibold flex-1 truncate">Discovery Prep</h2>

        {/* Tab switcher */}
        <div className="flex rounded-lg border border-border/20 overflow-hidden">
          <button
            className={cn(
              'px-3 py-1 text-[10px] font-medium transition-colors',
              activeTab === 'draft' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/20'
            )}
            onClick={() => setActiveTab('draft')}
          >
            Draft
          </button>
          <button
            className={cn(
              'px-3 py-1 text-[10px] font-medium transition-colors flex items-center gap-1',
              activeTab === 'review' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/20'
            )}
            onClick={() => setActiveTab('review')}
          >
            Review
            {pendingRedlines.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[8px] bg-amber-500/20 text-amber-700">
                {pendingRedlines.length}
              </Badge>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-3">
          {activeTab === 'draft' ? (
            <div className="space-y-2">
              {(result.draft.sections || []).map((section: any) => {
                const isExpanded = expandedSections.has(section.id);
                const label = SECTION_LABELS[section.id] || section.id;
                const hasRedline = result.review.redlines?.some(
                  r => r.section_id === section.id && r.status === 'pending'
                );
                const wasEdited = result.review.redlines?.some(
                  r => r.section_id === section.id && r.status === 'accepted'
                );

                return (
                  <Card key={section.id} className={cn(
                    'border-border/15 shadow-none',
                    hasRedline && 'border-l-2 border-l-amber-400/50',
                    wasEdited && 'border-l-2 border-l-green-400/50'
                  )}>
                    <CardHeader
                      className="px-3 py-2 cursor-pointer hover:bg-muted/10 transition-colors"
                      onClick={() => toggleSection(section.id)}
                    >
                      <div className="flex items-center gap-2">
                        {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                        <CardTitle className="text-xs font-semibold text-primary/80">{label}</CardTitle>
                        {hasRedline && (
                          <Badge variant="outline" className="text-[8px] border-amber-400/30 text-amber-600 ml-auto">
                            <Pencil className="h-2 w-2 mr-0.5" /> Edit suggested
                          </Badge>
                        )}
                        {wasEdited && (
                          <Badge variant="outline" className="text-[8px] border-green-400/30 text-green-600 ml-auto">
                            <Check className="h-2 w-2 mr-0.5" /> Updated
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    {isExpanded && (
                      <CardContent className="px-3 pb-3 pt-0">
                        {renderSectionContent(section)}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Strengths */}
              {result.review.strengths?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5" /> What's Strong
                  </h3>
                  <div className="space-y-1.5">
                    {result.review.strengths.map((s, i) => (
                      <div key={i} className="flex gap-2 text-xs bg-green-50/50 dark:bg-green-950/20 rounded-lg px-3 py-2 border border-green-200/30">
                        <Check className="h-3 w-3 text-green-600 shrink-0 mt-0.5" />
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Redlines */}
              {result.review.redlines?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
                    <MessageSquareWarning className="h-3.5 w-3.5" /> Proposed Edits
                    {acceptedCount > 0 && (
                      <Badge variant="secondary" className="text-[8px] bg-green-100 text-green-700 ml-1">
                        {acceptedCount} applied
                      </Badge>
                    )}
                  </h3>
                  <div className="space-y-2">
                    {result.review.redlines.map(redline => (
                      <RedlineCard
                        key={redline.id}
                        redline={redline}
                        onAccept={() => onApplyRedline(result.run_id, redline.section_id, redline.proposed_text)}
                        onReject={() => onRejectRedline(redline.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {!result.review.strengths?.length && !result.review.redlines?.length && (
                <p className="text-sm text-muted-foreground text-center py-8">No review feedback generated.</p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
