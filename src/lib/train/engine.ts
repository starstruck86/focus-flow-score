/**
 * TRAIN v2 — Stage D engine (Phase 2).
 *
 * ONE engine. Both practice drills and band gate items are scored by the
 * existing dojo-score edge function. There is no second scorer.
 *
 *   practice mode  → pass `ki` (tactic_summary/when_to_use/...) so the model
 *                    grades against the play. NEVER pass example_usage —
 *                    dojo-score now strips it from the prompt, and the
 *                    regression guard there asserts objection !== example_usage.
 *
 *   band_gate mode → pass NO `ki`. Cold test. The model only sees the buyer
 *                    situation + the rep's response.
 *
 * Per rep we ALSO fire kiMasteryWriter (per-KI SRS unchanged) and
 * incrementSubLevelRep (curriculum progress).
 *
 * Gate runs aggregate all item scores via summarizeBandGate and persist via
 * recordBandGateAttempt, returning the weakest item so a lopsided pass is
 * visible (Plan §D ruling 3).
 *
 * dojo_sessions writes are layered on the existing session-creation path so
 * every NOT NULL column (skill_focus, session_type, difficulty, status, mode)
 * is populated. `mode` is plain text — we write 'train_atom' / 'band_gate'.
 */

import { supabase } from '@/integrations/supabase/client';
import { writeKIMastery } from '@/lib/dojo/kiMasteryWriter';
import {
  incrementSubLevelRep,
  recordBandGateAttempt,
  summarizeBandGate,
} from './competency';
import type {
  Band,
  BandGateRow,
  CurriculumKi,
} from '@/types/train';
import { TRAIN_TUNABLES } from '@/types/train';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// ── Common dojo-score wrapper ──────────────────────────────────────

interface ScoreOpts {
  skillFocus: string;
  userResponse: string;
  /** Buyer situation. MUST NOT be the gold answer. Prefer ki.when_to_use. */
  objection: string;
  context?: string;
  /** Practice mode passes ki play context; gate mode passes undefined (cold). */
  ki?: CurriculumKi | null;
}

interface ScoreResult {
  score: number;
  feedback: string;
  raw: any;
}

