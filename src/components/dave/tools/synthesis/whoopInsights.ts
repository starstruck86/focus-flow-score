/**
 * WHOOP Insights for Dave — gated pattern surfacing.
 *
 * Only surfaces insights when:
 * - Pattern is validated (≥5 occurrences, ≥10% effect)
 * - Impact is meaningful
 *
 * Tone: suggestive, not prescriptive. Concise. Tied to performance.
 * Does NOT override execution plan or excuse missed targets.
 */

import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';

interface WhoopDay {
  date: string;
  recovery_score: number | null;
  sleep_score: number | null;
  strain_score: number | null;
}

interface JournalDay {
  date: string;
  dials: number;
  conversations: number;
  meetings_set: number;
  opportunities_created: number;
}

const MIN_SAMPLE = 5;
const MIN_EFFECT = 0.10;
const RECOVERY_HIGH = 67;
const RECOVERY_LOW = 33;
const SLEEP_HIGH = 75;
const SLEEP_LOW = 50;

type BioKey = 'recovery_score' | 'sleep_score' | 'strain_score';
type PerfKey = 'dials' | 'conversations' | 'meetings_set' | 'opportunities_created';

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function nextDateStr(d: string): string {
  const dt = new Date(d + 'T12:00:00Z');
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString().split('T')[0];
}

interface ValidatedPattern {
  label: string;
  effect: number;
  samples: number;
  confidence: string;
  suggestion: string;
}

function findPatterns(whoop: WhoopDay[], journals: Map<string, JournalDay>): ValidatedPattern[] {
  const results: ValidatedPattern[] = [];

  const checks: Array<{
    bio: BioKey;
    bioLabel: string;
    condition: 'high' | 'low';
    threshold: number;
    compare: 'gte' | 'lte';
    perf: PerfKey;
    perfLabel: string;
    suggestion: string;
  }> = [
    // Recovery → next-day output
    { bio: 'recovery_score', bioLabel: 'recovery', condition: 'low', threshold: RECOVERY_LOW, compare: 'lte', perf: 'dials', perfLabel: 'call volume', suggestion: 'Consider a short reset or lighter prospecting block before your calls.' },
    { bio: 'recovery_score', bioLabel: 'recovery', condition: 'high', threshold: RECOVERY_HIGH, compare: 'gte', perf: 'conversations', perfLabel: 'conversation rate', suggestion: 'Great time for difficult conversations and power hours.' },
    // Sleep → conversion
    { bio: 'sleep_score', bioLabel: 'sleep', condition: 'low', threshold: SLEEP_LOW, compare: 'lte', perf: 'meetings_set', perfLabel: 'meeting conversion', suggestion: 'On lower-sleep days, lean into admin and research vs. live calls.' },
    { bio: 'sleep_score', bioLabel: 'sleep', condition: 'high', threshold: SLEEP_HIGH, compare: 'gte', perf: 'meetings_set', perfLabel: 'meeting conversion', suggestion: 'Sharp days like this tend to convert. Prioritize live outreach.' },
    // Strain → next-day performance
    { bio: 'strain_score', bioLabel: 'strain', condition: 'high', threshold: 14, compare: 'gte', perf: 'dials', perfLabel: 'call volume', suggestion: 'High-strain days may reduce next-day output. Consider a shorter call block.' },
  ];

  for (const chk of checks) {
    const matchPerfs: number[] = [];
    const otherPerfs: number[] = [];

    for (const w of whoop) {
      const bioVal = w[chk.bio] as number | null;
      if (bioVal === null || bioVal === undefined) continue;
      const next = journals.get(nextDateStr(w.date));
      if (!next) continue;

      const perfVal = next[chk.perf] ?? 0;
      const isMatch = chk.compare === 'gte' ? bioVal >= chk.threshold : bioVal <= chk.threshold;

      if (isMatch) matchPerfs.push(perfVal);
      else otherPerfs.push(perfVal);
    }

    if (matchPerfs.length < MIN_SAMPLE || otherPerfs.length < 2) continue;

    const avgMatch = mean(matchPerfs);
    const avgOther = mean(otherPerfs);
    if (avgOther === 0 && avgMatch === 0) continue;

    const effect = avgOther === 0 ? 1 : (avgMatch - avgOther) / avgOther;
    if (Math.abs(effect) < MIN_EFFECT) continue;

    const pct = Math.round(Math.abs(effect) * 100);
    const dir = effect > 0 ? 'higher' : 'lower';
    const confidence = matchPerfs.length >= 14 ? 'high' : matchPerfs.length >= 8 ? 'moderate' : 'early signal';

    results.push({
      label: `${chk.condition}-${chk.bioLabel} → ${chk.perfLabel}`,
      effect,
      samples: matchPerfs.length,
      confidence,
      suggestion: `Pattern (${confidence}, ${matchPerfs.length} days): After ${chk.condition}-${chk.bioLabel} days, your next-day ${chk.perfLabel} is ~${pct}% ${dir}. ${chk.suggestion}`,
    });
  }

  // Sort by absolute effect
  results.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return results;
}

