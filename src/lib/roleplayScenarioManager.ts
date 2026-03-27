/**
 * Roleplay Scenario Manager
 *
 * Handles automatic regeneration, freshness tracking, and lifecycle
 * management of grounded roleplay scenarios derived from playbooks.
 * Feature-flagged via ENABLE_ROLEPLAY_GROUNDING.
 */

import {
  generateScenariosFromPlaybooks,
  loadCachedScenarios,
  saveCachedScenarios,
  loadOutcomes,
  type RoleplayScenario,
  type RoleplayOutcome,
} from '@/lib/roleplayKnowledge';

// ── Freshness Model ────────────────────────────────────────

const SCENARIO_META_KEY = 'roleplay-scenario-meta';
const MAX_SCENARIO_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MIN_PLAYBOOK_CONFIDENCE = 40;

export interface ScenarioMeta {
  lastRegeneratedAt: string;
  sourcePlaybookHash: string;
  scenarioCount: number;
  staleIds: string[];
}

function loadMeta(): ScenarioMeta | null {
  try {
    const raw = localStorage.getItem(SCENARIO_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveMeta(meta: ScenarioMeta): void {
  localStorage.setItem(SCENARIO_META_KEY, JSON.stringify(meta));
}

function hashPlaybooks(playbooks: Array<{ id: string; confidence_score: number }>): string {
  return playbooks
    .filter(p => p.confidence_score >= MIN_PLAYBOOK_CONFIDENCE)
    .map(p => `${p.id}:${p.confidence_score}`)
    .sort()
    .join('|');
}

// ── Regeneration Logic ─────────────────────────────────────

export interface RegenerationResult {
  regenerated: boolean;
  reason: string;
  scenarioCount: number;
  staleRemoved: number;
}

/**
 * Check if scenarios need regeneration and regenerate if needed.
 * Called when playbooks are loaded/updated.
 */
export function regenerateScenariosIfNeeded(
  playbooks: Array<{
    id: string;
    title: string;
    problem_type: string;
    stage_fit: string[];
    persona_fit: string[];
    tactic_steps: string[];
    talk_tracks: string[];
    key_questions: string[];
    traps: string[];
    anti_patterns: string[];
    pressure_tactics: string[];
    success_criteria: string;
    what_great_looks_like: string[];
    common_mistakes: string[];
    confidence_score: number;
  }>,
): RegenerationResult {
  const meta = loadMeta();
  const currentHash = hashPlaybooks(playbooks);
  const now = Date.now();

  // Check if regeneration is needed
  const isStale = meta
    ? (now - new Date(meta.lastRegeneratedAt).getTime() > MAX_SCENARIO_AGE_MS)
    : true;
  const hashChanged = !meta || meta.sourcePlaybookHash !== currentHash;

  if (!isStale && !hashChanged) {
    return {
      regenerated: false,
      reason: 'Scenarios are fresh and playbook hash unchanged',
      scenarioCount: meta?.scenarioCount || 0,
      staleRemoved: 0,
    };
  }

  // Regenerate
  const newScenarios = generateScenariosFromPlaybooks(playbooks);

  // Preserve any scenarios from playbooks that are still trusted
  const existing = loadCachedScenarios();
  const newIds = new Set(newScenarios.map(s => s.roleplayScenarioId));
  const staleScenarios = existing.filter(s => !newIds.has(s.roleplayScenarioId));

  saveCachedScenarios(newScenarios);
  saveMeta({
    lastRegeneratedAt: new Date().toISOString(),
    sourcePlaybookHash: currentHash,
    scenarioCount: newScenarios.length,
    staleIds: staleScenarios.map(s => s.roleplayScenarioId),
  });

  return {
    regenerated: true,
    reason: hashChanged ? 'Playbook content changed' : 'Scenarios expired (>7 days)',
    scenarioCount: newScenarios.length,
    staleRemoved: staleScenarios.length,
  };
}

// ── Outcome-Informed Selection ─────────────────────────────

export interface ScenarioRecommendation {
  scenario: RoleplayScenario;
  reason: string;
  isGrounded: boolean;
}

/**
 * Select the best scenario considering practice history.
 * Elevates under-practiced scenario types, deprioritizes over-practiced ones.
 */
export function selectScenarioWithHistory(
  scenarios: RoleplayScenario[],
  preferredType?: string,
  preferredPersona?: string,
  preferredIndustry?: string,
): ScenarioRecommendation | null {
  if (scenarios.length === 0) return null;

  const outcomes = loadOutcomes();
  const typeCounts: Record<string, number> = {};
  const typeWeakness: Record<string, number> = {};

  for (const o of outcomes) {
    const s = scenarios.find(sc => sc.roleplayScenarioId === o.scenarioId);
    if (s) {
      typeCounts[s.scenarioType] = (typeCounts[s.scenarioType] || 0) + 1;
      if (o.keyWeakness) {
        typeWeakness[s.scenarioType] = (typeWeakness[s.scenarioType] || 0) + 1;
      }
    }
  }

  // Score each scenario
  const scored = scenarios.map(s => {
    let score = s.confidence;

    // Boost under-practiced types (< 3 sessions)
    const practiceCount = typeCounts[s.scenarioType] || 0;
    if (practiceCount < 2) score += 20;
    else if (practiceCount < 4) score += 10;
    else if (practiceCount > 8) score -= 10; // Slight fatigue

    // Boost types with repeated weaknesses
    const weaknessCount = typeWeakness[s.scenarioType] || 0;
    if (weaknessCount >= 2) score += 15;

    // Match preference bonuses
    if (preferredType && s.scenarioType === preferredType) score += 25;
    if (preferredPersona && s.targetPersona.toLowerCase().includes(preferredPersona.toLowerCase())) score += 10;

    return { scenario: s, score, practiceCount };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // Build reason
  const practiceCount = best.practiceCount;
  let reason: string;
  if (practiceCount === 0) {
    reason = `New scenario type: ${best.scenario.scenarioType.replace(/_/g, ' ')} — never practiced`;
  } else if (practiceCount < 3) {
    reason = `Under-practiced: ${best.scenario.scenarioType.replace(/_/g, ' ')} (${practiceCount} sessions)`;
  } else {
    reason = `Best match: ${best.scenario.scenarioType.replace(/_/g, ' ')} (confidence ${best.scenario.confidence})`;
  }

  // Apply industry override
  const scenario = preferredIndustry
    ? { ...best.scenario, targetIndustry: preferredIndustry }
    : best.scenario;

  return {
    scenario,
    reason,
    isGrounded: best.scenario.confidence >= MIN_PLAYBOOK_CONFIDENCE,
  };
}

// ── Coach / Skill Lab Helpers ──────────────────────────────

export interface ScenarioFamilySummary {
  scenarioType: string;
  displayName: string;
  scenarioCount: number;
  practiceCount: number;
  avgConfidence: number;
  weaknessCount: number;
  isUnderPracticed: boolean;
  bestScenario: RoleplayScenario | null;
}

/**
 * Get scenario family summaries for Coach / Skill Lab display.
 */
export function getScenarioFamilySummaries(): ScenarioFamilySummary[] {
  const scenarios = loadCachedScenarios();
  const outcomes = loadOutcomes();

  const families: Record<string, RoleplayScenario[]> = {};
  for (const s of scenarios) {
    if (!families[s.scenarioType]) families[s.scenarioType] = [];
    families[s.scenarioType].push(s);
  }

  const typeCounts: Record<string, number> = {};
  const typeWeakness: Record<string, number> = {};
  for (const o of outcomes) {
    const s = scenarios.find(sc => sc.roleplayScenarioId === o.scenarioId);
    if (s) {
      typeCounts[s.scenarioType] = (typeCounts[s.scenarioType] || 0) + 1;
      if (o.keyWeakness) typeWeakness[s.scenarioType] = (typeWeakness[s.scenarioType] || 0) + 1;
    }
  }

  const DISPLAY_NAMES: Record<string, string> = {
    cold_call: 'Cold Call',
    discovery: 'Discovery',
    pricing_pushback: 'Pricing Pushback',
    objection_handling: 'Objection Handling',
    champion_building: 'Champion Building',
    stakeholder_alignment: 'Stakeholder Alignment',
    create_urgency: 'Create Urgency',
    negotiation: 'Negotiation',
    closing: 'Closing',
    procurement_navigation: 'Procurement Navigation',
    general: 'General',
  };

  return Object.entries(families).map(([type, scenariosInFamily]) => {
    const practiceCount = typeCounts[type] || 0;
    const avgConfidence = scenariosInFamily.reduce((s, sc) => s + sc.confidence, 0) / scenariosInFamily.length;
    const best = [...scenariosInFamily].sort((a, b) => b.confidence - a.confidence)[0] || null;

    return {
      scenarioType: type,
      displayName: DISPLAY_NAMES[type] || type.replace(/_/g, ' '),
      scenarioCount: scenariosInFamily.length,
      practiceCount,
      avgConfidence: Math.round(avgConfidence),
      weaknessCount: typeWeakness[type] || 0,
      isUnderPracticed: practiceCount < 3,
      bestScenario: best,
    };
  }).sort((a, b) => {
    // Under-practiced first, then by weakness count
    if (a.isUnderPracticed !== b.isUnderPracticed) return a.isUnderPracticed ? -1 : 1;
    return b.weaknessCount - a.weaknessCount;
  });
}
