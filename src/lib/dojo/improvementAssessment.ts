/**
 * Improvement Assessment — Before vs After Scoring
 * 
 * Compares a rep's original call behavior against their Dojo-trained response
 * to determine if real behavioral improvement occurred.
 *
 * Uses existing scoring system + mistake taxonomy. No new models.
 *
 * Key principle: improvement = behavior change, not just score increase.
 */

import { MISTAKE_TAXONOMY, getMistakeEntry, type MistakeEntry } from './mistakeTaxonomy';

// ── Types ──────────────────────────────────────────────────────────

export type ImprovementType =
  | 'mistake_eliminated'    // Top mistake was fixed
  | 'severity_reduced'     // Mistake dropped from severity 3→2 or 2→1
  | 'category_shifted'     // Mistake moved from structural→style (less dangerous)
  | 'specificity_increased' // Same area but more precise execution
  | 'control_improved'     // Deal control or next steps got better
  | 'no_change'            // Nothing meaningful changed
  | 'regression';          // Got worse

export interface ImprovementVerdict {
  improved: boolean;
  deltaScore: number;
  improvementType: ImprovementType;
  primaryChange: string;
  secondaryChanges: string[];
  remainingGaps: string[];
  coachingSummary: string;
}

export interface ComparisonInput {
  originalScore: number;
  trainedScore: number;
  originalTopMistake: string;
  trainedTopMistake: string;
  /** Optional: trained focusApplied status from scoring */
  trainedFocusApplied?: 'yes' | 'partial' | 'no';
}

// ── Priority tiers for mistake severity ────────────────────────────

const PRIORITY_TIERS: Record<number, string> = {
  3: 'Control (deal-killing)',
  2: 'Execution (meaningful gap)',
  1: 'Polish (style issue)',
};

// ── Core assessment function ──────────────────────────────────────

export function assessImprovement(input: ComparisonInput): ImprovementVerdict {
  const {
    originalScore,
    trainedScore,
    originalTopMistake,
    trainedTopMistake,
    trainedFocusApplied,
  } = input;

  const deltaScore = trainedScore - originalScore;
  const originalEntry = getMistakeEntry(originalTopMistake);
  const trainedEntry = getMistakeEntry(trainedTopMistake);

  const mistakeFixed = originalTopMistake !== trainedTopMistake;
  const severityReduced = mistakeFixed && trainedEntry.severity < originalEntry.severity;
  const severityIncreased = mistakeFixed && trainedEntry.severity > originalEntry.severity;
  const sameMistake = !mistakeFixed;
  const skillShifted = mistakeFixed && trainedEntry.skill !== originalEntry.skill;

  // ── Determine improvement type ──

  let improvementType: ImprovementType;
  let primaryChange: string;
  const secondaryChanges: string[] = [];
  const remainingGaps: string[] = [];

  // Case 1: Regression — score dropped AND mistake got worse
  if (deltaScore < -5 && !severityReduced) {
    improvementType = 'regression';
    primaryChange = `Performance declined. ${originalEntry.label} wasn't fixed, and score dropped by ${Math.abs(deltaScore)} points.`;
  }
  // Case 2: Mistake eliminated with score improvement
  else if (mistakeFixed && deltaScore >= 5) {
    if (severityReduced) {
      improvementType = 'severity_reduced';
      primaryChange = `Fixed "${originalEntry.label}" (${PRIORITY_TIERS[originalEntry.severity]}). Remaining issue "${trainedEntry.label}" is lower severity (${PRIORITY_TIERS[trainedEntry.severity]}).`;
    } else if (skillShifted) {
      improvementType = 'category_shifted';
      primaryChange = `Fixed "${originalEntry.label}" in ${originalEntry.skill.replace(/_/g, ' ')}. New area to work on: "${trainedEntry.label}" in ${trainedEntry.skill.replace(/_/g, ' ')}.`;
    } else {
      improvementType = 'mistake_eliminated';
      primaryChange = `Eliminated "${originalEntry.label}". This was the biggest blocker — it's gone now.`;
    }
  }
  // Case 3: Mistake fixed but score didn't improve much
  else if (mistakeFixed && deltaScore >= 0) {
    improvementType = 'mistake_eliminated';
    primaryChange = `Fixed "${originalEntry.label}", though overall execution needs more work.`;
  }
  // Case 4: Same mistake but score improved (better execution of same pattern)
  else if (sameMistake && deltaScore >= 8) {
    improvementType = 'specificity_increased';
    primaryChange = `Still working on "${originalEntry.label}", but execution improved significantly (+${deltaScore} points).`;
  }
  // Case 5: Same mistake, small score change
  else if (sameMistake && deltaScore > 0 && deltaScore < 8) {
    improvementType = 'no_change';
    primaryChange = `Marginal improvement (+${deltaScore}), but "${originalEntry.label}" is still the primary issue.`;
  }
  // Case 6: Score improved but new worse mistake appeared
  else if (mistakeFixed && severityIncreased) {
    improvementType = 'no_change';
    primaryChange = `Fixed "${originalEntry.label}" but introduced a more serious issue: "${trainedEntry.label}".`;
  }
  // Case 7: No meaningful change
  else {
    improvementType = 'no_change';
    primaryChange = `No meaningful behavior change detected. "${originalEntry.label}" remains the core issue.`;
  }

  // ── Secondary changes ──

  if (deltaScore > 0 && improvementType !== 'regression') {
    secondaryChanges.push(`Score improved: ${originalScore} → ${trainedScore} (+${deltaScore})`);
  }

  if (mistakeFixed && severityReduced) {
    secondaryChanges.push(`Mistake severity dropped from ${originalEntry.severity} to ${trainedEntry.severity}`);
  }

  if (trainedFocusApplied === 'yes') {
    secondaryChanges.push('Coaching focus was applied in the trained response');
  } else if (trainedFocusApplied === 'partial') {
    secondaryChanges.push('Coaching focus was partially applied');
  }

  // ── Remaining gaps ──

  if (trainedEntry.severity >= 2) {
    remainingGaps.push(`${trainedEntry.label}: ${trainedEntry.whyItHurts}`);
  }

  if (trainedScore < 75) {
    remainingGaps.push('Not yet live-ready (score below 75)');
  }

  // ── Coaching summary (Dave voice) ──

  const coachingSummary = buildCoachingSummary(
    improvementType,
    originalEntry,
    trainedEntry,
    deltaScore,
    mistakeFixed,
    trainedScore,
  );

  // ── Determine "improved" flag ──
  // Real improvement = mistake fixed OR severity reduced OR significant score gain with focus applied
  const improved =
    improvementType === 'mistake_eliminated' ||
    improvementType === 'severity_reduced' ||
    improvementType === 'category_shifted' ||
    (improvementType === 'specificity_increased' && deltaScore >= 8);

  return {
    improved,
    deltaScore,
    improvementType,
    primaryChange,
    secondaryChanges,
    remainingGaps,
    coachingSummary,
  };
}

