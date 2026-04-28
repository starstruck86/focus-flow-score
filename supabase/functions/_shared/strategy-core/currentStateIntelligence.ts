/**
 * Current State Intelligence Layer
 * ════════════════════════════════════════════════════════════════════
 * Establishes a working *current-state thesis* about an account before
 * Strategy generates advice. Triggered when a user mentions a company
 * but the thread isn't linked to an account.
 *
 * Pipeline:
 *   1. Detect company/account mentions in user text.
 *   2. Resolve to an existing account row (exact, ilike, alias) → if
 *      found, attach as if linked_account_id existed.
 *   3. Otherwise, build an `inferred_current_state` skeleton labeled
 *      low-confidence; the prompt makes the model speak in
 *      "Likely:" / "Assumption:" voice and surface unknowns as
 *      discovery questions.
 *   4. Render a compact CURRENT STATE INTELLIGENCE block injected
 *      into the system prompt. Full payload is returned for logs.
 *
 * Out of scope:
 *   - Discovery Prep, Account Brief, run-strategy-task pipelines.
 *     Trigger gating (`shouldRunCurrentStatePreflight`) excludes them.
 *   - The generation contract / renderer / mode-lock are untouched.
 *
 * Trust rules:
 *   - Inferred claims MUST be labeled. We never tell the model an
 *     inferred fact is sourced.
 *   - When no web research adapter is wired, we emit a `web: false`
 *     signal so the prompt knows to stay in "Likely:" voice.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type AccountContextState = "attached" | "inferred" | "missing";
export type EntitySource =
  | "linked_account"
  | "text_match"
  | "inferred";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface DetectedEntity {
  name: string;
  source: EntitySource;
  matchedAccountId?: string | null;
}

export interface CurrentStateIntelligence {
  company: {
    name: string;
    website?: string;
    confidence: ConfidenceLevel;
    source:
      | "linked_account"
      | "account_match"
      | "text_inferred"
      | "web_researched";
  };
  business_model: {
    summary: string;
    revenue_model?: string;
    channels?: string[];
    customer_segments?: string[];
    product_or_service_lines?: string[];
    seasonality?: string;
    confidence: ConfidenceLevel;
    unknowns: string[];
  };
  customer_experience: {
    what_it_is_like_to_be_a_customer: string;
    acquisition_entry_points?: string[];
    browse_or_research_experience?: string;
    purchase_or_conversion_experience?: string;
    post_purchase_experience?: string;
    loyalty_or_membership_experience?: string;
    subscription_or_replenishment_model?: string;
    mobile_app_or_logged_in_experience?: string;
    confidence: ConfidenceLevel;
    unknowns: string[];
  };
  marketing_motion: {
    likely_new_customer_motion?: string;
    likely_repeat_customer_motion?: string;
    likely_churn_or_lapsed_customer_motion?: string;
    promotional_strategy?: string;
    lifecycle_triggers?: string[];
    channels_likely_used?: string[];
    personalization_maturity?: string;
    confidence: ConfidenceLevel;
    unknowns: string[];
  };
  strategic_priorities: {
    stated_priorities?: string[];
    inferred_priorities?: string[];
    investment_signals?: string[];
    new_products_or_initiatives?: string[];
    leadership_or_org_changes?: string[];
    confidence: ConfidenceLevel;
    unknowns: string[];
  };
  lifecycle_opportunity_map: {
    acquisition?: string[];
    activation?: string[];
    repeat_purchase?: string[];
    cross_sell?: string[];
    loyalty?: string[];
    winback?: string[];
    churn_prevention?: string[];
    customer_data?: string[];
  };
  current_state_thesis: {
    summary: string;
    likely_gap: string;
    why_now: string;
    strategic_tension: string;
    future_state_hypothesis: string;
  };
  discovery_questions: {
    must_confirm: string[];
    high_leverage: string[];
    trap_questions?: string[];
  };
  evidence: {
    sourced_facts: Array<{
      claim: string;
      source_title?: string;
      source_url?: string;
      confidence: ConfidenceLevel;
    }>;
    inferred_claims: Array<{
      claim: string;
      basis: string;
      confidence: "medium" | "low";
    }>;
  };
  /**
   * Top 2–3 ranked signals that should drive the response. Generated
   * after hypotheses by `generatePrioritizedSignals`. Empty when the
   * second pass fails — never fabricated.
   */
  prioritized_signals: PrioritizedSignal[];
}

