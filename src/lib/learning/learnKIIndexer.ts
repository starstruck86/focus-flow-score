/**
 * Dynamic Playbook Engine — KI Indexer
 *
 * Normalizes raw KIs into a playbook-ready index.
 * Each KI is enriched with inferred skills, concepts, lesson roles,
 * difficulty, and a redundancy key for deduplication.
 */

import { supabase } from '@/integrations/supabase/client';
import { CHAPTER_PATTERN_MAP } from '@/lib/dojo/v3/kiCatalogBridge';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import type { KILessonRole } from './learnPlaybookSchema';

// ── Types ──────────────────────────────────────────────────────────

export interface IndexedKI {
  kiId: string;
  title: string;
  skill: SkillFocus | null;
  subSkills: string[];
  concepts: string[];
  focusPatterns: string[];
  contexts: string[];
  lessonRoles: KILessonRole[];
  difficulty: 1 | 2 | 3 | 4;
  sourceQuality: number;
  redundancyKey: string;
  freshnessTimestamp?: string | null;
}

// ── Skill inference from chapter ──────────────────────────────────

const CHAPTER_SKILL_MAP: Record<string, SkillFocus> = {
  discovery: 'discovery',
  needs_analysis: 'discovery',
  qualification: 'qualification',
  objection_handling: 'objection_handling',
  pricing: 'objection_handling',
  competitive: 'objection_handling',
  negotiation: 'deal_control',
  closing: 'deal_control',
  deal_control: 'deal_control',
  deal_strategy: 'deal_control',
  follow_up: 'deal_control',
  pipeline: 'deal_control',
  pipeline_management: 'deal_control',
  pipeline_patterns: 'deal_control',
  executive: 'executive_response',
  c_suite: 'executive_response',
  leadership: 'executive_response',
  roi: 'executive_response',
  business_case: 'executive_response',
};

// ── Concept inference ─────────────────────────────────────────────

const PATTERN_CONCEPT_MAP: Record<string, string[]> = {
  ask_singular_questions: ['singular_questions'],
  deepen_one_level: ['depth_creation'],
  quantify_the_pain: ['pain_quantification', 'cost_consequence', 'number_anchoring'],
  tie_to_business_impact: ['business_impact_framing'],
  test_urgency: ['urgency_testing'],
  stay_concise_under_pressure: ['composure'],
  isolate_before_answering: ['isolation'],
  reframe_to_business_impact: ['reframing', 'value_anchoring'],
  use_specific_proof: ['proof_anchoring'],
  control_next_step: ['next_step_discipline'],
  name_the_risk: ['risk_naming'],
  lock_mutual_commitment: ['mutual_commitment'],
  test_before_accepting: ['testing_before_accepting'],
  create_urgency_without_pressure: ['urgency_creation'],
  cut_to_three_sentences: ['brevity', 'executive_brevity'],
  lead_with_the_number: ['number_led_opening'],
  anchor_to_their_priority: ['priority_anchoring'],
  project_certainty: ['certainty_projection'],
  close_with_a_specific_ask: ['specific_ask_closing'],
  validate_real_pain: ['pain_validation'],
  map_stakeholders: ['stakeholder_mapping'],
  tie_problem_to_business_impact: ['pain_validation', 'business_impact_framing'],
  disqualify_weak_opportunities: ['disqualification_courage', 'pipeline_discipline'],
};

// ── Sub-skill inference from chapter / tags ───────────────────────

