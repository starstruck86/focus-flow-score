/**
 * V6 Live Scorer Runner
 * 
 * Sends V6 fixtures through the real dojo-score edge function
 * and validates the returned multiThread assessment.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeMultiThreadAssessment, type MultiThreadAssessment } from './multiThreadTypes';
import { validateScoredFixture, type V6ScorerFixtureResult } from './qaHarness';
import { V6_FIXTURES, type V6Fixture } from './qaFixtures';


export interface V6LiveRunResult extends V6ScorerFixtureResult {
  /** Raw scorer JSON (full response, not just multiThread) */
  rawScorerOutput?: Record<string, unknown>;
  /** Error if the scorer call failed */
  error?: string;
  /** Duration of the scorer call in ms */
  durationMs: number;
}

export interface V6BatchSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  falsePositives: number;
  falseNegatives: number;
  momentumMismatches: number;
  weakCoachingNotes: number;
  hallucinations: number;
}

/**
 * Run a single V6 fixture through the live dojo-score edge function.
 */
export async function runLiveFixture(fixture: V6Fixture): Promise<V6LiveRunResult> {
  const start = performance.now();

  try {
    const { data, error } = await supabase.functions.invoke('dojo-score', {
      body: {
        scenario: {
          skillFocus: 'objection_handling', // default skill for V6 fixtures
          context: fixture.context,
          objection: fixture.objection,
          multiThread: fixture.multiThreadContext,
        },
        userResponse: fixture.userResponse,
        retryCount: 0,
      },
    });

    const durationMs = Math.round(performance.now() - start);

    if (error) {
      return makeErrorResult(fixture, `Edge function error: ${error.message}`, durationMs);
    }

    if (data?.error) {
      return makeErrorResult(fixture, `Scorer error: ${data.error}`, durationMs);
    }

    const rawOutput = data as Record<string, unknown>;
    const rawMultiThread = rawOutput.multiThread as Record<string, unknown> | undefined;
    const normalized = normalizeMultiThreadAssessment(rawMultiThread ?? undefined);

    const validation = validateScoredFixture(fixture, normalized);

    return {
      ...validation,
      rawScorerOutput: rawOutput,
      durationMs,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    return makeErrorResult(fixture, err instanceof Error ? err.message : String(err), durationMs);
  }
}

function makeErrorResult(fixture: V6Fixture, error: string, durationMs: number): V6LiveRunResult {
  return {
    fixtureId: fixture.id,
    group: fixture.group,
    label: fixture.label,
    tests: [{ name: 'Scorer call', passed: false, detail: error }],
    passed: false,
    error,
    durationMs,
  };
}

/**
 * Compute batch summary from an array of live run results.
 */
export function computeBatchSummary(results: V6LiveRunResult[]): V6BatchSummary {
  let falsePositives = 0;
  let falseNegatives = 0;
  let momentumMismatches = 0;
  let weakCoachingNotes = 0;
  let hallucinations = 0;
  let errors = 0;

  for (const r of results) {
    if (r.error) { errors++; continue; }

    const fixture = r; // has group, expected is on the original fixture
    const activated = r.rawMultiThread !== undefined;
    const expected = getFixtureById(r.fixtureId);
    if (!expected) continue;

    // False positive: activated when it shouldn't
    if (activated && !expected.expected.shouldActivate) falsePositives++;
    // False negative: not activated when it should
    if (!activated && expected.expected.shouldActivate) falseNegatives++;

    // Momentum mismatch
    if (expected.expected.expectedMomentum && r.rawMultiThread) {
      if (r.rawMultiThread.dealMomentum !== expected.expected.expectedMomentum) momentumMismatches++;
    }

    // Weak coaching note
    if (r.rawMultiThread && r.rawMultiThread.coachingNote.length <= 10) weakCoachingNotes++;

    // Hallucination check: detected stakeholders not in fixture context
    if (r.rawMultiThread && expected.multiThreadContext?.stakeholders) {
      const knownRoles = new Set(expected.multiThreadContext.stakeholders.map(s => s.role.toLowerCase()));
      const detected = r.rawMultiThread.stakeholdersDetected.map(s => s.toLowerCase());
      const unknowns = detected.filter(d => !knownRoles.has(d));
      if (unknowns.length > 0) hallucinations++;
    }
  }

  return {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed && !r.error).length,
    errors,
    falsePositives,
    falseNegatives,
    momentumMismatches,
    weakCoachingNotes,
    hallucinations,
  };
}

// Helper to get fixture by ID (lazy import to avoid circular)
function getFixtureById(id: string): V6Fixture | undefined {
  // Import inline to avoid top-level circular
  const { V6_FIXTURES } = require('./qaFixtures');
  return V6_FIXTURES.find((f: V6Fixture) => f.id === id);
}
