// ════════════════════════════════════════════════════════════════
// Account Brief — TaskHandler (Cycle 1)
// Reuses Discovery Prep's 5-stage waterfall via runTask.ts.
// Consumes inputs.__cards / inputs.__cardsContext injected by
// run-strategy-job (or by the strategy-chat router insertion).
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
  pattern: 0.8,
  exemplar: 0.4,
};

const REQUIRED_HEADERS = HYBRID_GUARD_REGISTRY.account_brief.required_headers;

function readCardsContext(inputs: TaskInputs): string {
  const ctx = (inputs as any).__cardsContext;
  return typeof ctx === "string" && ctx.trim() ? ctx : "(no library cards available — proceed with research + library context)";
}

function readCards(inputs: TaskInputs): LibraryCard[] {
  const cards = (inputs as any).__cards;
  return Array.isArray(cards) ? (cards as LibraryCard[]) : [];
}

export const accountBriefHandler: TaskHandler & { roleWeights: Record<LibraryRole, number> } = {
  taskType: "account_brief",
  roleWeights: ROLE_WEIGHTS,

  buildResearchQueries(inputs) {
    const company = inputs.company_name || "the account";
    const site = inputs.website ? ` Website: ${inputs.website}.` : "";
    return [
      {
        key: "company_overview",
        prompt: `${company} — overview, products/lines, ICP, stated executive priorities, recent strategy.${site} Specific facts with dates and sources.`,
      },
      {
        key: "recent_signals",
        prompt: `${company} — news, funding, leadership changes, product launches, M&A, hiring patterns in the last 90 days. Format dated bullets [YYYY-MM] signal — implication.`,
      },
      {
        key: "tech_stack",
        prompt: `${company} — known technology stack, vendors, integrations (commerce, ESP, CDP, analytics, loyalty, subscription).${site} Cite evidence.`,
      },
    ];
  },

  libraryScopes(inputs) {
    const desiredFocus = (inputs as any).desired_focus as string | undefined;
    const industry = (inputs as any).industry as string | undefined;
    const motion = (inputs as any).motion as string | undefined;
    return [
      "account planning",
      "account brief",
      "stakeholder map",
      "buying committee",
      "executive buyer",
      "executive engagement",
      "penetration",
      "expansion",
      "land",
      "competitive",
      "next step",
      industry || "",
      motion || "",
      desiredFocus || "",
    ].filter((s): s is string => !!s && s.length > 0);
  },

  buildSynthesisPrompt(inputs, research, library) {
    const researchText = Object.entries(research.results)
      .filter(([_, v]) => v.text)
      .map(([k, v]) => `=== ${k.toUpperCase()} ===\n${v.text}\n\nSources: ${v.citations.join(", ") || "inline"}`)
      .join("\n\n---\n\n");
    const cardsContext = readCardsContext(inputs);

    return `You are a senior account strategist synthesizing intelligence for an account brief.

ACCOUNT: ${inputs.company_name || "Unknown"}
OPPORTUNITY: ${inputs.opportunity || "n/a"}
STAGE: ${inputs.stage || "Unknown"}
DESIRED FOCUS: ${(inputs as any).desired_focus || "general"}
PRIOR NOTES: ${inputs.prior_notes || "None"}

--- EXTERNAL RESEARCH ---
${researchText || "No research available."}
--- END RESEARCH ---

${library.contextString ? `--- INTERNAL LIBRARY (KIs + Playbooks) ---
${library.contextString}
--- END LIBRARY ---
` : ""}
--- LIBRARY CARDS (tactical assets — prefer when applicable) ---
${cardsContext}
--- END CARDS ---

Synthesize a structured intelligence object covering: thesis, account snapshot, stakeholders,
whitespace, risks, recommended 30-day moves. Tie every recommended move to a CARD[id] (preferred)
or RESEARCH[key]. No generic SaaS platitudes.

Return JSON with these fields:
{
  "thesis": "<single sharpest sentence>",
  "snapshot": { "overview": "...", "metrics": [{"label":"...","value":"...","source":"..."}], "exec_priorities": ["..."] },
  "stakeholders": [{"name":"...","role":"...","influence":"...","known_position":"..."}],
  "whitespace": ["..."],
  "risks": [{"risk":"...","level":"Low/Med/High","mitigation":"..."}],
  "recommended_moves": [{"action":"...","owner_or_role":"...","why":"...","grounded_by":"CARD[id]|RESEARCH[key]"}],
  "library_grounding": { "card_ids_used": ["..."], "research_keys_used": ["..."] }
}

Return ONLY JSON. No markdown fences.`;
  },

  buildDocumentSystemPrompt() {
    return `You are the document author for the Account Brief format.

OUTPUT MUST be a JSON object of shape:
{
  "sections": [
    { "id": "company_snapshot",   "name": "Company Snapshot",      "content": "..." },
    { "id": "stakeholders",        "name": "Stakeholders On File", "content": "..." },
    { "id": "operator_read",       "name": "Operator Read",        "content": "..." },
    { "id": "next_moves",          "name": "Next Moves",           "content": "..." }
  ],
  "markdown": "## Company Snapshot\\n...\\n\\n## Stakeholders On File\\n...\\n\\n## Operator Read\\n...\\n\\n## Next Moves\\n..."
}

The "markdown" field MUST contain the four required ## headers in the order listed below,
verbatim, with no renaming, merging, or reordering.

${renderRequiredHeadersBlock("account_brief")}

RULES:
- Every recommended move must cite CARD[id] or RESEARCH[key].
- No generic SaaS platitudes. Be specific to THIS account.
- Stakeholders section: name + role + influence + known position. If no stakeholders surfaced,
  state that explicitly and propose how to obtain them.
- Operator Read: 3-6 sentences. The strategic thesis with named risk + named opportunity.
- Next Moves: numbered list of 3-5 concrete actions, each with WHO / WHAT / WHY.
- Do NOT begin the answer with any forbidden opening listed above.

Return ONLY JSON. No markdown fences. No preamble.`;
  },

  buildDocumentUserPrompt(inputs, synthesis, library) {
    const cardsContext = readCardsContext(inputs);
    return `Author the Account Brief now.

ACCOUNT: ${inputs.company_name || "Unknown"}
OPPORTUNITY: ${inputs.opportunity || "n/a"}
STAGE: ${inputs.stage || "Unknown"}

SYNTHESIZED INTELLIGENCE (use as the source of truth; cite CARD[id]/RESEARCH[key] where used):
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
      : "(no cards available — flag as ungrounded if recommended_moves cite no CARD ids)";

    return `Review this Account Brief.

ACCOUNT: ${inputs.company_name || "Unknown"}

DRAFT:
${JSON.stringify(draft, null, 2)}

AVAILABLE LIBRARY CARDS:
${cardListing}

Check for:
1. Thesis specificity (named risk + named opportunity, not generic).
2. Stakeholder coverage (named or explicitly unknown with a plan).
3. Every recommended move cites CARD[id] or RESEARCH[key].
4. No SaaS platitudes; every claim is account-specific.
5. Required headers present and in order: ${REQUIRED_HEADERS.join(" → ")}.

Return JSON:
{
  "strengths": ["..."],
  "redlines": [
    { "id":"r1", "section_id":"company_snapshot|stakeholders|operator_read|next_moves",
      "section_name":"...", "current_text":"...", "proposed_text":"...",
      "rationale":"...", "grounded_by_id":"CARD[id]|null" }
  ],
  "library_coverage": { "used":[{"id":"...","title":"...","sections":["..."]}], "gaps":["..."], "score":0 },
  "rubric_check": {
    "thesis_specificity":"pass|warn|fail",
    "stakeholder_coverage":"pass|warn|fail",
    "moves_grounded":"pass|warn|fail",
    "no_platitudes":"pass|warn|fail",
    "headers_intact":"pass|warn|fail",
    "notes":["..."]
  }
}

Return ONLY JSON. No markdown fences.`;
  },
};
