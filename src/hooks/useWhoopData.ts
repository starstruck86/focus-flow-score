/**
 * WHOOP Data Access + Validation layer.
 * Validates ranges, handles gaps, flags anomalies.
 * Only clean, validated data passes through.
 */

import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ValidatedWhoopDay {
  date: string;
  recovery: number | null;   // 0-100
  sleep: number | null;      // 0-100
  strain: number | null;     // 0-21 typical, capped at 25
  gapFlags: string[];        // e.g. ['no_recovery', 'no_sleep']
  anomaly: boolean;          // true if values look suspicious
}

// ── Validation constants ───────────────────────────────────────
const RECOVERY_MIN = 0;
const RECOVERY_MAX = 100;
const SLEEP_MIN = 0;
const SLEEP_MAX = 100;
const STRAIN_MIN = 0;
const STRAIN_MAX = 25; // WHOOP max is ~21 but allow headroom
const ANOMALY_RECOVERY_JUMP = 40; // >40pt day-over-day jump = anomaly

function clampOrNull(val: number | null, min: number, max: number): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'number' || isNaN(val)) return null;
  if (val < min || val > max) return null; // out-of-range = treat as missing
  return val;
}

function detectAnomalies(days: ValidatedWhoopDay[]): void {
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const curr = days[i];
    if (prev.recovery !== null && curr.recovery !== null) {
      if (Math.abs(curr.recovery - prev.recovery) > ANOMALY_RECOVERY_JUMP) {
        curr.anomaly = true;
      }
    }
  }
}

export function useWhoopData() {
  const { user } = useAuth();

  /** Fetch and validate N days of WHOOP metrics */
  const getValidatedDays = useCallback(async (days = 30): Promise<ValidatedWhoopDay[]> => {
    if (!user?.id) return [];

    const { data, error } = await supabase
      .from('whoop_daily_metrics')
      .select('date, recovery_score, sleep_score, strain_score')
      .eq('user_id', user.id)
      .order('date', { ascending: true })
      .limit(days);

    if (error || !data?.length) return [];

    const validated: ValidatedWhoopDay[] = data.map(row => {
      const recovery = clampOrNull(Number(row.recovery_score), RECOVERY_MIN, RECOVERY_MAX);
      const sleep = clampOrNull(Number(row.sleep_score), SLEEP_MIN, SLEEP_MAX);
      const strain = clampOrNull(Number(row.strain_score), STRAIN_MIN, STRAIN_MAX);

      const gapFlags: string[] = [];
      if (recovery === null) gapFlags.push('no_recovery');
      if (sleep === null) gapFlags.push('no_sleep');
      if (strain === null) gapFlags.push('no_strain');

      return {
        date: row.date,
        recovery,
        sleep,
        strain,
        gapFlags,
        anomaly: false,
      };
    });

    detectAnomalies(validated);
    return validated;
  }, [user?.id]);

  /** Get only clean (non-anomalous, non-gap) days */
  const getCleanDays = useCallback(async (days = 30): Promise<ValidatedWhoopDay[]> => {
    const all = await getValidatedDays(days);
    return all.filter(d => !d.anomaly);
  }, [getValidatedDays]);

  /** Check if enough data exists for pattern detection (minimum 5 valid days) */
  const hasMinimumData = useCallback(async (): Promise<boolean> => {
    const clean = await getCleanDays(30);
    return clean.filter(d => d.recovery !== null || d.sleep !== null).length >= 5;
  }, [getCleanDays]);

  return { getValidatedDays, getCleanDays, hasMinimumData };
}