// ── Dave's coaching voice ─────────────────────────────────────────

function buildCoachingSummary(
  type: ImprovementType,
  originalEntry: MistakeEntry,
  trainedEntry: MistakeEntry,
  deltaScore: number,
  mistakeFixed: boolean,
  trainedScore: number,
): string {
  switch (type) {
    case 'mistake_eliminated':
      return `You stopped ${originalEntry.drillCue.toLowerCase().includes('replay') ? 'making the same mistake' : `"${originalEntry.label.toLowerCase()}"`}. That's the behavior change that matters — ${originalEntry.whyItHurts.split('.')[0].toLowerCase()}. ${trainedScore >= 75 ? 'This is live-ready now.' : `Next: work on "${trainedEntry.label}".`}`;

    case 'severity_reduced':
      return `You fixed the deal-killer: "${originalEntry.label}". What's left — "${trainedEntry.label}" — is a refinement issue, not a structural one. That's real progress.`;

    case 'category_shifted':
      return `"${originalEntry.label}" is gone. Your ${originalEntry.skill.replace(/_/g, ' ')} improved. New focus area: ${trainedEntry.skill.replace(/_/g, ' ')} — specifically "${trainedEntry.label}".`;

    case 'specificity_increased':
      return `Same area to work on, but your execution got sharper. +${deltaScore} points means the behavior is shifting. Keep drilling "${originalEntry.label}" — you're close.`;

    case 'regression':
      return `This didn't land better than the original. "${originalEntry.label}" is still there. Go back to the coaching hint and try again — one change at a time.`;

    case 'no_change':
      if (mistakeFixed) {
        return `You addressed "${originalEntry.label}" but introduced a new issue. Focus on one fix at a time — don't overcorrect.`;
      }
      return `"${originalEntry.label}" is still the main issue. The coaching hint from the last rep is the key — apply it deliberately next time.`;

    default:
      return 'Keep working on this. Focus on one specific behavior change per rep.';
  }
}
