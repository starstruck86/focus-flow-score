/**
 * Deal Execution Engine
 *
 * Autonomous strategic execution layer:
 * 1. Global prioritization — "next best action" per deal
 * 2. Multi-playbook sequencing — chained playbook execution
 * 3. Persistent deal memory — objections, approaches, stakeholders
 * 4. Meta-learning — self-optimizing weights and rankings
 */

import { createLogger } from './logger';

const log = createLogger('DealExecutionEngine');

// ── Deal Memory ────────────────────────────────────────────

export interface DealMemoryEntry {
  dealId: string;
  timestamp: string;
  type:
    | 'objection_seen'
    | 'stakeholder_engaged'
    | 'approach_failed'
    | 'approach_succeeded'
    | 'playbook_used'
    | 'playbook_skipped'
    | 'fatigue_signal'
    | 'engagement_trend'
    | 'stage_change'
    | 'risk_flagged';
  detail: string;
  playbookId?: string;
  stakeholder?: string;
  metadata?: Record<string, unknown>;
}

export interface DealMemory {
  dealId: string;
  entries: DealMemoryEntry[];
  objectionsEncountered: string[];
  stakeholdersEngaged: string[];
  failedApproaches: string[];
  successfulApproaches: string[];
  playbooksUsed: string[];
  fatigueSignals: number; // count of fatigue events
  lastEngagementTrend: 'improving' | 'declining' | 'stable' | 'unknown';
  updatedAt: string;
}

const MEMORY_STORAGE_KEY = 'deal-execution-memory';

export function loadDealMemory(dealId: string): DealMemory {
  try {
    const all = JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY) || '{}');
    if (all[dealId]) return all[dealId];
  } catch {}
  return createEmptyMemory(dealId);
}

function createEmptyMemory(dealId: string): DealMemory {
  return {
    dealId,
    entries: [],
    objectionsEncountered: [],
    stakeholdersEngaged: [],
    failedApproaches: [],
    successfulApproaches: [],
    playbooksUsed: [],
    fatigueSignals: 0,
    lastEngagementTrend: 'unknown',
    updatedAt: new Date().toISOString(),
  };
}

export function recordDealEvent(dealId: string, entry: Omit<DealMemoryEntry, 'dealId' | 'timestamp'>): DealMemory {
  const memory = loadDealMemory(dealId);
  const full: DealMemoryEntry = { ...entry, dealId, timestamp: new Date().toISOString() };
  memory.entries.push(full);

  // Keep last 200 entries
  if (memory.entries.length > 200) memory.entries = memory.entries.slice(-200);

  // Update aggregates
  switch (entry.type) {
    case 'objection_seen':
      if (!memory.objectionsEncountered.includes(entry.detail))
        memory.objectionsEncountered.push(entry.detail);
      break;
    case 'stakeholder_engaged':
      if (entry.stakeholder && !memory.stakeholdersEngaged.includes(entry.stakeholder))
        memory.stakeholdersEngaged.push(entry.stakeholder);
      break;
    case 'approach_failed':
      if (!memory.failedApproaches.includes(entry.detail))
        memory.failedApproaches.push(entry.detail);
      break;
    case 'approach_succeeded':
      if (!memory.successfulApproaches.includes(entry.detail))
        memory.successfulApproaches.push(entry.detail);
      break;
    case 'playbook_used':
      if (entry.playbookId && !memory.playbooksUsed.includes(entry.playbookId))
        memory.playbooksUsed.push(entry.playbookId);
      break;
    case 'fatigue_signal':
      memory.fatigueSignals++;
      break;
    case 'engagement_trend':
      memory.lastEngagementTrend = (entry.detail as DealMemory['lastEngagementTrend']) || 'unknown';
      break;
  }

  memory.updatedAt = new Date().toISOString();
  saveDealMemory(memory);
  return memory;
}

function saveDealMemory(memory: DealMemory): void {
  try {
    const all = JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY) || '{}');
    all[memory.dealId] = memory;
    // Keep max 50 deals
    const keys = Object.keys(all);
    if (keys.length > 50) {
      const sorted = keys
        .map(k => ({ k, t: all[k].updatedAt || '' }))
        .sort((a, b) => b.t.localeCompare(a.t));
      const keep = new Set(sorted.slice(0, 50).map(s => s.k));
      for (const k of keys) { if (!keep.has(k)) delete all[k]; }
    }
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export function clearDealMemory(dealId: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY) || '{}');
    delete all[dealId];
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

