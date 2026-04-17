// ════════════════════════════════════════════════════════════════
// Strategy Core — Critique Primitive
//
// The "VP of Sales" reviewer pass, generalized so any strategic
// artifact (prep doc today, chat answer tomorrow, future tasks) can
// be critiqued against the user's library and the Strategy Core
// thinking discipline.
//
// PR #1 scope: this file exposes the building blocks. Discovery Prep
// continues to assemble its own review prompt by composing these
// fragments — the assembled string remains byte-identical to today's.
// ════════════════════════════════════════════════════════════════

import type { LibraryRetrievalResult } from "../strategy-orchestrator/types.ts";

/**
 * Library grounding header used at the top of every critique prompt.
 * Returns the library context block when present, or the explicit
 * coverage-gap fallback line when absent.
 *
 * Verbatim string fragment from discoveryPrep.buildReviewPrompt so the
 * assembled prompt is unchanged.
 */
export function libraryGroundingHeader(library: LibraryRetrievalResult): string {
  return library.contextString ||
    "(No relevant library entries found — use general discovery, MEDDPICC, value-selling, executive-framing, and competitive positioning best practices, but flag this as a coverage gap.)";
}

/**
 * The reviewer-identity instruction. Surface-agnostic. Each task can
 * prepend a one-line subject (`for ${company}`, `for this answer`, etc.).
 */
export const CRITIQUE_IDENTITY_INSTRUCTION =
  "GROUND YOUR REVIEW IN THE INTERNAL PLAYBOOKS / KIs BELOW. Do NOT use generic best practices when the library covers the topic — cite the playbook/KI title in your rationale.";
