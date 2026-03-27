/**
 * Voice Operating Context (Persistent Conversation Memory)
 *
 * Lightweight operating memory for Dave voice sessions.
 * Enables natural follow-ups like "practice it", "use that", "log that".
 *
 * Stored in localStorage with a 30-minute TTL.
 */

const CONTEXT_KEY = 'dave-voice-context';
const TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface VoiceOperatingContext {
  /** Current deal being discussed */
  currentDeal: { id: string; name: string; accountName: string; stage?: string } | null;
  /** Current recommended playbook */
  currentPlaybook: { id: string; title: string } | null;
  /** Current/last task discussed */
  currentTask: { id: string; title: string } | null;
  /** Last roleplay config */
  lastRoleplay: { callType: string; persona?: string; difficulty?: number } | null;
  /** Last unresolved action from Dave */
  pendingAction: { tool: string; description: string; params?: Record<string, any> } | null;
  /** Current account in focus */
  currentAccount: { id: string; name: string } | null;
  /** Last response snippet for "repeat that" */
  lastResponse: string | null;
  /** Chained workflow state */
  chainedWorkflow: { steps: string[]; descriptions?: string[]; currentStep: number } | null;
  /** Timestamp */
  updatedAt: number;
}

function emptyContext(): VoiceOperatingContext {
  return {
    currentDeal: null,
    currentPlaybook: null,
    currentTask: null,
    lastRoleplay: null,
    pendingAction: null,
    currentAccount: null,
    lastResponse: null,
    chainedWorkflow: null,
    updatedAt: Date.now(),
  };
}

export function getVoiceContext(): VoiceOperatingContext {
  try {
    const raw = localStorage.getItem(CONTEXT_KEY);
    if (!raw) return emptyContext();
    const ctx = JSON.parse(raw) as VoiceOperatingContext;
    // TTL check
    if (Date.now() - ctx.updatedAt > TTL_MS) {
      clearVoiceContext();
      return emptyContext();
    }
    return ctx;
  } catch {
    return emptyContext();
  }
}

export function updateVoiceContext(patch: Partial<VoiceOperatingContext>): void {
  const current = getVoiceContext();
  const updated = { ...current, ...patch, updatedAt: Date.now() };
  try {
    localStorage.setItem(CONTEXT_KEY, JSON.stringify(updated));
    // Emit event so UI safety net can react
    window.dispatchEvent(new CustomEvent('dave-context-changed', { detail: updated }));
  } catch {}
}

export function clearVoiceContext(): void {
  try {
    localStorage.removeItem(CONTEXT_KEY);
    window.dispatchEvent(new CustomEvent('dave-context-changed', { detail: emptyContext() }));
  } catch {}
}

// ── Context resolution helpers ─────────────────────────────

/**
 * Resolve pronoun references ("it", "that", "this one") to actual IDs/names.
 * Returns enriched params or null if no context available.
 */
export function resolveContextReference(
  input: string,
  ctx: VoiceOperatingContext,
): Record<string, string> | null {
  const lower = input.toLowerCase();

  // "practice it" / "roleplay that" → last roleplay or current playbook
  if (/\b(practice|roleplay)\s+(it|that|again)\b/i.test(lower)) {
    if (ctx.lastRoleplay) {
      return { call_type: ctx.lastRoleplay.callType, difficulty: String(ctx.lastRoleplay.difficulty ?? 5) };
    }
    if (ctx.currentPlaybook) {
      return { playbookTitle: ctx.currentPlaybook.title };
    }
  }

  // "log that" / "log it" → pending action or current deal
  if (/\b(log)\s+(that|it|this)\b/i.test(lower)) {
    if (ctx.currentDeal) {
      return { accountName: ctx.currentDeal.accountName, dealName: ctx.currentDeal.name };
    }
    if (ctx.currentAccount) {
      return { accountName: ctx.currentAccount.name };
    }
  }

  // "use that" / "use this" → current playbook
  if (/\b(use)\s+(that|this|it)\b/i.test(lower)) {
    if (ctx.currentPlaybook) {
      return { playbookId: ctx.currentPlaybook.id, playbookTitle: ctx.currentPlaybook.title };
    }
  }

  // Generic "this deal" / "this account"
  if (/\bthis\s+(deal|opportunity)\b/i.test(lower) && ctx.currentDeal) {
    return { dealId: ctx.currentDeal.id, dealName: ctx.currentDeal.name };
  }
  if (/\bthis\s+account\b/i.test(lower) && ctx.currentAccount) {
    return { accountId: ctx.currentAccount.id, accountName: ctx.currentAccount.name };
  }

  return null;
}
