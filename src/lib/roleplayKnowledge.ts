/**
 * Roleplay Knowledge Layer
 *
 * Transforms trusted playbooks and resources into structured roleplay
 * scenarios that Dave can use for grounded, context-aware roleplays.
 * Feature-flagged via ENABLE_ROLEPLAY_GROUNDING.
 */

// ── Scenario Model ─────────────────────────────────────────

export interface RoleplayScenario {
  roleplayScenarioId: string;
  sourcePlaybookIds: string[];
  sourceResourceIds: string[];
  scenarioType: string;
  targetPersona: string;
  targetIndustry: string;
  stageContext: string;
  objectionThemes: string[];
  requiredMoves: string[];
  antiPatterns: string[];
  talkTrackFragments: string[];
  successCriteria: string[];
  confidence: number;
  generatedAt: string;
}

// ── Roleplay Outcome Tracking ──────────────────────────────

export interface RoleplayOutcome {
  scenarioId: string;
  roleplayType: 'daily' | 'on_demand' | 'playbook_practice' | 'skill_lab';
  persona: string;
  industry: string;
  completed: boolean;
  durationUsed: number;
  keyWeakness: string | null;
  keyStrength: string | null;
  daveAssessment: string | null;
  userSelfRating?: number;
  timestamp: string;
}

const SCENARIO_CACHE_KEY = 'roleplay-scenarios';
const OUTCOME_KEY = 'roleplay-outcomes';

// ── Scenario Generation from Playbooks ─────────────────────

interface PlaybookInput {
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
}

const SCENARIO_TYPE_MAP: Record<string, string> = {
  'cold call': 'cold_call',
  'discovery': 'discovery',
  'pricing': 'pricing_pushback',
  'objection': 'objection_handling',
  'champion': 'champion_building',
  'stakeholder': 'stakeholder_alignment',
  'urgency': 'create_urgency',
  'negotiation': 'negotiation',
  'closing': 'closing',
  'procurement': 'procurement_navigation',
};

function inferScenarioType(playbook: PlaybookInput): string {
  const text = `${playbook.problem_type} ${playbook.title}`.toLowerCase();
  for (const [keyword, type] of Object.entries(SCENARIO_TYPE_MAP)) {
    if (text.includes(keyword)) return type;
  }
  return 'general';
}

function inferPersona(playbook: PlaybookInput): string {
  if (playbook.persona_fit.length > 0) return playbook.persona_fit[0];
  return 'Director of Marketing';
}

function inferStageContext(playbook: PlaybookInput): string {
  if (playbook.stage_fit.length > 0) return playbook.stage_fit[0];
  return 'early';
}

/**
 * Generate structured roleplay scenarios from playbooks.
 * Only uses playbooks with confidence >= 40.
 */
export function generateScenariosFromPlaybooks(playbooks: PlaybookInput[]): RoleplayScenario[] {
  const trusted = playbooks.filter(p => p.confidence_score >= 40);
  return trusted.map(p => ({
    roleplayScenarioId: `scenario-${p.id}`,
    sourcePlaybookIds: [p.id],
    sourceResourceIds: [],
    scenarioType: inferScenarioType(p),
    targetPersona: inferPersona(p),
    targetIndustry: '', // filled at runtime from config
    stageContext: inferStageContext(p),
    objectionThemes: p.traps.slice(0, 3),
    requiredMoves: p.tactic_steps.slice(0, 4),
    antiPatterns: p.anti_patterns.slice(0, 3),
    talkTrackFragments: p.talk_tracks.slice(0, 3),
    successCriteria: p.what_great_looks_like.slice(0, 3),
    confidence: p.confidence_score,
    generatedAt: new Date().toISOString(),
  }));
}

// ── Scenario Selection ─────────────────────────────────────

/**
 * Select the best scenario for a roleplay session.
 * Priority: matching scenario type > high confidence > default fallback.
 */
export function selectBestScenario(
  scenarios: RoleplayScenario[],
  preferredType?: string,
  preferredPersona?: string,
  preferredIndustry?: string,
): RoleplayScenario | null {
  if (scenarios.length === 0) return null;

  let candidates = [...scenarios];

  // Filter by type if specified
  if (preferredType) {
    const typeMatch = candidates.filter(s => s.scenarioType === preferredType);
    if (typeMatch.length > 0) candidates = typeMatch;
  }

  // Prefer persona match
  if (preferredPersona) {
    const personaMatch = candidates.filter(s =>
      s.targetPersona.toLowerCase().includes(preferredPersona.toLowerCase())
    );
    if (personaMatch.length > 0) candidates = personaMatch;
  }

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];

  // Apply industry override
  if (best && preferredIndustry) {
    return { ...best, targetIndustry: preferredIndustry };
  }

  return best;
}

// ── Build Dave System Prompt from Scenario ──────────────────

