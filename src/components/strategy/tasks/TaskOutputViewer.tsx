import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeft, FileText, MessageSquareWarning, Check, Download,
  ChevronDown, ChevronUp, Pencil, Loader2, FileDown, Copy, Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sanitizeTaskRunResult, type TaskRunResult, type Redline, type DiscoverySection } from '@/hooks/strategy/useTaskExecution';
import { RedlineCard } from './RedlineCard';
import { generateDiscoveryDocx, downloadBlob } from '@/lib/strategy/discoveryDocxGenerator';
import { generateDiscoveryPdf } from '@/lib/strategy/discoveryPdfGenerator';
import { toast } from 'sonner';

interface Props {
  result: TaskRunResult | null | undefined;
  onBack: () => void;
  onApplyRedline: (runId: string, sectionId: string, proposedText: string) => void;
  onRejectRedline: (redlineId: string) => void;
}

type Tab = 'document' | 'review';

const SECTION_ICONS: Record<string, string> = {
  cockpit: '🎯',
  cover: '📋',
  participants: '👥',
  cx_audit: '🔍',
  executive_snapshot: '📊',
  value_selling: '💡',
  discovery_questions: '❓',
  customer_examples: '🏢',
  pivot_statements: '🔄',
  objection_handling: '🛡️',
  marketing_team: '👤',
  exit_criteria: '✅',
  revenue_pathway: '📈',
  metrics_intelligence: '📐',
  loyalty_analysis: '💎',
  tech_stack: '⚙️',
  competitive_war_game: '⚔️',
  hypotheses_risks: '🎲',
  appendix: '📎',
};

