/**
 * "Why Now" Thread
 *
 * Every system decision/recommendation must include:
 * - whyThis: why this specific recommendation
 * - whyNow: why at this moment
 * - whatChanged: what triggered the recommendation
 * - consequenceIfIgnored: what happens if not acted on
 * - confidence: how sure the system is
 *
 * Feature-flagged via ENABLE_VOICE_OS.
 */

export interface WhyNowThread {
  whyThis: string;
  whyNow: string;
  whatChanged: string;
  consequenceIfIgnored: string;
  confidence: number;
}

/**
 * Build a WhyNow thread from available context.
 */
export function buildWhyNow(opts: {
  recommendation: string;
  dealName?: string;
  stage?: string;
  closeDate?: string;
  daysUntilClose?: number;
  riskLevel?: string;
  recentActivity?: string;
  confidence: number;
}): WhyNowThread {
  const { recommendation, dealName, stage, closeDate, daysUntilClose, riskLevel, recentActivity, confidence } = opts;

  // whyThis
  const whyThis = dealName
    ? `${recommendation} — specifically for ${dealName}${stage ? ` at ${stage} stage` : ''}.`
    : recommendation;

  // whyNow
  let whyNow = 'This is the highest-priority action based on current data.';
  if (daysUntilClose !== undefined && daysUntilClose <= 14) {
    whyNow = `Close date is ${daysUntilClose} days away — action needed now.`;
  } else if (riskLevel === 'high' || riskLevel === 'critical') {
    whyNow = `Risk level is ${riskLevel} — delayed action increases loss probability.`;
  } else if (recentActivity) {
    whyNow = `Recent activity: ${recentActivity}. Momentum window is open.`;
  }

  // whatChanged
  let whatChanged = 'Routine priority scoring update.';
  if (recentActivity) whatChanged = recentActivity;
  if (riskLevel && riskLevel !== 'low') whatChanged = `Risk escalated to ${riskLevel}.`;

  // consequenceIfIgnored
  let consequenceIfIgnored = 'May miss the optimal action window.';
  if (daysUntilClose !== undefined && daysUntilClose <= 7) {
    consequenceIfIgnored = `Deal could slip — only ${daysUntilClose} days to close.`;
  } else if (riskLevel === 'high' || riskLevel === 'critical') {
    consequenceIfIgnored = 'Risk of deal loss increases significantly.';
  }

  return { whyThis, whyNow, whatChanged, consequenceIfIgnored, confidence };
}

/**
 * Format WhyNow thread for voice delivery (concise).
 */
export function formatWhyNowForVoice(thread: WhyNowThread): string {
  return `${thread.whyThis} ${thread.whyNow}`;
}

/**
 * Format WhyNow thread for UI display (full detail).
 */
export function formatWhyNowForDisplay(thread: WhyNowThread): string {
  const lines = [
    `**Why this:** ${thread.whyThis}`,
    `**Why now:** ${thread.whyNow}`,
    `**What changed:** ${thread.whatChanged}`,
    `**If ignored:** ${thread.consequenceIfIgnored}`,
  ];
  if (thread.confidence < 55) lines.push(`⚠️ Low confidence (${thread.confidence}%)`);
  return lines.join('\n');
}
