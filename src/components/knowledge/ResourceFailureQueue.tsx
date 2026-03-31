/**
 * Resource Failure Review Queue — shows resource-level pipeline failures
 * with root causes, remediation paths, and quick actions.
 */

import { useState, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronDown, ChevronRight, AlertOctagon, RotateCcw,
  FileText, Trash2, ArrowRight, Filter, Wand2, Merge,
  Crown, Star, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

// ── Types ──────────────────────────────────────────────────

export type TerminalState =
  | 'operationalized' | 'operationalized_partial'
  | 'needs_review' | 'reference_supporting' | 'reference_needs_judgment'
  | 'reference_low_leverage' | 'content_missing';

export interface ResourceDiagnosis {
  resource_id: string;
  title: string;
  route: string;
  terminal_state: TerminalState;
  failure_reasons: string[];
  retryable: boolean;
  recommended_fix: string;
  priority: 'high' | 'medium' | 'low';
  human_review_required: boolean;
  assets_created: {
    knowledge_items: number;
    knowledge_activated: number;
    templates: number;
    examples: number;
  };
  trust_failures: string[];
  most_similar_existing?: string;
}

interface ResourceFailureQueueProps {
  diagnoses: ResourceDiagnosis[];
  onRerunResource?: (resourceId: string) => void;
  onRerunStrict?: (resourceId: string) => void;
}

// ── Labels ─────────────────────────────────────────────────

const FAILURE_LABELS: Record<string, string> = {
  missing_content: 'Missing Content',
  extraction_returned_zero: 'No Actions Found',
  extraction_too_generic: 'Too Generic',
  trust_failed_specificity: 'Not Specific',
  trust_failed_actionability: 'Not Actionable',
  trust_failed_distinctness: 'Too Similar',
  trust_failed_use_case_clarity: 'Unclear Use Case',
  trust_failed_phrasing_quality: 'AI-Sounding',
  duplicate_template: 'Duplicate Template',
  duplicate_example: 'Duplicate Example',
  duplicate_knowledge: 'Duplicate Knowledge',
  routed_reference_only: 'Reference Only',
  stale_blocker_state: 'Stale / Stuck',
  malformed_source: 'Bad Source',
  template_incomplete: 'Incomplete Template',
  example_not_strong_enough: 'Weak Example',
  tactic_not_atomic: 'Too Broad',
  extraction_error: 'Extraction Error',
};

const STATE_LABELS: Record<string, string> = {
  operationalized_partial: 'Partial Success',
  needs_review: 'Needs Review',
  reference_supporting: 'Reference — Supporting',
  reference_needs_judgment: 'Reference — Needs Judgment',
  reference_low_leverage: 'Reference — Low Leverage',
  content_missing: 'Missing Content',
};

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-destructive/15 text-destructive border-destructive/30',
  medium: 'bg-status-yellow/15 text-status-yellow border-status-yellow/30',
  low: 'bg-muted text-muted-foreground border-border',
};

type FailureFilter = string;

// ── Component ──────────────────────────────────────────────

