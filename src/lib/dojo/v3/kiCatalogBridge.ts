/**
 * V3 KI Catalog Bridge
 *
 * Maps the existing knowledge_items foundation to V3's training architecture.
 * This is the ONLY place V3 resolves KIs — no parallel catalog, no disconnected logic.
 *
 * Architecture rule:
 *   KIs and resources ARE the product foundation.
 *   V3 is the orchestration layer on top.
 *   Every DailyAssignment must resolve to real KI IDs.
 *
 * Mapping chain:
 *   DayAnchor → KI chapters → matching KIs → focusPattern alignment → selection
 */

import { supabase } from '@/integrations/supabase/client';
import type { DayAnchor } from './dayAnchors';
import type { KICatalogEntry } from './programmingEngine';
import type { SkillFocus } from '../scenarios';

// ── Anchor → Chapter Mapping ──────────────────────────────────────
// Maps V3 weekday anchors to KI chapter values used in knowledge_items.
// A KI belongs to an anchor if its chapter falls within that anchor's domain.

const ANCHOR_CHAPTER_MAP: Record<DayAnchor, string[]> = {
  opening_cold_call: [
    'cold_calling', 'opening', 'prospecting', 'messaging',
    // Previously unmapped chapters — cold-call-adjacent
    'social_selling', 'call_opening', 'rapport_building', 're_engagement',
    'preparation', 'running_your_sales_day', 'running_sales_day',
    'time_management', 'self_management', 'mindset',
  ],
  discovery_qualification: [
    'discovery', 'Discovery', 'qualification', 'needs_analysis', 'stakeholder_navigation',
    'Stakeholder Navigation', 'Stakeholder_Navigation',
    // Previously unmapped chapters — discovery-adjacent
    'personas', 'building_trust', 'on_site_meetings', 'in_person_meetings',
    'meeting_strategy', 'meeting_strategies', 'meeting_management', 'meeting_facilitation',
    'sales_meetings', 'customer_success', 'retention',
  ],
  objection_pricing: [
    'objection_handling', 'pricing', 'competitive', 'Competitive', 'value_proposition',
    // Previously unmapped chapters — objection-adjacent
    'competitors', 'presenting_price', 'rfp_strategy', 'managing_scope',
  ],
  deal_control_negotiation: [
    'negotiation', 'closing', 'Closing', 'deal_control', 'deal_strategy', 'follow_up',
    'pipeline', 'pipeline_management', 'pipeline_patterns', 'account_strategy',
    // Previously unmapped chapters — deal-control-adjacent
    'pipeline_generation', 'pipeline_diagnosis', 'deal_reviews', 'deal_inspection',
    'deal_management', 'next_steps', 'champion_enablement', 'champion_building',
    'account_planning', 'account_management', 'territory_planning', 'territory_management',
    'forecasting', 'forecast', 'team_selling', 'strategic_planning', 'product',
    'product_feedback',
  ],
  executive_roi_mixed: [
    'executive', 'roi', 'business_case', 'leadership', 'c_suite', 'demo', 'expansion',
    'executive_engagement',
    // Previously unmapped chapters — coaching/general/management (executive-adjacent)
    'coaching', 'call_coaching', 'general', 'General',
    'hiring', 'Hiring Top Talent', 'hiring_top_talent',
    'onboarding', 'management', 'team_management', 'sales_management', 'sales_leadership',
    'training', 'sales_process', 'career_development', 'career_pathing', 'career_growth',
    'developing_people', 'developing_your_people', 'SDR_management', 'sdr_management',
    'sales_enablement', 'skill_development', 'compensation', 'ai_enablement',
    'strategy',
  ],
};

// ── Anchor → Skill Mapping ────────────────────────────────────────
// Aligns with dayAnchors.ts primarySkills for consistency.

const ANCHOR_SKILL_MAP: Record<DayAnchor, SkillFocus[]> = {
  opening_cold_call: ['objection_handling', 'deal_control'],
  discovery_qualification: ['discovery', 'qualification'],
  objection_pricing: ['objection_handling'],
  deal_control_negotiation: ['deal_control'],
  executive_roi_mixed: ['executive_response'],
};

// ── Chapter → FocusPattern Mapping ────────────────────────────────
// Maps KI chapters to the most likely canonical focus patterns.
// Used when a KI doesn't have explicit pattern tags.