// ── Dave tool: whoop_performance_insights ────────────────────────

export async function whoopPerformanceInsights(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  // Fetch WHOOP data (last 30 days)
  const { data: whoopData } = await supabase
    .from('whoop_daily_metrics')
    .select('date, recovery_score, sleep_score, strain_score')
    .eq('user_id', userId)
    .order('date', { ascending: true })
    .limit(30);

  if (!whoopData?.length || whoopData.length < MIN_SAMPLE) {
    return 'Not enough WHOOP data yet (need at least 5 days). Keep syncing and I\'ll identify patterns soon.';
  }

  // Validate: filter out anomalous values
  const validWhoop = whoopData.filter(w => {
    const r = w.recovery_score as number | null;
    const s = w.sleep_score as number | null;
    const st = w.strain_score as number | null;
    if (r !== null && (r < 0 || r > 100)) return false;
    if (s !== null && (s < 0 || s > 100)) return false;
    if (st !== null && (st < 0 || st > 25)) return false;
    return true;
  });

  if (validWhoop.length < MIN_SAMPLE) {
    return 'Not enough valid WHOOP data yet. Some days had out-of-range values. Need 5+ clean days.';
  }

  // Fetch journal data
  const dates = validWhoop.map(w => w.date);
  const { data: journals } = await supabase
    .from('daily_journal_entries')
    .select('date, dials, conversations, meetings_set, opportunities_created')
    .eq('user_id', userId)
    .in('date', dates);

  if (!journals?.length || journals.length < MIN_SAMPLE) {
    return 'Not enough matching journal data. Log at least 5 days of activity alongside WHOOP data for pattern detection.';
  }

  const journalMap = new Map<string, JournalDay>();
  for (const j of journals) journalMap.set(j.date, j as JournalDay);

  const patterns = findPatterns(validWhoop as WhoopDay[], journalMap);

  if (patterns.length === 0) {
    return 'No validated performance patterns yet. I need more data, or your performance is consistent regardless of biometrics — which is actually a strength.';
  }

  // Surface top 2 patterns max to avoid noise
  const topPatterns = patterns.slice(0, 2);
  const lines: string[] = ['📊 **Performance Patterns** (from your WHOOP + activity data)\n'];

  for (const p of topPatterns) {
    lines.push(p.suggestion);
    lines.push('');
  }

  lines.push('_These patterns are based on your own data. They\'re meant to inform, not control your schedule._');

  return lines.join('\n');
}

// ── Dave tool: whoop_today_context ──────────────────────────────

export async function whoopTodayContext(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const today = new Date().toISOString().split('T')[0];
  const { data: todayMetric } = await supabase
    .from('whoop_daily_metrics')
    .select('recovery_score, sleep_score, strain_score')
    .eq('user_id', userId)
    .eq('date', today)
    .limit(1);

  const metric = todayMetric?.[0];
  if (!metric) return 'No WHOOP data for today. Sync your WHOOP or check back later.';

  const recovery = metric.recovery_score as number | null;
  const sleep = metric.sleep_score as number | null;

  // Only add context if there are validated patterns
  const { data: whoopHistory } = await supabase
    .from('whoop_daily_metrics')
    .select('date, recovery_score, sleep_score, strain_score')
    .eq('user_id', userId)
    .order('date', { ascending: true })
    .limit(30);

  const dates = whoopHistory?.map(w => w.date) || [];
  const { data: journals } = await supabase
    .from('daily_journal_entries')
    .select('date, dials, conversations, meetings_set, opportunities_created')
    .eq('user_id', userId)
    .in('date', dates);

  const journalMap = new Map<string, JournalDay>();
  for (const j of (journals || [])) journalMap.set(j.date, j as JournalDay);

  const patterns = whoopHistory && whoopHistory.length >= MIN_SAMPLE
    ? findPatterns(whoopHistory as WhoopDay[], journalMap)
    : [];

  let result = `Today's WHOOP: Recovery ${recovery ?? '—'}% | Sleep ${sleep ?? '—'}%`;

  // Only add pattern-based suggestion if a validated pattern applies to today
  if (patterns.length > 0 && recovery !== null) {
    const relevant = patterns.find(p => {
      if (p.label.includes('low-recovery') && recovery <= RECOVERY_LOW) return true;
      if (p.label.includes('high-recovery') && recovery >= RECOVERY_HIGH) return true;
      return false;
    });
    if (relevant) {
      result += `\n${relevant.suggestion}`;
    }
  }

  return result;
}
