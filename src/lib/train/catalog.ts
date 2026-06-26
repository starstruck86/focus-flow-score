/**
 * TRAIN v2 — curriculum catalog (Phase 0 reachability).
 * Enumerates spokes/topics dynamically from curriculum_concepts so the UI
 * stays correct as content evolves.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TopicEntry {
  topic: string;
  conceptCount: number;
}

export interface SpokeEntry {
  spoke: string;
  topicCount: number;
  conceptCount: number;
  topics: TopicEntry[];
}

export const SPOKE_DISPLAY_NAMES: Record<string, string> = {
  product: 'Product',
  discovery: 'Discovery',
  qualification: 'Qualification',
  deal_control: 'Deal Control',
  objection_handling: 'Objection Handling',
  competitive: 'Competitive',
  expansion: 'Expansion',
  stakeholder_navigation: 'Stakeholder Navigation',
  messaging: 'Messaging',
  c_suite: 'C-Suite',
};

export const SPOKE_DISPLAY_ORDER: string[] = [
  'product',
  'discovery',
  'qualification',
  'deal_control',
  'objection_handling',
  'competitive',
  'expansion',
  'stakeholder_navigation',
  'messaging',
  'c_suite',
];

export function spokeLabel(spoke: string): string {
  return (
    SPOKE_DISPLAY_NAMES[spoke] ??
    spoke.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function topicLabel(topic: string): string {
  return topic.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** All spokes + their topics, enumerated from curriculum_concepts. */
export async function fetchTrainCatalog(): Promise<SpokeEntry[]> {
  const { data, error } = await (supabase as any)
    .from('curriculum_concepts')
    .select('spoke, topic');
  if (error) throw error;

  const bySpoke = new Map<string, Map<string, number>>();
  for (const row of (data as Array<{ spoke: string; topic: string }>) ?? []) {
    if (!row?.spoke || !row?.topic) continue;
    if (!bySpoke.has(row.spoke)) bySpoke.set(row.spoke, new Map());
    const topicMap = bySpoke.get(row.spoke)!;
    topicMap.set(row.topic, (topicMap.get(row.topic) ?? 0) + 1);
  }

  const entries: SpokeEntry[] = Array.from(bySpoke.entries()).map(([spoke, topicMap]) => {
    const topics: TopicEntry[] = Array.from(topicMap.entries())
      .map(([topic, conceptCount]) => ({ topic, conceptCount }))
      .sort((a, b) => a.topic.localeCompare(b.topic));
    return {
      spoke,
      topicCount: topics.length,
      conceptCount: topics.reduce((acc, t) => acc + t.conceptCount, 0),
      topics,
    };
  });

  // Sort by configured display order; unknowns appended alphabetically.
  entries.sort((a, b) => {
    const ai = SPOKE_DISPLAY_ORDER.indexOf(a.spoke);
    const bi = SPOKE_DISPLAY_ORDER.indexOf(b.spoke);
    if (ai === -1 && bi === -1) return a.spoke.localeCompare(b.spoke);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return entries;
}

export function useTrainCatalog() {
  return useQuery({
    queryKey: ['train', 'catalog'],
    queryFn: fetchTrainCatalog,
    staleTime: 10 * 60 * 1000,
  });
}