// ── Global Prioritization Engine ───────────────────────────

export interface DealSignals {
  dealId: string;
  dealName: string;
  arrK: number;               // ARR in thousands
  stage: string;
  daysSinceLastTouch: number;
  daysUntilClose: number | null;
  hasNextStep: boolean;
  churnRisk: string | null;    // 'high' | 'certain' | 'moderate' | null
  stakeholderCount: number;
  competitionPresent: boolean;
  meddiccCoverage: number;     // 0-100
  isNewLogo: boolean;
}

export interface NextBestAction {
  dealId: string;
  dealName: string;
  urgency: number;            // 0-100
  confidence: number;         // 0-100
  riskLevel: 'critical' | 'high' | 'moderate' | 'low';
  recommendedPlaybookId: string | null;
  recommendedAction: string;
  reason: string;
  sequencePosition: number | null; // if part of a sequence
}

export interface PrioritizationWeights {
  revenueWeight: number;      // default 0.30
  riskWeight: number;         // default 0.25
  momentumWeight: number;     // default 0.20
  stalenessWeight: number;    // default 0.15
  complexityWeight: number;   // default 0.10
}

const DEFAULT_WEIGHTS: PrioritizationWeights = {
  revenueWeight: 0.30,
  riskWeight: 0.25,
  momentumWeight: 0.20,
  stalenessWeight: 0.15,
  complexityWeight: 0.10,
};

export function computeDealUrgency(signals: DealSignals, weights: PrioritizationWeights = DEFAULT_WEIGHTS): number {
  // Revenue component: log-scaled ARR
  const revenueScore = Math.min(100, (Math.log10(Math.max(signals.arrK, 1)) / Math.log10(500)) * 100);

  // Risk component
  let riskScore = 0;
  if (signals.churnRisk === 'certain') riskScore = 100;
  else if (signals.churnRisk === 'high') riskScore = 75;
  else if (signals.churnRisk === 'moderate') riskScore = 40;
  if (signals.daysUntilClose !== null && signals.daysUntilClose <= 7) riskScore = Math.max(riskScore, 80);
  if (signals.daysUntilClose !== null && signals.daysUntilClose <= 14) riskScore = Math.max(riskScore, 60);

  // Momentum: inverse of staleness, boosted by next step presence
  const stalenessScore = Math.min(100, (signals.daysSinceLastTouch / 21) * 100);
  const momentumScore = signals.hasNextStep ? Math.max(0, 100 - stalenessScore) : Math.max(0, 60 - stalenessScore);

  // Complexity: MEDDICC gaps + competition + stakeholder depth
  let complexityScore = 100 - signals.meddiccCoverage;
  if (signals.competitionPresent) complexityScore = Math.min(100, complexityScore + 15);
  if (signals.stakeholderCount < 2) complexityScore = Math.min(100, complexityScore + 10);

  const raw =
    revenueScore * weights.revenueWeight +
    riskScore * weights.riskWeight +
    (100 - momentumScore) * weights.momentumWeight +  // lower momentum = more urgent
    stalenessScore * weights.stalenessWeight +
    complexityScore * weights.complexityWeight;

  return Math.round(Math.min(100, Math.max(0, raw)));
}

export function classifyRisk(urgency: number): NextBestAction['riskLevel'] {
  if (urgency >= 80) return 'critical';
  if (urgency >= 60) return 'high';
  if (urgency >= 35) return 'moderate';
  return 'low';
}