export function buildGroundedRoleplayPrompt(scenario: RoleplayScenario, industry?: string): string {
  const ind = industry || scenario.targetIndustry || 'SaaS / Technology';
  const lines = [
    `You are a ${scenario.targetPersona} at a mid-market ${ind} company.`,
    `Scenario type: ${scenario.scenarioType.replace(/_/g, ' ')}.`,
    `Stage context: ${scenario.stageContext}.`,
    '',
    'BUYER BEHAVIOR RULES:',
  ];

  if (scenario.objectionThemes.length > 0) {
    lines.push(`- Use these objection themes naturally: ${scenario.objectionThemes.join('; ')}`);
  }
  if (scenario.antiPatterns.length > 0) {
    lines.push(`- Punish these anti-patterns if the rep does them: ${scenario.antiPatterns.join('; ')}`);
  }

  lines.push(
    '- Be realistic — interrupt, push back, show skepticism',
    '- Do NOT be a pushover',
    '- If the rep ramblings or pitches too early, go cold or cut them off',
    '- Keep energy and pressure high',
    '',
    'WHAT "GOOD" LOOKS LIKE FROM THE REP:',
  );

  if (scenario.successCriteria.length > 0) {
    scenario.successCriteria.forEach(c => lines.push(`- ${c}`));
  }

  if (scenario.requiredMoves.length > 0) {
    lines.push('', 'KEY MOVES THE REP SHOULD ATTEMPT:');
    scenario.requiredMoves.forEach(m => lines.push(`- ${m}`));
  }

  lines.push(
    '',
    'Stay in character for the full session. Do not break character unless the session ends.',
    'After the roleplay, provide a 2-sentence debrief highlighting one strength and one area for improvement.',
  );

  return lines.join('\n');
}

// ── Default Fallback Scenario ──────────────────────────────

export function getDefaultFallbackScenario(config?: {
  scenarioType?: string;
  persona?: string;
  industry?: string;
}): RoleplayScenario {
  return {
    roleplayScenarioId: 'default-fallback',
    sourcePlaybookIds: [],
    sourceResourceIds: [],
    scenarioType: config?.scenarioType || 'cold_call',
    targetPersona: config?.persona || 'Director of Marketing',
    targetIndustry: config?.industry || 'SaaS / Technology',
    stageContext: 'initial outreach',
    objectionThemes: [
      'Not interested right now',
      'Already have a solution',
      'Send me an email instead',
    ],
    requiredMoves: [
      'Pattern interrupt within first 10 seconds',
      'Ask a discovery question before pitching',
      'Handle objection without caving immediately',
      'Secure a next step or meeting',
    ],
    antiPatterns: [
      'Starting with "How are you today?"',
      'Pitching features before understanding pain',
      'Accepting brush-off without a second attempt',
    ],
    talkTrackFragments: [],
    successCriteria: [
      'Gets past the initial objection',
      'Asks at least one insightful question',
      'Achieves a concrete next step',
    ],
    confidence: 30,
    generatedAt: new Date().toISOString(),
  };
}

// ── Persistence ────────────────────────────────────────────

export function loadCachedScenarios(): RoleplayScenario[] {
  try {
    return JSON.parse(localStorage.getItem(SCENARIO_CACHE_KEY) || '[]');
  } catch { return []; }
}

export function saveCachedScenarios(scenarios: RoleplayScenario[]): void {
  localStorage.setItem(SCENARIO_CACHE_KEY, JSON.stringify(scenarios));
}

export function loadOutcomes(): RoleplayOutcome[] {
  try {
    return JSON.parse(localStorage.getItem(OUTCOME_KEY) || '[]');
  } catch { return []; }
}

export function recordOutcome(outcome: RoleplayOutcome): void {
  const outcomes = loadOutcomes();
  outcomes.push(outcome);
  // Keep last 100
  const trimmed = outcomes.slice(-100);
  localStorage.setItem(OUTCOME_KEY, JSON.stringify(trimmed));
}

// ── Coach / Skill Lab Helpers ──────────────────────────────

export function getUnderPracticedScenarioTypes(outcomes: RoleplayOutcome[], scenarios: RoleplayScenario[]): string[] {
  const typeCounts: Record<string, number> = {};
  for (const o of outcomes) {
    const s = scenarios.find(sc => sc.roleplayScenarioId === o.scenarioId);
    if (s) typeCounts[s.scenarioType] = (typeCounts[s.scenarioType] || 0) + 1;
  }
  const allTypes = [...new Set(scenarios.map(s => s.scenarioType))];
  return allTypes
    .filter(t => (typeCounts[t] || 0) < 2)
    .sort((a, b) => (typeCounts[a] || 0) - (typeCounts[b] || 0));
}

export function getScenarioFamilies(scenarios: RoleplayScenario[]): Record<string, RoleplayScenario[]> {
  const families: Record<string, RoleplayScenario[]> = {};
  for (const s of scenarios) {
    if (!families[s.scenarioType]) families[s.scenarioType] = [];
    families[s.scenarioType].push(s);
  }
  return families;
}
