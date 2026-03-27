/**
 * Dave Mode Detector
 *
 * Detects the appropriate Dave mode from user input and context,
 * and structures all responses with explainability metadata.
 *
 * Feature-flagged via ENABLE_SYSTEM_OS.
 */

import { createLogger } from './logger';
import { classifyVoiceIntent, type VoiceIntent } from './voiceIntent';

const log = createLogger('DaveModeDetector');

// ── Voice intent → Dave mode mapping ──────────────────────

const VOICE_TO_DAVE: Record<VoiceIntent, DaveMode> = {
  ask: 'EXECUTE',
  explain: 'COACH',
  act: 'EXECUTE',
  diagnose: 'DIAGNOSE',
  recover: 'RECOVERY',
  'confirm-required': 'EXECUTE',
};

export type DaveMode = 'EXECUTE' | 'PREP' | 'COACH' | 'ROLEPLAY' | 'DIAGNOSE' | 'RECOVERY';

export interface DaveModeContext {
  currentRoute?: string;
  dealStage?: string;
  hasActiveCall?: boolean;
  hasRecentError?: boolean;
  systemMode?: string;
  accountName?: string;
  isRoleplayActive?: boolean;
}

export interface DaveResponse {
  mode: DaveMode;
  recommendation: string;
  reasoning: {
    topFactors: string[];
    suppressedAlternatives: string[];
    recentChanges: string[];
    confidenceDrivers: string[];
  };
  confidence: number;
  nextAction: string | null;
  sourcesUsed: string[];
  sourcesIgnored: string[];
}

// ── Mode Detection Patterns ────────────────────────────────

const MODE_PATTERNS: Record<DaveMode, RegExp[]> = {
  EXECUTE: [
    /\b(do|update|create|log|move|set|mark|complete|send|draft|write)\b/i,
    /\bnext\s+(step|action|task)\b/i,
    /\bwhat\s+should\s+i\s+do\b/i,
    /\bprimary\s+action\b/i,
  ],
  PREP: [
    /\b(prep|prepare|research|brief|before\s+my\s+call)\b/i,
    /\bmeeting\s+(prep|brief|research)\b/i,
    /\bwho\s+(is|are)\b.*\b(stakeholder|buyer|champion)\b/i,
    /\bpre-call\b/i,
  ],
  COACH: [
    /\b(coach|improve|feedback|review|score|grade|skill|learn)\b/i,
    /\bwhat\s+(did\s+i|went)\s+(wrong|well)\b/i,
    /\bhow\s+(can|do)\s+i\s+improve\b/i,
    /\bweekly\s+review\b/i,
  ],
  ROLEPLAY: [
    /\b(roleplay|practice|simulate|mock\s+call|role\s+play)\b/i,
    /\blet'?s\s+practice\b/i,
    /\brun\s+a\s+scenario\b/i,
  ],
  DIAGNOSE: [
    /\b(diagnose|debug|why\s+is|what'?s\s+wrong|system\s+health|status)\b/i,
    /\bwhy\s+isn'?t\b/i,
    /\bsystem\s+(check|state|status|confidence)\b/i,
  ],
  RECOVERY: [
    /\b(recovery|recover|fix|reset|fallback|degraded)\b/i,
    /\bsomething\s+(broke|failed|isn'?t\s+working)\b/i,
  ],
};

export function detectDaveMode(input: string, context: DaveModeContext = {}): DaveMode {
  // Context-based overrides
  if (context.isRoleplayActive) return 'ROLEPLAY';
  if (context.systemMode === 'recovery' || context.hasRecentError) return 'RECOVERY';

  // Pattern matching with priority
  const scores: Record<DaveMode, number> = {
    EXECUTE: 0, PREP: 0, COACH: 0, ROLEPLAY: 0, DIAGNOSE: 0, RECOVERY: 0,
  };

  for (const [mode, patterns] of Object.entries(MODE_PATTERNS) as [DaveMode, RegExp[]][]) {
    for (const pattern of patterns) {
      if (pattern.test(input)) scores[mode]++;
    }
  }

  // Route-based boosting
  if (context.currentRoute?.includes('prep')) scores.PREP += 0.5;
  if (context.currentRoute?.includes('coach')) scores.COACH += 0.5;
  if (context.currentRoute?.includes('pipeline') || context.currentRoute?.includes('deal')) scores.EXECUTE += 0.5;

  const topMode = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (topMode[1] > 0) return topMode[0] as DaveMode;

  // Default to EXECUTE
  return 'EXECUTE';
}

// ── Response Builder ───────────────────────────────────────

export function buildDaveResponse(opts: {
  mode: DaveMode;
  recommendation: string;
  topFactors?: string[];
  suppressedAlternatives?: string[];
  recentChanges?: string[];
  confidence?: number;
  nextAction?: string | null;
  sourcesUsed?: string[];
  sourcesIgnored?: string[];
}): DaveResponse {
  const confidence = opts.confidence ?? 70;
  const confidenceDrivers: string[] = [];

  if (confidence >= 80) confidenceDrivers.push('Strong signal coverage');
  else if (confidence >= 55) confidenceDrivers.push('Moderate data confidence');
  else confidenceDrivers.push('Limited data — low confidence');

  if ((opts.topFactors?.length ?? 0) >= 3) confidenceDrivers.push('Multiple supporting factors');
  if ((opts.sourcesUsed?.length ?? 0) > 0) confidenceDrivers.push(`${opts.sourcesUsed!.length} trusted sources used`);

  return {
    mode: opts.mode,
    recommendation: opts.recommendation,
    reasoning: {
      topFactors: opts.topFactors ?? [],
      suppressedAlternatives: opts.suppressedAlternatives ?? [],
      recentChanges: opts.recentChanges ?? [],
      confidenceDrivers,
    },
    confidence,
    nextAction: opts.nextAction ?? null,
    sourcesUsed: opts.sourcesUsed ?? [],
    sourcesIgnored: opts.sourcesIgnored ?? [],
  };
}

// ── Response Formatting ────────────────────────────────────

export function formatDaveResponseForDisplay(response: DaveResponse): string {
  const lines: string[] = [];
  lines.push(response.recommendation);

  if (response.nextAction) {
    lines.push(`\n**Next Action:** ${response.nextAction}`);
  }

  if (response.reasoning.topFactors.length > 0) {
    lines.push(`\n**Why:** ${response.reasoning.topFactors.slice(0, 3).join(' • ')}`);
  }

  if (response.confidence < 55) {
    lines.push(`\n⚠️ Low confidence (${response.confidence}%) — limited data available`);
  }

  return lines.join('\n');
}
