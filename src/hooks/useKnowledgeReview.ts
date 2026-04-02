/**
 * Hook for KI review workflow — low-yield resources, duplicate detection, review status updates.
 */
import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useKnowledgeItems, type KnowledgeItem } from '@/hooks/useKnowledgeItems';
import { useAllResources, type Resource } from '@/hooks/useResources';
import { toast } from 'sonner';

const TABLE = 'knowledge_items' as any;

// ── Low-yield resources ────────────────────────────────────

export interface LowYieldResource {
  resource: Resource;
  kis: KnowledgeItem[];
}

export function useLowYieldResources() {
  const { data: items = [] } = useKnowledgeItems();
  const { data: resources = [] } = useAllResources();

  return useMemo(() => {
    const byResource = new Map<string, KnowledgeItem[]>();
    for (const ki of items) {
      if (!ki.active) continue;
      const rid = ki.source_resource_id;
      if (!rid) continue;
      if (!byResource.has(rid)) byResource.set(rid, []);
      byResource.get(rid)!.push(ki);
    }

    const resourceMap = new Map(resources.map(r => [r.id, r]));
    const result: LowYieldResource[] = [];

    for (const [rid, kis] of byResource) {
      if (kis.length <= 2) {
        const resource = resourceMap.get(rid);
        if (resource) result.push({ resource, kis });
      }
    }

    return result.sort((a, b) => a.kis.length - b.kis.length);
  }, [items, resources]);
}

// ── Duplicate detection ────────────────────────────────────

export interface DuplicatePair {
  a: KnowledgeItem;
  b: KnowledgeItem;
  similarity: number;
  resourceNameA: string;
  resourceNameB: string;
}

function wordSet(text: string): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export function useDuplicateKIs() {
  const { data: items = [] } = useKnowledgeItems();
  const { data: resources = [] } = useAllResources();

  return useMemo(() => {
    const active = items.filter(i => i.active);
    const resourceMap = new Map(resources.map(r => [r.id, r.title]));
    const pairs: DuplicatePair[] = [];

    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      const aWords = wordSet(`${a.title} ${a.tactic_summary || ''}`);
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        const bWords = wordSet(`${b.title} ${b.tactic_summary || ''}`);
        const sim = jaccardSimilarity(aWords, bWords);
        if (sim > 0.5) {
          pairs.push({
            a, b, similarity: sim,
            resourceNameA: resourceMap.get(a.source_resource_id || '') || 'Unknown',
            resourceNameB: resourceMap.get(b.source_resource_id || '') || 'Unknown',
          });
        }
      }
    }

    return pairs.sort((a, b) => b.similarity - a.similarity);
  }, [items, resources]);
}

// ── Review status mutation ─────────────────────────────────

export type ReviewStatus = 'unreviewed' | 'approved' | 'needs_rework' | 'archived';

export function useSetReviewStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ReviewStatus }) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ review_status: status, updated_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-items'] }),
  });
}

export function useDeactivateKI() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ active: false, status: 'stale', updated_at: new Date().toISOString() } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      toast.success('KI deactivated');
    },
  });
}
