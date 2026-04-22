// ════════════════════════════════════════════════════════════════
// Hybrid Guard Schema Registry
// Single source of truth for required `##` headers per hybrid intent.
// Consumed by:
//   - the existing chat-side guard in strategy-chat/index.ts
//     (header lists below mirror evaluateHybridGuard's regexes)
//   - the new TaskHandlers' review prompts (account_brief, ninety_day_plan)
// ════════════════════════════════════════════════════════════════

export type HybridIntent = "account_brief" | "ninety_day_plan";

export interface HybridSchema {
  required_headers: string[];          // human-readable; used in prompts
  required_header_regexes: RegExp[];   // exact regexes used by guards
  forbidden_opening_patterns: RegExp[]; // applied to first ~200 chars
  legacy_bold_label_patterns: RegExp[]; // ≥2 hits = legacy schema fallback
}

export const HYBRID_GUARD_REGISTRY: Record<HybridIntent, HybridSchema> = {
  account_brief: {
    required_headers: [
      "## Company Snapshot",
      "## Stakeholders On File",
      "## Operator Read",
      "## Next Moves",
    ],
    required_header_regexes: [
      /##\s*Company Snapshot/i,
      /##\s*Stakeholders/i,
      /##\s*Operator Read/i,
      /##\s*Next Moves/i,
    ],
    forbidden_opening_patterns: [
      /the dominant move/i,
      /the dominant lever/i,
      /the real lever/i,
      /what actually matters/i,
      /the key motion/i,
    ],
    legacy_bold_label_patterns: [
      /\*\*Most Likely Buying Motion:?\*\*/i,
      /\*\*Stakeholder Map:?\*\*/i,
      /\*\*Top Risks:?\*\*/i,
      /\*\*Learning Priorities:?\*\*/i,
      /\*\*Pipeline Creation Plan:?\*\*/i,
      /\*\*Commercial POV:?\*\*/i,
      /\*\*Buying Motion:?\*\*/i,
      /\*\*Lead Angle:?\*\*/i,
    ],
  },
  ninety_day_plan: {
    required_headers: [
      "## Account Context",
      "## Days 1–30 — Learn",
      "## Days 31–60 — Engage",
      "## Days 61–90 — Advance",
      "## Operator Read",
    ],
    required_header_regexes: [
      /##\s*Account Context/i,
      /##\s*Days\s*1\s*[–\-]\s*30/i,
      /##\s*Days\s*31\s*[–\-]\s*60/i,
      /##\s*Days\s*61\s*[–\-]\s*90/i,
      /##\s*Operator Read/i,
    ],
    forbidden_opening_patterns: [
      /the dominant move/i,
      /the dominant lever/i,
      /the real lever/i,
      /what actually matters/i,
      /the key motion/i,
    ],
    legacy_bold_label_patterns: [
      /\*\*Most Likely Buying Motion:?\*\*/i,
      /\*\*Stakeholder Map:?\*\*/i,
      /\*\*Top Risks:?\*\*/i,
      /\*\*Learning Priorities:?\*\*/i,
      /\*\*Pipeline Creation Plan:?\*\*/i,
      /\*\*Commercial POV:?\*\*/i,
      /\*\*Buying Motion:?\*\*/i,
      /\*\*Lead Angle:?\*\*/i,
    ],
  },
};

/** Evaluate a markdown blob against a registered hybrid intent. */
export function evaluateAgainstRegistry(
  intent: HybridIntent,
  text: string,
): { passed: boolean; failure_reasons: string[] } {
  const schema = HYBRID_GUARD_REGISTRY[intent];
  const reasons: string[] = [];
  const body = text || "";
  const head = body.slice(0, 200).toLowerCase();

  schema.required_header_regexes.forEach((re, i) => {
    if (!re.test(body)) {
      reasons.push(`missing_required_header:${schema.required_headers[i]}`);
    }
  });

  for (const re of schema.forbidden_opening_patterns) {
    if (re.test(head)) reasons.push(`forbidden_opening:${re.source}`);
  }

  const legacyHits = schema.legacy_bold_label_patterns.reduce(
    (n, re) => n + (re.test(body) ? 1 : 0),
    0,
  );
  if (legacyHits >= 2) reasons.push("opened_with_legacy_bold_schema");

  return { passed: reasons.length === 0, failure_reasons: reasons };
}

/** Helper for handler review prompts: render the required header block. */
export function renderRequiredHeadersBlock(intent: HybridIntent): string {
  const schema = HYBRID_GUARD_REGISTRY[intent];
  return [
    "REQUIRED OUTPUT HEADERS (must appear, in this order, with no renaming):",
    ...schema.required_headers.map((h, i) => `  ${i + 1}. ${h}`),
    "",
    "FORBIDDEN OPENINGS (do not start the answer with any of these phrases):",
    ...schema.forbidden_opening_patterns.map((re) => `  - ${re.source}`),
  ].join("\n");
}

/**
 * Parse "CARD[xxxxxxxx]" tokens from a markdown blob.
 * Returns the unique 8-char ids actually cited.
 */
export function parseCardCitations(text: string): string[] {
  if (!text) return [];
  const re = /CARD\[([0-9a-f]{6,12})\]/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(m[1].toLowerCase());
  return Array.from(found);
}
