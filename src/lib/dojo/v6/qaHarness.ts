/**
 * V6 Multi-Thread Validation Harness
 *
 * Runs V6 fixtures through the selector and normalizer to validate
 * activation correctness, normalizer resilience, and output coherence.
 *
 * Deterministic tests (no AI calls): selector + normalizer.
 * AI-dependent tests: run via edge function and validate output shape.
 */

import { shouldInjectMultiThread, type MultiThreadInput } from './multiThreadSelector';
import { normalizeMultiThreadAssessment, type MultiThreadAssessment } from './multiThreadTypes';
import { V6_FIXTURES, type V6Fixture, type V6FixtureGroup } from './qaFixtures';
import { V6_QA_CHECKLIST, type QACheckItem } from './qaChecklist';

// ── Result types ──────────────────────────────────────────────────

export interface V6ValidationResult {
  fixtureId: string;
  group: V6FixtureGroup;
  label: string;
  tests: V6TestResult[];
  passed: boolean;
}

export interface V6TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

// ── Selector validation (deterministic) ───────────────────────────

export function validateSelector(): V6ValidationResult[] {
  const results: V6ValidationResult[] = [];

  // Test: benchmark/retest never activates
  results.push(runSelectorTest('selector-benchmark', 'activation', 'Benchmark reps never activate', {
    blockStage: 'enterprise',
    blockPhase: 'peak',
    dayAnchor: 'executive_roi_mixed',
    recentAvg: 85,
    recentMultiThreadCount: 0,
    isBenchmarkOrRetest: true,
  }, false));

  // Test: low scores never activate
  results.push(runSelectorTest('selector-low-score', 'activation', 'Low scores (< 55) never activate', {
    blockStage: 'enterprise',
    blockPhase: 'peak',
    dayAnchor: 'executive_roi_mixed',
    recentAvg: 45,
    recentMultiThreadCount: 0,
    isBenchmarkOrRetest: false,
  }, false));

  // Test: weekly cap respected
  results.push(runSelectorTest('selector-cap', 'activation', 'Weekly cap (>= 3) blocks activation', {
    blockStage: 'enterprise',
    blockPhase: 'peak',
    dayAnchor: 'executive_roi_mixed',
    recentAvg: 85,
    recentMultiThreadCount: 3,
    isBenchmarkOrRetest: false,
  }, false));

  // Test: foundation + cold call = no activation
  results.push(runSelectorTest('selector-foundation-cold', 'activation', 'Foundation + cold call = no activation', {
    blockStage: 'foundation',
    blockPhase: 'build',
    dayAnchor: 'opening_cold_call',
    recentAvg: 70,
    recentMultiThreadCount: 0,
    isBenchmarkOrRetest: false,
  }, false));

  // Test: enterprise + peak + executive = activation
  results.push(runSelectorTest('selector-enterprise-exec', 'activation', 'Enterprise peak + executive = activation', {
    blockStage: 'enterprise',
    blockPhase: 'peak',
    dayAnchor: 'executive_roi_mixed',
    recentAvg: 80,
    recentMultiThreadCount: 0,
    isBenchmarkOrRetest: false,
  }, true));

  // Test: integration + build + deal control = activation
  results.push(runSelectorTest('selector-integration-deal', 'activation', 'Integration build + deal control = activation', {
    blockStage: 'integration',
    blockPhase: 'build',
    dayAnchor: 'deal_control_negotiation',
    recentAvg: 72,
    recentMultiThreadCount: 1,
    isBenchmarkOrRetest: false,
  }, true));

  // Test: foundation + peak + discovery = borderline (0.55 * 0.6 = 0.33 < 0.5)
  results.push(runSelectorTest('selector-foundation-disc', 'activation', 'Foundation peak + discovery = no activation', {
    blockStage: 'foundation',
    blockPhase: 'peak',
    dayAnchor: 'discovery_qualification',
    recentAvg: 70,
    recentMultiThreadCount: 0,
    isBenchmarkOrRetest: false,
  }, false));

  // Test: enterprise + sustain + objection = activation (0.55 * 0.7 = 0.385 < 0.5 → NO)
  results.push(runSelectorTest('selector-enterprise-obj-sustain', 'activation', 'Enterprise sustain + objection = no activation', {
    blockStage: 'enterprise',
    blockPhase: 'sustain',
    dayAnchor: 'objection_pricing',
    recentAvg: 75,
    recentMultiThreadCount: 0,
    isBenchmarkOrRetest: false,
  }, false));

  return results;
}

