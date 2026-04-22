// ════════════════════════════════════════════════════════════════
// 90-Day Plan — TaskHandler (Cycle 1)
// Reuses Discovery Prep's 5-stage waterfall via runTask.ts.
// Consumes inputs.__cards / inputs.__cardsContext.
// Locked output schema enforced via shared HYBRID_GUARD_REGISTRY.
// ════════════════════════════════════════════════════════════════

import type { TaskHandler, TaskInputs } from "../types.ts";
import {
  HYBRID_GUARD_REGISTRY,
  renderRequiredHeadersBlock,
} from "../hybridGuard.ts";
import type { LibraryCard, LibraryRole } from "../libraryCards.ts";

const ROLE_WEIGHTS: Record<LibraryRole, number> = {
  standard: 1.0,
  tactic: 1.0,
  pattern: 0.6,
  exemplar: 0.6,
};

const REQUIRED_HEADERS = HYBRID_GUARD_REGISTRY.ninety_day_plan.required_headers;

function readCardsContext(inputs: TaskInputs): string {
  const ctx = (inputs as any).__cardsContext;
  return typeof ctx === "string" && ctx.trim() ? ctx : "(no library cards available — proceed with research + library context)";
}

function readCards(inputs: TaskInputs): LibraryCard[] {
  const cards = (inputs as any).__cards;
  return Array.isArray(cards) ? (cards as LibraryCard[]) : [];
}

