/**
 * Level event store — lightweight in-memory tracking for progression events.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

export interface LevelEvent {
  skill: SkillFocus;
  type: 'tier_up' | 'progress_gain';
  previousTier?: number;
  newTier?: number;
  deltaProgress?: number;
  timestamp: string;
}

const STORAGE_KEY = 'skill_level_events';
const DISMISSED_KEY = 'tier_up_dismissed';

function getEvents(): LevelEvent[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function addLevelEvent(event: LevelEvent): void {
  const events = getEvents();
  events.unshift(event);
  // Keep last 20
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, 20)));
}

export function getRecentLevelEvents(limit = 10): LevelEvent[] {
  return getEvents().slice(0, limit);
}

export function clearLevelEvents(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Tier-up dismissal tracking ──

function getDismissedTierUps(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function isTierUpDismissed(skill: SkillFocus, tier: number): boolean {
  const dismissed = getDismissedTierUps();
  return dismissed[`${skill}_${tier}`] === tier;
}

export function dismissTierUp(skill: SkillFocus, tier: number): void {
  const dismissed = getDismissedTierUps();
  dismissed[`${skill}_${tier}`] = tier;
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
}