function runSelectorTest(
  id: string,
  group: V6FixtureGroup,
  label: string,
  input: MultiThreadInput,
  expectedResult: boolean,
): V6ValidationResult {
  const actual = shouldInjectMultiThread(input);
  const passed = actual === expectedResult;
  return {
    fixtureId: id,
    group: group as V6FixtureGroup,
    label,
    tests: [{
      name: `shouldInjectMultiThread → ${expectedResult}`,
      passed,
      detail: passed
        ? `Correct: returned ${actual}`
        : `FAIL: expected ${expectedResult}, got ${actual}`,
    }],
    passed,
  };
}

// ── Normalizer validation (deterministic) ─────────────────────────

export function validateNormalizer(): V6ValidationResult[] {
  const results: V6ValidationResult[] = [];

  // Null/undefined → undefined
  results.push({
    fixtureId: 'norm-null',
    group: 'no_activation',
    label: 'Normalizer: null input → undefined',
    tests: [{
      name: 'null → undefined',
      passed: normalizeMultiThreadAssessment(null) === undefined,
      detail: 'null input returns undefined',
    }],
    passed: normalizeMultiThreadAssessment(null) === undefined,
  });

  // Empty stakeholders → undefined
  results.push({
    fixtureId: 'norm-empty',
    group: 'no_activation',
    label: 'Normalizer: empty stakeholders → undefined',
    tests: [{
      name: 'empty array → undefined',
      passed: normalizeMultiThreadAssessment({ stakeholdersDetected: [] }) === undefined,
      detail: 'Empty stakeholdersDetected returns undefined',
    }],
    passed: normalizeMultiThreadAssessment({ stakeholdersDetected: [] }) === undefined,
  });

  // Valid input normalizes correctly
  const validRaw = {
    stakeholdersDetected: ['marketing', 'ops'],
    stakeholdersAddressed: ['marketing'],
    alignmentScore: 65,
    championStrengthScore: 70,
    politicalAwarenessScore: 55,
    dealMomentum: 'forward',
    coachingNote: 'Good alignment with marketing.',
    breakdown: {
      missedStakeholders: ['ops'],
      conflictingSignalsUnresolved: false,
      wrongPriorityFocus: false,
      statusQuoDefenderIgnored: false,
    },
  };
  const normalized = normalizeMultiThreadAssessment(validRaw);
  const validTests: V6TestResult[] = [
    { name: 'returns defined', passed: normalized !== undefined, detail: 'Valid input normalizes' },
    { name: 'stakeholders count', passed: normalized?.stakeholdersDetected.length === 2, detail: `Got ${normalized?.stakeholdersDetected.length}` },
    { name: 'momentum preserved', passed: normalized?.dealMomentum === 'forward', detail: `Got ${normalized?.dealMomentum}` },
    { name: 'scores clamped', passed: (normalized?.alignmentScore ?? 0) >= 0 && (normalized?.alignmentScore ?? 0) <= 100, detail: `Score: ${normalized?.alignmentScore}` },
    { name: 'missed stakeholders', passed: normalized?.breakdown?.missedStakeholders?.includes('ops') === true, detail: 'ops in missed list' },
  ];

  results.push({
    fixtureId: 'norm-valid',
    group: 'light_activation',
    label: 'Normalizer: valid input normalizes correctly',
    tests: validTests,
    passed: validTests.every(t => t.passed),
  });

  // Score clamping
  const clamped = normalizeMultiThreadAssessment({
    stakeholdersDetected: ['cmo'],
    alignmentScore: 150,
    politicalAwarenessScore: -20,
    dealMomentum: 'invalid_value',
  });
  const clampTests: V6TestResult[] = [
    { name: 'alignment clamped to 100', passed: clamped?.alignmentScore === 100, detail: `Got ${clamped?.alignmentScore}` },
    { name: 'political clamped to 0', passed: clamped?.politicalAwarenessScore === 0, detail: `Got ${clamped?.politicalAwarenessScore}` },
    { name: 'invalid momentum → neutral', passed: clamped?.dealMomentum === 'neutral', detail: `Got ${clamped?.dealMomentum}` },
  ];

  results.push({
    fixtureId: 'norm-clamp',
    group: 'no_activation',
    label: 'Normalizer: out-of-range values clamped',
    tests: clampTests,
    passed: clampTests.every(t => t.passed),
  });

  return results;
}

// ── Fixture validation (requires AI scorer call) ──────────────────

export interface V6ScorerFixtureResult extends V6ValidationResult {
  rawMultiThread?: MultiThreadAssessment;
}

/**
 * Validate a scored fixture result against its expected behavior.
 * Call this after invoking the dojo-score edge function with the fixture.
 */
