/**
 * Dave's trend comparison tool — interpretation layer only.
 * All computation is delegated to the shared comparison engine
 * at src/data/comparison-engine.ts.
 */
import type { ToolContext } from '../../toolTypes';
import {
  runComparison,
  type PeriodType,
  type ComparisonResult,
  type MetricComparison,
  type ConfidenceLevel,
} from '@/data/comparison-engine';

// ── NLP helpers (Dave-specific) ─────────────────────────────────

function detectPeriod(question: string): PeriodType {
  const q = question.toLowerCase();
  if (q.includes('yesterday') || q.includes('day before') || q.includes('today vs')) return 'day';
  if (q.includes('quarter')) return 'quarter';
  if (q.includes('month over month') || q.includes('this month') || q.includes('last month')) return 'month';
  if (q.includes('rolling 30') || q.includes('30-day') || q.includes('30 day')) return 'rolling-30';
  if (q.includes('rolling 7') || q.includes('7-day') || q.includes('7 day')) return 'rolling-7';
  return 'week';
}

function detectMetricFocus(question: string): string | null {
  const q = question.toLowerCase();
  if (q.includes('dial')) return 'dials';
  if (q.includes('conversation') || q.includes('connect')) return 'conversations';
  if (q.includes('meeting')) return 'meetingsSet';
  if (q.includes('opportunit') || q.includes('opp')) return 'oppsCreated';
  if (q.includes('pipeline')) return 'pipelineMoved';
  if (q.includes('prospect')) return 'prospects';
  if (q.includes('conversion') || q.includes('rate')) return 'dialToConvo';
  if (q.includes('sleep')) return 'avgSleep';
  if (q.includes('recovery') || q.includes('recover')) return 'avgRecovery';
  if (q.includes('strain')) return 'avgStrain';
  if (q.includes('score') || q.includes('performance')) return 'avgScore';
  return null;
}

function wantsDetail(question: string): boolean {
  const q = question.toLowerCase();
  return q.includes('detail') || q.includes('break') || q.includes('drill') || q.includes('deep') || q.includes('every metric') || q.includes('all metric');
}

// ── Public tool function ────────────────────────────────────────