const CHAPTER_PATTERN_MAP: Record<string, string[]> = {
  cold_calling: ['stay_concise_under_pressure', 'control_next_step'],
  opening: ['stay_concise_under_pressure', 'control_next_step'],
  prospecting: ['control_next_step', 'stay_concise_under_pressure'],
  discovery: ['deepen_one_level', 'tie_to_business_impact', 'ask_singular_questions', 'quantify_the_pain'],
  qualification: ['validate_real_pain', 'map_stakeholders', 'disqualify_weak_opportunities'],
  needs_analysis: ['deepen_one_level', 'test_urgency'],
  objection_handling: ['isolate_before_answering', 'reframe_to_business_impact', 'use_specific_proof'],
  pricing: ['reframe_to_business_impact', 'use_specific_proof'],
  competitive: ['use_specific_proof', 'reframe_to_business_impact'],
  value_proposition: ['reframe_to_business_impact', 'lead_with_the_number'],
  negotiation: ['name_the_risk', 'lock_mutual_commitment', 'test_before_accepting'],
  closing: ['lock_mutual_commitment', 'control_next_step', 'create_urgency_without_pressure'],
  deal_control: ['name_the_risk', 'lock_mutual_commitment', 'test_before_accepting'],
  follow_up: ['control_next_step', 'test_before_accepting'],
  pipeline: ['name_the_risk', 'create_urgency_without_pressure'],
  executive: ['lead_with_the_number', 'cut_to_three_sentences', 'anchor_to_their_priority'],
  roi: ['lead_with_the_number', 'anchor_to_their_priority'],
  business_case: ['lead_with_the_number', 'project_certainty'],
  leadership: ['anchor_to_their_priority', 'project_certainty', 'close_with_a_specific_ask'],
  c_suite: ['cut_to_three_sentences', 'close_with_a_specific_ask'],
  demo: ['anchor_to_their_priority', 'use_specific_proof'],
  messaging: ['reframe_to_business_impact', 'use_specific_proof', 'stay_concise_under_pressure'],
  stakeholder_navigation: ['map_stakeholders', 'deepen_one_level', 'anchor_to_their_priority'],
  deal_strategy: ['name_the_risk', 'lock_mutual_commitment', 'control_next_step'],
  expansion: ['anchor_to_their_priority', 'lead_with_the_number', 'use_specific_proof'],
  pipeline_management: ['name_the_risk', 'control_next_step', 'create_urgency_without_pressure'],
  pipeline_patterns: ['name_the_risk', 'create_urgency_without_pressure'],
  account_strategy: ['anchor_to_their_priority', 'map_stakeholders'],
  // ── Previously unmapped chapters ──
  coaching: ['anchor_to_their_priority', 'deepen_one_level'],
  call_coaching: ['deepen_one_level', 'isolate_before_answering'],
  general: ['stay_concise_under_pressure', 'reframe_to_business_impact'],
  personas: ['map_stakeholders', 'anchor_to_their_priority'],
  hiring: ['anchor_to_their_priority', 'project_certainty'],
  hiring_top_talent: ['anchor_to_their_priority', 'project_certainty'],
  'Hiring Top Talent': ['anchor_to_their_priority', 'project_certainty'],
  onboarding: ['deepen_one_level', 'control_next_step'],
  competitors: ['use_specific_proof', 'reframe_to_business_impact'],
  pipeline_generation: ['control_next_step', 'create_urgency_without_pressure'],
  pipeline_diagnosis: ['name_the_risk', 'create_urgency_without_pressure'],
  deal_reviews: ['name_the_risk', 'lock_mutual_commitment'],
  deal_inspection: ['name_the_risk', 'lock_mutual_commitment'],
  deal_management: ['name_the_risk', 'control_next_step'],
  next_steps: ['control_next_step', 'lock_mutual_commitment'],
  champion_enablement: ['map_stakeholders', 'anchor_to_their_priority'],
  champion_building: ['map_stakeholders', 'anchor_to_their_priority'],
  account_planning: ['anchor_to_their_priority', 'map_stakeholders'],
  account_management: ['anchor_to_their_priority', 'map_stakeholders'],
  territory_planning: ['control_next_step', 'create_urgency_without_pressure'],
  territory_management: ['control_next_step', 'create_urgency_without_pressure'],
  forecasting: ['name_the_risk', 'lead_with_the_number'],
  forecast: ['name_the_risk', 'lead_with_the_number'],
  social_selling: ['stay_concise_under_pressure', 'reframe_to_business_impact'],
  call_opening: ['stay_concise_under_pressure', 'control_next_step'],
  rapport_building: ['deepen_one_level', 'anchor_to_their_priority'],
  presenting_price: ['reframe_to_business_impact', 'lead_with_the_number'],
  rfp_strategy: ['use_specific_proof', 'reframe_to_business_impact'],
  managing_scope: ['name_the_risk', 'lock_mutual_commitment'],
  meeting_strategy: ['anchor_to_their_priority', 'control_next_step'],
  team_selling: ['map_stakeholders', 'anchor_to_their_priority'],
  strategic_planning: ['anchor_to_their_priority', 'lead_with_the_number'],
};