export type SignalType =
  | "tension"
  | "revenue_or_growth"
  | "change_in_motion"
  | "blind_spot"
  | "external_event"
  | "competitive_pressure"
  | "leadership_or_org"
  | "product_or_launch";

export interface PrioritizedSignal {
  rank: 1 | 2 | 3;
  signal: string;             // The signal itself, named concretely
  signal_type: SignalType;
  why_it_matters: string;     // What makes this matter for a first conversation
  business_impact: string;    // Revenue / growth / risk implication
  conversation_angle: string; // What Corey can actually say to open or drive on this
}

export interface CurrentStateResult {
  ran: boolean;
  /** Why we didn't run, or "ok" when we did. */
  reason: string;
  entity: DetectedEntity | null;
  accountContextState: AccountContextState;
  /** Resolved/attached account, when source=text_match. */
  resolvedAccount?: {
    id: string;
    name: string;
    website: string | null;
    industry: string | null;
    tier: string | null;
    notes: string | null;
    outreach_status: string | null;
  } | null;
  intelligence: CurrentStateIntelligence | null;
  /** Compact prompt block; empty string when nothing to inject. */
  promptBlock: string;
  /** Structured log payload for observability. */
  log: Record<string, unknown>;
}

export interface RunPreflightArgs {
  supabase: any;
  userId: string;
  userContent: string;
  workspaceKeyRaw: string | null | undefined;
  /** True when the thread is already linked to an account row. */
  threadHasLinkedAccount: boolean;
  /** Set when the call originates from a task pipeline (Discovery Prep / Brief). */
  isTaskPipeline?: boolean;
  /** Optional intent string from the router (e.g. "synthesis"). */
  intentTag?: string | null;
  /** Web research adapter, if available in this environment. */
  webCapabilityAvailable?: boolean;
}

// ─── Trigger gating ─────────────────────────────────────────────────

const PREFLIGHT_WORKSPACES = new Set([
  "brainstorm",
  "deep_research",
  "deepresearch",
  "research",
  "work",
  "artifacts",
  "library",
  "refine",
]);