export function ResourceFailureQueue({ diagnoses, onRerunResource, onRerunStrict }: ResourceFailureQueueProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [filters, setFilters] = useState<Set<FailureFilter>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Show needs_review, content_missing, and operationalized_partial
  const failedDiagnoses = useMemo(() =>
    diagnoses.filter(d =>
      ['needs_review', 'content_missing', 'operationalized_partial'].includes(d.terminal_state) &&
      !dismissed.has(d.resource_id)
    ),
    [diagnoses, dismissed]
  );

  const reasonCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of failedDiagnoses) {
      for (const r of d.failure_reasons) {
        counts[r] = (counts[r] || 0) + 1;
      }
    }
    return counts;
  }, [failedDiagnoses]);

  const filteredDiagnoses = useMemo(() => {
    if (filters.size === 0) return failedDiagnoses;
    return failedDiagnoses.filter(d =>
      d.failure_reasons.some(r => filters.has(r))
    );
  }, [failedDiagnoses, filters]);

  const toggleFilter = useCallback((reason: string) => {
    setFilters(prev => {
      const next = new Set(prev);
      next.has(reason) ? next.delete(reason) : next.add(reason);
      return next;
    });
  }, []);

  const handleMarkReference = useCallback(async (resourceId: string) => {
    await supabase.from('resources').update({ content_classification: 'reference' } as any).eq('id', resourceId);
    setDismissed(prev => new Set(prev).add(resourceId));
    qc.invalidateQueries({ queryKey: ['resources'] });
    toast.success('Marked as reference');
  }, [qc]);

  const handlePromoteTemplate = useCallback(async (d: ResourceDiagnosis) => {
    if (!user) return;
    await supabase.from('execution_templates' as any).insert({
      user_id: user.id, title: d.title, body: '', template_type: 'email',
      output_type: 'custom', template_origin: 'promoted_from_resource',
      status: 'active', created_by_user: false,
    } as any);
    setDismissed(prev => new Set(prev).add(d.resource_id));
    qc.invalidateQueries({ queryKey: ['resources'] });
    toast.success('Promoted as template');
  }, [user, qc]);

  const handlePromoteExample = useCallback(async (d: ResourceDiagnosis) => {
    if (!user) return;
    await supabase.from('execution_outputs').insert({
      user_id: user.id, title: d.title, content: '',
      output_type: 'custom', is_strong_example: true,
    });
    setDismissed(prev => new Set(prev).add(d.resource_id));
    qc.invalidateQueries({ queryKey: ['resources'] });
    toast.success('Promoted as example');
  }, [user, qc]);

  const handleDismiss = useCallback((resourceId: string) => {
    setDismissed(prev => new Set(prev).add(resourceId));
  }, []);

  if (failedDiagnoses.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-destructive/20 rounded-lg bg-destructive/5">
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2.5 px-3 hover:bg-destructive/10 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-destructive" /> : <ChevronRight className="h-3.5 w-3.5 text-destructive" />}
        <AlertOctagon className="h-4 w-4 text-destructive" />
        <span className="text-xs font-semibold text-foreground">Resource Failures — Needs Fix</span>
        <Badge variant="outline" className="text-[10px] ml-auto bg-destructive/15 text-destructive border-destructive/30">
          {filteredDiagnoses.length}{filters.size > 0 ? ` / ${failedDiagnoses.length}` : ''}
        </Badge>
      </CollapsibleTrigger>

      <CollapsibleContent className="px-3 pb-3 space-y-2">
        <p className="text-[10px] text-muted-foreground">
          Resources that could not be fully operationalized. Each shows why it failed and how to fix it.
        </p>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-1">
          {Object.entries(reasonCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 8)
            .map(([reason, count]) => {
              const isActive = filters.has(reason);
              return (
                <Button
                  key={reason}
                  size="sm"
                  variant={isActive ? 'default' : 'outline'}
                  className={cn('h-6 text-[10px] gap-1', !isActive && 'opacity-70')}
                  onClick={() => toggleFilter(reason)}
                >
                  <Filter className="h-2.5 w-2.5" />
                  {FAILURE_LABELS[reason] || reason} ({count})
                </Button>
              );
            })}
          {filters.size > 0 && (
            <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground" onClick={() => setFilters(new Set())}>
              Clear
            </Button>
          )}
        </div>

        {/* Resource rows */}
        {filteredDiagnoses.slice(0, 30).map(d => (
          <div key={d.resource_id} className="p-2.5 rounded-md border border-border bg-card text-xs space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-foreground">{d.title}</span>
                  <Badge variant="outline" className={cn('text-[9px]', PRIORITY_BADGE[d.priority])}>
                    {d.priority}
                  </Badge>
                  {d.terminal_state !== 'needs_review' && (
                    <Badge variant="outline" className="text-[9px]">
                      {STATE_LABELS[d.terminal_state] || d.terminal_state}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[9px]">
                    {d.route || 'unrouted'}
                  </Badge>
                </div>

                {/* Failure reasons */}
                <div className="flex flex-wrap gap-1 mt-1">
                  {d.failure_reasons.map(r => (
                    <Badge key={r} variant="outline" className="text-[9px] border-destructive/30 bg-destructive/5 text-destructive">
                      {FAILURE_LABELS[r] || r}
                    </Badge>
                  ))}
                </div>

                {/* Similar existing */}
                {d.most_similar_existing && (
                  <p className="text-[10px] text-status-yellow mt-0.5">
                    Similar to: "{d.most_similar_existing}"
                  </p>
                )}

                {/* Assets created (partial success) */}
                {(d.assets_created.knowledge_items > 0 || d.assets_created.templates > 0 || d.assets_created.examples > 0) && (
                  <p className="text-[10px] text-status-green mt-0.5">
                    Partial: {d.assets_created.knowledge_items > 0 ? `${d.assets_created.knowledge_items} KI (${d.assets_created.knowledge_activated} active)` : ''}
                    {d.assets_created.templates > 0 ? ` · ${d.assets_created.templates} template` : ''}
                    {d.assets_created.examples > 0 ? ` · ${d.assets_created.examples} example` : ''}
                  </p>
                )}

                {/* Remediation */}
                <div className="mt-1.5 p-1.5 rounded bg-muted/50 border border-border">
                  <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                    <ArrowRight className="h-2.5 w-2.5 mt-0.5 shrink-0 text-primary" />
                    <span>{d.recommended_fix.split(' | ')[0]}</span>
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-1 shrink-0">
                {d.retryable && onRerunResource && (
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => onRerunResource(d.resource_id)}>
                    <RotateCcw className="h-3 w-3" /> Retry
                  </Button>
                )}
                {d.retryable && onRerunStrict && (
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => onRerunStrict(d.resource_id)}>
                    <Wand2 className="h-3 w-3" /> Strict
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => handlePromoteTemplate(d)}>
                  <Crown className="h-3 w-3" /> Template
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => handlePromoteExample(d)}>
                  <Star className="h-3 w-3" /> Example
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => handleMarkReference(d.resource_id)}>
                  <FileText className="h-3 w-3" /> Reference
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground" onClick={() => handleDismiss(d.resource_id)}>
                  <Trash2 className="h-3 w-3" /> Dismiss
                </Button>
              </div>
            </div>
          </div>
        ))}
        {filteredDiagnoses.length > 30 && (
          <p className="text-[10px] text-muted-foreground text-center py-1">+ {filteredDiagnoses.length - 30} more</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
