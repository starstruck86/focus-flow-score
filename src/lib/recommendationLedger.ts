/**
 * Recommendation + Action Ledger
 *
 * Tracks recommendations → actions → outcomes for system learning.
 * Feature-flagged via ENABLE_VOICE_OS.
 */

const LEDGER_KEY = 'dave-recommendation-ledger';
const MAX_ENTRIES = 300;

export interface LedgerEntry {
  recommendationId: string;
  dealId?: string;
  playbookId?: string;
  reason: string;
  confidence: number;
  shownAt: number;
  acceptedAt?: number;
  dismissedAt?: number;
  usedAt?: number;
  outcome?: 'positive' | 'neutral' | 'negative';
  outcomeTimestamp?: number;
}

export interface LedgerMetrics {
  systemRightRate: number;
  ignoredHighConfidenceRate: number;
  acceptedLowConfidenceRate: number;
  outcomeLift: number;
  totalEntries: number;
}

// ── Core API ───────────────────────────────────────────────

export function logRecommendation(entry: Omit<LedgerEntry, 'recommendationId' | 'shownAt'>): string {
  const id = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const full: LedgerEntry = { ...entry, recommendationId: id, shownAt: Date.now() };
  const ledger = loadLedger();
  ledger.push(full);
  if (ledger.length > MAX_ENTRIES) ledger.splice(0, ledger.length - MAX_ENTRIES);
  saveLedger(ledger);
  return id;
}

export function markAccepted(recommendationId: string): void {
  updateEntry(recommendationId, { acceptedAt: Date.now() });
}

export function markDismissed(recommendationId: string): void {
  updateEntry(recommendationId, { dismissedAt: Date.now() });
}

export function markUsed(recommendationId: string): void {
  updateEntry(recommendationId, { usedAt: Date.now() });
}

export function recordOutcome(recommendationId: string, outcome: 'positive' | 'neutral' | 'negative'): void {
  updateEntry(recommendationId, { outcome, outcomeTimestamp: Date.now() });
}

// ── Metrics ────────────────────────────────────────────────

export function getLedgerMetrics(windowMs: number = 30 * 24 * 3600 * 1000): LedgerMetrics {
  const cutoff = Date.now() - windowMs;
  const entries = loadLedger().filter(e => e.shownAt > cutoff);

  if (entries.length === 0) {
    return { systemRightRate: 0, ignoredHighConfidenceRate: 0, acceptedLowConfidenceRate: 0, outcomeLift: 0, totalEntries: 0 };
  }

  const withOutcome = entries.filter(e => e.outcome);
  const systemRight = withOutcome.filter(e => e.outcome === 'positive').length;
  const systemRightRate = withOutcome.length > 0 ? systemRight / withOutcome.length : 0;

  const highConf = entries.filter(e => e.confidence >= 70);
  const ignoredHigh = highConf.filter(e => e.dismissedAt && !e.acceptedAt).length;
  const ignoredHighConfidenceRate = highConf.length > 0 ? ignoredHigh / highConf.length : 0;

  const lowConf = entries.filter(e => e.confidence < 50);
  const acceptedLow = lowConf.filter(e => e.acceptedAt).length;
  const acceptedLowConfidenceRate = lowConf.length > 0 ? acceptedLow / lowConf.length : 0;

  // Outcome lift: accepted recs with positive outcome vs dismissed recs with positive outcome
  const acceptedPositive = entries.filter(e => e.acceptedAt && e.outcome === 'positive').length;
  const acceptedTotal = entries.filter(e => e.acceptedAt && e.outcome).length;
  const dismissedPositive = entries.filter(e => e.dismissedAt && !e.acceptedAt && e.outcome === 'positive').length;
  const dismissedTotal = entries.filter(e => e.dismissedAt && !e.acceptedAt && e.outcome).length;
  const acceptedRate = acceptedTotal > 0 ? acceptedPositive / acceptedTotal : 0;
  const dismissedRate = dismissedTotal > 0 ? dismissedPositive / dismissedTotal : 0;
  const outcomeLift = acceptedRate - dismissedRate;

  return { systemRightRate, ignoredHighConfidenceRate, acceptedLowConfidenceRate, outcomeLift, totalEntries: entries.length };
}

// ── Storage ────────────────────────────────────────────────

function loadLedger(): LedgerEntry[] {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]'); } catch { return []; }
}

function saveLedger(entries: LedgerEntry[]): void {
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(entries)); } catch {}
}

function updateEntry(id: string, patch: Partial<LedgerEntry>): void {
  const ledger = loadLedger();
  const idx = ledger.findIndex(e => e.recommendationId === id);
  if (idx >= 0) {
    ledger[idx] = { ...ledger[idx], ...patch };
    saveLedger(ledger);
  }
}