const CHAPTER_SUBSKILL_MAP: Record<string, string[]> = {
  discovery: ['Pain Excavation', 'Question Architecture'],
  needs_analysis: ['Pain Excavation'],
  qualification: ['Pain Validation', 'Stakeholder Mapping'],
  objection_handling: ['Containment', 'Reframing'],
  pricing: ['Reframing'],
  competitive: ['Reframing', 'Proof Delivery'],
  negotiation: ['Mutual Action Planning'],
  closing: ['Next Step Discipline', 'Commitment Recovery'],
  deal_control: ['Next Step Discipline', 'Risk Naming'],
  deal_strategy: ['Mutual Action Planning', 'Risk Naming'],
  follow_up: ['Next Step Discipline'],
  pipeline: ['Risk Naming'],
  pipeline_management: ['Risk Naming'],
  executive: ['Brevity Under Pressure', 'Executive Anchoring'],
  c_suite: ['Brevity Under Pressure', 'Executive Anchoring'],
  leadership: ['Executive Anchoring'],
  roi: ['Executive Anchoring'],
  business_case: ['Executive Anchoring'],
  stakeholder_navigation: ['Stakeholder Discovery'],
  account_strategy: ['Stakeholder Discovery'],
};

// ── Context inference ─────────────────────────────────────────────

function inferContexts(chapter: string, appliesTo: string[] | null): string[] {
  const contexts = new Set<string>();
  if (chapter) contexts.add(chapter);
  if (appliesTo) {
    for (const ctx of appliesTo) contexts.add(ctx);
  }
  return Array.from(contexts);
}

// ── Lesson role inference ─────────────────────────────────────────

function inferLessonRoles(
  knowledgeType: string | null,
  tags: string[] | null,
  title: string,
): KILessonRole[] {
  const roles: KILessonRole[] = [];
  const t = title.toLowerCase();
  const tagSet = new Set((tags ?? []).map(t => t.toLowerCase()));

  // Default: core_concept
  roles.push('core_concept');

  if (knowledgeType === 'framework' || tagSet.has('framework')) {
    roles.push('framework_step');
  }
  if (tagSet.has('example') || tagSet.has('case_study') || t.includes('example')) {
    roles.push('example');
  }
  if (tagSet.has('anti-pattern') || t.includes('mistake') || t.includes('don\'t') || t.includes('avoid')) {
    roles.push('counterexample');
  }
  if (tagSet.has('diagnostic') || t.includes('diagnos') || t.includes('assess')) {
    roles.push('diagnostic');
  }
  if (tagSet.has('practice') || tagSet.has('roleplay') || t.includes('practice') || t.includes('drill')) {
    roles.push('practice_seed');
  }
  if (tagSet.has('cheat') || tagSet.has('shortcut') || t.includes('cheat') || t.includes('hack')) {
    roles.push('cheat');
  }

  return [...new Set(roles)];
}

// ── Difficulty inference ──────────────────────────────────────────

function inferDifficulty(
  chapter: string,
  tags: string[] | null,
  confidenceScore: number | null,
): 1 | 2 | 3 | 4 {
  const tagSet = new Set((tags ?? []).map(t => t.toLowerCase()));

  // Executive / c-suite content is harder
  if (['executive', 'c_suite', 'leadership'].includes(chapter)) return 3;
  if (['negotiation', 'deal_strategy'].includes(chapter)) return 3;

  // Tag-based hints
  if (tagSet.has('advanced') || tagSet.has('complex')) return 4;
  if (tagSet.has('intermediate')) return 2;
  if (tagSet.has('beginner') || tagSet.has('foundational')) return 1;

  // Confidence-based fallback
  if (confidenceScore != null) {
    if (confidenceScore >= 90) return 2;
    if (confidenceScore >= 70) return 2;
  }

  return 2; // default medium
}

// ── Redundancy key ────────────────────────────────────────────────

function buildRedundancyKey(title: string, chapter: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Take first 6 significant words
  const words = normalized.split(' ').filter(w => w.length > 2).slice(0, 6);
  return `${chapter}::${words.join('_')}`;
}

// ── Core indexing function (shared) ───────────────────────────────

