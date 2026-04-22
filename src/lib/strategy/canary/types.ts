/**
 * Cycle 1 Canary Operator Workflow — shared types.
 *
 * Source of truth for the parser, recommendation engine, repository,
 * and UI surfaces. Everything is deterministic + client-side.
 */

export type Decision = 'continue' | 'fix' | 'rollback';

export interface ParsedStep {
  n: number;            // 1..8
  status: 'pass' | 'fail';
  note: string | null;
}

export interface SqlBlock {
  empty: boolean;
  raw: string | null;   // null if section was missing entirely
}

export interface LaneMix {
  direct: number;
  assisted: number;
  deep_work: number;
}

export interface FlagState {
  auto_promote: 0 | 1 | null;
}

export interface ParsedCanary {
  steps: ParsedStep[];                // may be < 8 if input is partial
  duplicates: SqlBlock;
  failures: SqlBlock;
  lane_mix: LaneMix | null;
  observations: string | null;
  flag_state: FlagState;
  parse_warnings: string[];
}

export interface RiskSignal {
  key:
    | 'idempotency_breach'
    | 'utility_misroute'
    | 'double_click_guard'
    | 'discovery_regression'
    | 'retry_broken'
    | 'bypass_not_honored';
  label: string;
}

export type LaneBand = 'healthy' | 'warn' | 'off_band' | 'unknown';

export interface EvidenceSummary {
  steps: ParsedStep[];
  duplicates_status: 'empty' | 'non_empty' | 'missing';
  duplicates_raw: string | null;
  failures_status: 'empty' | 'non_empty' | 'missing';
  failures_raw: string | null;
  lane_mix: LaneMix | null;
  lane_band: LaneBand;
  deep_work_pct: number | null;
  flag_state: FlagState;
  risk_signals: RiskSignal[];
  observations: string | null;
  recommendation: Decision;
}

export interface CanaryReviewRow {
  id: string;
  user_id: string;
  raw_input: string;
  parsed_json: ParsedCanary;
  evidence_summary: EvidenceSummary;
  recommendation: Decision;
  decision: Decision;
  decision_notes: string | null;
  flag_state: FlagState;
  created_at: string;
}

/** Static label lookup for the 8 canary steps (operator card). */
export const STEP_LABELS: Record<number, string> = {
  1: 'Utility prompt → direct',
  2: 'Light tactical → assisted',
  3: 'Heavy strategic → deep_work',
  4: 'Deep-work job completes',
  5: 'Double-click guard',
  6: 'Retry path',
  7: 'Bypass honored',
  8: 'Discovery Prep regression check',
};
