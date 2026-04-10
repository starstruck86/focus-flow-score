/**
 * Canonical Focus Pattern Registry
 * Single source of truth for all approved focusPattern values.
 */

import type { SkillFocus } from './scenarios';

export interface FocusPatternDef {
  id: string;
  label: string;
  skill: SkillFocus;
  description: string;
}

/** All approved focus patterns, organized by skill */
export const CANONICAL_FOCUS_PATTERNS: FocusPatternDef[] = [
  // ── Objection Handling ──
  { id: 'isolate_before_answering', label: 'Isolate before answering', skill: 'objection_handling', description: 'Pause and surface the real concern before responding' },
  { id: 'reframe_to_business_impact', label: 'Reframe to business impact', skill: 'objection_handling', description: 'Shift from feature/cost to revenue/margin/risk' },
  { id: 'use_specific_proof', label: 'Use specific proof', skill: 'objection_handling', description: 'Anchor claims with a concrete customer story or metric' },
  { id: 'control_next_step', label: 'Control the next step', skill: 'objection_handling', description: 'End with a clear, time-bound ask' },
  { id: 'stay_concise_under_pressure', label: 'Stay concise under pressure', skill: 'objection_handling', description: 'Say less, land harder' },

  // ── Discovery ──
  { id: 'deepen_one_level', label: 'Deepen one level', skill: 'discovery', description: 'When the buyer gives a surface answer, ask what it costs them' },
  { id: 'tie_to_business_impact', label: 'Tie to business impact', skill: 'discovery', description: 'Connect every problem to revenue, cost, or competitive risk' },
  { id: 'ask_singular_questions', label: 'Ask singular questions', skill: 'discovery', description: 'One question at a time — let the buyer go deep' },
  { id: 'test_urgency', label: 'Test urgency', skill: 'discovery', description: 'Probe for timeline, trigger event, or consequence of inaction' },
  { id: 'quantify_the_pain', label: 'Quantify the pain', skill: 'discovery', description: 'Attach a number, dollar amount, or timeline to the problem' },

  // ── Executive Response ──
  { id: 'lead_with_the_number', label: 'Lead with the number', skill: 'executive_response', description: 'Open with a specific metric or outcome, not context' },
  { id: 'cut_to_three_sentences', label: 'Cut to 3 sentences', skill: 'executive_response', description: 'Brevity is the skill — say it in 3 sentences or fewer' },
  { id: 'anchor_to_their_priority', label: 'Anchor to their priority', skill: 'executive_response', description: "Reference the exec's known initiative or stated goal" },
  { id: 'project_certainty', label: 'Project certainty', skill: 'executive_response', description: 'No hedging, no "I think" — speak with authority' },
  { id: 'close_with_a_specific_ask', label: 'Close with a specific ask', skill: 'executive_response', description: "End with exactly what you want — not 'thoughts?'" },

  // ── Deal Control ──
  { id: 'name_the_risk', label: 'Name the risk', skill: 'deal_control', description: 'Call out deal drift, stalling, or missing stakeholders directly' },
  { id: 'lock_mutual_commitment', label: 'Lock mutual commitment', skill: 'deal_control', description: 'Define what both sides will do by when' },
  { id: 'test_before_accepting', label: 'Test before accepting', skill: 'deal_control', description: "Don't accept 'let's circle back' — probe what's really happening" },
  { id: 'create_urgency_without_pressure', label: 'Create urgency without pressure', skill: 'deal_control', description: 'Show the cost of waiting without being aggressive' },

  // ── Qualification ──
  { id: 'validate_real_pain', label: 'Validate real pain', skill: 'qualification', description: 'Distinguish between genuine business pain and casual interest' },
  { id: 'map_stakeholders', label: 'Map stakeholders', skill: 'qualification', description: 'Identify who decides, who influences, who controls budget' },
  { id: 'disqualify_weak_opportunities', label: 'Disqualify weak opportunities', skill: 'qualification', description: 'Be willing to walk away from low-quality pipeline' },
  { id: 'tie_problem_to_business_impact', label: 'Tie problem to business impact', skill: 'qualification', description: 'Connect the stated issue to a measurable outcome' },
];

/** Set of all valid focus pattern IDs for fast lookup */
export const VALID_FOCUS_PATTERN_IDS = new Set(CANONICAL_FOCUS_PATTERNS.map(p => p.id));

/** Map from ID to label */
export const FOCUS_PATTERN_LABELS: Record<string, string> = Object.fromEntries(
  CANONICAL_FOCUS_PATTERNS.map(p => [p.id, p.label])
);

/** Map from ID to definition */
export const FOCUS_PATTERN_MAP: Record<string, FocusPatternDef> = Object.fromEntries(
  CANONICAL_FOCUS_PATTERNS.map(p => [p.id, p])
);

/** Get patterns for a specific skill */
export function getPatternsForSkill(skill: SkillFocus): FocusPatternDef[] {
  return CANONICAL_FOCUS_PATTERNS.filter(p => p.skill === skill);
}

/**
 * Normalize a raw focusPattern string to the closest valid canonical pattern.
 * Uses exact match first, then fuzzy keyword matching.
 */
export function normalizeFocusPattern(raw: string, skill?: SkillFocus): string {
  if (!raw) return '';
  
  // Exact match
  if (VALID_FOCUS_PATTERN_IDS.has(raw)) return raw;
  
  // Normalize formatting
  const cleaned = raw.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
  if (VALID_FOCUS_PATTERN_IDS.has(cleaned)) return cleaned;
  
  // Fuzzy keyword matching
  const candidates = skill 
    ? CANONICAL_FOCUS_PATTERNS.filter(p => p.skill === skill)
    : CANONICAL_FOCUS_PATTERNS;
  
  const rawLower = raw.toLowerCase();
  
  // Score each candidate by keyword overlap
  let bestMatch = '';
  let bestScore = 0;
  
  for (const p of candidates) {
    const keywords = [...p.id.split('_'), ...p.label.toLowerCase().split(' '), ...p.description.toLowerCase().split(' ')];
    const rawWords = rawLower.replace(/_/g, ' ').split(' ');
    let score = 0;
    for (const word of rawWords) {
      if (word.length < 3) continue;
      if (keywords.some(k => k.includes(word) || word.includes(k))) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = p.id;
    }
  }
  
  // Require at least 1 keyword match
  if (bestScore >= 1 && bestMatch) return bestMatch;
  
  // Fallback: return the first pattern for the skill, or the raw value
  if (skill) {
    const skillPatterns = getPatternsForSkill(skill);
    if (skillPatterns.length > 0) return skillPatterns[0].id;
  }
  
  return raw;
}

/** Safe display label for any focusPattern value */
export function formatFocusPattern(pattern: string): string {
  return FOCUS_PATTERN_LABELS[pattern] || pattern.replace(/_/g, ' ');
}
