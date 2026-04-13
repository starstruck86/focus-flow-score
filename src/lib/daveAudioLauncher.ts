/**
 * Dave Audio Launcher — Voice-first entry flow.
 *
 * Handles the initial "What do you want to do?" interaction
 * and routes the user to the right surface hands-free.
 *
 * Tightly scoped to training orchestration — NOT a chatbot.
 */

import {
  parseUserIntent,
  fetchTrainingContext,
  routeByIntent,
  type DaveRecommendation,
  type UserIntent,
} from '@/lib/daveTrainingRouter';
import { loadVoiceSessionBuffer } from '@/lib/daveSessionBuffer';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveAudioLauncher');

// ── Launcher State ─────────────────────────────────────────────────

export type LauncherPhase = 'greeting' | 'listening' | 'routing' | 'launching' | 'idle';

export interface LauncherState {
  phase: LauncherPhase;
  recommendation: DaveRecommendation | null;
  error: string | null;
}

// ── Greeting ───────────────────────────────────────────────────────

export function buildGreeting(hasResumable: boolean): string {
  if (hasResumable) {
    return "Welcome back. You have a session in progress. Say 'resume' or tell me what you want to work on.";
  }
  return "Hey. What do you want to work on? You can say things like 'quick rep', 'teach me discovery', or 'work on my weakest area'.";
}

// ── Launch Flow ────────────────────────────────────────────────────

export async function processLaunchIntent(
  transcript: string,
  userId: string,
): Promise<DaveRecommendation> {
  const intent = parseUserIntent(transcript);
  logger.info('Parsed launch intent', { intent, transcript: transcript.slice(0, 80) });

  const ctx = await fetchTrainingContext(userId);
  return routeByIntent(intent, ctx);
}

// ── Commute Presets ────────────────────────────────────────────────

export interface CommutePreset {
  id: string;
  label: string;
  spokenLabel: string;
  durationMinutes: number;
  surface: 'dojo' | 'learn' | 'skill_builder';
  launchState: Record<string, unknown>;
  description: string;
}

export const COMMUTE_PRESETS: CommutePreset[] = [
  {
    id: 'quick_rep',
    label: 'Quick Rep',
    spokenLabel: 'quick rep',
    durationMinutes: 5,
    surface: 'dojo',
    launchState: { mode: 'quick', reps: 1 },
    description: 'One focused practice rep.',
  },
  {
    id: 'focused_practice',
    label: 'Focused Practice',
    spokenLabel: 'focused practice',
    durationMinutes: 12,
    surface: 'dojo',
    launchState: { mode: 'focused', reps: 3 },
    description: 'Three reps on one skill with coaching between.',
  },
  {
    id: 'drive_session',
    label: 'Drive Session',
    spokenLabel: 'drive session',
    durationMinutes: 25,
    surface: 'skill_builder',
    launchState: { mode: 'drive', blockCount: 5 },
    description: 'Guided Skill Builder blocks with practice reps.',
  },
  {
    id: 'long_skill_builder',
    label: 'Long Skill Builder',
    spokenLabel: 'long session',
    durationMinutes: 45,
    surface: 'skill_builder',
    launchState: { mode: 'full' },
    description: 'Full Skill Builder session with all blocks.',
  },
  {
    id: 'learn_and_practice',
    label: 'Learn + Practice Combo',
    spokenLabel: 'learn and practice',
    durationMinutes: 20,
    surface: 'learn',
    launchState: { mode: 'combo', dojoFollowUp: true },
    description: 'Coaching on a concept then practice reps to apply it.',
  },
];

const PRESET_PATTERNS: [string, RegExp][] = [
  ['quick_rep', /\b(quick\s+rep|fast\s+one|warm\s*up)\b/i],
  ['focused_practice', /\b(focused|10\s+min|fifteen\s+min|three\s+reps)\b/i],
  ['drive_session', /\b(drive\s+session|commute|20\s+min|twenty\s+min|25\s+min)\b/i],
  ['long_skill_builder', /\b(long|full\s+session|45\s+min|30\s+min|skill\s+builder)\b/i],
  ['learn_and_practice', /\b(learn\s+and\s+practice|combo|teach.+then\s+practice)\b/i],
];

export function matchPreset(transcript: string): CommutePreset | null {
  for (const [id, pattern] of PRESET_PATTERNS) {
    if (pattern.test(transcript)) {
      return COMMUTE_PRESETS.find(p => p.id === id) ?? null;
    }
  }
  return null;
}
