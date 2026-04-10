/**
 * Dojo QA Harness — lightweight test fixtures for scorer inspection.
 * Run sample prompts through dojo-score and inspect output coherence.
 * Covers all 3 modes: drill, roleplay, review.
 */

import type { SkillFocus } from './scenarios';
import type { DojoScoreResult } from './types';

export interface QAFixture {
  id: string;
  mode: 'drill' | 'roleplay' | 'review';
  skill: SkillFocus;
  context: string;
  objection: string;
  userResponse: string;
  expectedScoreRange: [number, number];
  expectedMistake?: string;
  /** For roleplay fixtures — multi-turn conversation */
  conversation?: Array<{ role: 'buyer' | 'rep'; content: string }>;
  /** For review fixtures */
  weakResponse?: string;
  userDiagnosis?: string;
  userRewrite?: string;
}

export const QA_FIXTURES: QAFixture[] = [
  // ── DRILL FIXTURES ──
  {
    id: 'qa-oh-weak',
    mode: 'drill',
    skill: 'objection_handling',
    context: 'VP of Marketing at a DTC skincare brand, renewed Braze 3 months ago.',
    objection: "We just renewed Braze three months ago. I'm not ripping that out.",
    userResponse: "I totally understand. Our platform is really great though and has a lot of features. Let me send you a deck.",
    expectedScoreRange: [35, 55],
    expectedMistake: 'too_generic',
  },
  {
    id: 'qa-disc-surface',
    mode: 'drill',
    skill: 'discovery',
    context: 'Sr. Manager of Retention at a DTC skincare brand, churn is up.',
    objection: "Yeah, churn's been up. Can you walk me through your segmentation?",
    userResponse: "How much has churn increased?",
    expectedScoreRange: [45, 62],
    expectedMistake: 'failed_to_deepen',
  },
  {
    id: 'qa-exec-strong',
    mode: 'drill',
    skill: 'executive_response',
    context: 'CMO of a $100M DTC brand, 4 minutes, never seen a demo.',
    objection: "Give me the 30-second version. Why should I care?",
    userResponse: "Your retention revenue is leaking — brands like yours typically lose 15-20% of repeat revenue to lifecycle gaps. We closed that gap for [similar brand] in 60 days and added $2.4M in annual retention revenue. I'd need 20 minutes with your lifecycle lead to show you exactly where your gaps are. Can we get that on the calendar this week?",
    expectedScoreRange: [75, 90],
  },
  {
    id: 'qa-dc-passive',
    mode: 'drill',
    skill: 'deal_control',
    context: 'Director of CRM went dark after strong demo 10 days ago.',
    objection: "Sorry I've been slammed. Can we reconnect in a couple weeks?",
    userResponse: "No problem at all! Totally understand. Just let me know when you're free and we'll get something on the calendar.",
    expectedScoreRange: [35, 50],
    expectedMistake: 'lack_of_control',
  },
  {
    id: 'qa-qual-chase',
    mode: 'drill',
    skill: 'qualification',
    context: 'Marketing Coordinator, 24 years old, no budget authority.',
    objection: "I love this! When can we do a demo for my boss?",
    userResponse: "That's great to hear! I'd love to set up a demo. What day works best for you and your boss?",
    expectedScoreRange: [35, 52],
    expectedMistake: 'failed_to_qualify',
  },

  // ── ROLEPLAY FIXTURES ──
  {
    id: 'qa-rp-discovery-weak',
    mode: 'roleplay',
    skill: 'discovery',
    context: 'Director of CRM at a DTC brand, evaluating lifecycle tools. 45-day eval window.',
    objection: "We're looking at a few options. What makes you different?",
    userResponse: '',
    expectedScoreRange: [40, 58],
    conversation: [
      { role: 'buyer', content: "We're looking at a few options. What makes you different?" },
      { role: 'rep', content: "Great question! We have best-in-class segmentation, AI-powered send time optimization, and over 200 integrations. We're the leader in the space." },
      { role: 'buyer', content: "Everyone says that. What specifically would change for us?" },
      { role: 'rep', content: "Well, our segmentation is really powerful. You can create segments based on any attribute. And our AI optimizes send times automatically." },
      { role: 'buyer', content: "I understand the features. But what problem are you solving for me specifically?" },
      { role: 'rep', content: "We solve retention challenges. Most brands see 20-30% improvement in retention metrics after switching to us." },
    ],
  },
  {
    id: 'qa-rp-objection-strong',
    mode: 'roleplay',
    skill: 'objection_handling',
    context: 'VP RevOps at a mid-market SaaS, locked into Salesforce ecosystem. Concerned about migration.',
    objection: "We're pretty deep in Salesforce. Migration sounds like a nightmare.",
    userResponse: '',
    expectedScoreRange: [65, 82],
    conversation: [
      { role: 'buyer', content: "We're pretty deep in Salesforce. Migration sounds like a nightmare." },
      { role: 'rep', content: "Totally fair — before we talk about any migration, help me understand: what's the biggest friction point your team hits with Salesforce today?" },
      { role: 'buyer', content: "Honestly, reporting is a mess. It takes our ops team 2 days to pull pipeline reports." },
      { role: 'rep', content: "2 days for pipeline reports — that's real time lost. What does that cost you in terms of forecast accuracy? Are you making decisions on stale data?" },
      { role: 'buyer', content: "Yeah, our forecasts are usually off by 15-20%. The board's noticed." },
      { role: 'rep', content: "So the board is flagging forecast accuracy, and the root cause traces back to a 2-day reporting lag. That's a $-problem, not just an ops annoyance. Here's what I'd suggest — let me show you how [similar company] got real-time pipeline visibility without ripping out Salesforce. We layered on top. 30 minutes, and you'll know if it's worth exploring. Can we do Thursday?" },
    ],
  },

  // ── REVIEW FIXTURES ──
  {
    id: 'qa-rev-diagnosis-weak',
    mode: 'review',
    skill: 'deal_control',
    context: 'Champion went silent after verbal commitment. No next step locked.',
    objection: "Let me check with my team and get back to you.",
    userResponse: '',
    expectedScoreRange: [35, 55],
    weakResponse: "Sounds great! Take your time and let me know when your team has had a chance to review. I'll send over the proposal and some case studies in the meantime. Looking forward to hearing back!",
    userDiagnosis: "The rep is being too passive and not setting a next step.",
    userRewrite: "I appreciate that — before you loop in your team, what specific concerns do you think they'll raise? I want to make sure the materials I send address those directly. And let's lock in a 15-minute check-in for Thursday so we don't lose momentum.",
  },
  {
    id: 'qa-rev-diagnosis-missed',
    mode: 'review',
    skill: 'qualification',
    context: 'Junior analyst asking for a demo. No decision-making authority.',
    objection: "This looks really cool. Can I get a demo?",
    userResponse: '',
    expectedScoreRange: [30, 48],
    weakResponse: "Absolutely! I'd love to show you a demo. Let me send you a calendar link and we can find a time that works. I'll prepare a custom walkthrough based on your use case.",
    userDiagnosis: "The response is too eager and doesn't ask enough questions.",
    userRewrite: "Happy to do a demo! What time works for you next week? I'll make sure to tailor it to your needs.",
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
    /** Roleplay-specific */
    turnAnalysisPresent?: boolean;
    controlArcPresent?: boolean;
    /** Review-specific */
    diagnosisAccuracyPresent?: boolean;
    rewriteFixedPresent?: boolean;
  };
  issues: string[];
}