export function determineRecommendedAction(signals: DealSignals, memory: DealMemory): { action: string; reason: string } {
  // Priority: close risk > staleness > missing next step > MEDDICC gaps > multithreading
  if (signals.daysUntilClose !== null && signals.daysUntilClose <= 7) {
    return { action: 'Close preparation — confirm decision timeline', reason: `Close date in ${signals.daysUntilClose} days` };
  }
  if (signals.churnRisk === 'certain' || signals.churnRisk === 'high') {
    return { action: 'Risk mitigation — schedule executive alignment', reason: `Churn risk: ${signals.churnRisk}` };
  }
  if (signals.daysSinceLastTouch >= 14) {
    return { action: 'Re-engage — send value-driven follow-up', reason: `${signals.daysSinceLastTouch}d since last touch` };
  }
  if (!signals.hasNextStep) {
    return { action: 'Define next step — lock specific commitment', reason: 'No next step defined' };
  }
  if (signals.meddiccCoverage < 40) {
    const gaps = memory.objectionsEncountered.length > 0
      ? `MEDDICC at ${signals.meddiccCoverage}%, ${memory.objectionsEncountered.length} objections logged`
      : `MEDDICC coverage only ${signals.meddiccCoverage}%`;
    return { action: 'Deepen discovery — fill MEDDICC gaps', reason: gaps };
  }
  if (signals.stakeholderCount < 2) {
    return { action: 'Multithread — identify additional stakeholders', reason: 'Single-threaded deal' };
  }
  if (memory.failedApproaches.length >= 2) {
    return { action: 'Pivot strategy — previous approaches failed', reason: `${memory.failedApproaches.length} failed approaches recorded` };
  }
  return { action: 'Advance deal — execute current next step', reason: 'On track — maintain momentum' };
}

export function prioritizeDeals(
  deals: DealSignals[],
  weights?: PrioritizationWeights,
): NextBestAction[] {
  const w = weights || DEFAULT_WEIGHTS;

  return deals
    .map(d => {
      const memory = loadDealMemory(d.dealId);
      const urgency = computeDealUrgency(d, w);
      const { action, reason } = determineRecommendedAction(d, memory);
      const confidence = computeActionConfidence(d, memory);

      return {
        dealId: d.dealId,
        dealName: d.dealName,
        urgency,
        confidence,
        riskLevel: classifyRisk(urgency),
        recommendedPlaybookId: null, // filled by sequencing engine
        recommendedAction: action,
        reason,
        sequencePosition: null,
      };
    })
    .sort((a, b) => b.urgency - a.urgency || b.confidence - a.confidence);
}

function computeActionConfidence(signals: DealSignals, memory: DealMemory): number {
  let conf = 50;
  // More data = more confidence
  if (signals.hasNextStep) conf += 10;
  if (signals.meddiccCoverage >= 60) conf += 10;
  if (memory.entries.length >= 5) conf += 10;
  if (memory.successfulApproaches.length >= 1) conf += 10;
  // Less confidence if repeated failures
  if (memory.failedApproaches.length >= 3) conf -= 15;
  if (memory.fatigueSignals >= 3) conf -= 10;
  if (memory.lastEngagementTrend === 'declining') conf -= 10;
  if (memory.lastEngagementTrend === 'improving') conf += 10;
  return Math.max(10, Math.min(100, conf));
}

// ── Playbook Sequencing Engine ─────────────────────────────

export interface PlaybookSequenceStep {
  playbookId: string;
  label: string;
  requiredSignals: string[];     // conditions to start this step
  skipConditions: string[];      // conditions to skip
  branchOnFailure?: string;      // alternative playbookId if this fails
}

export interface PlaybookSequence {
  id: string;
  name: string;
  description: string;
  applicableStages: string[];
  steps: PlaybookSequenceStep[];
}