export async function scoreRep(opts: ScoreOpts): Promise<ScoreResult> {
  const { data: { session } } = await supabase.auth.getSession();

  // Hard guard — refuse to ship gold content as the objection.
  if (opts.ki && opts.ki.example_usage && opts.objection.trim() === opts.ki.example_usage.trim()) {
    throw new Error('train/engine: objection must not equal ki.example_usage (score poisoning).');
  }

  const body: Record<string, unknown> = {
    scenario: {
      skillFocus: opts.skillFocus,
      context: opts.context ?? opts.ki?.when_to_use ?? 'Enterprise sales scenario.',
      objection: opts.objection,
    },
    userResponse: opts.userResponse,
  };

  // Only attach ki in practice mode. Gate mode = cold (no ki block).
  if (opts.ki) {
    body.ki = {
      title: opts.ki.title ?? '',
      tactic_summary: opts.ki.tactic_summary ?? '',
      // example_usage intentionally NOT forwarded — dojo-score ignores it too.
      when_to_use: opts.ki.when_to_use ?? '',
      when_not_to_use: opts.ki.when_not_to_use ?? '',
      why_it_matters: opts.ki.why_it_matters ?? '',
    };
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/dojo-score`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`dojo-score ${res.status}: ${data?.error ?? 'failed'}`);
  }
  return {
    score: typeof data.score === 'number' ? data.score : 50,
    feedback: typeof data.feedback === 'string' ? data.feedback : '',
    raw: data,
  };
}

// ── Practice rep (train_atom mode) ─────────────────────────────────

export interface PracticeRepInput {
  userId: string;
  spoke: string;
  topic: string;
  band: Band;
  subLevel: string;
  drillCountInSubLevel: number;
  ki: CurriculumKi;
  userResponse: string;
  skillFocus: string;
  /** Optional override; defaults to ki.when_to_use. */
  objection?: string;
}

export interface PracticeRepResult {
  score: number;
  feedback: string;
  raw: any;
  progress: number;       // 0..1 after this rep
  reps: number;           // total reps in this sub-level
  gatePassedAt: string | null;
}

export async function runPracticeRep(input: PracticeRepInput): Promise<PracticeRepResult> {
  const isPromptOnly = !!input.ki.promptOnly || !input.ki.ki_id;
  const objection = input.objection ?? input.ki.when_to_use ?? 'Respond to this buyer situation.';
  const scored = await scoreRep({
    skillFocus: input.skillFocus,
    userResponse: input.userResponse,
    objection,
    context: input.ki.when_to_use ?? undefined,
    ki: isPromptOnly ? null : input.ki,
  });

  // Per-KI SRS — only when there is a real KI behind this rep.
  if (!isPromptOnly) {
    writeKIMastery({
      userId: input.userId,
      kiId: input.ki.ki_id,
      chapter: input.ki.chapter,
      spiderDimension: input.ki.spider_dimension ?? null,
      score: scored.score,
      recognitionScore: scored.raw?.recognitionScore ?? null,
      executionScore: scored.raw?.executionScore ?? null,
      awarenessScore: scored.raw?.awarenessScore ?? null,
    }).catch(() => {});
  }

  const comp = await incrementSubLevelRep({
    userId: input.userId,
    spoke: input.spoke,
    topic: input.topic,
    band: input.band,
    subLevel: input.subLevel,
    score: scored.score,
    drillCountInSubLevel: input.drillCountInSubLevel,
  });

  return {
    score: scored.score,
    feedback: scored.feedback,
    raw: scored.raw,
    progress: Number(comp.progress ?? 0),
    reps: Number(comp.reps ?? 0),
    gatePassedAt: comp.gate_passed_at ?? null,
  };
}

// ── Band gate run (band_gate mode) ─────────────────────────────────

export interface GateItemInput {
  /** Cold prompt shown to the rep. Pulled from gate metadata or band exemplar. */
  objection: string;
  context?: string;
  /** What the rep typed. */
  userResponse: string;
  /** Tag for traceability — NOT passed into scoring. */
  sourceKiId?: string;
  sourceTitle?: string;
}

export interface GateItemResult {
  index: number;
  score: number;
  feedback: string;
  sourceKiId?: string;
  sourceTitle?: string;
}

export interface BandGateRunInput {
  userId: string;
  spoke: string;
  topic: string;
  band: Band;
  skillFocus: string;
  gate: BandGateRow;
  items: GateItemInput[];
}

export interface BandGateRunResult {
  avgScore: number;
  passed: boolean;
  passThreshold: number;
  itemResults: GateItemResult[];
  weakest: GateItemResult | null;     // Plan §D ruling 3 — surface lopsided passes
  nextRetestDue: string | null;
  status: 'passed' | 'failed';
}

export async function runBandGate(input: BandGateRunInput): Promise<BandGateRunResult> {
  const threshold = input.gate.pass_threshold ?? TRAIN_TUNABLES.bandGatePassThreshold;

  // Score each item COLD — no `ki` payload, no example_usage leak possible.
  const itemResults: GateItemResult[] = [];
  for (let i = 0; i < input.items.length; i++) {
    const it = input.items[i];
    const scored = await scoreRep({
      skillFocus: input.skillFocus,
      userResponse: it.userResponse,
      objection: it.objection,
      context: it.context,
      ki: null,
    });
    itemResults.push({
      index: i,
      score: scored.score,
      feedback: scored.feedback,
      sourceKiId: it.sourceKiId,
      sourceTitle: it.sourceTitle,
    });
  }

  const summary = summarizeBandGate(itemResults.map((r) => r.score), threshold);
  const persisted = await recordBandGateAttempt({
    userId: input.userId,
    spoke: input.spoke,
    topic: input.topic,
    band: input.band,
    attempt: { ...summary, band: input.band },
    passThreshold: threshold,
    promotesTo: input.gate.promotes_to,
  });

  const weakest = itemResults.length
    ? itemResults.reduce((a, b) => (a.score <= b.score ? a : b))
    : null;

  return {
    avgScore: summary.avgScore,
    passed: summary.passed,
    passThreshold: threshold,
    itemResults,
    weakest,
    nextRetestDue: persisted.next_retest_due ?? null,
    status: summary.passed ? 'passed' : 'failed',
  };
}

// ── dojo_sessions writer for train atoms ───────────────────────────
// Reuses the existing session schema. ALL NOT NULL columns populated.

export interface TrainSessionRow {
  userId: string;
  /** 'train_atom' for practice sets, 'band_gate' for gate attempts. */
  mode: 'train_atom' | 'band_gate';
  skillFocus: string;
  subLevel?: string;
  band?: Band;
  conceptId?: string;
  bestScore: number;
  latestScore: number;
  startedAt: string;
  completedAt: string;
}

export async function writeTrainSession(row: TrainSessionRow): Promise<void> {
  await (supabase as any).from('dojo_sessions').insert({
    user_id: row.userId,
    mode: row.mode,                              // plain text — no enum/check
    session_type: row.mode === 'band_gate' ? 'gate' : 'drill',
    skill_focus: row.skillFocus,
    difficulty: 'standard',
    status: 'completed',
    best_score: row.bestScore,
    latest_score: row.latestScore,
    retry_count: 0,
    started_at: row.startedAt,
    completed_at: row.completedAt,
    benchmark_tag: false,
    scenario_title: row.conceptId
      ? `${row.mode === 'band_gate' ? 'Band Gate' : 'Train atom'} · ${row.conceptId}${row.subLevel ? ` (${row.subLevel})` : ''}`
      : row.mode === 'band_gate'
        ? `Band Gate B${row.band ?? ''}`
        : 'Train atom',
  });
}
