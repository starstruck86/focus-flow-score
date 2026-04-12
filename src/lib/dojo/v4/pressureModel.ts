/**
 * V4 Pressure Model
 *
 * Defines pressure dimensions and profiles that overlay V3 scenarios.
 * Pressure is introduced deliberately by block phase and skill readiness.
 */

export type PressureDimension =
  | 'time_pressure'
  | 'hostile_persona'
  | 'ambiguity'
  | 'multi_stakeholder_tension'
  | 'executive_scrutiny'
  | 'none';

export type PressureLevel = 'none' | 'light' | 'moderate' | 'high';

export interface PressureProfile {
  level: PressureLevel;
  dimensions: PressureDimension[];
  label: string;        // user-facing badge text
  daveFrame: string;    // short framing line
}

// ── Presets ────────────────────────────────────────────────────────

export const PRESSURE_NONE: PressureProfile = {
  level: 'none',
  dimensions: ['none'],
  label: '',
  daveFrame: '',
};

export const PRESSURE_LABELS: Record<PressureDimension, string> = {
  time_pressure: 'Time Constraint',
  hostile_persona: 'Hostile Buyer',
  ambiguity: 'Ambiguous Situation',
  multi_stakeholder_tension: 'Multi-Stakeholder Tension',
  executive_scrutiny: 'Executive Pressure',
  none: '',
};

export const DAVE_FRAMES: Record<PressureDimension, string> = {
  time_pressure: 'You have less time than you want. Prioritize.',
  hostile_persona: 'The buyer is tense. Stay controlled.',
  ambiguity: "You won't get perfect clarity here. Create it.",
  multi_stakeholder_tension: 'Multiple agendas in the room. Find alignment.',
  executive_scrutiny: 'Executive eyes on this. Be precise.',
  none: '',
};