export function validateQAResult(fixture: QAFixture, result: DojoScoreResult): QAResult {
  const issues: string[] = [];

  const scoreInRange = result.score >= fixture.expectedScoreRange[0] && result.score <= fixture.expectedScoreRange[1];
  if (!scoreInRange) issues.push(`Score ${result.score} outside expected range [${fixture.expectedScoreRange.join('-')}]`);

  const mistakeMatch = !fixture.expectedMistake || result.topMistake === fixture.expectedMistake;
  if (!mistakeMatch) issues.push(`Expected mistake "${fixture.expectedMistake}" but got "${result.topMistake}"`);

  const feedbackAligned = result.feedback.length > 20;
  if (!feedbackAligned) issues.push('Feedback too short');

  const focusPatternAligned = result.focusPattern.length > 0;
  if (!focusPatternAligned) issues.push('Missing focusPattern');

  const practiceCueActionable = result.practiceCue.length > 10 && !(/^(focus on|improve|show more|be more)/i.test(result.practiceCue));
  if (!practiceCueActionable) issues.push(`practiceCue too vague: "${result.practiceCue}"`);

  const deltaNotePresent = result.deltaNote.length > 10;
  if (!deltaNotePresent) issues.push('Missing or weak deltaNote');

  if (result.worldClassResponse && result.improvedVersion) {
    if (result.worldClassResponse === result.improvedVersion) {
      issues.push('worldClassResponse identical to improvedVersion');
    }
  }

  // Mode-specific checks
  const raw = result as unknown as Record<string, unknown>;

  let turnAnalysisPresent: boolean | undefined;
  let controlArcPresent: boolean | undefined;
  let diagnosisAccuracyPresent: boolean | undefined;
  let rewriteFixedPresent: boolean | undefined;

  if (fixture.mode === 'roleplay') {
    turnAnalysisPresent = Array.isArray(raw.turnAnalysis) && (raw.turnAnalysis as unknown[]).length > 0;
    if (!turnAnalysisPresent) issues.push('Missing turnAnalysis for roleplay');
    controlArcPresent = typeof raw.controlArc === 'string' && (raw.controlArc as string).length > 10;
    if (!controlArcPresent) issues.push('Missing controlArc for roleplay');
  }

  if (fixture.mode === 'review') {
    diagnosisAccuracyPresent = typeof raw.diagnosisAccuracy === 'string';
    if (!diagnosisAccuracyPresent) issues.push('Missing diagnosisAccuracy for review');
    rewriteFixedPresent = typeof raw.rewriteFixedIssue === 'boolean';
    if (!rewriteFixedPresent) issues.push('Missing rewriteFixedIssue for review');
  }

  return {
    fixture,
    result,
    scoreInRange,
    mistakeMatch,
    coherenceCheck: {
      feedbackAligned,
      focusPatternAligned,
      practiceCueActionable,
      deltaNotePresent,
      turnAnalysisPresent,
      controlArcPresent,
      diagnosisAccuracyPresent,
      rewriteFixedPresent,
    },
    issues,
  };
}
