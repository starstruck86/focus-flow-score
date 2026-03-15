// Robust account matching for calendar events
// Replaces fragile titleLower.includes(name) with multi-signal matching

import type { Account } from '@/types';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'call', 'meeting', 'sync', 'review',
  'check', 'intro', 'demo', 'follow', 'weekly', 'monthly', 'quarterly',
  'annual', 'kickoff', 'onboarding', 'training', 'session', 'discussion',
  'update', 'status', 'team', 'group', 'internal', 'external', 'new',
  'prep', 'plan', 'strategy', 'touch', 'base', 'catch',
]);

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function tokenize(s: string): string[] {
  return normalizeForMatch(s)
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

interface MatchResult {
  account: Account;
  score: number;
}

export function matchAccountToEvent(
  eventTitle: string,
  accounts: Account[],
  threshold = 0.6,
): Account | null {
  if (!eventTitle || accounts.length === 0) return null;

  const titleNorm = normalizeForMatch(eventTitle);
  const titleTokens = tokenize(eventTitle);

  const results: MatchResult[] = [];

  for (const account of accounts) {
    let score = 0;
    const nameNorm = normalizeForMatch(account.name);

    // Exact full-name match (strongest signal)
    if (titleNorm.includes(nameNorm) && nameNorm.length > 2) {
      score += 10;
    }

    // Token overlap — how many significant words from the account name appear in the title
    const nameTokens = tokenize(account.name);
    if (nameTokens.length > 0) {
      const matchedTokens = nameTokens.filter(nt =>
        titleTokens.some(tt => tt === nt || (nt.length >= 4 && tt.startsWith(nt)) || (tt.length >= 4 && nt.startsWith(tt)))
      );
      const tokenRatio = matchedTokens.length / nameTokens.length;
      score += tokenRatio * 5;
    }

    // Salesforce ID in title (very strong if present)
    if (account.salesforceId && titleNorm.includes(normalizeForMatch(account.salesforceId))) {
      score += 15;
    }

    // Website domain match (e.g. "acme.com" appears in event title)
    if (account.website) {
      const domain = account.website
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]
        .split('.')[0]; // extract just the company part
      if (domain.length >= 3 && titleNorm.includes(normalizeForMatch(domain))) {
        score += 3;
      }
    }

    if (score >= threshold) {
      results.push({ account, score });
    }
  }

  if (results.length === 0) return null;

  // Return highest scoring match
  results.sort((a, b) => b.score - a.score);
  return results[0].account;
}
