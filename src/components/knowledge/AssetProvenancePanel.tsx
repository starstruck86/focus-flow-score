/**
 * Post-Promotion Audit View with Visual Diff & QA Counters
 * Shows: original resource, source segment, transformed content,
 * removed/preserved lines, cluster/canonical status.
 * Visual diff highlights removals, placeholder normalization, and preserved high-risk lines.
 */

import { useState, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronDown, ChevronRight, History,
  Layers, AlertTriangle, Eye, BarChart3, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface ProvenanceRecord {
  id: string;
  asset_type: string;
  asset_id: string;
  source_resource_id: string;
  source_segment_index: number | null;
  source_char_range: [number, number] | null;
  source_heading: string | null;
  transformed_content: string | null;
  removed_lines: string[];
  high_risk_removals: Array<{ line: string; lineNumber: number; riskLabels: string[] }>;
  original_content: string | null;
  created_at: string;
  cluster_resolution?: {
    cluster_id: string;
    canonical_role: string;
    reasoning: string;
    demoted_count: number;
  } | null;
}

interface QACounters {
  assetsWithProvenance: number;
  tacticsMissingProvenance: number;
  clusterResolutions: number;
  highRiskRemovals: number;
  needsManualReview: number;
}

interface AssetProvenancePanelProps {
  resourceId?: string;
}

// ── Visual Diff helpers ────────────────────────────────────

type DiffLineType = 'unchanged' | 'removed' | 'added' | 'placeholder_normalized' | 'high_risk_preserved';

interface DiffLine {
  text: string;
  type: DiffLineType;
  riskLabels?: string[];
}

function computeVisualDiff(
  original: string,
  transformed: string,
  removedLines: string[],
  highRiskRemovals: Array<{ line: string; riskLabels: string[] }>,
): DiffLine[] {
  const origLines = original.split('\n');
  const transLines = transformed.split('\n');
  const removedSet = new Set(removedLines.map(l => l.trim()));
  const highRiskMap = new Map(highRiskRemovals.map(hr => [hr.line.trim(), hr.riskLabels]));
  const diff: DiffLine[] = [];

  // Walk original lines
  let tIdx = 0;
  for (const origLine of origLines) {
    const trimmed = origLine.trim();

    if (removedSet.has(trimmed)) {
      diff.push({
        text: origLine,
        type: 'removed',
        riskLabels: highRiskMap.get(trimmed),
      });
      continue;
    }

    // Check if the line was transformed (placeholder normalization)
    if (tIdx < transLines.length) {
      const transLine = transLines[tIdx];
      if (origLine !== transLine && transLine) {
        // Check if it's a placeholder normalization ({name} → [Name])
        const isPlaceholderChange = /\{(\w+)\}/.test(origLine) && /\[\w+\]/.test(transLine);
        if (isPlaceholderChange) {
          diff.push({ text: origLine, type: 'removed' });
          diff.push({ text: transLine, type: 'placeholder_normalized' });
          tIdx++;
          continue;
        }
      }
      tIdx++;
    }

    // Check if this line contained high-risk patterns but was preserved
    const hasHighRisk = highRiskMap.has(trimmed) === false &&
      (/["'""].{5,}["'""]/.test(trimmed) || /\[.*?\]|\{.*?\}/.test(trimmed) ||
       /\b(when|if|before|after)\s+(the|a|you|they)\b/i.test(trimmed));

    if (hasHighRisk && trimmed.length > 0) {
      diff.push({ text: origLine, type: 'high_risk_preserved' });
    } else {
      diff.push({ text: origLine, type: 'unchanged' });
    }
  }

  return diff;
}

const DIFF_STYLES: Record<DiffLineType, string> = {
  unchanged: 'text-muted-foreground',
  removed: 'text-destructive/80 line-through bg-destructive/10',
  added: 'text-status-green bg-status-green/10',
  placeholder_normalized: 'text-primary bg-primary/10',
  high_risk_preserved: 'text-status-green bg-status-green/5 border-l-2 border-status-green/40',
};

export function AssetProvenancePanel({ resourceId }: AssetProvenancePanelProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<ProvenanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [counters, setCounters] = useState<QACounters | null>(null);

  useEffect(() => {
    if (!user || !open) return;
    setLoading(true);

    const fetchAll = async () => {
      // Fetch provenance records
      let query = supabase
        .from('asset_provenance')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (resourceId) {
        query = query.eq('source_resource_id', resourceId);
      }

      const [{ data: provData }, { data: crData }, { count: kiCount }] = await Promise.all([
        query,
        supabase
          .from('cluster_resolutions')
          .select('cluster_id, canonical_role, reasoning, demoted_members, canonical_resource_id')
          .eq('user_id', user.id),
        supabase
          .from('knowledge_items')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .is('source_resource_id', null),
      ]);

      // Build enriched records
      const crMap = new Map<string, any>();
      if (crData) {
        for (const cr of crData as any[]) {
          if (cr.canonical_resource_id) {
            crMap.set(cr.canonical_resource_id, cr);
          }
        }
      }

      const enriched: ProvenanceRecord[] = [];
      let totalHighRisk = 0;
      let needsReview = 0;

      if (provData) {
        for (const row of provData as any[]) {
          const hrRemovals = Array.isArray(row.high_risk_removals) ? row.high_risk_removals : [];
          totalHighRisk += hrRemovals.length;
          if (hrRemovals.length > 0) needsReview++;

          const cr = crMap.get(row.source_resource_id);
          enriched.push({
            ...row,
            removed_lines: Array.isArray(row.removed_lines) ? row.removed_lines : [],
            high_risk_removals: hrRemovals,
            cluster_resolution: cr ? {
              cluster_id: cr.cluster_id,
              canonical_role: cr.canonical_role,
              reasoning: cr.reasoning,
              demoted_count: Array.isArray(cr.demoted_members) ? cr.demoted_members.length : 0,
            } : null,
          });
        }
      }

      setRecords(enriched);
      setCounters({
        assetsWithProvenance: enriched.length,
        tacticsMissingProvenance: kiCount || 0,
        clusterResolutions: crData?.length || 0,
        highRiskRemovals: totalHighRisk,
        needsManualReview: needsReview,
      });
      setLoading(false);
    };

    fetchAll();
  }, [user, open, resourceId]);

  if (!user) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-border rounded-lg">
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2.5 px-3 hover:bg-muted/50 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <History className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-foreground">Promotion Audit Trail</span>
        {records.length > 0 && (
          <Badge variant="outline" className="text-[10px] ml-auto">
            {records.length} records
          </Badge>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="px-3 pb-3 space-y-2">
        {loading && <p className="text-[10px] text-muted-foreground">Loading provenance…</p>}

        {/* QA Counters */}
        {counters && !loading && (
          <div className="flex items-center gap-2 flex-wrap p-2 rounded border border-border bg-muted/30">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-semibold text-foreground">Lineage Coverage</span>
            <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">
              {counters.assetsWithProvenance} with provenance
            </Badge>
            {counters.tacticsMissingProvenance > 0 && (
              <Badge variant="outline" className="text-[9px] border-status-yellow/50 text-status-yellow">
                {counters.tacticsMissingProvenance} knowledge items missing provenance
              </Badge>
            )}
            <Badge variant="outline" className="text-[9px]">
              {counters.clusterResolutions} cluster resolutions
            </Badge>
            {counters.highRiskRemovals > 0 && (
              <Badge variant="outline" className="text-[9px] border-destructive/50 text-destructive">
                {counters.highRiskRemovals} high-risk removals
              </Badge>
            )}
            {counters.needsManualReview > 0 && (
              <Badge variant="outline" className="text-[9px] border-status-yellow/50 text-status-yellow">
                <AlertTriangle className="h-2 w-2 mr-0.5" />
                {counters.needsManualReview} need review
              </Badge>
            )}
          </div>
        )}

        {!loading && records.length === 0 && (
          <p className="text-[10px] text-muted-foreground">No promoted assets yet.</p>
        )}

        {records.map(record => (
          <ProvenanceRecordCard
            key={record.id}
            record={record}
            expanded={expandedId === record.id}
            onToggle={() => setExpandedId(expandedId === record.id ? null : record.id)}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ProvenanceRecordCard({
  record,
  expanded,
  onToggle,
}: {
  record: ProvenanceRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const diffLines = useMemo(() => {
    if (!expanded || !record.original_content || !record.transformed_content) return [];
    return computeVisualDiff(
      record.original_content,
      record.transformed_content,
      record.removed_lines,
      record.high_risk_removals,
    );
  }, [expanded, record]);

  return (
    <div className="rounded-md border border-border bg-card p-2 space-y-1.5">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[10px] capitalize">
          {record.asset_type}
        </Badge>
        <span className="text-[10px] text-muted-foreground font-mono">
          {record.source_resource_id.slice(0, 8)}…
        </span>
        {record.source_segment_index != null && (
          <Badge variant="outline" className="text-[10px]">
            Seg #{record.source_segment_index}
          </Badge>
        )}
        {record.source_heading && (
          <Badge variant="outline" className="text-[10px]">
            §{record.source_heading.slice(0, 25)}
          </Badge>
        )}
        {record.source_char_range && (
          <span className="text-[9px] text-muted-foreground">
            chars {record.source_char_range[0]}–{record.source_char_range[1]}
          </span>
        )}
        <span className="text-[9px] text-muted-foreground ml-auto">
          {new Date(record.created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Cluster resolution */}
      {record.cluster_resolution && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <Layers className="h-3 w-3 text-primary" />
          <span className="text-muted-foreground">
            Canonical {record.cluster_resolution.canonical_role} in cluster.
            {' '}{record.cluster_resolution.demoted_count} demoted.
          </span>
          <span className="text-muted-foreground italic truncate">
            {record.cluster_resolution.reasoning.slice(0, 60)}
          </span>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-2">
        {record.removed_lines.length > 0 && (
          <Badge variant="outline" className="text-[10px] border-status-yellow/50 text-status-yellow">
            {record.removed_lines.length} removed
          </Badge>
        )}
        {record.high_risk_removals.length > 0 && (
          <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive">
            <AlertTriangle className="h-2.5 w-2.5 mr-1" />
            {record.high_risk_removals.length} high-risk
          </Badge>
        )}
        {record.removed_lines.length === 0 && (
          <Badge variant="outline" className="text-[10px] border-status-green/50 text-status-green">
            <ShieldCheck className="h-2.5 w-2.5 mr-1" /> clean
          </Badge>
        )}
      </div>

      <Button
        size="sm" variant="ghost"
        className="h-5 text-[9px] gap-1"
        onClick={onToggle}
      >
        <Eye className="h-2.5 w-2.5" />
        {expanded ? 'Collapse' : 'View Diff'}
      </Button>

      {/* Visual Diff */}
      {expanded && (
        <div className="space-y-2 mt-1">
          {/* Legend */}
          <div className="flex items-center gap-3 text-[9px] flex-wrap">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-destructive/30" /> removed
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-primary/30" /> placeholder normalized
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-status-green/30" /> high-risk preserved
            </span>
          </div>

          <ScrollArea className="max-h-[250px] border rounded bg-card">
            <div className="p-1.5 space-y-0">
              {diffLines.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'text-[9px] font-mono px-1.5 py-0.5 flex items-start gap-1.5',
                    DIFF_STYLES[line.type],
                  )}
                >
                  <span className="text-muted-foreground/50 shrink-0 w-4 text-right select-none">
                    {i + 1}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all">
                    {line.type === 'removed' && '− '}
                    {line.type === 'placeholder_normalized' && '+ '}
                    {line.text || ' '}
                  </span>
                  {line.riskLabels && line.riskLabels.length > 0 && (
                    <span className="shrink-0 flex gap-0.5">
                      {line.riskLabels.map(l => (
                        <Badge key={l} variant="outline" className="text-[8px] border-destructive/40 text-destructive">
                          {l}
                        </Badge>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* High-risk removals summary */}
          {record.high_risk_removals.length > 0 && (
            <div className="p-1.5 rounded border border-destructive/30 bg-destructive/5">
              <p className="text-[9px] font-semibold text-destructive mb-1">
                High-Risk Removals ({record.high_risk_removals.length})
              </p>
              {record.high_risk_removals.map((hr, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[9px] mb-0.5">
                  <span className="text-destructive/70 font-mono truncate flex-1">
                    L{hr.lineNumber}: {hr.line}
                  </span>
                  <span className="flex gap-0.5 shrink-0">
                    {hr.riskLabels.map(l => (
                      <Badge key={l} variant="outline" className="text-[8px] border-destructive/40 text-destructive">
                        {l}
                      </Badge>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