export function validateScoredFixture(
  fixture: V6Fixture,
  multiThread: MultiThreadAssessment | undefined,
): V6ScorerFixtureResult {
  const tests: V6TestResult[] = [];

  // Activation check
  const activated = multiThread !== undefined;
  tests.push({
    name: 'Activation correctness',
    passed: activated === fixture.expected.shouldActivate,
    detail: activated === fixture.expected.shouldActivate
      ? `Correct: activation=${activated}`
      : `FAIL: expected activation=${fixture.expected.shouldActivate}, got ${activated}`,
  });

  if (fixture.expected.shouldActivate && multiThread) {
    // Stakeholder count
    if (fixture.expected.minStakeholdersDetected !== undefined) {
      const count = multiThread.stakeholdersDetected.length;
      const ok = count >= fixture.expected.minStakeholdersDetected;
      tests.push({
        name: 'Min stakeholders detected',
        passed: ok,
        detail: `Detected ${count}, min ${fixture.expected.minStakeholdersDetected}`,
      });
    }

    // Momentum
    if (fixture.expected.expectedMomentum) {
      tests.push({
        name: 'Deal momentum',
        passed: multiThread.dealMomentum === fixture.expected.expectedMomentum,
        detail: `Expected ${fixture.expected.expectedMomentum}, got ${multiThread.dealMomentum}`,
      });
    }

    // Missed stakeholders
    if (fixture.expected.expectMissedStakeholders !== undefined) {
      const hasMissed = (multiThread.breakdown?.missedStakeholders?.length ?? 0) > 0;
      tests.push({
        name: 'Missed stakeholders present',
        passed: hasMissed === fixture.expected.expectMissedStakeholders,
        detail: `Expected missed=${fixture.expected.expectMissedStakeholders}, got ${hasMissed}`,
      });
    }

    // Coaching note quality
    tests.push({
      name: 'Coaching note is non-empty',
      passed: multiThread.coachingNote.length > 10,
      detail: `Note length: ${multiThread.coachingNote.length}`,
    });

    // Coaching note keywords
    if (fixture.expected.coachingNoteKeywords?.length) {
      const note = multiThread.coachingNote.toLowerCase();
      for (const kw of fixture.expected.coachingNoteKeywords) {
        tests.push({
          name: `Coaching note contains "${kw}"`,
          passed: note.includes(kw.toLowerCase()),
          detail: note.includes(kw.toLowerCase()) ? 'Found' : `Missing "${kw}" in: "${multiThread.coachingNote}"`,
        });
      }
    }
  }

  if (!fixture.expected.shouldActivate && multiThread) {
    tests.push({
      name: 'No multiThread on non-activated fixture',
      passed: false,
      detail: `FAIL: multiThread present when it should be absent`,
    });
  }

  return {
    fixtureId: fixture.id,
    group: fixture.group,
    label: fixture.label,
    tests,
    passed: tests.every(t => t.passed),
    rawMultiThread: multiThread,
  };
}

// ── Run all deterministic tests ───────────────────────────────────

export function runDeterministicSuite(): {
  selector: V6ValidationResult[];
  normalizer: V6ValidationResult[];
  summary: { total: number; passed: number; failed: number };
} {
  const selector = validateSelector();
  const normalizer = validateNormalizer();
  const all = [...selector, ...normalizer];
  return {
    selector,
    normalizer,
    summary: {
      total: all.length,
      passed: all.filter(r => r.passed).length,
      failed: all.filter(r => !r.passed).length,
    },
  };
}

// ── Run checklist against deterministic signals ───────────────────

export function evaluateChecklist(): QACheckItem[] {
  const selectorResults = validateSelector();
  const normalizerResults = validateNormalizer();

  const allPassed = [...selectorResults, ...normalizerResults].every(r => r.passed);

  return V6_QA_CHECKLIST.map(item => {
    switch (item.id) {
      case 'act-1': return { ...item, pass: selectorResults.find(r => r.fixtureId === 'selector-foundation-cold')?.passed ?? null };
      case 'act-2': return { ...item, pass: selectorResults.find(r => r.fixtureId === 'selector-benchmark')?.passed ?? null };
      case 'act-3': return { ...item, pass: selectorResults.find(r => r.fixtureId === 'selector-cap')?.passed ?? null };
      case 'act-4': return { ...item, pass: selectorResults.find(r => r.fixtureId === 'selector-low-score')?.passed ?? null };
      case 'act-5': return { ...item, pass: selectorResults.find(r => r.fixtureId === 'selector-enterprise-exec')?.passed ?? null };
      case 'reg-4': return { ...item, pass: normalizerResults.every(r => r.passed) };
      default: return item; // AI-dependent checks remain null until scored
    }
  });
}