export const STANDARD_SEQUENCES: PlaybookSequence[] = [
  {
    id: 'seq-new-logo-full',
    name: 'New Logo Full Cycle',
    description: 'Discovery → Demo → Proposal → Close',
    applicableStages: ['prospecting', 'discovery', 'demo', 'proposal', 'negotiation'],
    steps: [
      { playbookId: 'pb-early-credibility', label: 'Establish credibility', requiredSignals: ['stage:prospecting'], skipConditions: ['has_meeting_booked'] },
      { playbookId: 'pb-discovery-depth', label: 'Deep discovery', requiredSignals: ['stage:discovery'], skipConditions: ['meddicc_coverage>60'] },
      { playbookId: 'pb-champion-building', label: 'Build champion', requiredSignals: ['has_key_contact'], skipConditions: ['champion_confirmed'], branchOnFailure: 'pb-multithreading' },
      { playbookId: 'pb-demo-execution', label: 'Demo tailored to pain', requiredSignals: ['stage:demo', 'pain_identified'], skipConditions: [] },
      { playbookId: 'pb-create-urgency', label: 'Create urgency', requiredSignals: ['stage:proposal'], skipConditions: ['buyer_committed_timeline'] },
      { playbookId: 'pb-closing-commitment', label: 'Close the deal', requiredSignals: ['stage:negotiation'], skipConditions: [] },
    ],
  },
  {
    id: 'seq-stalled-recovery',
    name: 'Stalled Deal Recovery',
    description: 'Re-engage → Reassess → Redirect → Close',
    applicableStages: ['discovery', 'demo', 'proposal', 'negotiation'],
    steps: [
      { playbookId: 'pb-recover-stalled', label: 'Re-engage contact', requiredSignals: ['days_stale>14'], skipConditions: [] },
      { playbookId: 'pb-discovery-depth', label: 'Reassess pain and priority', requiredSignals: ['contact_responsive'], skipConditions: ['meddicc_coverage>60'] },
      { playbookId: 'pb-create-urgency', label: 'Rebuild urgency', requiredSignals: ['pain_confirmed'], skipConditions: [], branchOnFailure: 'pb-next-step-control' },
    ],
  },
  {
    id: 'seq-competitive',
    name: 'Competitive Displacement',
    description: 'Defend → Differentiate → Prove → Close',
    applicableStages: ['discovery', 'demo', 'proposal', 'negotiation'],
    steps: [
      { playbookId: 'pb-competitor-defense', label: 'Understand competitive landscape', requiredSignals: ['competition_present'], skipConditions: [] },
      { playbookId: 'pb-demo-execution', label: 'Differentiation demo', requiredSignals: ['stage:demo'], skipConditions: [] },
      { playbookId: 'pb-closing-commitment', label: 'Close with urgency', requiredSignals: ['stage:negotiation'], skipConditions: [] },
    ],
  },
];

export interface SequenceState {
  sequenceId: string;
  dealId: string;
  currentStepIndex: number;
  completedSteps: number[];
  skippedSteps: number[];
  failedSteps: number[];
  startedAt: string;
  updatedAt: string;
}

const SEQUENCE_STORAGE_KEY = 'deal-sequence-states';

export function loadSequenceState(dealId: string): SequenceState | null {
  try {
    const all = JSON.parse(localStorage.getItem(SEQUENCE_STORAGE_KEY) || '{}');
    return all[dealId] || null;
  } catch { return null; }
}

