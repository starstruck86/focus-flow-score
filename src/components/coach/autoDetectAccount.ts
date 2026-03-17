// Auto-detect account from transcript content/participants
import type { Account } from '@/types';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'call', 'meeting', 'sync', 'review',
  'check', 'intro', 'demo', 'follow', 'weekly', 'monthly', 'quarterly',
  'hello', 'thank', 'thanks', 'sure', 'yeah', 'yes', 'great', 'good',
  'hi', 'hey', 'okay', 'right', 'well', 'like', 'just', 'know',
  'think', 'want', 'need', 'going', 'really', 'today', 'time',
]);

export function detectAccountFromTranscript(
  content: string,
  participants: string,
  accounts: Account[],
): { accountId: string; accountName: string; confidence: number } | null {
  if (!content && !participants) return null;
  if (accounts.length === 0) return null;

  const searchText = `${participants} ${content.substring(0, 3000)}`.toLowerCase();

  const results: { account: Account; score: number }[] = [];

  for (const account of accounts) {
    let score = 0;
    const nameLower = account.name.toLowerCase().trim();

    // Short names (2-3 chars) need stronger contextual signals
    const isShort = nameLower.length <= 3;

    // Exact name match in first 3000 chars
    if (searchText.includes(nameLower)) {
      score += isShort ? 4 : 10; // Short names get less credit for raw match
      // Bonus if in participants specifically (strong signal even for short names)
      if (participants.toLowerCase().includes(nameLower)) {
        score += isShort ? 8 : 5; // Participant mention is very strong for short names
      }
    }

    // Website domain match
    if (account.website) {
      const domain = account.website
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]
        .split('.')[0]
        .toLowerCase();
      if (domain.length >= 3 && searchText.includes(domain)) {
        score += 3;
      }
    }

    // Token-based matching for multi-word names
    const nameTokens = nameLower.split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t));
    if (nameTokens.length > 1) {
      const matched = nameTokens.filter(t => searchText.includes(t));
      if (matched.length === nameTokens.length) {
        score += 7;
      } else if (matched.length > 0) {
        score += matched.length * 2;
      }
    }

    if (score > 0) {
      results.push({ account, score });
    }
  }

  if (results.length === 0) return null;

  results.sort((a, b) => b.score - a.score);
  const best = results[0];

  // Require minimum confidence
  if (best.score < 5) return null;

  const confidence = Math.min(100, best.score * 8);
  return {
    accountId: best.account.id,
    accountName: best.account.name,
    confidence,
  };
}
