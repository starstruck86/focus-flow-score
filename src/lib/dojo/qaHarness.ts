/**
 * Dojo QA Harness — lightweight test fixtures for scorer inspection.
 * Run sample prompts through dojo-score and inspect output coherence.
 */

import type { SkillFocus } from './scenarios';
import type { DojoScoreResult } from './types';
import { normalizeScoreResult } from './types';

export interface QAFixture {
  id: string;
  skill: SkillFocus;
  context: string;
  objection: string;
  userResponse: string;
  expectedScoreRange: [number, number];
  expectedMistake?: string;
}

export const QA_FIXTURES: QAFixture[] = [
  {
    id: 'qa-oh-weak',
    skill: 'objection_handling',
    context: 'VP of Marketing at a DTC skincare brand, renewed Braze 3 months ago.',
    objection: "We just renewed Braze three months ago. I'm not ripping that out.",
    userResponse: "I totally understand. Our platform is really great though and has a lot of features. Let me send you a deck.",
    expectedScoreRange: [35, 55],
    expectedMistake: 'too_generic',
  },
  {
    id: 'qa-disc-surface',
    skill: 'discovery',
    context: 'Sr. Manager of Retention at a DTC skincare brand, churn is up.',
    objection: "Yeah, churn's been up. Can you walk me through your segmentation?",
    userResponse: "How much has churn increased?",
    expectedScoreRange: [45, 62],
    expectedMistake: 'failed_to_deepen',
  },
  {
    id: 'qa-exec-strong',
    skill: 'executive_response',
    context: 'CMO of a $100M DTC brand, 4 minutes, never seen a demo.',
    objection: "Give me the 30-second version. Why should I care?",
    userResponse: "Your retention revenue is leaking — brands like yours typically lose 15-20% of repeat revenue to lifecycle gaps. We closed that gap for [similar brand] in 60 days and added $2.4M in annual retention revenue. I'd need 20 minutes with your lifecycle lead to show you exactly where your gaps are. Can we get that on the calendar this week?",
    expectedScoreRange: [75, 90],
  },
  {
    id: 'qa-dc-passive',
    skill: 'deal_control',
    context: 'Director of CRM went dark after strong demo 10 days ago.',
    objection: "Sorry I've been slammed. Can we reconnect in a couple weeks?",
    userResponse: "No problem at all! Totally understand. Just let me know when you're free and we'll get something on the calendar.",
    expectedScoreRange: [35, 50],
    expectedMistake: 'lack_of_control',
  },
  {
    id: 'qa-qual-chase',
    skill: 'qualification',
    context: 'Marketing Coordinator, 24 years old, no budget authority.',
    objection: "I love this! When can we do a demo for my boss?",
    userResponse: "That's great to hear! I'd love to set up a demo. What day works best for you and your boss?",
    expectedScoreRange: [35, 52],
    expectedMistake: 'failed_to_qualify',
  },
];

export interface QAResult {
  fixture: QAFixture;
  result: DojoScoreResult;
  scoreInRange: boolean;
  mistakeMatch: boolean;
  coherenceCheck: {
    feedbackAligned: boolean;
    focusPatternAligned: boolean;
    practiceCueActionable: boolean;
    deltaNotePresent: boolean;
  };
  issues: string[];
}

export function validateQAResult(fixture: QAFixture, result: DojoScoreResult): QAResult {
  const issues: string[] = [];

  const scoreInRange = result.score >= fixture.expectedScoreRange[0] && result.score <= fixture.expectedScoreRange[1];
  if (!scoreInRange) issues.push(`Score ${result.score} outside expected range [${fixture.expectedScoreRange.join('-')}]`);

  const mistakeMatch = !fixture.expectedMistake || result.topMistake === fixture.expectedMistake;
  if (!mistakeMatch) issues.push(`Expected mistake "${fixture.expectedMistake}" but got "${result.topMistake}"`);

  // Coherence checks
  const feedbackAligned = result.feedback.length > 20;
  if (!feedbackAligned) issues.push('Feedback too short');

  const focusPatternAligned = result.focusPattern.length > 0;
  if (!focusPatternAligned) issues.push('Missing focusPattern');

  const practiceCueActionable = result.practiceCue.length > 10 && !(/^(focus on|improve|show more|be more)/i.test(result.practiceCue));
  if (!practiceCueActionable) issues.push(`practiceCue too vague: "${result.practiceCue}"`);

  const deltaNotePresent = result.deltaNote.length > 10;
  if (!deltaNotePresent) issues.push('Missing or weak deltaNote');

  // World-class should differ from improved
  if (result.worldClassResponse && result.improvedVersion) {
    if (result.worldClassResponse === result.improvedVersion) {
      issues.push('worldClassResponse identical to improvedVersion');
    }
  }

  return {
    fixture,
    result,
    scoreInRange,
    mistakeMatch,
    coherenceCheck: { feedbackAligned, focusPatternAligned, practiceCueActionable, deltaNotePresent },
    issues,
  };
}
