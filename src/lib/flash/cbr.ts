// Confidence-based repetition intervals for Flash.
// Card scheduling lives exclusively on flashcard_state.due_at — do NOT touch
// ki_mastery.next_review_at from this module (that belongs to the drill writer).

export type Confidence = 1 | 2 | 3 | 4 | 5;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const OFFSETS_MS: Record<Confidence, number> = {
  1: 10 * MINUTE,
  2: 1 * DAY,
  3: 3 * DAY,
  4: 7 * DAY,
  5: 21 * DAY,
};

export function nextDueAt(confidence: Confidence, from: Date = new Date()): Date {
  return new Date(from.getTime() + OFFSETS_MS[confidence]);
}

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'OK',
  4: 'Good',
  5: 'Perfect',
};
