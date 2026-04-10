/**
 * Multi-Tab Ownership Guard for Sales Dojo
 *
 * Prevents two browser tabs from fighting over the same Dojo audio session.
 * Uses localStorage with heartbeat timestamps to determine ownership.
 *
 * Rules:
 * - Only one tab may actively deliver audio for a session at a time
 * - Ownership is claimed on session start and heartbeated every 3s
 * - A stale owner (no heartbeat for >10s) can be taken over
 * - Tabs that fail to claim ownership degrade to text or refuse to start
 */

const OWNERSHIP_PREFIX = 'dojo_owner_';
const HEARTBEAT_INTERVAL_MS = 3_000;
const STALE_THRESHOLD_MS = 10_000;

// Tab-unique ID (survives within the tab's lifetime, not across refreshes)
const TAB_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export { TAB_ID };

// ── Ownership record ─────────────────────────────────────────────

interface OwnershipRecord {
  tabId: string;
  claimedAt: string;
  lastHeartbeat: string;
}

function storageKey(sessionId: string): string {
  return `${OWNERSHIP_PREFIX}${sessionId}`;
}

// ── Read ─────────────────────────────────────────────────────────

function readOwnership(sessionId: string): OwnershipRecord | null {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as OwnershipRecord;
  } catch {
    return null;
  }
}

// ── Write ────────────────────────────────────────────────────────

function writeOwnership(sessionId: string, record: OwnershipRecord): void {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(record));
  } catch { /* localStorage full — proceed without ownership guard */ }
}

// ── Claim ────────────────────────────────────────────────────────

export type ClaimResult =
  | { ok: true; reason: 'claimed' | 'takeover_stale' }
  | { ok: false; reason: 'owned_by_other_tab'; ownerTabId: string };

/**
 * Attempt to claim ownership of a session for this tab.
 * Succeeds if:
 * - No current owner exists
 * - Current owner is this tab (re-claim)
 * - Current owner is stale (heartbeat older than STALE_THRESHOLD_MS)
 */
export function claimSession(sessionId: string): ClaimResult {
  const existing = readOwnership(sessionId);

  if (!existing || existing.tabId === TAB_ID) {
    writeOwnership(sessionId, {
      tabId: TAB_ID,
      claimedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    });
    return { ok: true, reason: 'claimed' };
  }

  // Check staleness
  const lastBeat = new Date(existing.lastHeartbeat).getTime();
  const isStale = Date.now() - lastBeat > STALE_THRESHOLD_MS;

  if (isStale) {
    writeOwnership(sessionId, {
      tabId: TAB_ID,
      claimedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    });
    return { ok: true, reason: 'takeover_stale' };
  }

  return { ok: false, reason: 'owned_by_other_tab', ownerTabId: existing.tabId };
}

// ── Heartbeat ────────────────────────────────────────────────────

/** Update heartbeat timestamp. Returns false if ownership was lost. */
export function heartbeatOwnership(sessionId: string): boolean {
  const existing = readOwnership(sessionId);
  if (!existing || existing.tabId !== TAB_ID) return false;

  writeOwnership(sessionId, {
    ...existing,
    lastHeartbeat: new Date().toISOString(),
  });
  return true;
}

/** Start a heartbeat interval. Returns cleanup function. */
export function startOwnershipHeartbeat(sessionId: string): () => void {
  const interval = setInterval(() => {
    const still = heartbeatOwnership(sessionId);
    if (!still) clearInterval(interval);
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(interval);
}

// ── Release ──────────────────────────────────────────────────────

/** Release ownership (call on unmount/destroy). */
export function releaseOwnership(sessionId: string): void {
  const existing = readOwnership(sessionId);
  if (existing?.tabId === TAB_ID) {
    try {
      localStorage.removeItem(storageKey(sessionId));
    } catch { /* noop */ }
  }
}

// ── Query ────────────────────────────────────────────────────────

export function isCurrentTabOwner(sessionId: string): boolean {
  const existing = readOwnership(sessionId);
  return existing?.tabId === TAB_ID;
}

export function getOwnerInfo(sessionId: string): {
  hasOwner: boolean;
  isThisTab: boolean;
  isStale: boolean;
  ownerTabId: string | null;
  lastHeartbeatAge: number | null;
} {
  const existing = readOwnership(sessionId);
  if (!existing) {
    return { hasOwner: false, isThisTab: false, isStale: false, ownerTabId: null, lastHeartbeatAge: null };
  }
  const age = Date.now() - new Date(existing.lastHeartbeat).getTime();
  return {
    hasOwner: true,
    isThisTab: existing.tabId === TAB_ID,
    isStale: age > STALE_THRESHOLD_MS,
    ownerTabId: existing.tabId,
    lastHeartbeatAge: age,
  };
}