export async function compareTrends(ctx: ToolContext, params: { question?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const question = params.question || 'How am I doing this week vs last week?';
  const periodType = detectPeriod(question);
  const focus = detectMetricFocus(question);
  const detail = wantsDetail(question);

  const result = await runComparison(userId, periodType);

  if (!result) {
    return `I don't have enough check-in data to run that comparison yet. Keep logging and I'll be able to spot trends.`;
  }

  // Focused on a single metric
  if (focus) {
    const focusedMetric = result.metrics.find(c => c.metric === focus);
    if (focusedMetric) return buildFocusedResponse(focusedMetric, result, detail);
  }

  return detail ? buildDetailedTrend(result) : buildSummaryTrend(result);
}

// ── Interpretation & response formatting ────────────────────────

function comparisonModeNote(result: ComparisonResult): string {
  if (result.comparisonMode === 'to-date') {
    return `(Note: this is a to-date comparison — ${result.currentLabel} vs ${result.previousLabel}, so we're comparing the same number of days for a fair read.)`;
  }
  return '';
}

function formatVal(m: MetricComparison): string {
  if (m.isRate) return `${m.currentValue}% vs ${m.previousValue}%`;
  return `${m.currentValue} vs ${m.previousValue}`;
}

function formatMetricLine(m: MetricComparison): string {
  const arrow = m.trend === 'up' ? '↑' : m.trend === 'down' ? '↓' : '→';
  const pct = m.percentChange !== null && m.trend !== 'flat' ? ` (${m.percentChange > 0 ? '+' : ''}${m.percentChange}%)` : '';
  const val = m.isRate ? `${m.currentValue}% → was ${m.previousValue}%` : `${m.currentValue} → was ${m.previousValue}`;
  return `  ${arrow} ${m.label}: ${val}${pct}`;
}

function interpretComparisons(result: ComparisonResult): string {
  const { metrics, currentLabel, previousLabel } = result;
  const meaningful = metrics.filter(m => m.trend !== 'flat' && m.currentValue + m.previousValue > 0);
  if (!meaningful.length) return `Metrics look pretty flat between ${previousLabel} and ${currentLabel}. Not enough change to call out.`;

  const ups = meaningful.filter(m => m.trend === 'up');
  const downs = meaningful.filter(m => m.trend === 'down');
  const sentences: string[] = [];

  if (result.topImprovement) {
    const m = result.topImprovement;
    const pct = m.percentChange !== null ? `${m.percentChange > 0 ? '+' : ''}${m.percentChange}%` : '';
    sentences.push(`Your biggest improvement is ${m.label} — ${formatVal(m)} ${pct}.`);
  }

  if (result.topDecline) {
    const m = result.topDecline;
    const pct = m.percentChange !== null ? `${m.percentChange}%` : '';
    sentences.push(`Biggest drop is ${m.label} — ${formatVal(m)} ${pct}.`);
  }

  // Efficiency insight
  const dialsM = metrics.find(m => m.metric === 'dials');
  const rateM = metrics.find(m => m.metric === 'dialToConvo');
  if (dialsM && rateM) {
    if (dialsM.trend === 'up' && rateM.trend === 'down') {
      sentences.push(`You're dialing more but converting fewer — might be worth checking call quality or targeting.`);
    } else if (dialsM.trend === 'down' && rateM.trend === 'up') {
      sentences.push(`Fewer dials but better conversion — quality over quantity is working.`);
    } else if (dialsM.trend === 'up' && rateM.trend === 'up') {
      sentences.push(`More activity and better conversion — that's the ideal combination.`);
    }
  }

  // WHOOP + performance cross-correlation
  const recoveryM = metrics.find(m => m.metric === 'avgRecovery');
  const scoreM = metrics.find(m => m.metric === 'avgScore');
  if (recoveryM && scoreM && recoveryM.trend !== 'flat' && scoreM.trend !== 'flat') {
    if (recoveryM.trend === 'down' && scoreM.trend === 'down') {
      sentences.push(`Both recovery and daily scores dropped — rest might be the lever here.`);
    } else if (recoveryM.trend === 'up' && scoreM.trend === 'up') {
      sentences.push(`Recovery is up and so are your scores — the body-performance link is real.`);
    } else if (recoveryM.trend === 'down' && scoreM.trend === 'up') {
      sentences.push(`Interesting — scores are up despite lower recovery. You're grinding, but watch for burnout.`);
    } else if (recoveryM.trend === 'up' && scoreM.trend === 'down') {
      sentences.push(`Better recovery but scores are down — might be a focus or strategy issue, not energy.`);
    }
  }

  if (ups.length && downs.length) {
    sentences.push(`Overall, ${ups.length} metric${ups.length > 1 ? 's' : ''} improved and ${downs.length} declined compared to ${previousLabel}.`);
  } else if (ups.length) {
    sentences.push(`All ${ups.length} tracked metrics moved in the right direction.`);
  } else if (downs.length) {
    sentences.push(`${downs.length} metric${downs.length > 1 ? 's' : ''} declined — worth reviewing what changed.`);
  }

  return sentences.join(' ');
}

function buildSummaryTrend(result: ComparisonResult): string {
  const sentences: string[] = [];
  sentences.push(`Here's how ${result.currentLabel} compares to ${result.previousLabel}.`);
  const modeNote = comparisonModeNote(result);
  if (modeNote) sentences.push(modeNote);
  sentences.push(interpretComparisons(result));
  sentences.push(`Want me to break down every metric, or drill into a specific one?`);
  return sentences.join(' ');
}

function buildDetailedTrend(result: ComparisonResult): string {
  const { metrics, currentLabel, previousLabel } = result;
  const sentences: string[] = [];

  sentences.push(`Full breakdown, ${currentLabel} vs ${previousLabel}:`);
  const modeNote = comparisonModeNote(result);
  if (modeNote) sentences.push(modeNote);

  const workMetrics = metrics.filter(m => !['avgRecovery', 'avgSleep', 'avgStrain'].includes(m.metric));
  const whoopMetrics = metrics.filter(m => ['avgRecovery', 'avgSleep', 'avgStrain'].includes(m.metric));

  if (workMetrics.length) {
    sentences.push('\nWork metrics:');
    for (const m of workMetrics) sentences.push(formatMetricLine(m));
  }

  if (whoopMetrics.length && whoopMetrics.some(m => m.currentValue + m.previousValue > 0)) {
    sentences.push('\nBiometrics:');
    for (const m of whoopMetrics) {
      if (m.currentValue + m.previousValue > 0) sentences.push(formatMetricLine(m));
    }
  }

  sentences.push('');
  sentences.push(interpretComparisons(result));
  return sentences.join('\n');
}

function buildFocusedResponse(metric: MetricComparison, result: ComparisonResult, detail: boolean): string {
  const sentences: string[] = [];
  const arrow = metric.trend === 'up' ? '↑' : metric.trend === 'down' ? '↓' : '→';
  const pct = metric.percentChange !== null ? ` (${metric.percentChange > 0 ? '+' : ''}${metric.percentChange}%)` : '';

  sentences.push(`${metric.label}: ${formatVal(metric)} ${arrow}${pct}, comparing ${result.currentLabel} to ${result.previousLabel}.`);

  if (metric.metric === 'dials' || metric.metric === 'conversations') {
    const rate = result.metrics.find(m => m.metric === 'dialToConvo');
    if (rate && rate.currentValue + rate.previousValue > 0) {
      sentences.push(`Your dial-to-conversation rate is ${rate.currentValue}% vs ${rate.previousValue}% — ${rate.trend === 'up' ? 'efficiency is improving' : rate.trend === 'down' ? 'efficiency dipped' : 'holding steady'}.`);
    }
  }

  if (['avgRecovery', 'avgSleep', 'avgStrain'].includes(metric.metric)) {
    const score = result.metrics.find(m => m.metric === 'avgScore');
    if (score && score.currentValue + score.previousValue > 0) {
      sentences.push(`Meanwhile, your daily score went ${score.trend === 'up' ? 'up' : score.trend === 'down' ? 'down' : 'flat'} (${score.currentValue} vs ${score.previousValue}).`);
    }
  }

  if (detail) {
    sentences.push('');
    sentences.push(interpretComparisons(result));
  }

  return sentences.join(' ');
}
