/**
 * V4 Pressure Selectors
 *
 * Deterministic selection of pressure profile based on block phase,
 * day anchor, skill readiness, and stage.
 */

import type { BlockPhase } from '../v3/blockManager';
import type { DayAnchor } from '../v3/dayAnchors';
import type { BlockStage } from '../v3/blockManager';
import {
  type PressureProfile,
  type PressureDimension,
  PRESSURE_NONE,
  PRESSURE_LABELS,
  DAVE_FRAMES,
} from './pressureModel';

export interface PressureInput {
  blockPhase: BlockPhase;
  dayAnchor: DayAnchor;
  isFriday: boolean;
  recentAvg: number;
  stage: BlockStage;
}

// ── Anchor → preferred dimensions mapping ─────────────────────────

const ANCHOR_PRESSURE_AFFINITY: Record<DayAnchor, PressureDimension[]> = {
  opening_cold_call: ['time_pressure', 'hostile_persona'],
  discovery_qualification: ['ambiguity', 'time_pressure'],
  objection_pricing: ['hostile_persona', 'ambiguity'],
  deal_control_negotiation: ['multi_stakeholder_tension', 'time_pressure'],
  executive_roi_mixed: ['executive_scrutiny', 'ambiguity', 'multi_stakeholder_tension'],
};

// ── Main selector ─────────────────────────────────────────────────

export function selectPressureProfile(input: PressureInput): PressureProfile {
  const { blockPhase, dayAnchor, isFriday, recentAvg } = input;

  // Benchmark / Retest → always clean
  if (blockPhase === 'benchmark' || blockPhase === 'retest') {
    return PRESSURE_NONE;
  }

  // Foundation phase
  if (blockPhase === 'foundation') {
    if (!isFriday) return PRESSURE_NONE;
    // Friday in foundation: light pressure
    return buildProfile('light', pickDimensions(dayAnchor, 1));
  }

  // Build phase
  if (blockPhase === 'build') {
    if (isFriday) {
      return buildProfile('moderate', pickDimensions(dayAnchor, 2));
    }
    // Non-Friday: only if anchor avg > 65
    if (recentAvg > 65) {
      return buildProfile('light', pickDimensions(dayAnchor, 1));
    }
    return PRESSURE_NONE;
  }

  // Peak phase
  if (blockPhase === 'peak') {
    if (isFriday) {
      return buildProfile('high', pickDimensions(dayAnchor, 2));
    }
    // Non-Friday in peak: moderate if skill is strong enough
    if (recentAvg > 60) {
      return buildProfile('moderate', pickDimensions(dayAnchor, 1));
    }
    return buildProfile('light', pickDimensions(dayAnchor, 1));
  }

  return PRESSURE_NONE;
}

// ── Helpers ───────────────────────────────────────────────────────

function pickDimensions(anchor: DayAnchor, count: number): PressureDimension[] {
  const pool = ANCHOR_PRESSURE_AFFINITY[anchor];
  return pool.slice(0, count);
}

function buildProfile(
  level: PressureProfile['level'],
  dimensions: PressureDimension[],
): PressureProfile {
  const primary = dimensions[0] ?? 'ambiguity';
  return {
    level,
    dimensions,
    label: dimensions.length > 1
      ? 'Pressure Rep'
      : PRESSURE_LABELS[primary],
    daveFrame: DAVE_FRAMES[primary],
  };
}
