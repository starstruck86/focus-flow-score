/**
 * Phase 3.7B — Auth Status Diagnostic.
 *
 * Detects preview auth state for operational diagnostics.
 * Pure client-side — no network calls at import time.
 */

import { supabase } from "@/integrations/supabase/client";

export interface AuthStatusResult {
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  sessionExpiry: string | null;
  canInvokeEdgeFunctions: boolean;
  diagnosticMessage: string;
}

/**
 * Check current auth status. Returns diagnostic info about whether
 * the current session can invoke authenticated edge functions.
 */
export async function checkAuthStatus(): Promise<AuthStatusResult> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
      return {
        authenticated: false,
        userId: null,
        email: null,
        sessionExpiry: null,
        canInvokeEdgeFunctions: false,
        diagnosticMessage: error
          ? `Auth error: ${error.message}`
          : "No active session — user is not logged in",
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at ?? 0;
    const isExpired = expiresAt < now;

    return {
      authenticated: !isExpired,
      userId: session.user?.id ?? null,
      email: session.user?.email ?? null,
      sessionExpiry: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
      canInvokeEdgeFunctions: !isExpired,
      diagnosticMessage: isExpired
        ? "Session expired — re-authentication required"
        : "Session active — edge function invocation available",
    };
  } catch (e: unknown) {
    return {
      authenticated: false,
      userId: null,
      email: null,
      sessionExpiry: null,
      canInvokeEdgeFunctions: false,
      diagnosticMessage: `Auth check failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