export const ninetyDayPlanHandler: TaskHandler & { roleWeights: Record<LibraryRole, number> } = {
  taskType: "ninety_day_plan",
  roleWeights: ROLE_WEIGHTS,

  buildResearchQueries(inputs) {
    if (!inputs.company_name) return [];
    const co = inputs.company_name;
    const site = inputs.website ? ` Website: ${inputs.website}.` : "";
    return [
      { key: "company_overview", prompt: `${co} — overview, ICP, stated strategy, exec priorities.${site}` },
      { key: "recent_signals",   prompt: `${co} — dated signals last 90 days (leadership, funding, launches, M&A).` },
      { key: "tech_stack",       prompt: `${co} — known technology stack, vendors.${site}` },
    ];
  },

  libraryScopes(inputs) {
    const objective = (inputs as any).objective as string | undefined;
    return [
      "90 day plan",
      "ninety day plan",
      "territory plan",
      "milestone planning",
      "stakeholder strategy",
      "ramp",
      "land",
      "expand",
      "renew",
      "recover",
      objective || "",
    ].filter((s): s is string => !!s && s.length > 0);
  },

  buildSynthesisPrompt(inputs, research, library) {
    const researchText = Object.entries(research.results)
      .filter(([_, v]) => v.text)
      .map(([k, v]) => `=== ${k.toUpperCase()} ===\n${v.text}`)
      .join("\n\n---\n\n");
    const cardsContext = readCardsContext(inputs);

    return `You are a senior sales strategist building a 90-day plan synthesis.

ACCOUNT: ${inputs.company_name || "n/a"}
OBJECTIVE: ${(inputs as any).objective || "Unspecified"}
STARTING POSITION: ${(inputs as any).starting_position || "Unknown"}
DESIRED OUTCOME: ${(inputs as any).desired_outcome || "Unspecified"}

--- EXTERNAL RESEARCH ---
${researchText || "No external research available."}
--- END RESEARCH ---

${library.contextString ? `--- INTERNAL LIBRARY ---
${library.contextString}
--- END LIBRARY ---
` : ""}
--- LIBRARY CARDS ---
${cardsContext}
--- END CARDS ---

Return JSON:
{
  "objective_definition": "<one sentence>",
  "current_state": { "strengths": ["..."], "gaps": ["..."], "unknowns": ["..."] },
  "pillars": ["<3 strategic pillars>"],
  "phase_1_30": [{"action":"...","owner_or_cadence":"...","metric":"...","grounded_by":"CARD[id]|RESEARCH[key]|null"}],
  "phase_31_60": [...],
  "phase_61_90": [...],
  "risks": [{"risk":"...","mitigation":"..."}],
  "weekly_cadence": ["..."],
  "library_grounding": { "card_ids_used": ["..."], "research_keys_used": ["..."] }
}

Each phase must contain 3-5 concrete actions. Every action must have an owner-or-cadence
and a measurable metric. Return ONLY JSON. No markdown fences.`;
  },

  buildDocumentSystemPrompt() {
    return `You are the document author for the 90-Day Plan format.

OUTPUT MUST be a JSON object of shape:
{
  "sections": [
    { "id": "account_context", "name": "Account Context",            "content": "..." },
    { "id": "days_1_30",       "name": "Days 1–30 — Learn",          "content": "..." },
    { "id": "days_31_60",      "name": "Days 31–60 — Engage",        "content": "..." },
    { "id": "days_61_90",      "name": "Days 61–90 — Advance",       "content": "..." },
    { "id": "operator_read",   "name": "Operator Read",              "content": "..." }
  ],
  "markdown": "## Account Context\\n...\\n\\n## Days 1–30 — Learn\\n...\\n\\n## Days 31–60 — Engage\\n...\\n\\n## Days 61–90 — Advance\\n...\\n\\n## Operator Read\\n..."
}

The "markdown" field MUST contain the five required ## headers in the order listed below,
verbatim, with no renaming, merging, or reordering. Use the en-dash "–" between day numbers
(NOT a hyphen) to match the schema exactly.

${renderRequiredHeadersBlock("ninety_day_plan")}

RULES:
- Each phase: numbered list of 3-5 actions; every action carries WHO (owner or cadence),
  WHAT (verb + artifact), WHY (measurable signal).
- Cite CARD[id] or RESEARCH[key] where a tactic is grounded in the library or research.
- Operator Read: 3-6 sentences with named risk + named lever.
- No platitudes; specific to THIS objective and account.
- Do NOT begin the answer with any forbidden opening listed above.

Return ONLY JSON. No markdown fences. No preamble.`;
  },

  buildDocumentUserPrompt(inputs, synthesis, library) {
    const cardsContext = readCardsContext(inputs);
    return `Author the 90-Day Plan now.

ACCOUNT: ${inputs.company_name || "n/a"}
OBJECTIVE: ${(inputs as any).objective || "Unspecified"}

SYNTHESIZED INTELLIGENCE:
${JSON.stringify(synthesis, null, 2)}

${library.contextString ? `INTERNAL LIBRARY:
${library.contextString}
` : ""}
LIBRARY CARDS:
${cardsContext}

Required headers (must appear, exactly, in order):
${REQUIRED_HEADERS.map((h, i) => `  ${i + 1}. ${h}`).join("\n")}

Return ONLY JSON conforming to the locked sections shape.`;
  },

  buildReviewPrompt(inputs, draft, _library) {
    const cards = readCards(inputs);
    const cardListing = cards.length
      ? cards.map((c) => `CARD[${c.id.slice(0, 8)}] ${c.library_role} — "${c.title}"`).join("\n")
      : "(no cards available — flag if no actions cite CARD ids)";

    return `Review this 90-Day Plan.

ACCOUNT: ${inputs.company_name || "n/a"}
OBJECTIVE: ${(inputs as any).objective || "Unspecified"}

DRAFT:
${JSON.stringify(draft, null, 2)}

AVAILABLE LIBRARY CARDS:
${cardListing}

Check for:
1. Each phase has 3-5 concrete actions with owner-or-cadence + measurable metric.
2. Tactics from library cards are cited where applicable.
3. Operator Read names a real risk and a real lever.
4. No platitudes; specific to objective + account.
5. Required headers present and in order: ${REQUIRED_HEADERS.join(" → ")}.

Return JSON:
{
  "strengths": ["..."],
  "redlines": [
    { "id":"r1", "section_id":"account_context|days_1_30|days_31_60|days_61_90|operator_read",
      "section_name":"...", "current_text":"...", "proposed_text":"...",
      "rationale":"...", "grounded_by_id":"CARD[id]|null" }
  ],
  "library_coverage": { "used":[{"id":"...","title":"...","sections":["..."]}], "gaps":["..."], "score":0 },
  "rubric_check": {
    "actions_concrete":"pass|warn|fail",
    "metrics_measurable":"pass|warn|fail",
    "moves_grounded":"pass|warn|fail",
    "no_platitudes":"pass|warn|fail",
    "headers_intact":"pass|warn|fail",
    "notes":["..."]
  }
}

Return ONLY JSON. No markdown fences.`;
  },
};
