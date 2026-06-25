/**
 * TRAIN v2 — Stage D types.
 * Aligns with curriculum_concepts / ki_curriculum / curriculum_gates /
 * user_competency / user_band_gate (Stage C live schema).
 */

export type Band = 1 | 2 | 3 | 4 | 5;

export const BAND_NAMES: Record<Band, string> = {
  1: 'Foundation',
  2: 'Conversational',
  3: 'Practitioner',
  4: 'Advanced',
  5: 'Expert',
};

export type TeachKind = 'ki_exemplar' | 'authored';
export type TeachBeatStatus = 'ready' | 'pending';
export type ConceptRole = 'teach' | 'drill' | 'gate';
export type BandGateStatus = 'locked' | 'available' | 'passed' | 'failed';

export interface ConceptRow {
  concept_id: string;          // e.g. 'C2', 'C5b'
  spoke: string;
  topic: string;
  band: Band;
  sub_level: string;           // e.g. '1.2'
  order_in_sublevel: number;
  title: string;
  teach_kind: TeachKind;
  exemplar_ki_id: string | null;
  teach_beat_status: TeachBeatStatus;
  teach_beat_ref: string | null;
  notes: string | null;
}

export interface CurriculumKiRef {
  ki_id: string;
  role: ConceptRole;
  is_exemplar: boolean;
  order_in_concept: number;
  active: boolean;
}

export interface CurriculumKi extends CurriculumKiRef {
  // Hydrated from knowledge_items
  title: string;
  tactic_summary: string | null;
  example_usage: string | null;
  when_to_use: string | null;
  when_not_to_use: string | null;
  why_it_matters: string | null;
  spider_dimension: string | null;
  chapter: string | null;
}

export interface ConceptWithItems {
  concept: ConceptRow;
  teach:
    | { kind: 'ki_exemplar'; exemplar: CurriculumKi }
    | { kind: 'authored'; ref: string }
    | { kind: 'pending'; provisional?: CurriculumKi };
  drills: CurriculumKi[];      // capped (default 5)
  drillsAvailable: number;     // total before cap
}

export interface SubLevelGroup {
  sub_level: string;
  band: Band;
  concepts: ConceptRow[];
}

export interface BandGateRow {
  id: string;
  spoke: string;
  topic: string;
  band: Band;
  gate_prompt: string;
  pass_threshold: number;
  item_strategy: 'band_exemplars';
  promotes_to: Band | null;
}

export interface UserCompetencyRow {
  user_id: string;
  spoke: string;
  topic: string;
  band: Band;
  sub_level: string;
  progress: number;          // 0..1
  reps: number;
  gate_passed_at: string | null;
  updated_at: string;
}

export interface UserBandGateRow {
  user_id: string;
  spoke: string;
  topic: string;
  band: Band;
  status: BandGateStatus;
  attempts: number;
  best_score: number | null;
  passed_at: string | null;
  last_attempt_at: string | null;
  next_retest_due: string | null;
  updated_at: string;
}

export interface BandGateAttempt {
  band: Band;
  itemScores: number[];      // per-item 0..100
  avgScore: number;          // 0..100
  passed: boolean;
}

/** Engine atom config (Phase 2 will consume). */
export interface TrainAtomPlan {
  mode: 'practice' | 'band_gate';
  spoke: string;
  topic: string;
  band: Band;
  sub_level?: string;
  conceptId?: string;
}

// ── Tunables (decision defaults from Plan §D) ─────────────────────

export const TRAIN_TUNABLES = {
  drillsPerRepCap: 5,
  subLevelRequiredPasses: 3,        // floor; effective = max(3, drillCount)
  subLevelPassThreshold: 70,        // per-rep score considered "passing"
  bandGateItemCount: 5,
  bandGatePassThreshold: 80,        // overridden by curriculum_gates row if present
  bandGateWarningFloor: 70,         // 70-79 = warning interval
  retestPassDays: 30,
  retestWarningDays: 14,
} as const;