function indexKI(ki: any): IndexedKI {
  const chapter = ki.chapter ?? '';
  const tags = ki.tags as string[] | null;
  const appliesTo = ki.applies_to_contexts as string[] | null;

  const chapterPatterns = CHAPTER_PATTERN_MAP[chapter] ?? [];

  // Derive concepts from patterns
  const concepts = new Set<string>();
  for (const p of chapterPatterns) {
    for (const c of (PATTERN_CONCEPT_MAP[p] ?? [])) {
      concepts.add(c);
    }
  }

  return {
    kiId: ki.id,
    title: ki.title ?? '',
    skill: CHAPTER_SKILL_MAP[chapter] ?? null,
    subSkills: CHAPTER_SUBSKILL_MAP[chapter] ?? [],
    concepts: Array.from(concepts),
    focusPatterns: chapterPatterns,
    contexts: inferContexts(chapter, appliesTo),
    lessonRoles: inferLessonRoles(ki.knowledge_type, tags, ki.title ?? ''),
    difficulty: inferDifficulty(chapter, tags, ki.confidence_score),
    sourceQuality: ki.confidence_score ?? 50,
    redundancyKey: buildRedundancyKey(ki.title ?? '', chapter),
    freshnessTimestamp: ki.updated_at ?? null,
  };
}

// ── Main Indexer (full library) ───────────────────────────────────

const KI_SELECT_FIELDS = 'id, title, chapter, tags, knowledge_type, tactic_summary, when_to_use, confidence_score, applies_to_contexts, updated_at';

export async function buildKIIndex(userId?: string): Promise<IndexedKI[]> {
  let query = supabase
    .from('knowledge_items' as any)
    .select(KI_SELECT_FIELDS)
    .eq('active', true)
    .order('confidence_score', { ascending: false });

  if (userId) {
    query = query.eq('user_id', userId);
  }

  // Paginate to get full library (beyond 1000 limit)
  const allKIs: any[] = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
    if (error || !data || data.length === 0) {
      hasMore = false;
    } else {
      allKIs.push(...data);
      hasMore = data.length === pageSize;
      page++;
    }
  }

  return allKIs.map((ki: any) => indexKI(ki));
}

// ── Incremental Indexing ──────────────────────────────────────────

/**
 * Index a single KI by ID. Returns null if KI is inactive or not found.
 */
export async function indexSingleKI(kiId: string): Promise<IndexedKI | null> {
  const { data, error } = await supabase
    .from('knowledge_items' as any)
    .select(KI_SELECT_FIELDS)
    .eq('id', kiId)
    .eq('active', true)
    .maybeSingle();

  if (error || !data) return null;
  return indexKI(data);
}

/**
 * Merge an updated KI into an existing index.
 * Replaces existing entry with same kiId, or appends if new.
 */
export function mergeIndexedKI(
  existingIndex: IndexedKI[],
  updatedKI: IndexedKI,
): IndexedKI[] {
  const idx = existingIndex.findIndex(ki => ki.kiId === updatedKI.kiId);
  if (idx >= 0) {
    const result = [...existingIndex];
    result[idx] = updatedKI;
    return result;
  }
  return [...existingIndex, updatedKI];
}

// ── Helpers ───────────────────────────────────────────────────────

/** Filter index by skill */
export function getIndexedKIsForSkill(index: IndexedKI[], skill: SkillFocus): IndexedKI[] {
  return index.filter(ki => ki.skill === skill);
}

/** Filter index by concept */
export function getIndexedKIsForConcept(index: IndexedKI[], concept: string): IndexedKI[] {
  return index.filter(ki => ki.concepts.includes(concept));
}

/** Filter index by focus pattern */
export function getIndexedKIsForPattern(index: IndexedKI[], pattern: string): IndexedKI[] {
  return index.filter(ki => ki.focusPatterns.includes(pattern));
}

/** Get unique redundancy groups */
export function getRedundancyGroups(index: IndexedKI[]): Map<string, IndexedKI[]> {
  const groups = new Map<string, IndexedKI[]>();
  for (const ki of index) {
    if (!groups.has(ki.redundancyKey)) groups.set(ki.redundancyKey, []);
    groups.get(ki.redundancyKey)!.push(ki);
  }
  return groups;
}