export function startSequence(dealId: string, sequenceId: string): SequenceState {
  const state: SequenceState = {
    sequenceId,
    dealId,
    currentStepIndex: 0,
    completedSteps: [],
    skippedSteps: [],
    failedSteps: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveSequenceState(state);
  return state;
}

export function advanceSequence(dealId: string, outcome: 'completed' | 'skipped' | 'failed'): SequenceState | null {
  const state = loadSequenceState(dealId);
  if (!state) return null;

  const seq = STANDARD_SEQUENCES.find(s => s.id === state.sequenceId);
  if (!seq) return null;

  if (outcome === 'completed') state.completedSteps.push(state.currentStepIndex);
  else if (outcome === 'skipped') state.skippedSteps.push(state.currentStepIndex);
  else if (outcome === 'failed') {
    state.failedSteps.push(state.currentStepIndex);
    // Check for branch-on-failure
    const failedStep = seq.steps[state.currentStepIndex];
    if (failedStep?.branchOnFailure) {
      // Find step with that playbookId and jump to it
      const branchIdx = seq.steps.findIndex(s => s.playbookId === failedStep.branchOnFailure);
      if (branchIdx >= 0) {
        state.currentStepIndex = branchIdx;
        state.updatedAt = new Date().toISOString();
        saveSequenceState(state);
        return state;
      }
    }
  }

  // Advance to next step
  state.currentStepIndex++;
  state.updatedAt = new Date().toISOString();
  saveSequenceState(state);
  return state;
}

export function getCurrentSequenceStep(dealId: string): { step: PlaybookSequenceStep; position: number; total: number } | null {
  const state = loadSequenceState(dealId);
  if (!state) return null;

  const seq = STANDARD_SEQUENCES.find(s => s.id === state.sequenceId);
  if (!seq || state.currentStepIndex >= seq.steps.length) return null;

  return {
    step: seq.steps[state.currentStepIndex],
    position: state.currentStepIndex + 1,
    total: seq.steps.length,
  };
}

export function selectBestSequence(signals: DealSignals): PlaybookSequence | null {
  if (signals.daysSinceLastTouch >= 14) {
    return STANDARD_SEQUENCES.find(s => s.id === 'seq-stalled-recovery') || null;
  }
  if (signals.competitionPresent) {
    return STANDARD_SEQUENCES.find(s => s.id === 'seq-competitive') || null;
  }
  if (signals.isNewLogo) {
    return STANDARD_SEQUENCES.find(s => s.id === 'seq-new-logo-full') || null;
  }
  return null;
}

function saveSequenceState(state: SequenceState): void {
  try {
    const all = JSON.parse(localStorage.getItem(SEQUENCE_STORAGE_KEY) || '{}');
    all[state.dealId] = state;
    localStorage.setItem(SEQUENCE_STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

// ── Meta-Learning Layer ────────────────────────────────────

export interface MetaLearningRecord {
  timestamp: string;
  type: 'weight_adjustment' | 'playbook_performance' | 'cluster_quality';
  data: Record<string, unknown>;
}

export interface LearnedWeights {
  weights: PrioritizationWeights;
  sampleSize: number;
  lastUpdated: string;
  adjustmentHistory: Array<{ field: string; oldValue: number; newValue: number; reason: string; timestamp: string }>;
}

const META_STORAGE_KEY = 'deal-meta-learning';

export function loadLearnedWeights(): LearnedWeights {
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    weights: { ...DEFAULT_WEIGHTS },
    sampleSize: 0,
    lastUpdated: new Date().toISOString(),
    adjustmentHistory: [],
  };
}

export interface OutcomeCorrelation {
  field: keyof PrioritizationWeights;
  currentWeight: number;
  suggestedWeight: number;
  correlation: number;  // -1 to 1
  sampleSize: number;
}

/**
 * Analyze outcome data to suggest weight adjustments.
 * Each outcome has the deal signals + whether the deal progressed positively.
 */
export function analyzeWeightCorrelations(
  outcomes: Array<{ signals: DealSignals; positiveOutcome: boolean }>,
): OutcomeCorrelation[] {
  if (outcomes.length < 10) return []; // need minimum sample

  const current = loadLearnedWeights().weights;
  const fields: (keyof PrioritizationWeights)[] = [
    'revenueWeight', 'riskWeight', 'momentumWeight', 'stalenessWeight', 'complexityWeight',
  ];

  const signalExtractors: Record<keyof PrioritizationWeights, (s: DealSignals) => number> = {
    revenueWeight: s => Math.min(100, (Math.log10(Math.max(s.arrK, 1)) / Math.log10(500)) * 100),
    riskWeight: s => {
      if (s.churnRisk === 'certain') return 100;
      if (s.churnRisk === 'high') return 75;
      return s.daysUntilClose !== null && s.daysUntilClose <= 14 ? 60 : 20;
    },
    momentumWeight: s => s.hasNextStep ? 70 : 30,
    stalenessWeight: s => Math.min(100, (s.daysSinceLastTouch / 21) * 100),
    complexityWeight: s => 100 - s.meddiccCoverage,
  };

  return fields.map(field => {
    const values = outcomes.map(o => ({
      signal: signalExtractors[field](o.signals),
      outcome: o.positiveOutcome ? 1 : 0,
    }));

    // Simple correlation
    const n = values.length;
    const sumX = values.reduce((s, v) => s + v.signal, 0);
    const sumY = values.reduce((s, v) => s + v.outcome, 0);
    const sumXY = values.reduce((s, v) => s + v.signal * v.outcome, 0);
    const sumX2 = values.reduce((s, v) => s + v.signal * v.signal, 0);
    const sumY2 = values.reduce((s, v) => s + v.outcome * v.outcome, 0);

    const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    const correlation = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;

    // Suggest nudging weight in direction of correlation
    const nudge = correlation * 0.02; // conservative
    const suggested = Math.max(0.05, Math.min(0.50, current[field] + nudge));

    return {
      field,
      currentWeight: current[field],
      suggestedWeight: Math.round(suggested * 100) / 100,
      correlation: Math.round(correlation * 1000) / 1000,
      sampleSize: n,
    };
  });
}

/**
 * Apply suggested weight adjustments if they meet thresholds.
 */
export function applyWeightAdjustments(
  correlations: OutcomeCorrelation[],
  minCorrelation: number = 0.15,
  minSampleSize: number = 15,
): LearnedWeights {
  const learned = loadLearnedWeights();
  const now = new Date().toISOString();

  for (const c of correlations) {
    if (Math.abs(c.correlation) < minCorrelation) continue;
    if (c.sampleSize < minSampleSize) continue;
    if (Math.abs(c.suggestedWeight - c.currentWeight) < 0.01) continue;

    learned.adjustmentHistory.push({
      field: c.field,
      oldValue: learned.weights[c.field],
      newValue: c.suggestedWeight,
      reason: `correlation=${c.correlation}, n=${c.sampleSize}`,
      timestamp: now,
    });

    learned.weights[c.field] = c.suggestedWeight;
  }

  // Normalize weights to sum to 1
  const sum = Object.values(learned.weights).reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (const key of Object.keys(learned.weights) as (keyof PrioritizationWeights)[]) {
      learned.weights[key] = Math.round((learned.weights[key] / sum) * 100) / 100;
    }
  }

  // Keep last 50 adjustments
  if (learned.adjustmentHistory.length > 50) {
    learned.adjustmentHistory = learned.adjustmentHistory.slice(-50);
  }

  learned.sampleSize = correlations[0]?.sampleSize || learned.sampleSize;
  learned.lastUpdated = now;

  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(learned));
  } catch {}

  return learned;
}