function renderContent(section: DiscoverySection) {
  const c = section.content;
  if (!c) return <p className="text-xs text-muted-foreground italic">No content generated</p>;

  switch (section.id) {
    case 'cockpit': {
      const cards = c.cards || [];
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {cards.map((card: any, i: number) => (
            <div key={i} className="rounded-lg border border-primary/10 bg-primary/[0.02] p-2.5">
              <p className="text-[10px] font-bold text-primary/70 uppercase tracking-wide mb-1">{card.label}</p>
              {card.bullets ? (
                <ul className="space-y-0.5">{card.bullets.map((b: string, j: number) => (
                  <li key={j} className="text-xs text-foreground flex gap-1.5"><span className="text-primary/40 shrink-0">•</span>{b}</li>
                ))}</ul>
              ) : (
                <p className="text-xs text-foreground">{card.value || 'Unknown'}</p>
              )}
            </div>
          ))}
        </div>
      );
    }

    case 'cover':
      return (
        <div className="space-y-1">
          {Object.entries(c).map(([k, v]) => (
            <div key={k} className="flex gap-2 text-xs">
              <span className="font-medium text-foreground/60 min-w-[120px] capitalize">{k.replace(/_/g, ' ')}:</span>
              <span className="text-foreground">{String(v) || 'Unknown'}</span>
            </div>
          ))}
        </div>
      );

    case 'participants': {
      const renderTable = (title: string, people: any[], cols: string[]) => {
        if (!people?.length) return null;
        return (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">{title}</p>
            <div className="border border-border/20 rounded-lg overflow-hidden text-xs">
              <div className={cn('grid gap-px bg-primary/10 text-[10px] font-medium px-2 py-1', `grid-cols-${cols.length}`)}>
                {cols.map(h => <span key={h}>{h}</span>)}
              </div>
              {people.map((p: any, i: number) => (
                <div key={i} className={cn('grid gap-px px-2 py-1.5 border-t border-border/10', `grid-cols-${cols.length}`)}>
                  <span className="font-medium">{p.name}</span>
                  {p.title !== undefined && <span className="text-muted-foreground">{p.title}</span>}
                  <span className="text-muted-foreground">{p.role}</span>
                </div>
              ))}
            </div>
          </div>
        );
      };
      return (
        <div className="space-y-3">
          {renderTable('Prospect', c.prospect, ['Name', 'Title', 'Role'])}
          {renderTable('Internal', c.internal, ['Name', 'Role'])}
        </div>
      );
    }

    case 'value_selling': {
      const rows = [
        ['How do they make money?', c.money],
        ['Competitors', c.compete],
        ['Pain Hypothesis', c.pain_hypothesis],
        ['C-Suite Initiative', c.csuite_initiative],
        ['Current State', c.current_state],
        ['Industry Pressures', c.industry_pressures],
        ['Problems & Pain', c.problems_and_pain],
        ['Ideal State', c.ideal_state],
        ['Value Driver', c.value_driver],
        ['POV', c.pov],
      ];
      return (
        <div className="border border-border/20 rounded-lg overflow-hidden">
          {rows.map(([label, value], i) => (
            <div key={i} className="border-t border-border/10 first:border-0 grid grid-cols-[1fr_1.5fr] gap-px">
              <div className="bg-muted/15 px-2.5 py-2 text-[11px] font-medium text-foreground/70">{label}</div>
              <div className="px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap">{value || 'Unknown'}</div>
            </div>
          ))}
        </div>
      );
    }

    case 'discovery_questions':
      return (
        <div className="space-y-1.5">
          {(c.questions || []).map((q: string, i: number) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="font-semibold text-primary/60 shrink-0">{i + 1}.</span>
              <span>{q}</span>
            </div>
          ))}
        </div>
      );

    case 'tech_stack': {
      const stacks = Array.isArray(c) ? c : [];
      return (
        <div className="border border-border/20 rounded-lg overflow-hidden">
          <div className="grid grid-cols-4 gap-px bg-primary/10 text-[10px] font-medium px-2 py-1">
            <span>Layer</span><span>Vendor</span><span>Evidence</span><span>Consolidation</span>
          </div>
          {stacks.map((s: any, i: number) => (
            <div key={i} className="grid grid-cols-4 gap-px text-xs px-2 py-1.5 border-t border-border/10">
              <span className="font-medium">{s.layer}</span>
              <span>{s.vendor || 'Unknown'}</span>
              <span className="text-muted-foreground text-[10px]">{s.evidence || '—'}</span>
              <span className="text-muted-foreground text-[10px]">{s.consolidation_opportunity || '—'}</span>
            </div>
          ))}
        </div>
      );
    }

    case 'exit_criteria':
      return (
        <div className="space-y-2">
          {c.known?.length > 0 && <div><p className="text-[10px] font-semibold text-green-600 mb-1">✅ Known</p>{c.known.map((k: string, i: number) => <p key={i} className="text-xs text-foreground/80 pl-3">• {k}</p>)}</div>}
          {c.gaps?.length > 0 && <div><p className="text-[10px] font-semibold text-amber-600 mb-1">❓ Gaps</p>{c.gaps.map((g: string, i: number) => <p key={i} className="text-xs text-foreground/80 pl-3">• {g}</p>)}</div>}
          {c.meddpicc_gaps?.length > 0 && <div><p className="text-[10px] font-semibold text-red-600 mb-1">🔴 MEDDPICC</p>{c.meddpicc_gaps.map((m: string, i: number) => <p key={i} className="text-xs text-foreground/80 pl-3">• {m}</p>)}</div>}
        </div>
      );

    case 'hypotheses_risks':
      return (
        <div className="space-y-2">
          {c.hypotheses?.length > 0 && <div><p className="text-[10px] font-semibold mb-1">Top Hypotheses</p>{c.hypotheses.map((h: string, i: number) => <p key={i} className="text-xs pl-3">• {h}</p>)}</div>}
          {c.blockers?.length > 0 && <div><p className="text-[10px] font-semibold text-amber-600 mb-1">Blockers</p>{c.blockers.map((b: string, i: number) => <p key={i} className="text-xs pl-3">• {b}</p>)}</div>}
          {c.risk_heatmap?.length > 0 && (
            <div className="border border-border/20 rounded-lg overflow-hidden">
              <div className="grid grid-cols-4 gap-px bg-primary/10 text-[10px] font-medium px-2 py-1"><span>Risk</span><span>Likelihood</span><span>Impact</span><span>Mitigation</span></div>
              {c.risk_heatmap.map((r: any, i: number) => (
                <div key={i} className="grid grid-cols-4 gap-px text-xs px-2 py-1.5 border-t border-border/10">
                  <span>{r.risk}</span><span>{r.likelihood}</span><span>{r.impact}</span><span className="text-muted-foreground">{r.mitigation}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );

    case 'appendix':
      return (
        <div className="space-y-3">
          {c.cx_audit_detail && <div><p className="text-[10px] font-semibold mb-1">CX Audit Detail</p><p className="text-xs text-foreground/80 whitespace-pre-wrap">{c.cx_audit_detail}</p></div>}
          {c.subscription_teardown && <div><p className="text-[10px] font-semibold mb-1">Subscription Teardown</p><p className="text-xs text-foreground/80 whitespace-pre-wrap">{c.subscription_teardown}</p></div>}
          {c.business_model_detail && <div><p className="text-[10px] font-semibold mb-1">Business Model</p><p className="text-xs text-foreground/80 whitespace-pre-wrap">{c.business_model_detail}</p></div>}
        </div>
      );

    default: {
      // Generic renderer for sections like executive_snapshot, revenue_pathway, etc.
      if (typeof c === 'string') return <p className="text-xs whitespace-pre-wrap">{c}</p>;
      if (c.summary || c.company_overview) {
        return (
          <div className="space-y-2">
            {c.company_overview && <p className="text-xs">{c.company_overview}</p>}
            {c.why_now && <div><p className="text-[10px] font-semibold mb-1">Why Now</p><p className="text-xs">{c.why_now}</p></div>}
            {c.key_metrics?.length > 0 && (
              <div className="border border-border/20 rounded-lg overflow-hidden">
                <div className="grid grid-cols-3 gap-px bg-primary/10 text-[10px] font-medium px-2 py-1"><span>Metric</span><span>Value</span><span>Source</span></div>
                {c.key_metrics.map((m: any, i: number) => (
                  <div key={i} className="grid grid-cols-3 gap-px text-xs px-2 py-1.5 border-t border-border/10">
                    <span className="font-medium">{m.metric}</span><span>{m.value}</span><span className="text-muted-foreground">{m.source}</span>
                  </div>
                ))}
              </div>
            )}
            {c.exec_priorities?.length > 0 && <div><p className="text-[10px] font-semibold mb-1">Priorities</p>{c.exec_priorities.map((p: string, i: number) => <p key={i} className="text-xs pl-3">• {p}</p>)}</div>}
          </div>
        );
      }
      // Tables (metrics, loyalty, etc.)
      if (Array.isArray(c)) {
        if (!c.length) return <p className="text-xs text-muted-foreground italic">No data</p>;
        const keys = Object.keys(c[0]);
        return (
          <div className="border border-border/20 rounded-lg overflow-hidden">
            <div className={cn('grid gap-px bg-primary/10 text-[10px] font-medium px-2 py-1', `grid-cols-${Math.min(keys.length, 6)}`)}>
              {keys.slice(0, 6).map(k => <span key={k} className="capitalize">{k.replace(/_/g, ' ')}</span>)}
            </div>
            {c.map((row: any, i: number) => (
              <div key={i} className={cn('grid gap-px text-xs px-2 py-1.5 border-t border-border/10', `grid-cols-${Math.min(keys.length, 6)}`)}>
                {keys.slice(0, 6).map(k => <span key={k} className="truncate">{row[k] || 'Unknown'}</span>)}
              </div>
            ))}
          </div>
        );
      }
      // Key-value for objects like pivot_statements, loyalty_analysis
      return (
        <div className="space-y-1">
          {Object.entries(c).map(([k, v]) => {
            if (Array.isArray(v)) {
              return (
                <div key={k}>
                  <p className="text-[10px] font-semibold capitalize mb-0.5">{k.replace(/_/g, ' ')}</p>
                  {(v as string[]).map((item, i) => <p key={i} className="text-xs pl-3">• {typeof item === 'string' ? item : JSON.stringify(item)}</p>)}
                </div>
              );
            }
            if (typeof v === 'object' && v !== null) return null;
            return (
              <div key={k} className="flex gap-2 text-xs">
                <span className="font-medium text-foreground/60 min-w-[100px] capitalize">{k.replace(/_/g, ' ')}:</span>
                <span>{String(v)}</span>
              </div>
            );
          })}
        </div>
      );
    }
  }
}

export function TaskOutputViewer({ result, onBack, onApplyRedline, onRejectRedline }: Props) {
  const safeResult = sanitizeTaskRunResult(result);
  const sections = safeResult?.draft.sections ?? [];
  const strengths = safeResult?.review.strengths ?? [];
  const redlines = safeResult?.review.redlines ?? [];
  const [activeTab, setActiveTab] = useState<Tab>('document');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(sections.map((s) => s.id))
  );
  const [importantSections, setImportantSections] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState<'docx' | 'pdf' | null>(null);

  const companyName = sections.find(s => s.id === 'cover')?.content?.opportunity
    || sections.find(s => s.id === 'cockpit')?.content?.cards?.[0]?.value?.split(' — ')?.[0]
    || 'Discovery Prep';

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleImportant = (id: string) => {
    setImportantSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const copySection = useCallback(async (section: DiscoverySection) => {
    try {
      const c = section.content;
      const body = typeof c === 'string'
        ? c
        : (() => { try { return JSON.stringify(c, null, 2); } catch { return ''; } })();
      await navigator.clipboard.writeText(`## ${section.name}\n\n${body}`);
      toast.success(`Copied "${section.name}"`);
    } catch {
      toast.error('Could not copy section');
    }
  }, []);

  const handleDownloadDocx = useCallback(async () => {
    setIsDownloading('docx');
    try {
      const blob = await generateDiscoveryDocx(sections, companyName);
      downloadBlob(blob, `Discovery_Prep_${companyName.replace(/\s+/g, '_')}.docx`);
      toast.success('DOCX downloaded');
    } catch (e) {
      console.error('DOCX generation error:', e);
      toast.error('Failed to generate DOCX');
    } finally {
      setIsDownloading(null);
    }
  }, [companyName, sections]);

  const handleDownloadPdf = useCallback(async () => {
    setIsDownloading('pdf');
    try {
      const blob = await generateDiscoveryPdf(sections, companyName);
      downloadBlob(blob, `Discovery_Prep_${companyName.replace(/\s+/g, '_')}.pdf`);
      toast.success('PDF downloaded');
    } catch (e) {
      console.error('PDF generation error:', e);
      toast.error('Failed to generate PDF');
    } finally {
      setIsDownloading(null);
    }
  }, [companyName, sections]);

  const pendingRedlines = redlines.filter(r => r.status === 'pending');
  const acceptedCount = redlines.filter(r => r.status === 'accepted').length;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-border/10 flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <FileText className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-sm font-semibold flex-1 truncate">Discovery Prep — {companyName}</h2>

        {/* Download buttons */}
        <Button
          size="sm" variant="outline"
          className="h-7 text-[10px] gap-1 border-primary/20"
          onClick={handleDownloadDocx}
          disabled={!!isDownloading || sections.length === 0}
        >
          {isDownloading === 'docx' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />}
          .docx
        </Button>
        <Button
          size="sm" variant="outline"
          className="h-7 text-[10px] gap-1 border-primary/20"
          onClick={handleDownloadPdf}
          disabled={!!isDownloading || sections.length === 0}
        >
          {isDownloading === 'pdf' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          .pdf
        </Button>

        {/* Tab switcher */}
        <div className="flex rounded-lg border border-border/20 overflow-hidden ml-1">
          <button
            className={cn(
              'px-3 py-1 text-[10px] font-medium transition-colors',
              activeTab === 'document' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/20'
            )}
            onClick={() => setActiveTab('document')}
          >
            Document
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
        <div className="px-4 py-3 max-w-3xl mx-auto">
          {activeTab === 'document' ? (
            <div className="space-y-2">
              {sections.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No document content is available for this run yet.</p>
              )}
              {sections.map((section) => {
                const isExpanded = expandedSections.has(section.id);
                const isImportant = importantSections.has(section.id);
                const icon = SECTION_ICONS[section.id] || '📄';
                const hasRedline = redlines.some(r => r.section_id === section.id && r.status === 'pending');
                const wasEdited = redlines.some(r => r.section_id === section.id && r.status === 'accepted');

                return (
                  <Card
                    key={section.id}
                    data-section-anchor={section.id}
                    className={cn(
                      'border-border/15 shadow-none scroll-mt-4 group/section',
                      hasRedline && 'border-l-2 border-l-amber-400/50',
                      wasEdited && 'border-l-2 border-l-green-400/50',
                      isImportant && 'border-l-2 border-l-primary/60',
                      section.id === 'appendix' && 'border-t-2 border-t-border/30 mt-4',
                    )}
                  >
                    <CardHeader
                      className="px-3 py-2 cursor-pointer hover:bg-muted/10 transition-colors"
                      onClick={() => toggleSection(section.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{icon}</span>
                        {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                        <CardTitle className="text-xs font-semibold text-foreground/80 flex-1 truncate">{section.name}</CardTitle>

                        {/* Status badges (always visible) */}
                        {hasRedline && (
                          <Badge variant="outline" className="text-[8px] border-amber-400/30 text-amber-600">
                            <Pencil className="h-2 w-2 mr-0.5" /> Edit suggested
                          </Badge>
                        )}
                        {wasEdited && (
                          <Badge variant="outline" className="text-[8px] border-green-400/30 text-green-600">
                            <Check className="h-2 w-2 mr-0.5" /> Updated
                          </Badge>
                        )}

                        {/* Hover controls — show on section hover or when active */}
                        <div className={cn(
                          'flex items-center gap-0.5 transition-opacity',
                          isImportant ? 'opacity-100' : 'opacity-0 group-hover/section:opacity-100',
                        )}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleImportant(section.id); }}
                            className="h-6 w-6 rounded-md hover:bg-muted/40 flex items-center justify-center"
                            title={isImportant ? 'Unmark important' : 'Mark important'}
                            aria-label={isImportant ? 'Unmark important' : 'Mark important'}
                          >
                            <Star
                              className="h-3 w-3"
                              fill={isImportant ? 'currentColor' : 'none'}
                              style={{ color: isImportant ? 'hsl(var(--primary))' : undefined }}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); copySection(section); }}
                            className="h-6 w-6 rounded-md hover:bg-muted/40 flex items-center justify-center text-muted-foreground"
                            title="Copy section"
                            aria-label="Copy section"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    {isExpanded && (
                      <CardContent className="px-3 pb-3 pt-0">
                        {renderContent(section)}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              {strengths.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5" /> What's Strong
                  </h3>
                  <div className="space-y-1.5">
                    {strengths.map((s, i) => (
                      <div key={i} className="flex gap-2 text-xs bg-green-50/50 dark:bg-green-950/20 rounded-lg px-3 py-2 border border-green-200/30">
                        <Check className="h-3 w-3 text-green-600 shrink-0 mt-0.5" />
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {redlines.length > 0 && (
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
                    {redlines.map(redline => (
                      <RedlineCard
                        key={redline.id}
                        redline={redline}
                        onAccept={() => safeResult && onApplyRedline(safeResult.run_id, redline.section_id, redline.proposed_text)}
                        onReject={() => onRejectRedline(redline.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {!strengths.length && !redlines.length && (
                <p className="text-sm text-muted-foreground text-center py-8">No review feedback generated.</p>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
