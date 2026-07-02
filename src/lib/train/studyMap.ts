/**
 * Study Hub data — one batched fetch that powers the /study 3-level flow.
 * READ-ONLY. Does not touch mastery writers, gate unlock logic, or graders.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ConceptStat {
  concept_id: string;
  title: string;
  spoke: string;
  topic: string;
  band: number;
  drill_ready: boolean;
  passed: boolean; // any KI on this concept with best_score >= 85 (§7.33 unified pass bar)
}

export interface TopicStat {
  spoke: string;
  topic: string;
  bands: number[];
  totalConcepts: number;
  drillReadyConcepts: number;
  passedConcepts: number;
  gates: Array<{ band: number; status: string | null }>;
  hasDeck: boolean;
  deckId: string | null;
  concepts: ConceptStat[];
}

export interface SpokeStat {
  spoke: string;
  totalConcepts: number;
  drillReadyConcepts: number;
  passedConcepts: number;
  topics: TopicStat[];
}

export interface StudyMap {
  spokes: SpokeStat[];
}

export async function fetchStudyMap(): Promise<StudyMap> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id ?? null;

  const [conceptsRes, kiRes, gatesRes, decksRes] = await Promise.all([
    (supabase as any)
      .from('curriculum_concepts')
      .select('concept_id, spoke, topic, band, title'),
    (supabase as any)
      .from('ki_curriculum')
      .select('ki_id, concept_id, drill_ready'),
    (supabase as any)
      .from('curriculum_gates')
      .select('spoke, topic, band, gate_content_status'),
    (supabase as any)
      .from('flashcard_decks')
      .select('id, source_type, source_ref, spoke')
      .eq('source_type', 'curriculum_topic'),
  ]);

  const concepts = (conceptsRes.data ?? []) as Array<{
    concept_id: string; spoke: string; topic: string; band: number; title: string;
  }>;
  const kiRows = (kiRes.data ?? []) as Array<{ ki_id: string; concept_id: string; drill_ready: boolean }>;
  const gates = (gatesRes.data ?? []) as Array<{ spoke: string; topic: string; band: number; gate_content_status: string | null }>;
  const decks = (decksRes.data ?? []) as Array<{ id: string; source_ref: string; spoke: string | null }>;

  // Concept → drill_ready?
  const drillReadyConcepts = new Set<string>();
  const kisByConcept = new Map<string, string[]>();
  for (const k of kiRows) {
    if (k.drill_ready) drillReadyConcepts.add(k.concept_id);
    if (!kisByConcept.has(k.concept_id)) kisByConcept.set(k.concept_id, []);
    kisByConcept.get(k.concept_id)!.push(k.ki_id);
  }

  // Mastery — one query for user's best_scores across relevant KIs.
  const relevantKiIds = Array.from(new Set(kiRows.map((k) => k.ki_id)));
  let passedKi = new Set<string>();
  if (uid && relevantKiIds.length > 0) {
    // Chunk to avoid huge IN() clauses.
    for (let i = 0; i < relevantKiIds.length; i += 500) {
      const slice = relevantKiIds.slice(i, i + 500);
      const { data: mast } = await (supabase as any)
        .from('ki_mastery')
        .select('ki_id, best_score')
        .eq('user_id', uid)
        .in('ki_id', slice);
      for (const m of (mast ?? []) as Array<{ ki_id: string; best_score: number | null }>) {
        if ((m.best_score ?? 0) >= 85) passedKi.add(m.ki_id);
      }
    }
  }

  // Concept passed = any of its KIs passed.
  const passedConcepts = new Set<string>();
  for (const [conceptId, kis] of kisByConcept.entries()) {
    if (kis.some((k) => passedKi.has(k))) passedConcepts.add(conceptId);
  }

  // Decks by "spoke/topic"
  const deckByRef = new Map<string, string>();
  for (const d of decks) if (d.source_ref) deckByRef.set(d.source_ref, d.id);

  // Group: spoke → topic → concepts
  const spokeMap = new Map<string, Map<string, ConceptStat[]>>();
  for (const c of concepts) {
    if (!c.spoke || !c.topic) continue;
    if (!spokeMap.has(c.spoke)) spokeMap.set(c.spoke, new Map());
    const tmap = spokeMap.get(c.spoke)!;
    if (!tmap.has(c.topic)) tmap.set(c.topic, []);
    tmap.get(c.topic)!.push({
      concept_id: c.concept_id,
      title: c.title,
      spoke: c.spoke,
      topic: c.topic,
      band: c.band,
      drill_ready: drillReadyConcepts.has(c.concept_id),
      passed: passedConcepts.has(c.concept_id),
    });
  }

  const gatesByTopic = new Map<string, Array<{ band: number; status: string | null }>>();
  for (const g of gates) {
    const key = `${g.spoke}/${g.topic}`;
    if (!gatesByTopic.has(key)) gatesByTopic.set(key, []);
    gatesByTopic.get(key)!.push({ band: g.band, status: g.gate_content_status });
  }

  const spokes: SpokeStat[] = [];
  for (const [spoke, tmap] of spokeMap.entries()) {
    const topics: TopicStat[] = [];
    for (const [topic, cs] of tmap.entries()) {
      const bands = Array.from(new Set(cs.map((c) => c.band))).sort();
      const ref = `${spoke}/${topic}`;
      const gateList = (gatesByTopic.get(ref) ?? []).sort((a, b) => a.band - b.band);
      topics.push({
        spoke,
        topic,
        bands,
        totalConcepts: cs.length,
        drillReadyConcepts: cs.filter((c) => c.drill_ready).length,
        passedConcepts: cs.filter((c) => c.passed).length,
        gates: gateList,
        hasDeck: deckByRef.has(ref),
        deckId: deckByRef.get(ref) ?? null,
        concepts: cs.sort((a, b) => a.band - b.band || a.concept_id.localeCompare(b.concept_id)),
      });
    }
    topics.sort((a, b) => a.topic.localeCompare(b.topic));
    spokes.push({
      spoke,
      totalConcepts: topics.reduce((n, t) => n + t.totalConcepts, 0),
      drillReadyConcepts: topics.reduce((n, t) => n + t.drillReadyConcepts, 0),
      passedConcepts: topics.reduce((n, t) => n + t.passedConcepts, 0),
      topics,
    });
  }
  spokes.sort((a, b) => a.spoke.localeCompare(b.spoke));

  return { spokes };
}

export function useStudyMap() {
  return useQuery({
    queryKey: ['study-map'],
    queryFn: fetchStudyMap,
    staleTime: 60_000,
  });
}