// ── Public API ────────────────────────────────────────────────────

/**
 * Fetch the KI catalog for a specific day anchor.
 * Returns KIs whose chapter maps to this anchor's skill domain.
 * This is what the programming engine uses for KI selection.
 */
export async function fetchKICatalogForAnchor(
  userId: string,
  anchor: DayAnchor,
): Promise<KICatalogEntry[]> {
  const chapters = ANCHOR_CHAPTER_MAP[anchor];
  const skills = ANCHOR_SKILL_MAP[anchor];

  // Fetch KIs matching this anchor's chapters OR with roleplay context
  const { data } = await supabase
    .from('knowledge_items' as any)
    .select('id, title, chapter, tags, knowledge_type, tactic_summary, when_to_use, confidence_score, updated_at, applies_to_contexts')
    .eq('user_id', userId)
    .eq('active', true)
    .in('chapter', chapters)
    .order('confidence_score', { ascending: false })
    .limit(50);

  if (!data || data.length === 0) {
    // Fallback: broaden to any KI with roleplay context
    return fetchFallbackKIs(userId, skills);
  }

  return (data as any[]).map(ki => mapKIToEntry(ki, anchor));
}

/**
 * Fetch the FULL KI catalog for the programming engine.
 * Used when the engine needs to evaluate across all anchors.
 */
export async function fetchFullKICatalog(userId: string): Promise<KICatalogEntry[]> {
  const { data } = await supabase
    .from('knowledge_items' as any)
    .select('id, title, chapter, tags, knowledge_type, tactic_summary, when_to_use, confidence_score, updated_at, applies_to_contexts')
    .eq('user_id', userId)
    .eq('active', true)
    .order('confidence_score', { ascending: false })
    .limit(200);

  if (!data) return [];

  return (data as any[]).map(ki => mapKIToEntry(ki));
}

/**
 * Get coverage analysis: which anchors have strong vs thin KI backing.
 * Returns a map of anchor → { count, hasTeachingContent, chapters }.
 */
export async function getKICoverageByAnchor(
  userId: string,
): Promise<Record<DayAnchor, AnchorCoverage>> {
  const { data } = await supabase
    .from('knowledge_items' as any)
    .select('chapter, tactic_summary, when_to_use, how_to_execute, example_usage')
    .eq('user_id', userId)
    .eq('active', true);

  const items = (data as any[]) ?? [];

  const coverage: Record<DayAnchor, AnchorCoverage> = {
    opening_cold_call: { count: 0, hasTeachingContent: false, chapters: [] },
    discovery_qualification: { count: 0, hasTeachingContent: false, chapters: [] },
    objection_pricing: { count: 0, hasTeachingContent: false, chapters: [] },
    deal_control_negotiation: { count: 0, hasTeachingContent: false, chapters: [] },
    executive_roi_mixed: { count: 0, hasTeachingContent: false, chapters: [] },
  };

  for (const ki of items) {
    const chapter = ki.chapter as string;
    const hasContent = !!(ki.tactic_summary || ki.when_to_use || ki.how_to_execute || ki.example_usage);

    for (const [anchor, chapters] of Object.entries(ANCHOR_CHAPTER_MAP)) {
      if (chapters.includes(chapter)) {
        const entry = coverage[anchor as DayAnchor];
        entry.count++;
        if (hasContent) entry.hasTeachingContent = true;
        if (!entry.chapters.includes(chapter)) entry.chapters.push(chapter);
      }
    }
  }

  return coverage;
}

export interface AnchorCoverage {
  count: number;
  hasTeachingContent: boolean;
  chapters: string[];
}

/**
 * Get the anchors for which the KI library is "thin" (< 3 KIs).
 * Used by progress/diagnostics to surface "you need more content here" signals.
 */
export function getThinAnchors(coverage: Record<DayAnchor, AnchorCoverage>): DayAnchor[] {
  return (Object.entries(coverage) as [DayAnchor, AnchorCoverage][])
    .filter(([, c]) => c.count < 3)
    .map(([anchor]) => anchor);
}

// ── Internal ──────────────────────────────────────────────────────