function normalizeWorkspaceKey(raw: string | null | undefined): string {
  return (raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Decide whether to run the current-state preflight. Returns a reason
 * string when skipped so we can log/diagnose without firing the layer.
 */
export function shouldRunCurrentStatePreflight(
  args: Pick<
    RunPreflightArgs,
    "workspaceKeyRaw" | "threadHasLinkedAccount" | "isTaskPipeline"
  >,
): { ok: boolean; reason: string; workspaceKey: string } {
  const workspaceKey = normalizeWorkspaceKey(args.workspaceKeyRaw);
  if (args.isTaskPipeline) {
    return { ok: false, reason: "task_pipeline_excluded", workspaceKey };
  }
  if (args.threadHasLinkedAccount) {
    return { ok: false, reason: "thread_already_linked", workspaceKey };
  }
  if (!PREFLIGHT_WORKSPACES.has(workspaceKey)) {
    return { ok: false, reason: "workspace_out_of_scope", workspaceKey };
  }
  return { ok: true, reason: "ok", workspaceKey };
}

// ─── Entity detection ───────────────────────────────────────────────

const ENTITY_STOPWORDS = new Set([
  "I", "We", "Our", "The", "A", "An", "And", "But", "Or", "So", "If", "When",
  "How", "What", "Why", "Who", "Where", "Which", "This", "That", "These",
  "Those", "It", "Its", "They", "Them", "There", "Here", "Today", "Tomorrow",
  "Yesterday", "Now", "Then", "Strategy", "Brainstorm", "Research", "Refine",
  "Work", "Artifact", "Artifacts", "Library", "Lifecycle", "Marketing",
  "Customer", "Engagement", "Acoustic", "Corey", "Dave", "Email", "Brief",
  "Plan", "Account", "Opportunity", "Conversation", "Approach", "Give",
  "Make", "Build", "Need", "Want", "Like", "Help", "Find", "Show",
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
]);

/**
 * Pull candidate company names from free text. Heuristic: capitalized
 * words / short uppercase tokens (TJX, IBM) that aren't obvious
 * sentence-starters or stopwords. Quoted and possessive forms are
 * recognized too.
 *
 * Returns ordered, de-duped candidates (longest first) capped at 5.
 */
export function detectCompanyMentions(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const cleaned = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

  const candidates = new Set<string>();

  // Quoted: "TJX", 'ButcherBox'
  for (const m of cleaned.matchAll(/["']([A-Z][A-Za-z0-9&.\- ]{1,40})["']/g)) {
    candidates.add(m[1].trim());
  }

  // Multi-word capitalized sequences: "Boston Museum of Science",
  // "elf Cosmetics" (allow lowercase first token for stylized brands).
  for (
    const m of cleaned.matchAll(
      /\b([A-Za-z][a-z0-9]+(?:\s+(?:of|the|de|la|and|&)\s+[A-Z][a-z0-9]+|\s+[A-Z][A-Za-z0-9&.\-]+){1,4})\b/g,
    )
  ) {
    const phrase = m[1].trim();
    if (/^[A-Z]/.test(phrase) || /^[a-z]+\s+[A-Z]/.test(phrase)) {
      candidates.add(phrase);
    }
  }

  // Single capitalized tokens: TJX, ButcherBox, Acoustic
  for (const m of cleaned.matchAll(/\b([A-Z][A-Za-z0-9&.\-]{1,30})\b/g)) {
    const tok = m[1].trim();
    // Drop very short ALL-CAPS that are likely acronyms for non-companies
    if (tok.length < 2) continue;
    if (ENTITY_STOPWORDS.has(tok)) continue;
    candidates.add(tok);
  }

  // Possessive form: "TJX's lifecycle" → strip 's
  const stripped = new Set<string>();
  for (const c of candidates) {
    stripped.add(c.replace(/'s$/i, "").trim());
  }

  // Filter stopwords + sentence-initial junk
  const filtered = [...stripped]
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 60)
    .filter((s) => !ENTITY_STOPWORDS.has(s))
    .filter((s) => !/^[A-Z][a-z]+$/.test(s) || s.length >= 4); // drop "Give", "Help" etc

  // Longest first — multi-word matches beat single tokens
  filtered.sort((a, b) => b.length - a.length);
  return filtered.slice(0, 5);
}

// ─── Account resolution ────────────────────────────────────────────

/**
 * Attempt to resolve a candidate name to an existing account row for
 * this user. Tries exact (ilike) then loose contains. Returns the
 * first match. Soft-deleted rows are excluded via active_accounts view.
 */
async function resolveCandidateToAccount(
  supabase: any,
  userId: string,
  candidate: string,
): Promise<
  | {
    id: string;
    name: string;
    website: string | null;
    industry: string | null;
    tier: string | null;
    notes: string | null;
    outreach_status: string | null;
  }
  | null
> {
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  const select =
    "id, name, website, industry, tier, notes, outreach_status";

  // Exact (case-insensitive) first.
  const { data: exact } = await supabase
    .from("active_accounts")
    .select(select)
    .eq("user_id", userId)
    .ilike("name", trimmed)
    .limit(1);
  if (Array.isArray(exact) && exact[0]) return exact[0] as any;

  // Loose contains, but only if candidate is reasonably specific.
  if (trimmed.length >= 3) {
    const escaped = trimmed.replace(/[%_]/g, "\\$&");
    const { data: loose } = await supabase
      .from("active_accounts")
      .select(select)
      .eq("user_id", userId)
      .ilike("name", `%${escaped}%`)
      .limit(1);
    if (Array.isArray(loose) && loose[0]) return loose[0] as any;
  }

  return null;
}

// ─── Inferred current-state builder ────────────────────────────────

/**
 * Build a low-confidence current-state skeleton. We DO NOT fabricate
 * facts — every field is a structured prompt for the model to fill
 * in "Likely:" voice during generation. The promptBlock then asks
 * the model to reason from this scaffold.
 *
 * If a real account row was found, we seed sourced facts from it
 * (name, website, industry, notes) and lift the company-confidence
 * to medium/high.
 */
// ─── Real hypothesis generator (LLM-backed) ────────────────────────

interface GeneratedHypotheses {
  business_model_summary: string;
  customer_experience: string;
  marketing_motion: string;
  strategic_tension: string;
  future_state_hypothesis: string;
  likely_gap: string;
  why_now: string;
  thesis_summary: string;
}

const HYPOTHESIS_SCHEMA_HINT = `Return ONLY a JSON object with EXACTLY these string keys:
{
  "business_model_summary": "1-2 sentences. Concrete, specific to this company. Use phrasing like 'X likely operates...' or 'In a Y model like X's...'. NEVER write '[Likely]' or scaffolding tokens — write real prose.",
  "customer_experience": "1-2 sentences describing what it's actually like to be a customer of this company end-to-end. Be specific: discovery vs efficiency, anonymous vs logged-in, planned vs unplanned, etc.",
  "marketing_motion": "1-2 sentences on how this company likely runs (or under-runs) lifecycle/CRM/engagement marketing today, given the business model. Name the likely shape and where it's misaligned.",
  "strategic_tension": "1 sentence naming a non-obvious tension Corey can put on the table — the kind a smart prospect will recognize ('most lifecycle strategies optimize for X, but Y's model benefits from Z').",
  "future_state_hypothesis": "1-2 sentences on what they're trying to become and what has to change in customer engagement to get there.",
  "likely_gap": "1 sentence: the most plausible gap between current and future state.",
  "why_now": "1 sentence: the market / competitive / internal pressure that makes this conversation timely.",
  "thesis_summary": "1 crisp sentence summarizing the working thesis about where the company is today."
}

Hard rules:
- Write real, concrete hypotheses. No placeholder text. No "[Likely]", "[Assume]", "describe…", "fill in…".
- It's OK — and required — to be hypothetical. Use "likely", "in a [model] like X's", "a reasonable assumption is".
- Do NOT cite. Do NOT pretend these are facts.
- Do NOT include any text outside the JSON object.`;

async function generateRealHypotheses(args: {
  entityName: string;
  resolvedAccount: CurrentStateResult["resolvedAccount"];
  userContent: string;
}): Promise<GeneratedHypotheses | null> {
  const key = (globalThis as any).Deno?.env?.get?.("LOVABLE_API_KEY");
  if (!key) {
    console.warn(
      "[currentStateIntelligence] LOVABLE_API_KEY missing — skipping hypothesis generation",
    );
    return null;
  }

  const acctSeed = args.resolvedAccount
    ? `\nKnown CRM facts about ${args.resolvedAccount.name}:\n` +
      `- Website: ${args.resolvedAccount.website ?? "unknown"}\n` +
      `- Industry: ${args.resolvedAccount.industry ?? "unknown"}\n` +
      (args.resolvedAccount.notes
        ? `- CRM note: ${args.resolvedAccount.notes.slice(0, 400)}\n`
        : "")
    : "";

  const sys =
    `You are a senior B2B sales strategist preparing a rep for a conversation. ` +
    `You generate concrete current-state hypotheses about a company so the rep ` +
    `walks in with a real point of view, not generic categories. ` +
    `You reason from public knowledge of the company plus the model/industry ` +
    `they likely operate in. You are explicit that these are hypotheses, but ` +
    `you write them as real prose — never as scaffolding placeholders.`;

  const user =
    `Company in focus: ${args.entityName}` +
    acctSeed +
    `\n\nThe rep's prompt that triggered this:\n"""${args.userContent.slice(0, 1200)}"""\n\n` +
    HYPOTHESIS_SCHEMA_HINT;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          temperature: 0.6,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
        }),
      },
    );
    if (!resp.ok) {
      console.warn(
        `[currentStateIntelligence] hypothesis gen http ${resp.status}`,
      );
      return null;
    }
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || "";
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const required: (keyof GeneratedHypotheses)[] = [
      "business_model_summary",
      "customer_experience",
      "marketing_motion",
      "strategic_tension",
      "future_state_hypothesis",
      "likely_gap",
      "why_now",
      "thesis_summary",
    ];
    for (const k of required) {
      if (typeof parsed[k] !== "string" || !parsed[k].trim()) {
        return null;
      }
      // Strip any leftover scaffolding tokens defensively.
      parsed[k] = String(parsed[k])
        .replace(/^\[(Likely|Assume|Assumption|TODO)\]\s*/i, "")
        .replace(/\[(Likely|Assume|Assumption|TODO)\]/gi, "")
        .trim();
    }
    return parsed as GeneratedHypotheses;
  } catch (e) {
    console.warn(
      "[currentStateIntelligence] hypothesis gen failed:",
      (e as Error).message,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Inferred current-state builder ────────────────────────────────

function buildSkeletonIntelligence(args: {
  entityName: string;
  resolvedAccount: CurrentStateResult["resolvedAccount"];
  webResearched: boolean;
  hypotheses?: GeneratedHypotheses | null;
}): CurrentStateIntelligence {
  const { entityName, resolvedAccount, webResearched, hypotheses } = args;

  const sourcedFacts: CurrentStateIntelligence["evidence"]["sourced_facts"] = [];
  if (resolvedAccount) {
    sourcedFacts.push({
      claim: `Account exists in CRM as "${resolvedAccount.name}".`,
      confidence: "high",
    });
    if (resolvedAccount.website) {
      sourcedFacts.push({
        claim: `Website: ${resolvedAccount.website}`,
        source_url: resolvedAccount.website,
        confidence: "high",
      });
    }
    if (resolvedAccount.industry) {
      sourcedFacts.push({
        claim: `Industry: ${resolvedAccount.industry}`,
        confidence: "high",
      });
    }
    if (resolvedAccount.notes) {
      sourcedFacts.push({
        claim: `CRM note: ${resolvedAccount.notes.slice(0, 240)}`,
        confidence: "medium",
      });
    }
  }

  const companyConfidence: ConfidenceLevel = resolvedAccount
    ? "high"
    : webResearched
    ? "medium"
    : "low";

  const sectionConfidence: ConfidenceLevel = resolvedAccount ? "medium" : "low";

  // Fallback prose used ONLY if hypothesis generation fails. Even the
  // fallback avoids "[Likely]" scaffolding tokens — it's plain prose
  // hedged with "likely". This keeps the model from seeing placeholder
  // text it might mirror back.
  const fb = (s: string) => `Likely ${s}`;

  return {
    company: {
      name: resolvedAccount?.name || entityName,
      website: resolvedAccount?.website || undefined,
      confidence: companyConfidence,
      source: resolvedAccount
        ? "account_match"
        : webResearched
        ? "web_researched"
        : "text_inferred",
    },
    business_model: {
      summary: hypotheses?.business_model_summary
        || fb(`${entityName} operates a business model that should be confirmed in discovery; reason from public knowledge of the company and its category.`),
      confidence: sectionConfidence,
      unknowns: [
        "Exact revenue mix (DTC vs wholesale vs marketplace)",
        "Subscription / replenishment share",
        "Seasonality and peak windows",
      ],
    },
    customer_experience: {
      what_it_is_like_to_be_a_customer: hypotheses?.customer_experience
        || fb(`the end-to-end customer journey for ${entityName} skews toward what its category typically rewards; the specifics of discovery, conversion, and repeat should be confirmed.`),
      confidence: sectionConfidence,
      unknowns: [
        "Logged-in / app vs anonymous browsing share",
        "Loyalty or membership penetration",
        "Post-purchase comms cadence",
      ],
    },
    marketing_motion: {
      likely_new_customer_motion: hypotheses?.marketing_motion,
      confidence: sectionConfidence,
      unknowns: [
        "Lifecycle triggers currently wired up",
        "Personalization maturity (segment vs 1:1)",
        "Channel mix (email / SMS / app / mail)",
        "Winback / lapsed playbook (if any)",
      ],
    },
    strategic_priorities: {
      confidence: sectionConfidence,
      unknowns: [
        "Public investment signals (earnings, hires, launches)",
        "Marketing leadership changes",
        "Stated digital / loyalty / data investments",
      ],
    },
    lifecycle_opportunity_map: {},
    current_state_thesis: {
      summary: hypotheses?.thesis_summary
        || fb(`${entityName} is operating where its category and stage suggest it should be; the working thesis should be sharpened in discovery.`),
      likely_gap: hypotheses?.likely_gap
        || fb(`there is a gap between current customer engagement maturity and what the future state requires.`),
      why_now: hypotheses?.why_now
        || fb(`market and competitive pressure make this conversation timely.`),
      strategic_tension: hypotheses?.strategic_tension
        || fb(`the standard playbook may be misaligned with how this company actually wins with customers.`),
      future_state_hypothesis: hypotheses?.future_state_hypothesis
        || fb(`the company is trying to deepen customer engagement; getting there will require changes in data, motion, or experience.`),
    },
    discovery_questions: {
      must_confirm: [
        "Is the business primarily store-led, ecommerce-led, subscription-led, or hybrid today?",
        "Where is customer data most fragmented across the experience?",
        "Which lifecycle moments are currently most under-served?",
      ],
      high_leverage: [
        "What's the current motion for repeat vs lapsed customers?",
        "What's the personalization ceiling you're hitting today?",
        "Where are you investing for the next 12 months in customer engagement?",
      ],
    },
    evidence: {
      sourced_facts: sourcedFacts,
      inferred_claims: hypotheses
        ? [
          { claim: hypotheses.business_model_summary, basis: "model reasoning from public knowledge", confidence: "low" },
          { claim: hypotheses.customer_experience, basis: "model reasoning from public knowledge", confidence: "low" },
          { claim: hypotheses.marketing_motion, basis: "model reasoning from public knowledge", confidence: "low" },
        ]
        : [],
    },
  };
}

// ─── Prompt block renderer ─────────────────────────────────────────

function renderPromptBlock(
  intelligence: CurrentStateIntelligence,
  contextState: AccountContextState,
  webAvailable: boolean,
): string {
  const c = intelligence.company;
  const t = intelligence.current_state_thesis;
  const facts = intelligence.evidence.sourced_facts.slice(0, 5)
    .map((f) => `- ${f.claim}${f.source_url ? ` (${f.source_url})` : ""}`)
    .join("\n");
  const mustConfirm = intelligence.discovery_questions.must_confirm.slice(0, 4)
    .map((q) => `- ${q}`)
    .join("\n");

  const stateLabel = contextState === "attached"
    ? "ATTACHED (CRM record matched)"
    : contextState === "inferred"
    ? "INFERRED (no CRM match — reasoning from public knowledge)"
    : "MISSING";

  const bm = intelligence.business_model.summary;
  const cx = intelligence.customer_experience.what_it_is_like_to_be_a_customer;
  const mm = intelligence.marketing_motion.likely_new_customer_motion;

  return `═══ CURRENT STATE INTELLIGENCE (working hypotheses — use these as the basis of your response) ═══
Company: ${c.name}${c.website ? ` (${c.website})` : ""}
Account context state: ${stateLabel}
Company confidence: ${c.confidence}
Web research available this turn: ${webAvailable ? "yes" : "no"}

WORKING HYPOTHESES ABOUT ${c.name.toUpperCase()} (these are reasoned, not sourced — speak in "likely" voice when reflecting them):
- Business model: ${bm}
- Customer experience: ${cx}${mm ? `\n- Marketing current state: ${mm}` : ""}
- Strategic tension: ${t.strategic_tension}
- Likely gap (current → future): ${t.likely_gap}
- Why now: ${t.why_now}
- Future-state hypothesis: ${t.future_state_hypothesis}
- Working thesis: ${t.summary}

KNOWN FACTS (sourced):
${facts || "- (none in CRM/library — reason from public knowledge of this company)"}

MUST-CONFIRM DISCOVERY QUESTIONS:
${mustConfirm}

GENERATION RULES FOR THIS TURN — NON-NEGOTIABLE:
- Your response MUST be built on the working hypotheses above. If a draft does not visibly reflect the business model, customer experience, and strategic tension named for ${c.name}, STOP and rewrite before responding.
- Do NOT produce generic lifecycle / marketing / engagement categories (e.g. "Acquisition / Activation / Retention / Winback" buckets, "personalize the journey", "build a loyalty program"). The user can already produce that themselves.
- Frame ideas as conversation strategies: angles Corey can lead with, tensions to surface, hypotheses to test — not capability checklists.
- Speak hedged hypotheses honestly: use "${c.name} likely…", "in a [model] like ${c.name}'s…", "a reasonable assumption is…". Never present an inferred hypothesis as a sourced fact.
- Map current state → future state. Each idea should imply the gap it closes for ${c.name} specifically.
- Turn unknowns into discovery questions Corey can ask, not into hedges in your prose.
- ${
    webAvailable
      ? "Cite sources when you draw from web research."
      : "Web research is NOT available this turn — reason from your training knowledge of this company; do not say \"I researched\"."
  }
═══════════════════════════════════`;
}

// ─── Main entry point ──────────────────────────────────────────────

/**
 * Run the full preflight: detection → resolution → skeleton → prompt
 * block. Always returns a `CurrentStateResult` (with `ran=false` when
 * gated out) so callers can log uniformly.
 */
export async function runCurrentStatePreflight(
  args: RunPreflightArgs,
): Promise<CurrentStateResult> {
  const gate = shouldRunCurrentStatePreflight(args);
  if (!gate.ok) {
    return {
      ran: false,
      reason: gate.reason,
      entity: null,
      accountContextState: "missing",
      intelligence: null,
      promptBlock: "",
      log: {
        current_state_preflight: false,
        skipped_reason: gate.reason,
        workspace: gate.workspaceKey,
      },
    };
  }

  const candidates = detectCompanyMentions(args.userContent || "");
  if (candidates.length === 0) {
    return {
      ran: true,
      reason: "no_entity_detected",
      entity: null,
      accountContextState: "missing",
      intelligence: null,
      promptBlock: "",
      log: {
        current_state_preflight: true,
        entity_detected: false,
        workspace: gate.workspaceKey,
      },
    };
  }

  // Try each candidate against the accounts table; first hit wins.
  let entity: DetectedEntity | null = null;
  let resolvedAccount: CurrentStateResult["resolvedAccount"] = null;

  for (const cand of candidates) {
    try {
      const acct = await resolveCandidateToAccount(
        args.supabase,
        args.userId,
        cand,
      );
      if (acct) {
        entity = {
          name: acct.name,
          source: "text_match",
          matchedAccountId: acct.id,
        };
        resolvedAccount = acct;
        break;
      }
    } catch (e) {
      console.warn(
        "[currentStateIntelligence] resolveCandidateToAccount failed:",
        (e as Error).message,
      );
    }
  }

  // If nothing resolved, take the strongest candidate as inferred.
  if (!entity) {
    entity = {
      name: candidates[0],
      source: "inferred",
      matchedAccountId: null,
    };
  }

  const accountContextState: AccountContextState = resolvedAccount
    ? "attached"
    : "inferred";

  const webResearched = !!args.webCapabilityAvailable;

  // Generate REAL hypotheses (not placeholder scaffolding) before the
  // main model runs. This is what gives the current-state block enough
  // signal to actually steer generation. Failure is non-fatal — we
  // fall back to hedged prose, never to "[Likely]" tokens.
  const hypotheses = await generateRealHypotheses({
    entityName: entity.name,
    resolvedAccount,
    userContent: args.userContent || "",
  });

  const intelligence = buildSkeletonIntelligence({
    entityName: entity.name,
    resolvedAccount,
    webResearched,
    hypotheses,
  });

  const promptBlock = renderPromptBlock(
    intelligence,
    accountContextState,
    webResearched,
  );

  const log = {
    current_state_preflight: true,
    entity_detected: true,
    entity_name: entity.name,
    entity_source: entity.source,
    account_context_state: accountContextState,
    matched_account_id: resolvedAccount?.id ?? null,
    matched_account_name: resolvedAccount?.name ?? null,
    workspace: gate.workspaceKey,
    source_mix: {
      account_data: !!resolvedAccount,
      library: false, // upstream library retrieval handles this
      web: webResearched,
      user_text: true,
    },
    current_state_confidence: intelligence.company.confidence,
    hypotheses_generated: !!hypotheses,
    unknowns_count: countUnknowns(intelligence),
    injected_current_state_block: true,
    candidates_considered: candidates,
  };

  return {
    ran: true,
    reason: "ok",
    entity,
    accountContextState,
    resolvedAccount,
    intelligence,
    promptBlock,
    log,
  };
}

function countUnknowns(intel: CurrentStateIntelligence): number {
  return (
    (intel.business_model.unknowns?.length || 0) +
    (intel.customer_experience.unknowns?.length || 0) +
    (intel.marketing_motion.unknowns?.length || 0) +
    (intel.strategic_priorities.unknowns?.length || 0)
  );
}
