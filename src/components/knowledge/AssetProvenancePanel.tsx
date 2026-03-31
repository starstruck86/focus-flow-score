/**
 * Post-Promotion Audit View
 * For every promoted asset, shows: original resource, source segment,
 * transformed content, removed lines, and cluster/canonical status.
 */

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronDown, ChevronRight, History, FileText,
  Layers, AlertTriangle, Eye,
} from 'lucide-react';
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

interface AssetProvenancePanelProps {
  resourceId?: string;
}

export function AssetProvenancePanel({ resourceId }: AssetProvenancePanelProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<ProvenanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !open) return;
    setLoading(true);

    const fetchProvenance = async () => {
      let query = supabase
        .from('asset_provenance')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (resourceId) {
        query = query.eq('source_resource_id', resourceId);
      }

      const { data } = await query;

      if (data) {
        // Enrich with cluster resolution data
        const enriched: ProvenanceRecord[] = [];
        for (const row of data as any[]) {
          let clusterRes = null;
          const { data: crData } = await supabase
            .from('cluster_resolutions')
            .select('cluster_id, canonical_role, reasoning, demoted_members')
            .eq('canonical_resource_id', row.source_resource_id)
            .eq('user_id', user.id)
            .limit(1);

          if (crData && crData.length > 0) {
            const cr = crData[0] as any;
            clusterRes = {
              cluster_id: cr.cluster_id,
              canonical_role: cr.canonical_role,
              reasoning: cr.reasoning,
              demoted_count: Array.isArray(cr.demoted_members) ? cr.demoted_members.length : 0,
            };
          }

          enriched.push({
            ...row,
            removed_lines: Array.isArray(row.removed_lines) ? row.removed_lines : [],
            high_risk_removals: Array.isArray(row.high_risk_removals) ? row.high_risk_removals : [],
            cluster_resolution: clusterRes,
          });
        }
        setRecords(enriched);
      }
      setLoading(false);
    };

    fetchProvenance();
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

        {!loading && records.length === 0 && (
          <p className="text-[10px] text-muted-foreground">No promoted assets yet.</p>
        )}

        {records.map(record => (
          <div key={record.id} className="rounded-md border border-border bg-card p-2 space-y-1.5">
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
                  Segment #{record.source_segment_index}
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
                  {record.cluster_resolution.demoted_count} demoted.
                </span>
                <span className="text-muted-foreground italic">
                  {record.cluster_resolution.reasoning.slice(0, 60)}
                </span>
              </div>
            )}

            {/* Removal stats */}
            <div className="flex items-center gap-2">
              {record.removed_lines.length > 0 && (
                <Badge variant="outline" className="text-[10px] border-status-yellow/50 text-status-yellow">
                  {record.removed_lines.length} lines removed
                </Badge>
              )}
              {record.high_risk_removals.length > 0 && (
                <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive">
                  <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                  {record.high_risk_removals.length} high-risk
                </Badge>
              )}
            </div>

            {/* Expandable detail */}
            <Button
              size="sm" variant="ghost"
              className="h-5 text-[9px] gap-1"
              onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
            >
              <Eye className="h-2.5 w-2.5" />
              {expandedId === record.id ? 'Collapse' : 'View Detail'}
            </Button>

            {expandedId === record.id && (
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div>
                  <p className="text-[9px] font-medium text-muted-foreground mb-0.5">Original</p>
                  <ScrollArea className="max-h-[150px] border rounded bg-muted/30">
                    <pre className="p-1.5 text-[9px] whitespace-pre-wrap font-mono text-muted-foreground">
                      {record.original_content || '(not stored)'}
                    </pre>
                  </ScrollArea>
                </div>
                <div>
                  <p className="text-[9px] font-medium text-foreground mb-0.5">Transformed</p>
                  <ScrollArea className="max-h-[150px] border rounded border-primary/20 bg-primary/5">
                    <pre className="p-1.5 text-[9px] whitespace-pre-wrap font-mono text-foreground">
                      {record.transformed_content || '(not stored)'}
                    </pre>
                  </ScrollArea>
                </div>
                {record.removed_lines.length > 0 && (
                  <div className="col-span-2">
                    <p className="text-[9px] font-medium text-status-yellow mb-0.5">Removed Lines</p>
                    <ScrollArea className="max-h-[80px] border rounded bg-destructive/5">
                      <div className="p-1.5 space-y-0.5">
                        {record.removed_lines.map((line, i) => (
                          <p key={i} className="text-[9px] text-destructive/80 font-mono line-through">
                            {String(line) || '(empty)'}
                          </p>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
