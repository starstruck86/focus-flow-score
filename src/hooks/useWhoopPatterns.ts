/**
 * WHOOP Pattern Detection Engine.
 *
 * Detects day-N → day-N+1 relationships between biometric data
 * and sales performance. Only surfaces patterns that meet:
 *   - Minimum 5 occurrences
 *   - Consistent direction
 *   - ≥10% effect size
 *
 * NO single-day correlations. NO weak patterns.
 */

import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWhoopData, type ValidatedWhoopDay } from './useWhoopData';

// ── Types ───────────────────────────────────────────────────────

export type BioMetric = 'recovery' | 'sleep' | 'strain';
export type PerfMetric = 'dials' | 'conversations' | 'meetings_set' | 'opportunities_created';
export type ConditionLevel = 'high' | 'low';

export interface DetectedPattern {
  bioMetric: BioMetric;
  perfMetric: PerfMetric;
  condition: ConditionLevel;
  /** Average perf on days following high/low bio */
  avgPerf: number;
  /** Average perf on all other days */
  baselinePerf: number;
  /** (avgPerf - baselinePerf) / baselinePerf — signed */
  effectSize: number;
  /** Number of matching days */
  sampleSize: number;
  /** Human-readable pattern */
  narrative: string;
  /** 'high' | 'moderate' | 'early_signal' */
  confidence: 'high' | 'moderate' | 'early_signal';
}

// ── Constants ───────────────────────────────────────────────────

const MIN_SAMPLE = 5;
const MIN_EFFECT_SIZE = 0.10; // 10%
const HIGH_CONFIDENCE_SAMPLE = 14;

/** Thresholds for high/low classification */
const THRESHOLDS: Record<BioMetric, { high: number; low: number }> = {
  recovery: { high: 67, low: 33 },
  sleep: { high: 75, low: 50 },
  strain: { high: 14, low: 8 },
};

const PERF_DB_FIELDS: Record<PerfMetric, string> = {
  dials: 'dials',
  conversations: 'conversations',
  meetings_set: 'meetings_set',
  opportunities_created: 'opportunities_created',
};

const PERF_LABELS: Record<PerfMetric, string> = {
  dials: 'dial count',
  conversations: 'conversation count',
  meetings_set: 'meetings set',
  opportunities_created: 'opportunities created',
};

const BIO_LABELS: Record<BioMetric, string> = {
  recovery: 'recovery',
  sleep: 'sleep score',
  strain: 'strain',
};

// ── Hook ────────────────────────────────────────────────────────

export function useWhoopPatterns() {
  const { user } = useAuth();
  const { getCleanDays } = useWhoopData();

  const detectPatterns = useCallback(async (): Promise<DetectedPattern[]> => {
    if (!user?.id) return [];

    // 1. Get validated WHOOP days
    const whoopDays = await getCleanDays(30);
    if (whoopDays.length < MIN_SAMPLE) return [];

    // 2. Get journal entries for the same period
    const dates = whoopDays.map(d => d.date);
    const { data: journals } = await supabase
      .from('daily_journal_entries')
      .select('date, dials, conversations, meetings_set, opportunities_created')
      .eq('user_id', user.id)
      .in('date', dates);

    if (!journals?.length || journals.length < MIN_SAMPLE) return [];

    // 3. Build date-indexed lookup for journal data
    const journalMap = new Map<string, typeof journals[0]>();
    for (const j of journals) journalMap.set(j.date, j);

    // 4. Build date-indexed lookup for WHOOP data
    const whoopMap = new Map<string, ValidatedWhoopDay>();
    for (const w of whoopDays) whoopMap.set(w.date, w);

    // 5. Test each bio → perf combination (day N bio → day N+1 perf)
    const patterns: DetectedPattern[] = [];

    const bioMetrics: BioMetric[] = ['recovery', 'sleep', 'strain'];
    const perfMetrics: PerfMetric[] = ['dials', 'conversations', 'meetings_set', 'opportunities_created'];

    for (const bio of bioMetrics) {
      for (const perf of perfMetrics) {
        for (const condition of ['high', 'low'] as ConditionLevel[]) {
          const result = testPattern(whoopDays, journalMap, bio, perf, condition);
          if (result) patterns.push(result);
        }
      }
    }

    // Sort by effect size (absolute) descending
    patterns.sort((a, b) => Math.abs(b.effectSize) - Math.abs(a.effectSize));

    return patterns;
  }, [user?.id, getCleanDays]);

  return { detectPatterns };
}

