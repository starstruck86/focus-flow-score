// ════════════════════════════════════════════════════════════════
// Strategy V2 — Wrong-Question Guard
//
// The ONLY hard pre-send check in V2. Catches the failure mode
// from the screenshots: model answering a different question than
// the user asked.
//
// Approach: lightweight lexical + semantic overlap between the
// user's prompt and the response opener. No embedding API call —
// pure deterministic token overlap, which is fast, cheap, and
// catches the cross-contamination cases we saw in production.
//
// Returns { passed, score, reason }. Caller decides whether to
// regen (one-shot budget, never loop). Persisted as evidence.
// ════════════════════════════════════════════════════════════════

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were",
  "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "must", "can",
  "this", "that", "these", "those", "i", "you", "he", "she", "it",
  "we", "they", "what", "which", "who", "when", "where", "why", "how",
  "to", "of", "in", "on", "at", "by", "for", "with", "about", "from",
  "as", "into", "through", "during", "me", "my", "your", "our", "their",
  "tell", "give", "show", "make", "build", "write", "draft", "create",
  "get", "want", "need", "like", "please", "thanks",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

export interface WrongQuestionResult {
  passed: boolean;
  score: number; // 0-1, higher = more aligned
  reason: string;
}

export function checkWrongQuestion(args: {
  userPrompt: string;
  responseBody: string;
  /** Optional: prior turn user prompt — if response matches THIS more than current, hard fail. */
  priorTurnPrompt?: string;
}): WrongQuestionResult {
  const userTokens = tokenize(args.userPrompt);
  // Score against the FULL response, not just opener — avoids false negatives
  // when the model leads with a citation and the substance follows.
  const respTokens = tokenize(args.responseBody.slice(0, 1500));

  if (userTokens.size < 2) {
    // Too short to score reliably — pass through
    return { passed: true, score: 1, reason: "user_prompt_too_short" };
  }

  // What % of user content tokens appear in response?
  let coverage = 0;
  for (const t of userTokens) if (respTokens.has(t)) coverage++;
  const coverageRatio = coverage / userTokens.size;

  const overlap = jaccard(userTokens, respTokens);

  // Check against prior turn — if response aligns more with prior than current, FAIL
  if (args.priorTurnPrompt) {
    const priorTokens = tokenize(args.priorTurnPrompt);
    if (priorTokens.size >= 2) {
      const priorOverlap = jaccard(priorTokens, respTokens);
      if (priorOverlap > overlap + 0.15 && coverageRatio < 0.25) {
        return {
          passed: false,
          score: overlap,
          reason: `cross_turn_contamination: prior=${priorOverlap.toFixed(2)} vs current=${overlap.toFixed(2)}`,
        };
      }
    }
  }

  // Hard fail thresholds — tuned to be conservative (false negatives OK,
  // false positives = bad UX)
  if (coverageRatio < 0.15 && overlap < 0.05) {
    return {
      passed: false,
      score: overlap,
      reason: `low_alignment: coverage=${coverageRatio.toFixed(2)} jaccard=${overlap.toFixed(2)}`,
    };
  }

  return {
    passed: true,
    score: overlap,
    reason: `aligned: coverage=${coverageRatio.toFixed(2)} jaccard=${overlap.toFixed(2)}`,
  };
}