// ── Playbook-Memory Integration ────────────────────────────

/**
 * Check if a playbook should be avoided for a deal based on memory.
 */
export function shouldAvoidPlaybook(dealId: string, playbookId: string): { avoid: boolean; reason: string | null } {
  const memory = loadDealMemory(dealId);

  // Check if this playbook led to a failed approach
  const failedWithPlaybook = memory.entries.filter(
    e => e.type === 'approach_failed' && e.playbookId === playbookId,
  );
  if (failedWithPlaybook.length >= 2) {
    return { avoid: true, reason: `Playbook failed ${failedWithPlaybook.length} times on this deal` };
  }

  // Check deal-level fatigue for this playbook
  const usedRecently = memory.entries.filter(
    e => e.type === 'playbook_used' && e.playbookId === playbookId &&
      Date.now() - new Date(e.timestamp).getTime() < 14 * 86400000,
  );
  if (usedRecently.length >= 3) {
    return { avoid: true, reason: 'Playbook overused on this deal in last 14 days' };
  }

  return { avoid: false, reason: null };
}

/**
 * Get memory-informed playbook ranking adjustments.
 */
export function getMemoryAdjustments(dealId: string): Record<string, number> {
  const memory = loadDealMemory(dealId);
  const adjustments: Record<string, number> = {};

  for (const pid of memory.playbooksUsed) {
    const successes = memory.entries.filter(e => e.type === 'approach_succeeded' && e.playbookId === pid).length;
    const failures = memory.entries.filter(e => e.type === 'approach_failed' && e.playbookId === pid).length;

    if (successes > failures) adjustments[pid] = 0.1 * (successes - failures);
    else if (failures > successes) adjustments[pid] = -0.15 * (failures - successes);
  }

  return adjustments;
}

// ── Dashboard Stats ────────────────────────────────────────

export interface ExecutionEngineStats {
  totalDealsTracked: number;
  activeSequences: number;
  totalMemoryEntries: number;
  weightAdjustmentsMade: number;
  topRiskDeal: string | null;
  averageConfidence: number;
}

export function computeEngineStats(actions: NextBestAction[]): ExecutionEngineStats {
  const learned = loadLearnedWeights();
  let totalMemory = 0;
  try {
    const all = JSON.parse(localStorage.getItem(MEMORY_STORAGE_KEY) || '{}');
    totalMemory = Object.values(all).reduce((s: number, m: any) => s + (m.entries?.length || 0), 0);
  } catch {}

  let activeSequences = 0;
  try {
    const seqs = JSON.parse(localStorage.getItem(SEQUENCE_STORAGE_KEY) || '{}');
    activeSequences = Object.keys(seqs).length;
  } catch {}

  return {
    totalDealsTracked: actions.length,
    activeSequences,
    totalMemoryEntries: totalMemory,
    weightAdjustmentsMade: learned.adjustmentHistory.length,
    topRiskDeal: actions.length > 0 ? actions[0].dealName : null,
    averageConfidence: actions.length > 0
      ? Math.round(actions.reduce((s, a) => s + a.confidence, 0) / actions.length)
      : 0,
  };
}