// ── Pattern test ────────────────────────────────────────────────

function testPattern(
  whoopDays: ValidatedWhoopDay[],
  journalMap: Map<string, { date: string; dials: number; conversations: number; meetings_set: number; opportunities_created: number }>,
  bio: BioMetric,
  perf: PerfMetric,
  condition: ConditionLevel,
): DetectedPattern | null {
  const threshold = THRESHOLDS[bio];
  const matchDayPerfs: number[] = [];
  const otherDayPerfs: number[] = [];

  for (let i = 0; i < whoopDays.length - 1; i++) {
    const bioDay = whoopDays[i];
    const bioVal = bioDay[bio];
    if (bioVal === null) continue;

    // Next calendar day perf
    const nextDate = nextDay(bioDay.date);
    const nextJournal = journalMap.get(nextDate);
    if (!nextJournal) continue;

    const perfVal = nextJournal[perf] ?? 0;
    const isMatch = condition === 'high'
      ? bioVal >= threshold.high
      : bioVal <= threshold.low;

    if (isMatch) {
      matchDayPerfs.push(perfVal);
    } else {
      otherDayPerfs.push(perfVal);
    }
  }

  // Check minimum sample size
  if (matchDayPerfs.length < MIN_SAMPLE) return null;
  if (otherDayPerfs.length < 2) return null; // need baseline

  const avgMatch = mean(matchDayPerfs);
  const avgOther = mean(otherDayPerfs);

  // Avoid division by zero
  if (avgOther === 0 && avgMatch === 0) return null;
  const effectSize = avgOther === 0
    ? (avgMatch > 0 ? 1 : 0)
    : (avgMatch - avgOther) / avgOther;

  // Check minimum effect size
  if (Math.abs(effectSize) < MIN_EFFECT_SIZE) return null;

  // Check direction consistency (at least 60% of matching days should trend same way)
  const direction = effectSize > 0 ? 'up' : 'down';
  const consistent = matchDayPerfs.filter(p =>
    direction === 'up' ? p > avgOther : p < avgOther,
  ).length;
  const consistencyRate = consistent / matchDayPerfs.length;
  if (consistencyRate < 0.6) return null;

  // Confidence level
  const confidence: DetectedPattern['confidence'] =
    matchDayPerfs.length >= HIGH_CONFIDENCE_SAMPLE ? 'high'
    : matchDayPerfs.length >= MIN_SAMPLE + 3 ? 'moderate'
    : 'early_signal';

  // Build narrative
  const pctChange = Math.round(Math.abs(effectSize) * 100);
  const directionWord = effectSize > 0 ? 'higher' : 'lower';
  const bioLabel = BIO_LABELS[bio];
  const perfLabel = PERF_LABELS[perf];

  // For strain, "high strain" means more exertion
  const conditionLabel = condition === 'high'
    ? `high-${bioLabel}` : `low-${bioLabel}`;

  const narrative = `After ${conditionLabel} days, your next-day ${perfLabel} is ~${pctChange}% ${directionWord} (${matchDayPerfs.length} occurrences).`;

  return {
    bioMetric: bio,
    perfMetric: perf,
    condition,
    avgPerf: round2(avgMatch),
    baselinePerf: round2(avgOther),
    effectSize: round2(effectSize),
    sampleSize: matchDayPerfs.length,
    narrative,
    confidence,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
