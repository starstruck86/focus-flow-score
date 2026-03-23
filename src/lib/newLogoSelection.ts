/**
 * New Logo Account Selection Engine
 * Automatically picks the top 3 new-logo accounts to target each day
 * using a practical scoring model based on available data.
 */
import type { Account } from '@/types';

export interface SelectedAccount {
  id: string;
  name: string;
  rank: 1 | 2 | 3;
  score: number;
  reason: string;
  suggestedFirstStep: string;
  tier: string;
  industry?: string;
  icpFitScore?: number;
}

export interface DailySelection {
  date: string;
  accounts: SelectedAccount[];
  generatedAt: string;
}

const STORAGE_KEY = 'new-logo-daily-selection';

/** Load cached selection for a given date */
export function loadCachedSelection(date: string): DailySelection | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${date}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailySelection;
    return parsed.date === date ? parsed : null;
  } catch {
    return null;
  }
}

/** Save selection to localStorage */
export function cacheSelection(selection: DailySelection): void {
  localStorage.setItem(`${STORAGE_KEY}-${selection.date}`, JSON.stringify(selection));
}

/** Clear old cached selections (keep last 7 days) */
export function pruneOldSelections(today: string): void {
  const todayDate = new Date(today + 'T12:00:00');
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(STORAGE_KEY)) continue;
    const dateStr = key.replace(`${STORAGE_KEY}-`, '');
    const d = new Date(dateStr + 'T12:00:00');
    if ((todayDate.getTime() - d.getTime()) > 7 * 86400000) {
      localStorage.removeItem(key);
    }
  }
}

/** Get recently selected account IDs (last N days) to reduce repetition */
function getRecentlySelected(today: string, lookbackDays = 3): Set<string> {
  const ids = new Set<string>();
  const todayDate = new Date(today + 'T12:00:00');
  for (let d = 1; d <= lookbackDays; d++) {
    const past = new Date(todayDate);
    past.setDate(past.getDate() - d);
    const pastStr = past.toISOString().split('T')[0];
    const cached = loadCachedSelection(pastStr);
    if (cached) {
      cached.accounts.forEach(a => ids.add(a.id));
    }
  }
  return ids;
}

/**
 * Score an account for new-logo targeting.
 * Higher score = better candidate for today.
 */
function scoreAccount(
  account: Account,
  recentlySelected: Set<string>,
  today: string,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. ICP fit (0-30 points)
  const icpFit = account.icpFitScore ?? account.priorityScore ?? 0;
  const icpPoints = Math.min(30, Math.round(icpFit * 0.3));
  score += icpPoints;
  if (icpFit >= 80) reasons.push('Strong ICP fit');
  else if (icpFit >= 60) reasons.push('Good ICP fit');

  // 2. Tier bonus (0-20 points)
  if (account.tier === 'A') { score += 20; reasons.push('Tier A account'); }
  else if (account.tier === 'B') { score += 12; }
  else { score += 5; }

  // 3. Triggered / high-probability (0-15 points)
  if (account.triggeredAccount || account.highProbabilityBuyer) {
    score += 15;
    reasons.push('Active buying signals detected');
  }
  if (account.triggerEvents?.length) {
    score += Math.min(10, account.triggerEvents.length * 3);
  }

  // 4. Freshness penalty — avoid overworking same accounts (0 to -20)
  if (recentlySelected.has(account.id)) {
    score -= 20;
  }

  // 5. Recency of last touch — prefer accounts not recently touched (0-15)
  if (account.lastTouchDate) {
    const daysSinceTouch = Math.floor(
      (new Date(today + 'T12:00:00').getTime() - new Date(account.lastTouchDate).getTime()) / 86400000
    );
    if (daysSinceTouch > 14) { score += 15; reasons.push('Not touched in 2+ weeks'); }
    else if (daysSinceTouch > 7) { score += 10; reasons.push('Not touched recently'); }
    else if (daysSinceTouch > 3) { score += 5; }
    else { score -= 5; } // Very recently touched, lower priority
  } else {
    score += 12; // Never touched — fresh target
    reasons.push('Never contacted');
  }

  // 6. Account status bonus (0-10)
  if (account.accountStatus === 'researching') { score += 5; }
  if (account.accountStatus === 'prepped') { score += 10; reasons.push('Already prepped'); }

  // 7. Outreach status (0-10)
  if (account.outreachStatus === 'not-started') { score += 10; reasons.push('Outreach not started'); }
  else if (account.outreachStatus === 'in-progress') { score += 5; }

  // 8. Enrichment data available (0-5)
  if (account.enrichmentSourceSummary || account.lastEnrichedAt) { score += 5; }

  // 9. Confidence score (0-10)
  if (account.confidenceScore) {
    score += Math.min(10, Math.round(account.confidenceScore * 0.1));
  }

  return { score, reasons };
}

function suggestFirstStep(account: Account): string {
  if (account.accountStatus === 'prepped' && account.contactStatus === 'ready') {
    return 'Add contacts to cadence and start outreach';
  }
  if (account.accountStatus === 'prepped') {
    return 'Find decision-maker contacts and get their info';
  }
  if (account.accountStatus === 'researching') {
    return 'Complete research — check website, news, and tech stack';
  }
  if (account.lastEnrichedAt) {
    return 'Review enrichment data, then identify key contacts';
  }
  return 'Research company background, industry, and pain points';
}

/**
 * Select the top 3 new-logo accounts for today.
 * Filters to new-logo motion accounts without active opportunities.
 */
export function selectDailyNewLogoTargets(
  accounts: Account[],
  today: string,
  activeOppAccountIds: Set<string> = new Set(),
  count = 3,
): DailySelection {
  // Filter to eligible new-logo accounts
  const eligible = accounts.filter(a => {
    if (activeOppAccountIds.has(a.id)) return false; // Already has an opp
    if (a.motion === 'renewal') return false;
    if (a.accountStatus === 'disqualified') return false;
    if (a.outreachStatus === 'closed-won' || a.outreachStatus === 'closed-lost') return false;
    if (a.outreachStatus === 'opp-open') return false;
    return true;
  });

  const recentlySelected = getRecentlySelected(today);

  // Score and sort
  const scored = eligible.map(a => {
    const { score, reasons } = scoreAccount(a, recentlySelected, today);
    return { account: a, score, reasons };
  }).sort((a, b) => b.score - a.score);

  // Pick top N
  const selected: SelectedAccount[] = scored.slice(0, count).map((s, i) => ({
    id: s.account.id,
    name: s.account.name,
    rank: (i + 1) as 1 | 2 | 3,
    score: s.score,
    reason: s.reasons.length > 0
      ? s.reasons.slice(0, 3).join('. ')
      : `Tier ${s.account.tier} account with available capacity`,
    suggestedFirstStep: suggestFirstStep(s.account),
    tier: s.account.tier,
    industry: s.account.industry,
    icpFitScore: s.account.icpFitScore,
  }));

  const selection: DailySelection = {
    date: today,
    accounts: selected,
    generatedAt: new Date().toISOString(),
  };

  cacheSelection(selection);
  pruneOldSelections(today);

  return selection;
}
