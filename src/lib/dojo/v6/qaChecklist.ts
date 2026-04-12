/**
 * V6 Multi-Thread QA Checklist
 *
 * Concrete pass/fail criteria for validating that V6 behaves correctly
 * in real usage without polluting the V3/V4/V5 foundation.
 */

export interface QACheckItem {
  id: string;
  category: QACategory;
  description: string;
  expected: string;
  pass: boolean | null; // null = not yet evaluated
}

export type QACategory =
  | 'activation'
  | 'scorer'
  | 'feedback'
  | 'ui_coherence'
  | 'regression';

// ── The checklist ─────────────────────────────────────────────────

export const V6_QA_CHECKLIST: QACheckItem[] = [
  // ── 1. Activation correctness ────────────────────────────────────
  {
    id: 'act-1',
    category: 'activation',
    description: 'Multi-thread does NOT activate on simple single-thread cold call',
    expected: 'No multiThread object in score result; no Deal Movement card rendered',
    pass: null,
  },
  {
    id: 'act-2',
    category: 'activation',
    description: 'Multi-thread does NOT activate on benchmark/retest reps',
    expected: 'shouldInjectMultiThread returns false when isBenchmarkOrRetest=true',
    pass: null,
  },
  {
    id: 'act-3',
    category: 'activation',
    description: 'Multi-thread respects weekly cap (max 3 per week)',
    expected: 'shouldInjectMultiThread returns false when recentMultiThreadCount >= 3',
    pass: null,
  },
  {
    id: 'act-4',
    category: 'activation',
    description: 'Multi-thread does NOT activate when recentAvg < 55',
    expected: 'shouldInjectMultiThread returns false for low-skill reps',
    pass: null,
  },
  {
    id: 'act-5',
    category: 'activation',
    description: 'Multi-thread activates on Thursday/Friday at enterprise stage',
    expected: 'shouldInjectMultiThread returns true for deal_control/executive anchors at enterprise peak',
    pass: null,
  },
  {
    id: 'act-6',
    category: 'activation',
    description: 'Foundation stage activates multi-thread at very low rate',
    expected: 'Only peak phase + high-density anchors cross the 0.5 threshold',
    pass: null,
  },

  // ── 2. Scorer correctness ───────────────────────────────────────
  {
    id: 'scr-1',
    category: 'scorer',
    description: 'stakeholdersDetected matches only stakeholders present in the prompt',
    expected: 'No invented roles; list must be subset of scenario stakeholders',
    pass: null,
  },
  {
    id: 'scr-2',
    category: 'scorer',
    description: 'stakeholdersAddressed reflects who the rep actually responded to',
    expected: 'Only stakeholders the rep explicitly engaged appear in addressed list',
    pass: null,
  },
  {
    id: 'scr-3',
    category: 'scorer',
    description: 'dealMomentum is believable given rep quality',
    expected: 'Strong orchestration → forward; missed stakeholders → at_risk; partial → neutral',
    pass: null,
  },
  {
    id: 'scr-4',
    category: 'scorer',
    description: 'coachingNote is concrete and ≤ 2 sentences',
    expected: 'Note references specific stakeholders/tension; not generic advice',
    pass: null,
  },
  {
    id: 'scr-5',
    category: 'scorer',
    description: 'No multiThread returned for ambiguous single-perspective scenarios',
    expected: 'Conservative: omit or return empty stakeholdersDetected for unclear cases',
    pass: null,
  },

  // ── 3. Feedback usefulness ──────────────────────────────────────
  {
    id: 'fb-1',
    category: 'feedback',
    description: 'Deal Movement card clearly identifies who was helped and who was missed',
    expected: 'stakeholdersAddressed count visible; missed list shown when non-empty',
    pass: null,
  },
  {
    id: 'fb-2',
    category: 'feedback',
    description: 'Deal Movement card adds insight beyond normal score feedback',
    expected: 'Coaching note is distinct from main feedback; covers internal deal dynamics',
    pass: null,
  },
  {
    id: 'fb-3',
    category: 'feedback',
    description: 'Momentum badge (Forward/Neutral/At Risk) is immediately legible',
    expected: 'Green/amber/red styling matches momentum; icon is correct',
    pass: null,
  },

  // ── 4. UI / product coherence ───────────────────────────────────
  {
    id: 'ui-1',
    category: 'ui_coherence',
    description: 'Deal Movement card only renders when multiThread exists',
    expected: 'Card is absent for non-multi-thread reps',
    pass: null,
  },
  {
    id: 'ui-2',
    category: 'ui_coherence',
    description: 'No duplicated feedback between DealMovementCard and main feedback',
    expected: 'Main feedback covers skill execution; Deal Movement covers deal dynamics',
    pass: null,
  },
  {
    id: 'ui-3',
    category: 'ui_coherence',
    description: 'Weekly summary shows multi-thread metrics only when data exists',
    expected: 'Section hidden or zeroed when no multi-thread reps this week',
    pass: null,
  },
  {
    id: 'ui-4',
    category: 'ui_coherence',
    description: 'multiThreadReadiness hidden when insufficient signal',
    expected: 'Capability model suppresses readiness with < 3 multi-thread reps',
    pass: null,
  },

  // ── 5. Regression protection ────────────────────────────────────
  {
    id: 'reg-1',
    category: 'regression',
    description: 'Non-multi-thread reps behave exactly as before V6',
    expected: 'No multiThread field; scores, feedback, flow unchanged',
    pass: null,
  },
  {
    id: 'reg-2',
    category: 'regression',
    description: 'Pressure profiles and simulation arcs remain intact',
    expected: 'V4 pressure + V5 flow + simulation still work independently',
    pass: null,
  },
  {
    id: 'reg-3',
    category: 'regression',
    description: 'Benchmark/retest snapshot system unaffected',
    expected: 'Snapshots capture scores_by_anchor without multi-thread pollution',
    pass: null,
  },
  {
    id: 'reg-4',
    category: 'regression',
    description: 'normalizeMultiThreadAssessment handles malformed input gracefully',
    expected: 'Returns undefined for null, missing fields, or empty stakeholder arrays',
    pass: null,
  },
];

// ── Helpers ───────────────────────────────────────────────────────

export function getChecklistByCategory(category: QACategory): QACheckItem[] {
  return V6_QA_CHECKLIST.filter(c => c.category === category);
}

export function getChecklistSummary(results: QACheckItem[]): {
  total: number;
  passed: number;
  failed: number;
  pending: number;
} {
  return {
    total: results.length,
    passed: results.filter(r => r.pass === true).length,
    failed: results.filter(r => r.pass === false).length,
    pending: results.filter(r => r.pass === null).length,
  };
}
