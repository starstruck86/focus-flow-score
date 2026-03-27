/**
 * Intervention Guard
 *
 * Prevents intervention fatigue by rate-limiting nudges, coaching prompts,
 * and recommendations. Enforces temporal suppression rules.
 *
 * Feature-flagged via ENABLE_SYSTEM_OS.
 */

import { createLogger } from './logger';

const log = createLogger('InterventionGuard');

// ── Types ──────────────────────────────────────────────────

export type InterventionType =
  | 'major_nudge'
  | 'pre_call_nudge'
  | 'post_call_reflection'
  | 'coach_nudge'
  | 'post_action'
  | 'risk_alert'
  | 'playbook_suggestion';

export interface InterventionRecord {
  type: InterventionType;
  timestamp: number; // epoch ms
  blockId?: string;  // optional time-block reference
}

// ── Rules ──────────────────────────────────────────────────

const SUPPRESSION_RULES: Record<InterventionType, {
  maxPerBlock: number;       // max occurrences per time-block (2h default)
  cooldownMs: number;        // minimum gap between same-type interventions
  suppressLowConfidence: boolean;
}> = {
  major_nudge:         { maxPerBlock: 1, cooldownMs: 4 * 3600 * 1000, suppressLowConfidence: true },
  pre_call_nudge:      { maxPerBlock: 1, cooldownMs: 4 * 3600 * 1000, suppressLowConfidence: false },
  post_call_reflection:{ maxPerBlock: 1, cooldownMs: 4 * 3600 * 1000, suppressLowConfidence: false },
  coach_nudge:         { maxPerBlock: 1, cooldownMs: 4 * 3600 * 1000, suppressLowConfidence: true },
  post_action:         { maxPerBlock: 2, cooldownMs: 1 * 3600 * 1000, suppressLowConfidence: false },
  risk_alert:          { maxPerBlock: 2, cooldownMs: 2 * 3600 * 1000, suppressLowConfidence: true },
  playbook_suggestion: { maxPerBlock: 1, cooldownMs: 4 * 3600 * 1000, suppressLowConfidence: true },
};

const INTERVENTION_LOG_KEY = 'system-intervention-log';
const MAX_LOG_SIZE = 200;
const BLOCK_DURATION_MS = 2 * 3600 * 1000; // 2 hours

// ── Core Logic ─────────────────────────────────────────────

export function shouldSuppressIntervention(
  type: InterventionType,
  confidence?: number,
  nowMs: number = Date.now(),
): boolean {
  const rule = SUPPRESSION_RULES[type];
  if (!rule) return false;

  // Suppress low-confidence interventions
  if (rule.suppressLowConfidence && confidence !== undefined && confidence < 40) {
    log.debug(`Suppressing ${type}: low confidence ${confidence}`);
    return true;
  }

  const recent = loadInterventionLog();
  const blockStart = nowMs - BLOCK_DURATION_MS;
  const inBlock = recent.filter(r => r.type === type && r.timestamp > blockStart);

  // Max per block
  if (inBlock.length >= rule.maxPerBlock) {
    log.debug(`Suppressing ${type}: maxPerBlock ${rule.maxPerBlock} reached`);
    return true;
  }

  // Cooldown
  const lastOfType = recent.filter(r => r.type === type).sort((a, b) => b.timestamp - a.timestamp)[0];
  if (lastOfType && nowMs - lastOfType.timestamp < rule.cooldownMs) {
    log.debug(`Suppressing ${type}: cooldown active`);
    return true;
  }

  return false;
}

export function recordIntervention(type: InterventionType, blockId?: string, nowMs: number = Date.now()): void {
  const records = loadInterventionLog();
  records.push({ type, timestamp: nowMs, blockId });
  if (records.length > MAX_LOG_SIZE) records.splice(0, records.length - MAX_LOG_SIZE);
  saveInterventionLog(records);
}

export function getInterventionStats(windowMs: number = 24 * 3600 * 1000): Record<InterventionType, number> {
  const cutoff = Date.now() - windowMs;
  const recent = loadInterventionLog().filter(r => r.timestamp > cutoff);
  const stats: Record<string, number> = {};
  for (const r of recent) {
    stats[r.type] = (stats[r.type] ?? 0) + 1;
  }
  return stats as Record<InterventionType, number>;
}

export function clearInterventionLog(): void {
  try { localStorage.removeItem(INTERVENTION_LOG_KEY); } catch {}
}

// ── Storage ────────────────────────────────────────────────

function loadInterventionLog(): InterventionRecord[] {
  try {
    return JSON.parse(localStorage.getItem(INTERVENTION_LOG_KEY) || '[]');
  } catch { return []; }
}

function saveInterventionLog(records: InterventionRecord[]): void {
  try {
    localStorage.setItem(INTERVENTION_LOG_KEY, JSON.stringify(records));
  } catch {}
}
