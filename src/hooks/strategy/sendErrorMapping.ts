/**
 * Pure helper: translate a raw send/streaming error into user-facing copy.
 *
 * Lives in its own module (no React, no supabase) so unit tests can import
 * it without bootstrapping the entire client. The chat hook re-exports this
 * for backwards compatibility.
 *
 * Guarantee: never returns "Failed to fetch", "Load failed", "TypeError",
 * or other raw fetch/runtime strings.
 */
export function mapSendErrorToFriendlyMessage(e: unknown): string {
  const err = e as { message?: unknown; name?: unknown } | null | undefined;
  const raw = String(err?.message ?? '');
  const name = String(err?.name ?? '');

  const isNetworkError =
    /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(raw)
    || name === 'TypeError';
  if (isNetworkError) {
    return "Connection hiccup — Strategy couldn't reach the AI provider. Check your network and try again.";
  }

  // Provider/server-side failures: our throw site formats these as "Error 5xx"
  // (see resp.ok branch in useStrategyMessages), but also catch raw "5xx"
  // and common HTTP phrases.
  const isProviderError =
    /\berror\s*5\d{2}\b/i.test(raw)
    || /\b5\d{2}\b/.test(raw)
    || /internal server error|bad gateway|service unavailable|gateway timeout/i.test(raw);
  if (isProviderError) {
    return 'The AI provider is having a moment. Please retry — usually clears in a few seconds.';
  }

  if (raw.trim()) return raw;
  return 'Something went wrong sending your message. Please try again.';
}