async function fetchFallbackKIs(
  userId: string,
  skills: SkillFocus[],
): Promise<KICatalogEntry[]> {
  // Broaden: any active KI with roleplay/coaching context
  const { data } = await supabase
    .from('knowledge_items' as any)
    .select('id, title, chapter, tags, knowledge_type, tactic_summary, when_to_use, confidence_score, updated_at, applies_to_contexts')
    .eq('user_id', userId)
    .eq('active', true)
    .contains('applies_to_contexts', ['roleplay'])
    .order('confidence_score', { ascending: false })
    .limit(20);

  if (!data) return [];
  return (data as any[]).map(ki => mapKIToEntry(ki));
}

function mapKIToEntry(ki: any, anchor?: DayAnchor): KICatalogEntry {
  const chapter = ki.chapter as string;
  const tags = (ki.tags as string[]) ?? [];

  // Derive skills from chapter (authoritative) + tags (supplementary)
  const skills = deriveSkillsFromChapter(chapter);
  const tagSkills = inferSkillsFromTags(tags);
  const allSkills = Array.from(new Set([...skills, ...tagSkills]));

  // Derive focus patterns from chapter mapping + tag inference
  const chapterPatterns = CHAPTER_PATTERN_MAP[chapter] ?? [];
  const tagPatterns = inferPatternsFromTags(tags);
  const allPatterns = Array.from(new Set([...chapterPatterns, ...tagPatterns]));

  return {
    id: ki.id,
    title: ki.title ?? '',
    skills: allSkills as SkillFocus[],
    focusPatterns: allPatterns,
    lastTaughtAt: ki.updated_at ?? null,
  };
}

/** Derive SkillFocus from KI chapter — the authoritative mapping */
function deriveSkillsFromChapter(chapter: string): SkillFocus[] {
  const map: Record<string, SkillFocus[]> = {
    cold_calling: ['objection_handling', 'deal_control'],
    opening: ['objection_handling', 'deal_control'],
    prospecting: ['deal_control'],
    messaging: ['objection_handling', 'deal_control'],
    discovery: ['discovery'],
    qualification: ['qualification'],
    needs_analysis: ['discovery'],
    stakeholder_navigation: ['discovery', 'qualification'],
    objection_handling: ['objection_handling'],
    pricing: ['objection_handling'],
    competitive: ['objection_handling'],
    value_proposition: ['objection_handling'],
    negotiation: ['deal_control'],
    closing: ['deal_control'],
    deal_control: ['deal_control'],
    deal_strategy: ['deal_control'],
    follow_up: ['deal_control'],
    pipeline: ['deal_control'],
    pipeline_management: ['deal_control'],
    pipeline_patterns: ['deal_control'],
    account_strategy: ['deal_control'],
    executive: ['executive_response'],
    roi: ['executive_response'],
    business_case: ['executive_response'],
    leadership: ['executive_response'],
    c_suite: ['executive_response'],
    demo: ['executive_response'],
    expansion: ['executive_response'],
  };
  return map[chapter] ?? ['objection_handling'];
}

// ── Tag inference (supplementary, not authoritative) ──────────────

const TAG_SKILL_MAP: Record<string, SkillFocus> = {
  objection: 'objection_handling',
  objections: 'objection_handling',
  discovery: 'discovery',
  qualification: 'qualification',
  executive: 'executive_response',
  deal_control: 'deal_control',
  negotiation: 'deal_control',
  closing: 'deal_control',
  cold_call: 'objection_handling',
  pricing: 'objection_handling',
  roi: 'executive_response',
};

function inferSkillsFromTags(tags: string[]): SkillFocus[] {
  const skills = new Set<SkillFocus>();
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    for (const [key, skill] of Object.entries(TAG_SKILL_MAP)) {
      if (lower.includes(key)) skills.add(skill);
    }
  }
  return Array.from(skills);
}

const TAG_PATTERN_MAP: Record<string, string> = {
  isolate: 'isolate_before_answering',
  reframe: 'reframe_to_business_impact',
  proof: 'use_specific_proof',
  deepen: 'deepen_one_level',
  quantify: 'quantify_the_pain',
  stakeholder: 'map_stakeholders',
  commitment: 'lock_mutual_commitment',
  next_step: 'control_next_step',
};

function inferPatternsFromTags(tags: string[]): string[] {
  const patterns = new Set<string>();
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    for (const [key, pattern] of Object.entries(TAG_PATTERN_MAP)) {
      if (lower.includes(key)) patterns.add(pattern);
    }
  }
  return Array.from(patterns);
}

// ── Exports for anchor mapping ────────────────────────────────────

export { ANCHOR_CHAPTER_MAP, ANCHOR_SKILL_MAP, CHAPTER_PATTERN_MAP };
