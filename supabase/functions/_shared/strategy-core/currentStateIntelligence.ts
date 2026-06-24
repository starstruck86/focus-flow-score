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

/**
 * A signal gathered BEFORE hypothesis generation. Verified-first model:
 * we attempt to surface real-world signals (recent news, launches,
 * leadership changes, partnerships, hiring, campaigns, etc.) and tag
 * each with its source + confidence. Hypotheses then build ON TOP of
 * verified signals; ranking prefers verified over inferred.
 */
export type VerifiedSignalSource =
  | "web"
  | "account"
  | "library"
  | "resource"
  | "inference";

export interface VerifiedSignal {
  signal: string;
  source: VerifiedSignalSource;
  confidence: ConfidenceLevel;
  source_url?: string;
  source_title?: string;
  /** Free-form category for downstream prioritization (news, launch, leadership, etc.). */
  kind?: string;
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
    mobile_app_or_logged_in_experience?: string;
    confidence: ConfidenceLevel;
    unknowns: string[];
  };
  marketing_motion: {
    likely_new_customer_motion?: string;
    likely_repeat_customer_motion?: string;
    promotional_strategy?: string;
    channels_likely_used?: string[];
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
  /**
   * Branch-specific posture sections. These replace the legacy
   * lifecycle/CX opportunity map with a mobile-app + attribution
   * frame: where the account stands on Branch's product surface area
   * and where the expansion whitespace is.
   */
  app_posture: {
    mobile_app_strategy: string;
    deep_linking_maturity: string;
    web_to_app_setup: string;
    deferred_deep_linking: string;
    confidence: ConfidenceLevel;
    unknowns: string[];
  };
  measurement_motion: {
    current_mmp: string;
    adjust_appsflyer_setup: string;
    attribution_gaps: string;
    mmp_consolidation_risk: string;
    confidence: ConfidenceLevel;
    unknowns: string[];
  };
  branch_expansion_map: {
    deep_linking_whitespace: string;
    universal_ads_whitespace: string;
    web_to_app_whitespace: string;
    email_sms_whitespace: string;
    advanced_products_whitespace: string;
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
   * Verified-first signals gathered BEFORE hypothesis generation.
   * Each is tagged with its source + confidence. Hypotheses and
   * prioritization both build on top of these. Empty when no verified
   * signal could be gathered (web/library/CRM produced nothing).
   */
  verified_signals: VerifiedSignal[];
  /**
   * Top 2–3 ranked signals that should drive the response. Generated
   * after hypotheses by `generatePrioritizedSignals`. Empty when the
   * second pass fails — never fabricated.
   */
  prioritized_signals: PrioritizedSignal[];
  /**
   * Commercial Insights (Challenger-style reframes). Generated AFTER
   * verified signals + prioritized signals so the insight is grounded
   * in real-world evidence, not pure inference. 1–2 insights max.
   * Each insight reframes how the customer thinks about their own
   * business — it is NOT another idea or angle. Empty when generation
   * fails; never fabricated.
   */
  commercial_insights: CommercialInsight[];
}

export interface CommercialInsightAIImpact {
  makes_easier: string;         // How AI lowers the cost / unlocks the shift
  makes_harder: string;         // How AI raises the bar / creates new pressure
}

export interface CommercialInsight {
  insight: string;              // The reframe — one sharp sentence that changes how the customer sees their business
  current_state: string;        // How they (and most of the category) think about it today
  shift: string;                // What is changing in the world / market / their operating model
  problem: string;              // What breaks if they keep operating on the old assumption
  implication: string;          // The business impact (revenue / growth / margin / risk) of the reframe
  tension: string;              // The assumption Corey should directly challenge
  // ── 3 WHY layer (Challenger narrative) ─────────────────────────────
  why_anything: string;         // What is structurally wrong / misaligned / the gap that exists
  why_now: string;              // What is changing / the pressure that makes this urgent
  why_you: string;              // Why our company / capability matters here — what enables the shift
  // ── AI Impact layer ───────────────────────────────────────────────
  ai_impact: CommercialInsightAIImpact;
  // ── Risk layer ────────────────────────────────────────────────────
  risk: string;                 // What happens if nothing changes / what they are likely missing
  // ── Conversation execution ────────────────────────────────────────
  conversation_entry: string;   // Spoken-voice opener — must read like "I'd lead here because…"
  conversation_move: string;    // First-person move — must read like "I'd lead here…"
  question: string;             // Legacy alias — kept for back-compat
  validation_question: string;  // Validation question — must read like "The question I'd ask is…"
  source_type: SignalSourceType; // account | library | web | inference — trust-down enforced
  confidence: ConfidenceLevel;
  /** Which prioritized-signal rank(s) this insight builds on, when applicable. */
  built_on_signal_ranks?: number[];
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

export type SignalSourceType = "account" | "library" | "web" | "inference";

export interface PrioritizedSignal {
  rank: 1 | 2 | 3;
  signal: string;             // The signal itself, named concretely
  signal_type: SignalType;
  source_type: SignalSourceType;
  confidence: ConfidenceLevel;

  // ── Strategic Why layer ──────────────────────────────────────────
  why_it_matters: string;             // What outcome / behavior / model this affects
  why_now: string;                    // What is changing right now that makes it timely
  why_this_company: string;           // Why this is uniquely relevant to THIS account

  business_pressure: string;          // Revenue / growth / risk pressure it points to
  customer_behavior_implication: string; // What customer behavior it suggests
  marketing_motion_implication: string;  // What it implies about lifecycle / engagement motion
  future_state_implication: string;   // What ambition / future-state it implies

  strategic_tension: string;          // The assumption Corey should challenge
  conversation_move: string;          // What Corey should lead with (spoken voice)
  validation_question: string;        // The question Corey should ask to test it

  // ── Change Vector (X → Y → Z) ────────────────────────────────────
  // Direction of travel for this signal. Y is verified when possible;
  // X and Z are typically inferred. Captures HOW the business is
  // changing — not just what it is — so prose can sound like
  // "they used to… now they're… which means…".
  change_vector: ChangeVector;

  // ── Reference Anchor ─────────────────────────────────────────────
  // Every signal must be grounded in a defensible reference. The
  // hierarchy (web > account > library > market > inference) drives
  // BOTH ranking and the prose shape the model uses to express it.
  reference: SignalReference;

  // ── Friction Layer (problem-first thinking) ──────────────────────
  // Names what is HARD about this signal — the constraint, tradeoff,
  // or tension that makes it difficult to execute. Forces the
  // conversation to open from a problem, not from an idea.
  friction: SignalFriction;

  // Back-compat from the earlier Prioritization layer (kept so the
  // conversation-mode digest and any prior consumers don't break):
  business_impact: string;            // 1-line revenue/growth/risk implication
  conversation_angle: string;         // Spoken-language opener
}

export type ReferenceType =
  | "web"        // news, earnings, launches, press
  | "account"    // CRM record / sourced fact tied to the resolved account
  | "library"    // user library / playbooks / framework material
  | "market"     // industry / category report or analyst piece
  | "inference"; // last resort — model recall, no external grounding

export interface SignalReference {
  reference_type: ReferenceType;
  reference_source: string;   // Human-readable source label (e.g. "Q3 2025 earnings call", "WSJ", "TJX press release")
  reference_url?: string;     // URL when available; omitted for inference / un-cited
  confidence: ConfidenceLevel; // High / medium / low — drives prose shape
  /** Optional 1-line excerpt or claim that anchors the signal to the reference. */
  reference_excerpt?: string;
}

export interface ChangeVector {
  before: string;          // X — prior state (what they used to do / how they used to operate)
  before_basis: "verified" | "inferred";
  now: string;             // Y — current state (verified when possible)
  now_basis: "verified" | "inferred";
  next: string;            // Z — direction of travel (inferred unless explicitly signaled)
  next_basis: "verified" | "inferred";
  what_changed: string;          // The delta, named concretely
  why_it_matters: string;        // Why the change matters for the business
  what_breaks: string;           // What breaks if they don't adapt
  opportunity: string;           // The opportunity that emerges from the change
}

export interface SignalFriction {
  /** What is hard about this signal — the constraint, named concretely. */
  what_is_hard: string;
  /** Why it's hard — the underlying reason (capacity, data, org, market, tooling, model). */
  why_it_is_hard: string;
  /** The tradeoff the team is forced to make — what they sacrifice to do this. */
  tradeoff: string;
  /** Connection back to the verified/inferred current state — anchors the friction in reality. */
  current_state_link: string;
  /** What breaks or gets left on the table if the friction isn't named and solved. */
  implication: string;
  /** First-person spoken move that opens from the PROBLEM, not the solution. */
  conversation_move: string;
  /** Plain-language question Corey would ask to test/validate the friction. */
  validation_question: string;
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
  "strategy",
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
  "Work", "Artifact", "Artifacts", "Library", "Acoustic", "Corey", "Dave",
  "Email", "Brief", "Plan", "Account", "Opportunity", "Conversation",
  "Approach", "Give", "Make", "Build", "Need", "Want", "Like", "Help",
  "Find", "Show",
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
// ─── Verified-First Signal Gathering ───────────────────────────────
//
// Before we generate any hypothesis, we attempt to gather REAL,
// verifiable signals about the company: recent news, product launches,
// leadership / org changes, partnerships, hiring, campaigns, digital
// or AI initiatives, industry shifts. We tag every signal with its
// source + confidence. Hypotheses then build ON TOP of these. This is
// the core of the verified-first contract: don't assume when we can
// verify.

const VERIFIED_SIGNAL_SCHEMA_HINT = `Return ONLY a JSON object with EXACTLY this shape:
{
  "signals": [
    {
      "signal": "Concrete, named real-world signal about this company. e.g. 'Launched a new owned-brand activewear line in March 2024 to broaden assortment beyond intimates' — not 'they invest in marketing'.",
      "kind": "news | product_launch | campaign | leadership_change | hiring | partnership | digital_or_ai_initiative | website_or_app_change | industry_trend | financial_or_earnings",
      "confidence": "high | medium | low",
      "source_title": "Optional short label of the source if you can identify it. Empty string if unsure.",
      "source_url": "Optional URL if you can recall a specific page. Empty string if unsure."
    }
  ]
}

Hard rules:
- Maximum 5 signals. Prefer 2-3 STRONG signals over 5 weak ones.
- ONLY include signals you can actually attest to from training knowledge or web research. If you are guessing, DO NOT include it — that's what the inference layer is for, not this layer.
- If your knowledge of this company is thin or stale, return an empty signals array. Empty is correct and honest.
- Set confidence honestly: "high" only when you are confident the signal is real and current; "medium" when you remember the signal but timing/details may have shifted; "low" when you only vaguely recall it.
- Each signal must be specific: name the thing (product, exec, partner, campaign, market shift), not the category.
- Do NOT include generic industry statements ("retail is becoming more digital"). Those are not signals about this company.
- Do NOT include any text outside the JSON object.`;

interface GeneratedVerifiedSignals {
  signals: Array<{
    signal?: string;
    kind?: string;
    confidence?: string;
    source_title?: string;
    source_url?: string;
  }>;
}

/**
 * Gather verified signals about the entity from the best available
 * source. Order of preference:
 *   1. Web research (Perplexity) when `webCapabilityAvailable` and
 *      PERPLEXITY_API_KEY is set — these get `source: "web"`.
 *   2. Model recall via Lovable AI Gateway — tagged honestly.
 * Account / library / resource signals are seeded separately by the
 * skeleton builder; we surface them through the same VerifiedSignal
 * shape so the renderer can show one unified list.
 *
 * Failure is non-fatal — returns [] and the pipeline falls back to
 * pure inference (and logs verified_first_applied=false).
 */
async function gatherVerifiedSignals(args: {
  entityName: string;
  resolvedAccount: CurrentStateResult["resolvedAccount"];
  webCapabilityAvailable: boolean;
}): Promise<VerifiedSignal[]> {
  const env = (globalThis as any).Deno?.env;
  const lovableKey = env?.get?.("LOVABLE_API_KEY");
  const pplxKey = env?.get?.("PERPLEXITY_API_KEY");

  const useWeb = !!(args.webCapabilityAvailable && pplxKey);
  const sourceTag: VerifiedSignalSource = useWeb ? "web" : "inference";

  // System framing changes based on whether we have live web grounding.
  const sys = useWeb
    ? `You are a B2B sales research analyst. You will be given a company name. ` +
      `Use real-time web search to gather the most relevant, recent, verifiable ` +
      `signals about this company that would shape a sales conversation: recent ` +
      `news, product launches, leadership changes, partnerships, hiring trends, ` +
      `digital or AI initiatives, campaigns, financial signals. You MUST cite ` +
      `actual sources you found. If you cannot verify something, OMIT it.`
    : `You are a B2B sales research analyst. You will be given a company name. ` +
      `From your training knowledge, surface the strongest, most distinctive ` +
      `real-world signals you can attest to about this company that would shape ` +
      `a sales conversation. Be honest about confidence — if your knowledge is ` +
      `thin or you're guessing, return an empty list. Empty is correct.`;

  const acctLine = args.resolvedAccount?.industry
    ? ` (industry: ${args.resolvedAccount.industry})`
    : "";

  const userMsg =
    `Company: ${args.entityName}${acctLine}\n\n` +
    `Surface the strongest verifiable signals about this company that would ` +
    `shape a first sales conversation. Focus on what is RECENT, SPECIFIC, and ` +
    `STRATEGICALLY RELEVANT.\n\n` +
    VERIFIED_SIGNAL_SCHEMA_HINT;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);

  try {
    let raw = "";

    if (useWeb) {
      // Perplexity: real-time web grounded. Returns citations on the
      // top-level `citations` array; we don't strictly need them here
      // because we ask the model to embed source_url/title per signal.
      const resp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pplxKey}`,
          "Content-Type": "application/json",
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: "sonar",
          temperature: 0.2,
          search_recency_filter: "month",
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "verified_signals",
              schema: {
                type: "object",
                properties: {
                  signals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        signal: { type: "string" },
                        kind: { type: "string" },
                        confidence: { type: "string" },
                        source_title: { type: "string" },
                        source_url: { type: "string" },
                      },
                      required: ["signal", "kind", "confidence"],
                    },
                  },
                },
                required: ["signals"],
              },
            },
          },
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userMsg },
          ],
        }),
      });
      if (!resp.ok) {
        console.warn(
          `[currentStateIntelligence] perplexity verified-signals http ${resp.status}`,
        );
      } else {
        const data = await resp.json();
        raw = data?.choices?.[0]?.message?.content || "";
      }
    } else if (lovableKey) {
      const resp = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            "Content-Type": "application/json",
          },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            temperature: 0.3,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userMsg },
            ],
          }),
        },
      );
      if (!resp.ok) {
        console.warn(
          `[currentStateIntelligence] gemini verified-signals http ${resp.status}`,
        );
      } else {
        const data = await resp.json();
        raw = data?.choices?.[0]?.message?.content || "";
      }
    } else {
      return [];
    }

    if (!raw) return [];

    let parsed: GeneratedVerifiedSignals | null = null;
    try {
      parsed = JSON.parse(raw) as GeneratedVerifiedSignals;
    } catch {
      // Perplexity sometimes wraps JSON in prose — pull the first {...}
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]) as GeneratedVerifiedSignals;
        } catch { /* fall through */ }
      }
    }
    if (!parsed || !Array.isArray(parsed.signals)) return [];

    const allowedConf: ConfidenceLevel[] = ["high", "medium", "low"];
    const cleaned: VerifiedSignal[] = [];
    for (const s of parsed.signals) {
      const signal = String(s?.signal || "").trim();
      if (!signal) continue;
      let conf: ConfidenceLevel = allowedConf.includes(s?.confidence as any)
        ? (s!.confidence as ConfidenceLevel)
        : "low";
      // Trust-down: pure model recall (no web) can never be "high".
      if (!useWeb && conf === "high") conf = "medium";
      const url = String(s?.source_url || "").trim();
      const title = String(s?.source_title || "").trim();
      cleaned.push({
        signal,
        source: sourceTag,
        confidence: conf,
        source_url: url || undefined,
        source_title: title || undefined,
        kind: String(s?.kind || "").trim() || undefined,
      });
      if (cleaned.length >= 5) break;
    }
    return cleaned;
  } catch (e) {
    console.warn(
      "[currentStateIntelligence] gatherVerifiedSignals failed:",
      (e as Error).message,
    );
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Real hypothesis generator (LLM-backed) ────────────────────────


interface GeneratedHypotheses {
  business_model_summary: string;
  app_posture: string;
  measurement_motion: string;
  strategic_tension: string;
  future_state_hypothesis: string;
  likely_gap: string;
  why_now: string;
  thesis_summary: string;
}

const HYPOTHESIS_SCHEMA_HINT = `Return ONLY a JSON object with EXACTLY these string keys:
{
  "business_model_summary": "1-2 sentences. Concrete, specific to this company. Use phrasing like 'X likely operates...' or 'In a Y model like X's...'. NEVER write '[Likely]' or scaffolding tokens — write real prose.",
  "app_posture": "1-2 sentences on this company's mobile app strategy and deep linking maturity. Where is the app in their funnel (acquisition-led, retention-led, transaction core, content/engagement)? What is the likely state of deep linking, deferred deep linking, and web-to-app today — is it instrumented, partial, or absent? Be specific.",
  "measurement_motion": "1-2 sentences on how this company likely measures mobile attribution today. Which MMP are they most likely on — Adjust, AppsFlyer, Kochava, Singular, or self-built? Where are the obvious attribution gaps (web-to-app, post-install retargeting, sub-entity reporting, privacy/AIO impact)? Where is MMP consolidation pressure most likely to land?",
  "strategic_tension": "1 sentence naming a non-obvious tension Corey can put on the table — the gap between their current attribution/measurement setup and where they need to be. Example shape: 'Most teams in their category assume their MMP covers X, but for this company Y is closer to true.'",
  "future_state_hypothesis": "1-2 sentences on what their attribution / measurement / app-monetization future state looks like, and what has to change (deep linking adoption, MMP consolidation, Universal Ads, web-to-app, Advanced Privacy posture) to get there.",
  "likely_gap": "1 sentence: the most plausible gap between their current Branch footprint and the future state — the whitespace expansion-ARR lives in.",
  "why_now": "1 sentence: the market / competitive / internal pressure that makes this conversation timely (renewal window, QBR cadence, privacy shift, competitor displacement, new app launch, leadership change).",
  "thesis_summary": "1 crisp sentence summarizing the working thesis about where the company sits on the Branch surface area today."
}

Hard rules:
- Write real, concrete hypotheses. No placeholder text. No "[Likely]", "[Assume]", "describe…", "fill in…".
- It's OK — and required — to be hypothetical. Use "likely", "in a [model] like X's", "a reasonable assumption is".
- Use Branch vocabulary directly (deep linking, deferred deep linking, Universal Ads, Web-to-App, Email-to-App, SMS-to-App, QR, AIO, Advanced Privacy, MMP, sub-entity, attribution, footprint, whitespace, QBR, expansion-ARR). Avoid generic "analytics / engagement / personalization" when a specific Branch capability fits.
- Name the competitive dynamic when it sharpens the point (Adjust, AppsFlyer, Kochava, Singular).
- Do NOT cite. Do NOT pretend these are facts.
- Do NOT include any text outside the JSON object.`;

async function generateRealHypotheses(args: {
  entityName: string;
  resolvedAccount: CurrentStateResult["resolvedAccount"];
  userContent: string;
  verifiedSignals?: VerifiedSignal[];
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

  const verified = (args.verifiedSignals || []).filter((s) =>
    s.source !== "inference" || s.confidence !== "low"
  );
  const verifiedBlock = verified.length
    ? `\nVERIFIED SIGNALS (real-world, source-tagged — your hypotheses MUST build on top of these, not ignore them):\n` +
      verified
        .map((s) =>
          `- [${s.source}·${s.confidence}${s.kind ? `·${s.kind}` : ""}] ${s.signal}` +
          (s.source_url ? ` (${s.source_url})` : "")
        )
        .join("\n") + "\n"
    : "";

  const sys =
    `You are a senior B2B sales strategist preparing a rep for a conversation. ` +
    `You generate concrete current-state hypotheses about a company so the rep ` +
    `walks in with a real point of view, not generic categories. ` +
    `You reason from VERIFIED SIGNALS first when present, then extend with ` +
    `public knowledge of the company plus the model/industry they likely ` +
    `operate in. You are explicit about which parts are verified vs hypothesis, ` +
    `but you write hypotheses as real prose — never as scaffolding placeholders.`;

  const user =
    `Company in focus: ${args.entityName}` +
    acctSeed +
    verifiedBlock +
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
      "app_posture",
      "measurement_motion",
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

// ─── Signal Prioritization (LLM-backed) ────────────────────────────

const SIGNAL_SCHEMA_HINT = `Return ONLY a JSON object with EXACTLY this shape:
{
  "signals": [
    {
      "rank": 1,
      "signal": "Concrete, named signal (not a category). e.g. 'TJX's treasure-hunt model means inventory turns weekly and creates real-time scarcity that lifecycle programs almost never exploit', not 'opportunity in retention'.",
      "signal_type": "tension | revenue_or_growth | change_in_motion | blind_spot | external_event | competitive_pressure | leadership_or_org | product_or_launch",
      "source_type": "account | library | web | inference",
      "confidence": "high | medium | low",

      "why_it_matters": "1 sentence: the business outcome, customer behavior, or operating-model lever this signal moves. Not 'this is important' — name what it changes.",
      "why_now": "1 sentence: what is changing right now (market, customer behavior, company priority, competitive pressure, product investment, leadership shift, channel change, seasonality, technology shift).",
      "why_this_company": "1 sentence: why THIS account specifically — not any company in the category. Tie to their model / scale / customer / position.",

      "business_pressure": "1 sentence: the revenue / growth / margin / risk pressure this points to.",
      "customer_behavior_implication": "1 sentence: what this signal implies about how their customers actually behave.",
      "marketing_motion_implication": "1 sentence: what this implies about how lifecycle / engagement / CRM motion should be shaped.",
      "future_state_implication": "1 sentence: what ambition or future-state this signal implies they are (or should be) moving toward.",

      "strategic_tension": "1 sentence: the assumption Corey should challenge in conversation. Should sound like 'most teams assume X, but for this company Y is closer to true.'",
      "conversation_move": "1-2 sentences in first-person spoken voice. Example shapes: \"I'd lead here because…\", \"The reason this matters is…\", \"The tension I'd test is…\". No headings, no labels, no consultant-speak.",
      "validation_question": "1 sentence: the question Corey should ask the customer to test the hypothesis. Plain language, the way Corey would actually ask it.",

      "change_vector": {
        "before": "X — what this account USED TO do / how they USED TO operate on this dimension. 1 short sentence, concrete (not 'they had a basic program'). Example: 'Drove repeat purchase entirely through batch promotional email.'",
        "before_basis": "verified | inferred",
        "now": "Y — what they are doing / how they operate TODAY. Anchored in verified signals when present. 1 short sentence, concrete. Example: 'Have launched a paid loyalty tier and started personalizing offers by segment.'",
        "now_basis": "verified | inferred",
        "next": "Z — the direction of travel: where this is heading next 6-18 months based on signals + business model. 1 short sentence. Example: 'Moving toward a behaviorally-triggered lifecycle motion that monetizes the loyalty signal in real time.'",
        "next_basis": "verified | inferred",
        "what_changed": "1 sentence: the delta from X → Y, named concretely. The actual shift, not a vague 'they evolved'.",
        "why_it_matters": "1 sentence: why this change matters for their business — revenue / customer / margin / risk lens.",
        "what_breaks": "1 sentence: what breaks or gets left on the table if they don't keep moving toward Z.",
        "opportunity": "1 sentence: the opportunity that emerges from the X → Y → Z motion — the gap Corey can lean into."
      },

      "reference": {
        "reference_type": "web | account | library | market | inference",
        "reference_source": "Concrete, human-readable source label. Examples: 'Q3 2025 earnings call', 'WSJ — Aug 2025', 'TJX Aug 2025 press release', 'CRM note: Sept 2025 discovery call', 'eMarketer 2025 Retail Outlook'. NEVER 'public knowledge', 'common sense', or 'industry best practice'.",
        "reference_url": "URL when one exists; omit for account/library/inference references with no URL.",
        "reference_excerpt": "1 short sentence — the actual claim from the reference that anchors this signal. Plain language, not a quote with quotation marks.",
        "confidence": "high | medium | low — driven by how directly the reference supports the signal. high only when web/account/library reference is current and specific."
      },

      "friction": {
        "what_is_hard": "1 sentence: name the constraint, the hard part, the thing that makes this difficult to execute. Concrete — not 'it's complex'. Examples: 'Their merch margin is too thin to absorb personalization compute at scale', 'Lifecycle and retail are run by different P&Ls with no shared incentive', 'Their ESP can't action behavioral signals in <24h'.",
        "why_it_is_hard": "1 sentence: the underlying reason — capacity, data, org structure, market dynamic, tooling, or business model. Why this constraint EXISTS, not just that it does.",
        "tradeoff": "1 sentence: the tradeoff the team is forced to make today — what they sacrifice to keep operating the way they do (e.g. 'They get scale by trading personalization', 'They protect margin by under-investing in repeat-purchase tooling').",
        "current_state_link": "1 sentence: tie the friction back to the verified or inferred current state (Y of the change vector, or a verified signal). The friction MUST be grounded in what's actually happening — not invented.",
        "implication": "1 sentence: what BREAKS, gets left on the table, or compounds into bigger pain if the friction isn't named and addressed.",
        "conversation_move": "1-2 sentences in first-person spoken voice that opens from the PROBLEM, not the solution. Shape: 'The challenge for a team like this is…', 'What's hard here is…', 'The real constraint is…'. NEVER opens with 'Use…', 'Build…', 'Implement…', 'Leverage…', or any solution verb.",
        "validation_question": "1 sentence: the question Corey would ask the customer to test whether the friction is real and how they're managing the tradeoff. Plain customer language."
      },

      "business_impact": "1 short sentence summarizing revenue / growth / risk implication (kept for downstream digest reuse).",
      "conversation_angle": "1 short spoken-voice opener (kept for downstream digest reuse). Same energy as conversation_move."
    }
  ]
}

Ranking criteria — apply in order:
1. What would matter most in a FIRST conversation with this account?
2. What creates real strategic TENSION (not generic best-practice)?
3. What impacts REVENUE / GROWTH most directly?
4. What is CHANGING right now (motion, leadership, market, product)?
5. What is most likely a BLIND SPOT for the team running it today?

Hard rules:
- Maximum 3 signals. Prefer 2 strong over 3 mediocre.
- No generic lifecycle buckets (Acquisition / Activation / Retention / Winback) as signals.
- No "opportunity to personalize" / "build a loyalty program" / "improve email" — those are not signals.
- A signal must be specific enough that another rep would say "yes, that's the real thing."
- If the underlying basis is inferred (no sourced fact), set source_type = "inference" and confidence = "low" — do NOT pretend it's sourced.
- Every Why field (why_it_matters, why_now, why_this_company) must be DIFFERENT. If you're tempted to repeat the signal in those fields, you haven't reasoned hard enough.
- conversation_move and conversation_angle must read like spoken language. No "we should explore...", no headings.
- change_vector is REQUIRED. X (before) and Z (next) are typically inferred — mark them so. Y (now) MUST be marked "verified" only when it traces to a verified signal or sourced CRM fact in the same turn; otherwise mark "inferred". Never mark Y as verified to sound credible.
- X, Y, Z must each describe a DIFFERENT state. If X and Y read the same, you haven't found the change — drop the signal.
- reference is REQUIRED. Use the hierarchy: prefer web > account > library > market > inference. Pick the STRONGEST grounding actually available — never invent a URL or fabricate a press release / earnings line. If only model recall supports the signal, set reference_type="inference", confidence="low", reference_source="model recall", and OMIT reference_url.
- reference.confidence drives prose downstream: high → speak with confidence ("they've done X"), medium → "we're seeing a shift toward…", low → "a reasonable assumption is…". Pick a confidence level you can defend.
- friction is REQUIRED. Every signal MUST identify what is HARD about acting on it — the constraint, the tradeoff, the tension. If you cannot name a real constraint, the signal is too generic — drop it.
- friction.conversation_move MUST open from the PROBLEM, not the solution. If your move starts with "Use…", "Build…", "Implement…", "Launch…", "Leverage…", or any solution verb, REWRITE it to open with the constraint ("The challenge for a team like this is…", "What's hard here is…", "The real constraint is…").
- friction must be DIFFERENT from change_vector.what_breaks. what_breaks = consequence of inaction. friction = the structural reason action is hard right now.
- Do NOT include any text outside the JSON object.`;

interface GeneratedSignals {
  signals: PrioritizedSignal[];
}

async function generatePrioritizedSignals(args: {
  entityName: string;
  resolvedAccount: CurrentStateResult["resolvedAccount"];
  userContent: string;
  hypotheses: GeneratedHypotheses | null;
  sourcedFacts: CurrentStateIntelligence["evidence"]["sourced_facts"];
  verifiedSignals: VerifiedSignal[];
  webResearched: boolean;
}): Promise<PrioritizedSignal[]> {
  const key = (globalThis as any).Deno?.env?.get?.("LOVABLE_API_KEY");
  if (!key) return [];

  const acctSeed = args.resolvedAccount
    ? `\nKnown CRM facts about ${args.resolvedAccount.name}:\n` +
      `- Website: ${args.resolvedAccount.website ?? "unknown"}\n` +
      `- Industry: ${args.resolvedAccount.industry ?? "unknown"}\n` +
      (args.resolvedAccount.notes
        ? `- CRM note: ${args.resolvedAccount.notes.slice(0, 400)}\n`
        : "")
    : "";

  // VERIFIED-FIRST: lead the prompt with verified signals so the model
  // ranks them ahead of inferred hypotheses. Hypotheses come AFTER as
  // gap-fillers, never as substitutes.
  const verified = args.verifiedSignals || [];
  const verifiedBlock = verified.length
    ? `\nVERIFIED SIGNALS (real-world, source-tagged — PREFER THESE WHEN RANKING):\n` +
      verified
        .map((s, i) =>
          `${i + 1}. [${s.source}·${s.confidence}${s.kind ? `·${s.kind}` : ""}] ${s.signal}` +
          (s.source_url ? ` (${s.source_url})` : "")
        )
        .join("\n") + "\n"
    : `\nVERIFIED SIGNALS: none gathered this turn — you may rank from hypotheses, but flag every signal as source_type:"inference".\n`;

  const hyp = args.hypotheses;
  const hypBlock = hyp
    ? `\nINFERRED HYPOTHESES (gap-fillers — use ONLY to extend verified signals or when no verified signal exists):\n` +
      `- Business model: ${hyp.business_model_summary}\n` +
      `- App posture: ${hyp.app_posture}\n` +
      `- Measurement motion: ${hyp.measurement_motion}\n` +
      `- Strategic tension: ${hyp.strategic_tension}\n` +
      `- Likely gap: ${hyp.likely_gap}\n` +
      `- Why now: ${hyp.why_now}\n` +
      `- Future-state hypothesis: ${hyp.future_state_hypothesis}\n`
    : "";

  const facts = args.sourcedFacts.length
    ? `\nKnown sourced facts (CRM / library):\n` +
      args.sourcedFacts.slice(0, 6).map((f) => `- ${f.claim}`).join("\n") + "\n"
    : "";

  const sys =
    `You are a senior B2B sales strategist. Your job is to RANK and SELECT the ` +
    `top 2-3 signals that should drive a first conversation with this account. ` +
    `You ruthlessly cut everything that doesn't matter most. You write signals ` +
    `that are concrete, specific, and tied to real business impact — never ` +
    `generic categories. ` +
    `VERIFIED-FIRST RULE: when verified signals exist, they MUST take the top ranks. ` +
    `Inferred hypotheses can only fill remaining slots, and only when they extend ` +
    `(not duplicate) the verified ones. Never let an inferred angle outrank a ` +
    `verified one. The output tells the rep what matters most, not everything ` +
    `that could matter.`;

  const user =
    `Account in focus: ${args.entityName}` +
    acctSeed +
    verifiedBlock +
    hypBlock +
    facts +
    `\nWeb research available this turn: ${args.webResearched ? "yes" : "no"}` +
    `\n\nThe rep's prompt:\n"""${args.userContent.slice(0, 1200)}"""\n\n` +
    SIGNAL_SCHEMA_HINT;


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
          temperature: 0.5,
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
        `[currentStateIntelligence] signal prioritization http ${resp.status}`,
      );
      return [];
    }
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || "";
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GeneratedSignals;
    if (!parsed || !Array.isArray(parsed.signals)) return [];

    const allowedTypes: SignalType[] = [
      "tension",
      "revenue_or_growth",
      "change_in_motion",
      "blind_spot",
      "external_event",
      "competitive_pressure",
      "leadership_or_org",
      "product_or_launch",
    ];
    const allowedSources: SignalSourceType[] = [
      "account",
      "library",
      "web",
      "inference",
    ];
    const allowedConfidences: ConfidenceLevel[] = ["high", "medium", "low"];

    const haveAccount = !!args.resolvedAccount;
    const verifiedWeb = (args.verifiedSignals || []).filter((v) => v.source === "web");
    const verifiedLib = (args.verifiedSignals || []).filter((v) => v.source === "library" || v.source === "resource");
    const haveWeb = !!args.webResearched && verifiedWeb.length > 0;
    const haveLibrary = verifiedLib.length > 0;

    const cleaned: PrioritizedSignal[] = [];
    for (let i = 0; i < parsed.signals.length && cleaned.length < 3; i++) {
      const s: any = parsed.signals[i];
      if (!s || typeof s !== "object") continue;

      const signal = String(s.signal || "").trim();
      const whyMatters = String(s.why_it_matters || "").trim();
      const whyNow = String(s.why_now || "").trim();
      const whyCo = String(s.why_this_company || "").trim();
      const pressure = String(s.business_pressure || "").trim();
      const cxImp = String(s.customer_behavior_implication || "").trim();
      const motionImp = String(s.marketing_motion_implication || "").trim();
      const futureImp = String(s.future_state_implication || "").trim();
      const tension = String(s.strategic_tension || "").trim();
      const move = String(s.conversation_move || "").trim();
      const validation = String(s.validation_question || "").trim();
      const impact = String(s.business_impact || pressure || "").trim();
      const angle = String(s.conversation_angle || move || "").trim();

      // Required fields — drop the signal if any core Why field is missing.
      if (
        !signal || !whyMatters || !whyNow || !whyCo ||
        !pressure || !cxImp || !motionImp || !futureImp ||
        !tension || !move || !validation
      ) continue;

      const type = allowedTypes.includes(s.signal_type)
        ? (s.signal_type as SignalType)
        : "tension";

      // Trust-down rule: never let the model upgrade a signal beyond
      // what the actual source mix supports. Inference can never
      // claim "account", "web", or "library" sourcing without backing
      // verified evidence in the same turn.
      let source: SignalSourceType = allowedSources.includes(s.source_type)
        ? (s.source_type as SignalSourceType)
        : "inference";
      if (source === "account" && !haveAccount) source = "inference";
      if (source === "web" && !haveWeb) source = "inference";
      if (source === "library" && !haveLibrary) source = "inference";

      let confidence: ConfidenceLevel = allowedConfidences.includes(s.confidence)
        ? (s.confidence as ConfidenceLevel)
        : "low";
      // Inference can't be high-confidence.
      if (source === "inference" && confidence === "high") confidence = "medium";

      // ── Change Vector (X → Y → Z) — REQUIRED ──────────────────────
      // We synthesize a safe fallback when the model omits or partially
      // returns the vector, so older runs and weaker models still ship
      // a usable shape. Y_basis is trust-down: never "verified" unless
      // the signal itself is sourced from web/account/library.
      const cv: any = (s && typeof s.change_vector === "object" && s.change_vector) || {};
      const trustBasis = (b: unknown): "verified" | "inferred" =>
        b === "verified" ? "verified" : "inferred";
      let nowBasis = trustBasis(cv.now_basis);
      // Y can only claim "verified" when the signal itself is verifiable.
      if (nowBasis === "verified" && source === "inference") nowBasis = "inferred";
      let beforeBasis = trustBasis(cv.before_basis);
      if (beforeBasis === "verified" && source === "inference") beforeBasis = "inferred";
      // Z (next) is forward-looking; never let it claim verified.
      const nextBasis: "verified" | "inferred" = "inferred";

      const before = String(cv.before || "").trim();
      const now = String(cv.now || "").trim();
      const next = String(cv.next || "").trim();
      const whatChanged = String(cv.what_changed || "").trim();
      const cvWhyMatters = String(cv.why_it_matters || "").trim();
      const whatBreaks = String(cv.what_breaks || "").trim();
      const opportunity = String(cv.opportunity || "").trim();

      // Drop the signal if the change vector is unusable. We need at
      // least Y (now) and Z (next) plus what_changed to drive prose.
      if (!now || !next || !whatChanged) continue;
      // X and Y must differ — otherwise there's no change to talk about.
      if (before && before.toLowerCase() === now.toLowerCase()) continue;

      const change_vector: ChangeVector = {
        before: before || `Prior state of "${signal}" before recent shifts.`,
        before_basis: beforeBasis,
        now,
        now_basis: nowBasis,
        next,
        next_basis: nextBasis,
        what_changed: whatChanged,
        why_it_matters: cvWhyMatters || whyMatters,
        what_breaks: whatBreaks || `Risk of falling behind the ${whatChanged} curve.`,
        opportunity: opportunity || `Lean into the gap created by ${whatChanged}.`,
      };

      // ── Reference Anchor — REQUIRED ───────────────────────────────
      // Trust-down on type: a signal whose source_type was downgraded
      // to "inference" cannot present a web/account/library reference.
      // We also strip URLs from inference references so the prose
      // never implies a citation we don't have.
      const allowedRefTypes: ReferenceType[] = ["web", "account", "library", "market", "inference"];
      const refRaw: any = (s && typeof s.reference === "object" && s.reference) || {};
      let reference_type: ReferenceType = allowedRefTypes.includes(refRaw.reference_type)
        ? (refRaw.reference_type as ReferenceType)
        : "inference";
      // Trust-down: keep reference_type aligned with what the source mix supports.
      if (reference_type === "account" && !haveAccount) reference_type = "inference";
      if (reference_type === "web" && !haveWeb) reference_type = "inference";
      if (reference_type === "library" && !haveLibrary) reference_type = "inference";
      // If the signal itself was downgraded to inference, the reference must follow.
      if (source === "inference" && reference_type !== "market") {
        reference_type = "inference";
      }

      const reference_source = String(refRaw.reference_source || "").trim() ||
        (reference_type === "inference" ? "model recall" : "");
      const reference_url_raw = String(refRaw.reference_url || "").trim();
      const reference_excerpt = String(refRaw.reference_excerpt || "").trim() || undefined;
      // Inference references never carry a URL — block any model attempt to cite one.
      const reference_url = reference_type === "inference" ? undefined : (reference_url_raw || undefined);

      let refConfidence: ConfidenceLevel = allowedConfidences.includes(refRaw.confidence)
        ? (refRaw.confidence as ConfidenceLevel)
        : confidence;
      // Inference can never be high-confidence; cap it.
      if (reference_type === "inference" && refConfidence === "high") refConfidence = "low";
      // A reference can't outclaim its underlying signal's confidence by more than one tier.
      if (confidence === "low" && refConfidence === "high") refConfidence = "medium";

      // Drop the signal if we can't even name a source. We never ship
      // an unanchored signal — if the model didn't provide one, fall
      // back to "model recall" / inference (already handled above).
      const reference: SignalReference = {
        reference_type,
        reference_source: reference_source || "model recall",
        reference_url,
        reference_excerpt,
        confidence: refConfidence,
      };

      // ── Friction Layer (problem-first) — REQUIRED ─────────────────
      // Forces the conversation to open from a constraint, not a
      // solution. We sanitize the move so any solution-verb opener is
      // rewritten into a problem-framed opener before it hits prose.
      const fr: any = (s && typeof s.friction === "object" && s.friction) || {};
      const whatIsHard = String(fr.what_is_hard || "").trim();
      const whyHard = String(fr.why_it_is_hard || "").trim();
      const tradeoff = String(fr.tradeoff || "").trim();
      const csLink = String(fr.current_state_link || "").trim() || now;
      const fricImp = String(fr.implication || "").trim() || (whatBreaks || "");
      let fricMove = String(fr.conversation_move || "").trim();
      const fricQ = String(fr.validation_question || "").trim() || validation;

      // Drop the signal if there's no real friction to name. The whole
      // point of this layer is to ensure no signal ships without a
      // problem-first frame; an empty friction is a tell that the
      // signal is too generic.
      if (!whatIsHard || !whyHard || !tradeoff) continue;

      // Sanitize: solution-verb opener → rewrite into problem-framed.
      // Cheap regex guard ensures we never ship "Use lifecycle…" prose
      // even if the model ignored the schema rule.
      const SOLUTION_OPENER = /^(use|build|implement|launch|leverage|deploy|create|introduce|roll\s*out|stand\s*up|set\s*up|adopt)\b/i;
      if (!fricMove || SOLUTION_OPENER.test(fricMove)) {
        fricMove = `The challenge for a team like this is ${whatIsHard.replace(/[.!?]+$/, "")} — ${whyHard.replace(/^[A-Z]/, (m) => m.toLowerCase())}`;
      }

      const friction: SignalFriction = {
        what_is_hard: whatIsHard,
        why_it_is_hard: whyHard,
        tradeoff,
        current_state_link: csLink,
        implication: fricImp || `Without naming this constraint, ${whatIsHard.replace(/[.!?]+$/, "")} compounds.`,
        conversation_move: fricMove,
        validation_question: fricQ,
      };

      cleaned.push({
        rank: 1, // re-ranked below after verified-first sort
        signal,
        signal_type: type,
        source_type: source,
        confidence,
        why_it_matters: whyMatters,
        why_now: whyNow,
        why_this_company: whyCo,
        business_pressure: pressure,
        customer_behavior_implication: cxImp,
        marketing_motion_implication: motionImp,
        future_state_implication: futureImp,
        strategic_tension: tension,
        conversation_move: move,
        validation_question: validation,
        change_vector,
        reference,
        friction,
        business_impact: impact,
        conversation_angle: angle,
      });
    }

    // REFERENCE-HIERARCHY stable sort: web > account > library > market > inference.
    // This subsumes the earlier verified-first sort (web/account/library are
    // the verifiable tiers) AND adds market reports as a defensible
    // mid-tier above pure inference. Within each tier, preserve the
    // model's ordering (it already considered impact / tension).
    const refRank: Record<ReferenceType, number> = {
      web: 0,
      account: 1,
      library: 2,
      market: 3,
      inference: 4,
    };
    cleaned.sort((a, b) => refRank[a.reference.reference_type] - refRank[b.reference.reference_type]);
    cleaned.forEach((s, idx) => {
      s.rank = ((idx + 1) as 1 | 2 | 3);
    });
    return cleaned;

  } catch (e) {
    console.warn(
      "[currentStateIntelligence] signal prioritization failed:",
      (e as Error).message,
    );
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Commercial Insight (Challenger reframe) layer ─────────────────

const COMMERCIAL_INSIGHT_SCHEMA_HINT = `
Return STRICT JSON in this exact shape:
{
  "insights": [
    {
      "insight": "ONE sharp sentence that REFRAMES how this company should think about their own business. Not an idea, not an angle, not a tactic — a new mental model. The customer should read it and think: 'I hadn't framed it that way before.'",
      "current_state": "1 sentence: how this company (and most of the category) thinks about it today — the prevailing assumption.",
      "shift": "1 sentence: what is changing in the market / customer behavior / operating model / technology that makes the old assumption break.",
      "problem": "1 sentence: what concretely BREAKS or gets left on the table if they keep operating on the old assumption.",
      "implication": "1 sentence: the business impact of the reframe — revenue, growth, margin, retention, risk. Quantified or directional, not vague.",
      "tension": "1 sentence: the specific assumption Corey should directly challenge in conversation.",
      "why_anything": "1 sentence: what is structurally wrong / misaligned / the gap that exists for THIS company. Names the broken or flawed assumption — not a generic 'companies should...'.",
      "why_now": "1 sentence: what is changing right now / what pressure is increasing / what makes this urgent THIS quarter — not 'in the future'.",
      "why_you": "1 sentence: why OUR company / capability matters here — what we specifically enable that closes the gap. Speak as the seller. No marketing language; name the concrete capability.",
      "ai_impact": {
        "makes_easier": "1 sentence: how AI lowers the cost / unlocks the shift / accelerates the move for this company specifically.",
        "makes_harder": "1 sentence: how AI raises the bar / creates new pressure / makes the old way more dangerous for this company specifically."
      },
      "risk": "1 sentence: what happens if they don't change — what they are likely missing or misinterpreting. Concrete consequence, not vague 'they may fall behind'.",
      "conversation_entry": "1-2 sentences in first-person spoken voice. MUST start with shape 'I'd lead here because…' or 'The reason I'd start here is…'. No headings. This is what Corey actually says.",
      "conversation_move": "1 sentence in first-person, MUST start with 'I'd lead by…' or 'I'd push on…'. The concrete move Corey makes in the conversation.",
      "validation_question": "1 sentence: the validation question Corey asks the customer to test the reframe. Plain spoken language, MUST read like 'The question I'd ask is…' (the verbatim phrase is fine).",
      "source_type": "account | library | web | inference",
      "confidence": "high | medium | low",
      "built_on_signal_ranks": [1, 2]
    }
  ]
}

Hard rules:
- 1 or 2 insights MAX. Prefer 1 strong reframe over 2 mediocre ones.
- An insight is NOT an idea, an angle, a play, a tactic, or a recommendation. It is a REFRAME of how the customer should understand their own business.
- The insight must be specific to THIS company — not "retailers should…", not "loyalty programs should…".
- The insight must EXPOSE a hidden problem or inefficiency, OR introduce a new mental model.
- 3 WHY narrative is NON-NEGOTIABLE: every insight must include why_anything (what is broken), why_now (what is changing), why_you (why our solution matters). All three must be filled, all three must be company-specific.
- AI IMPACT is NON-NEGOTIABLE: every insight must include both makes_easier and makes_harder, framed for THIS company. Do not produce generic "AI will change everything" platitudes.
- RISK is NON-NEGOTIABLE: every insight must name what concretely happens if they don't act. Used to create urgency in conversation.
- The conversation_entry, conversation_move, and validation_question are ALL required — Corey must walk out of the call with an opener, a move, and a question. Spoken-voice only.
- Build each insight on top of the verified signals + prioritized signals provided. If you must use pure inference, set source_type="inference" and confidence="low".
- Do NOT produce generic lifecycle / marketing categories.
- Do NOT include text outside the JSON object.`;

interface GeneratedCommercialInsights {
  insights: CommercialInsight[];
}

async function generateCommercialInsights(args: {
  entityName: string;
  resolvedAccount: CurrentStateResult["resolvedAccount"];
  userContent: string;
  hypotheses: GeneratedHypotheses | null;
  verifiedSignals: VerifiedSignal[];
  prioritizedSignals: PrioritizedSignal[];
  webResearched: boolean;
}): Promise<CommercialInsight[]> {
  const key = (globalThis as any).Deno?.env?.get?.("LOVABLE_API_KEY");
  if (!key) return [];

  const acctSeed = args.resolvedAccount
    ? `\nKnown CRM facts about ${args.resolvedAccount.name}:\n` +
      `- Website: ${args.resolvedAccount.website ?? "unknown"}\n` +
      `- Industry: ${args.resolvedAccount.industry ?? "unknown"}\n` +
      (args.resolvedAccount.notes
        ? `- CRM note: ${args.resolvedAccount.notes.slice(0, 400)}\n`
        : "")
    : "";

  const verified = args.verifiedSignals || [];
  const verifiedBlock = verified.length
    ? `\nVERIFIED SIGNALS (real-world, source-tagged — anchor insights here when possible):\n` +
      verified.map((s, i) =>
        `${i + 1}. [${s.source}·${s.confidence}${s.kind ? `·${s.kind}` : ""}] ${s.signal}` +
        (s.source_url ? ` (${s.source_url})` : "")
      ).join("\n") + "\n"
    : `\nVERIFIED SIGNALS: none gathered — insights will be inference-grade.\n`;

  const prio = args.prioritizedSignals || [];
  const prioBlock = prio.length
    ? `\nPRIORITIZED SIGNALS (already-ranked top angles — your insight should REFRAME the thinking behind these, not restate them):\n` +
      prio.map((s) =>
        `${s.rank}. [${s.signal_type}·src:${s.source_type}] ${s.signal}\n` +
        `   tension: ${s.strategic_tension}\n` +
        `   why now: ${s.why_now}`
      ).join("\n") + "\n"
    : "";

  const hyp = args.hypotheses;
  const hypBlock = hyp
    ? `\nWORKING HYPOTHESES (business-model / customer / motion):\n` +
      `- Business model: ${hyp.business_model_summary}\n` +
      `- App posture: ${hyp.app_posture}\n` +
      `- Measurement motion: ${hyp.measurement_motion}\n`
    : "";

  const sys =
    `You are a senior B2B sales strategist trained in the Challenger Sale framework. ` +
    `Your job is to produce 1–2 COMMERCIAL INSIGHTS — reframes that change how the ` +
    `customer thinks about their own business. You do NOT produce ideas, angles, ` +
    `or tactics. You produce a new mental model the customer hasn't framed for ` +
    `themselves yet. You expose hidden problems, challenge assumptions, and create ` +
    `constructive tension. ` +
    `SOURCE HIERARCHY: build the insight from (1) verified signals, (2) industry ` +
    `shifts, (3) the company's business model, (4) customer behavior — in that order. ` +
    `If the basis is pure inference, mark it as such — never pretend it's sourced.`;

  const user =
    `Account in focus: ${args.entityName}` +
    acctSeed +
    verifiedBlock +
    prioBlock +
    hypBlock +
    `\nWeb research available this turn: ${args.webResearched ? "yes" : "no"}` +
    `\n\nThe rep's prompt:\n"""${args.userContent.slice(0, 1200)}"""\n\n` +
    COMMERCIAL_INSIGHT_SCHEMA_HINT;

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
        `[currentStateIntelligence] commercial insights http ${resp.status}`,
      );
      return [];
    }
    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || "";
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GeneratedCommercialInsights;
    if (!parsed || !Array.isArray(parsed.insights)) return [];

    const allowedSources: SignalSourceType[] = ["account", "library", "web", "inference"];
    const allowedConfidences: ConfidenceLevel[] = ["high", "medium", "low"];

    const haveAccount = !!args.resolvedAccount;
    const verifiedWeb = verified.filter((v) => v.source === "web");
    const verifiedLib = verified.filter((v) => v.source === "library" || v.source === "resource");
    const haveWeb = !!args.webResearched && verifiedWeb.length > 0;
    const haveLibrary = verifiedLib.length > 0;

    const cleaned: CommercialInsight[] = [];
    for (let i = 0; i < parsed.insights.length && cleaned.length < 2; i++) {
      const r: any = parsed.insights[i];
      if (!r || typeof r !== "object") continue;

      const insight = String(r.insight || "").trim();
      const current_state = String(r.current_state || "").trim();
      const shift = String(r.shift || "").trim();
      const problem = String(r.problem || "").trim();
      const implication = String(r.implication || "").trim();
      const tension = String(r.tension || "").trim();
      const conversation_entry = String(r.conversation_entry || "").trim();
      const questionRaw = String(r.question || "").trim();
      // ── 3 WHY layer ──
      const why_anything = String(r.why_anything || "").trim();
      const why_now = String(r.why_now || "").trim();
      const why_you = String(r.why_you || "").trim();
      // ── AI Impact ──
      const aiImpactRaw: any = r.ai_impact && typeof r.ai_impact === "object" ? r.ai_impact : {};
      const ai_makes_easier = String(aiImpactRaw.makes_easier || "").trim();
      const ai_makes_harder = String(aiImpactRaw.makes_harder || "").trim();
      // ── Risk ──
      const risk = String(r.risk || "").trim();
      // ── Conversation move + validation question ──
      let conversation_move = String(r.conversation_move || "").trim();
      let validation_question = String(r.validation_question || questionRaw || "").trim();
      const question = questionRaw || validation_question;

      // All fields required — drop incomplete insights so we never ship a half-formed reframe.
      if (
        !insight || !current_state || !shift || !problem ||
        !implication || !tension || !conversation_entry ||
        !why_anything || !why_now || !why_you ||
        !ai_makes_easier || !ai_makes_harder ||
        !risk || !validation_question
      ) continue;

      // Force first-person spoken-voice shape on the conversation move
      // and validation question so the response can drop them in verbatim.
      const SOLUTION_OPENER = /^(use|build|implement|launch|leverage|deploy|create|introduce|roll\s*out|stand\s*up|set\s*up|adopt)\b/i;
      if (!conversation_move || SOLUTION_OPENER.test(conversation_move)) {
        conversation_move = `I'd lead here by surfacing the tension: ${tension.replace(/[.!?]+$/, "")}`;
      }
      if (!/^the question i['']?d ask is/i.test(validation_question)) {
        validation_question = `The question I'd ask is: ${validation_question.replace(/^[\s"'(]+/, "")}`;
      }

      let source_type: SignalSourceType = allowedSources.includes(r.source_type)
        ? (r.source_type as SignalSourceType)
        : "inference";
      // Trust-down: never let inference upgrade itself.
      if (source_type === "account" && !haveAccount) source_type = "inference";
      if (source_type === "web" && !haveWeb) source_type = "inference";
      if (source_type === "library" && !haveLibrary) source_type = "inference";

      let confidence: ConfidenceLevel = allowedConfidences.includes(r.confidence)
        ? (r.confidence as ConfidenceLevel)
        : "low";
      if (source_type === "inference" && confidence === "high") confidence = "medium";

      const built_on_signal_ranks = Array.isArray(r.built_on_signal_ranks)
        ? r.built_on_signal_ranks
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isFinite(n) && n >= 1 && n <= 3)
        : undefined;

      cleaned.push({
        insight,
        current_state,
        shift,
        problem,
        implication,
        tension,
        why_anything,
        why_now,
        why_you,
        ai_impact: {
          makes_easier: ai_makes_easier,
          makes_harder: ai_makes_harder,
        },
        risk,
        conversation_entry,
        conversation_move,
        question,
        validation_question,
        source_type,
        confidence,
        built_on_signal_ranks,
      });
    }
    return cleaned;
  } catch (e) {
    console.warn(
      "[currentStateIntelligence] commercial insights failed:",
      (e as Error).message,
    );
    return [];
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
  verifiedSignals?: VerifiedSignal[];
}): CurrentStateIntelligence {
  const { entityName, resolvedAccount, webResearched, hypotheses } = args;
  const verifiedSignals = args.verifiedSignals || [];

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

  // Promote verified signals (web/library/resource) into sourced_facts
  // so downstream consumers (citation audits, prompt facts list) treat
  // them as first-class evidence rather than hypotheses.
  for (const v of verifiedSignals) {
    if (v.source === "inference") continue;
    sourcedFacts.push({
      claim: v.signal,
      source_url: v.source_url,
      source_title: v.source_title,
      confidence: v.confidence,
    });
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
        "Exact revenue mix (DTC vs app vs partner channels)",
        "Mobile app's role in revenue (acquisition / retention / transaction core)",
        "Sub-entity / business-unit structure that drives Branch footprint",
      ],
    },
    customer_experience: {
      what_it_is_like_to_be_a_customer: fb(
        `the end-to-end customer journey for ${entityName} crosses web → app → re-engagement surfaces; the specifics of how deep linking, deferred deep linking, and post-install attribution actually work should be confirmed.`,
      ),
      confidence: sectionConfidence,
      unknowns: [
        "Logged-in / app vs anonymous browsing share",
        "Web-to-app handoff quality (deferred deep linking on/off)",
        "Post-install / post-purchase comms cadence on app surfaces",
      ],
    },
    marketing_motion: {
      confidence: sectionConfidence,
      unknowns: [
        "Paid acquisition channel mix (Universal Ads candidate?)",
        "Email-to-App / SMS-to-App instrumentation today",
        "QR / out-of-home routing to the app",
      ],
    },
    strategic_priorities: {
      confidence: sectionConfidence,
      unknowns: [
        "Public investment signals (earnings, hires, app launches, M&A)",
        "Mobile / growth / measurement leadership changes",
        "Stated investments in attribution, privacy posture (AIO), or app monetization",
      ],
    },
    app_posture: {
      mobile_app_strategy: hypotheses?.app_posture
        || fb(`${entityName}'s mobile app sits inside their growth motion in a way that should be confirmed — its role in acquisition, retention, and transaction is the first thing to pin down.`),
      deep_linking_maturity: fb(
        `deep linking coverage is partial — owned surfaces (email, SMS, web) likely route inconsistently into the app; deferred deep linking on first-install paths should be confirmed.`,
      ),
      web_to_app_setup: fb(
        `web-to-app is either un-instrumented or relies on a default store handoff; Branch Web-to-App is a likely whitespace.`,
      ),
      deferred_deep_linking: fb(
        `deferred deep linking on paid + owned install paths should be confirmed — common gap that compounds attribution loss and post-install drop-off.`,
      ),
      confidence: sectionConfidence,
      unknowns: [
        "Which Branch products are live today vs not",
        "Deep linking coverage across email / SMS / web / paid",
        "Deferred deep linking on first-install funnels",
        "Universal Ads / Email-to-App / SMS-to-App adoption",
      ],
    },
    measurement_motion: {
      current_mmp: fb(
        `their MMP today is most likely Adjust or AppsFlyer; Kochava or Singular are less likely but possible. Confirm in discovery.`,
      ),
      adjust_appsflyer_setup: fb(
        `the install + post-install attribution setup is standard MMP shape — paid network postbacks, organic install split, basic in-app event tracking; the gaps usually show up on web-to-app, sub-entity reporting, and Advanced Privacy / AIO posture.`,
      ),
      attribution_gaps: hypotheses?.measurement_motion
        || fb(`attribution gaps most likely concentrate on web-to-app, post-install retargeting, sub-entity rollups, and the AIO / privacy boundary.`),
      mmp_consolidation_risk: fb(
        `with renewal cycles tightening and Branch's MMP capability maturing, there is real consolidation pressure on Adjust / AppsFlyer where Branch already owns the deep linking layer.`,
      ),
      confidence: sectionConfidence,
      unknowns: [
        "Which MMP is on contract today (Adjust, AppsFlyer, Kochava, Singular, self-built)",
        "Renewal window and incumbent satisfaction",
        "Where attribution accuracy is being questioned internally",
        "Sub-entity / business-unit attribution requirements",
      ],
    },
    branch_expansion_map: {
      deep_linking_whitespace: fb(
        `deep linking is the wedge — every Branch product downstream (Universal Ads, Web-to-App, Email-to-App, SMS-to-App, AIO) depends on it being instrumented properly.`,
      ),
      universal_ads_whitespace: fb(
        `Universal Ads is whitespace for accounts with material paid mobile spend that aren't already routing through Branch's ad network coverage.`,
      ),
      web_to_app_whitespace: fb(
        `Web-to-App is whitespace when their owned web traffic is sizable but the app handoff is the default store flow — material conversion-funnel uplift sits here.`,
      ),
      email_sms_whitespace: fb(
        `Email-to-App / SMS-to-App is whitespace when they run owned CRM but their deep links into the app are unreliable across iOS/Android updates.`,
      ),
      advanced_products_whitespace: fb(
        `Advanced Privacy / AIO and QR-driven journeys are whitespace as iOS/Android privacy posture tightens and offline-to-app becomes a measurable surface.`,
      ),
    },
    current_state_thesis: {
      summary: hypotheses?.thesis_summary
        || fb(`${entityName} sits in the middle of the Branch surface area — some products live, real whitespace on the rest; the working thesis should be sharpened against the QBR usage signal.`),
      likely_gap: hypotheses?.likely_gap
        || fb(`there is a gap between current Branch footprint and the products their peers in this vertical have already adopted — expansion-ARR lives in that gap.`),
      why_now: hypotheses?.why_now
        || fb(`renewal cadence, QBR rhythm, and competitive pressure from Adjust / AppsFlyer make this conversation timely.`),
      strategic_tension: hypotheses?.strategic_tension
        || fb(`their current measurement setup most likely covers the basics but misses the surfaces (web-to-app, sub-entity, AIO) where revenue actually leaks.`),
      future_state_hypothesis: hypotheses?.future_state_hypothesis
        || fb(`the company is moving toward a consolidated measurement + deep linking stack where Branch can own more of the surface area as MMPs get re-evaluated.`),
    },
    discovery_questions: {
      must_confirm: [
        "Which Branch products are currently live at this account — deep linking, Universal Ads, Web-to-App, Email-to-App?",
        "Who is their current MMP — Adjust, AppsFlyer, Kochava, or Singular?",
        "What does their mobile measurement setup look like today — app installs, retargeting, deferred deep linking?",
      ],
      high_leverage: [
        "Where are they seeing attribution gaps or inaccuracies today?",
        "What's driving the QBR conversation — usage up, down, or flat?",
        "Where is the whitespace — which Branch products aren't live that their peers are using?",
        "Is there any internal build-vs-buy discussion on attribution or deep linking?",
      ],
    },
    evidence: {
      sourced_facts: sourcedFacts,
      inferred_claims: hypotheses
        ? [
          { claim: hypotheses.business_model_summary, basis: "model reasoning from public knowledge", confidence: "low" },
          { claim: hypotheses.app_posture, basis: "model reasoning about mobile app + deep linking posture", confidence: "low" },
          { claim: hypotheses.measurement_motion, basis: "model reasoning about MMP / attribution setup", confidence: "low" },
        ]
        : [],
    },
    verified_signals: verifiedSignals,
    prioritized_signals: [],
    commercial_insights: [],
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
  const ap = intelligence.app_posture;
  const mp = intelligence.measurement_motion;
  const bx = intelligence.branch_expansion_map;

  const signals = intelligence.prioritized_signals || [];
  const signalsBlock = signals.length
    ? signals.map((s) => {
      const cv = s.change_vector;
      const cvLines = cv
        ? `\n   Change vector (X→Y→Z):\n` +
          `     X (before · ${cv.before_basis}): ${cv.before}\n` +
          `     Y (now · ${cv.now_basis}):       ${cv.now}\n` +
          `     Z (next · ${cv.next_basis}):     ${cv.next}\n` +
          `     What changed:        ${cv.what_changed}\n` +
          `     Why it matters:      ${cv.why_it_matters}\n` +
          `     What breaks:         ${cv.what_breaks}\n` +
          `     Opportunity:         ${cv.opportunity}`
        : "";
      return `${s.rank}. [${s.signal_type} · source:${s.source_type} · confidence:${s.confidence}] ${s.signal}\n` +
        `   Why it matters:        ${s.why_it_matters}\n` +
        `   Why now:               ${s.why_now}\n` +
        `   Why this company:      ${s.why_this_company}\n` +
        `   Business pressure:     ${s.business_pressure}\n` +
        `   Customer behavior:     ${s.customer_behavior_implication}\n` +
        `   Marketing motion:      ${s.marketing_motion_implication}\n` +
        `   Future-state implied:  ${s.future_state_implication}\n` +
        `   Strategic tension:     ${s.strategic_tension}\n` +
        `   Conversation move:     ${s.conversation_move}\n` +
        `   Validation question:   ${s.validation_question}` +
        cvLines +
        `\n   Reference (anchor — express IN PROSE per confidence rules below; do NOT dump as a citation):\n` +
        `     type:       ${s.reference.reference_type}\n` +
        `     source:     ${s.reference.reference_source}` +
        (s.reference.reference_url ? `\n     url:        ${s.reference.reference_url}` : "") +
        (s.reference.reference_excerpt ? `\n     excerpt:    ${s.reference.reference_excerpt}` : "") +
        `\n     confidence: ${s.reference.confidence}` +
        (s.friction
          ? `\n   Friction (problem-first — OPEN THE PATH FROM THIS, NOT FROM A SOLUTION):\n` +
            `     What is hard:        ${s.friction.what_is_hard}\n` +
            `     Why it's hard:       ${s.friction.why_it_is_hard}\n` +
            `     Tradeoff:            ${s.friction.tradeoff}\n` +
            `     Current-state link:  ${s.friction.current_state_link}\n` +
            `     Implication:         ${s.friction.implication}\n` +
            `     Problem-first move:  ${s.friction.conversation_move}\n` +
            `     Validation question: ${s.friction.validation_question}`
          : "");
    }).join("\n\n")
    : "(prioritization pass produced no signals — fall back to the working hypotheses above, but still pick the 2-3 highest-leverage angles yourself before responding, and explain the why behind each.)";

  // VERIFIED-FIRST block: list real-world signals tagged with source +
  // confidence. Hypotheses come AFTER and are clearly framed as
  // gap-fillers. The prose contract below tells the model to LEAD with
  // verified signals when they exist.
  const verifiedSigs = (intelligence.verified_signals || []);
  const verifiedCount = verifiedSigs.filter((v) => v.source !== "inference").length;
  const inferredCount = verifiedSigs.length - verifiedCount;
  const verifiedBlock = verifiedSigs.length
    ? verifiedSigs.map((v, i) =>
      `${i + 1}. [source:${v.source} · confidence:${v.confidence}${v.kind ? ` · ${v.kind}` : ""}] ${v.signal}` +
      (v.source_url ? `\n   Source: ${v.source_title || v.source_url} (${v.source_url})` : "")
    ).join("\n")
    : "(no verified real-world signals gathered this turn — proceed with hypotheses, framed clearly as assumptions)";

  // COMMERCIAL INSIGHT (Challenger reframe) block — when present, this
  // is the single most important block on the page: the response MUST
  // open from the insight, not from a list of ideas.
  const insights = intelligence.commercial_insights || [];
  const insightsBlock = insights.length
    ? insights.map((ins, i) =>
      `${i + 1}. [src:${ins.source_type} · conf:${ins.confidence}${ins.built_on_signal_ranks?.length ? ` · built on signal #${ins.built_on_signal_ranks.join(",")}` : ""}]\n` +
      `   Insight (the reframe):     ${ins.insight}\n` +
      `   How they think today:      ${ins.current_state}\n` +
      `   What is shifting:          ${ins.shift}\n` +
      `   What breaks:               ${ins.problem}\n` +
      `   Business implication:      ${ins.implication}\n` +
      `   Tension to challenge:      ${ins.tension}\n` +
      `   ── 3 WHY ──\n` +
      `   Why anything (broken):     ${ins.why_anything}\n` +
      `   Why now (urgency):         ${ins.why_now}\n` +
      `   Why you (our edge):        ${ins.why_you}\n` +
      `   ── AI Impact ──\n` +
      `   AI makes this easier:      ${ins.ai_impact?.makes_easier ?? ""}\n` +
      `   AI makes this harder:      ${ins.ai_impact?.makes_harder ?? ""}\n` +
      `   ── Risk ──\n` +
      `   If they don't change:      ${ins.risk}\n` +
      `   ── Conversation execution ──\n` +
      `   Conversation entry:        ${ins.conversation_entry}\n` +
      `   Conversation move:         ${ins.conversation_move}\n` +
      `   Validation question:       ${ins.validation_question || ins.question}`
    ).join("\n\n")
    : "(no commercial insight generated — fall back to leading with the top prioritized signal as the conversation entry, but still open with a POV, not a list)";

  return `═══ UNIFIED STRATEGY PIPELINE (verified → change → prioritized → why → friction → conversation) ═══
Pipeline contract for THIS turn (do not skip a step, do not reorder):
  1. Entity detection                         ✓ done
  2. Verified signal gathering (web/account/library)  ✓ see VERIFIED SIGNALS below
  3. Change vector construction (X → Y → Z)   ✓ embedded in each PRIORITIZED SIGNAL
  4. Hypothesis generation (gap-fill only)    ✓ see WORKING HYPOTHESES (use sparingly)
  5. Signal prioritization (top 2–3)          ✓ see PRIORITIZED SIGNALS
  6. Strategic why (matters / now / company)  ✓ embedded in each PRIORITIZED SIGNAL
  7. Friction layer (what is HARD)            ✓ embedded in each PRIORITIZED SIGNAL — open every path from this
  8. Conversation execution (what Corey SAYS) ← YOUR JOB IN THE RESPONSE BELOW (open from FRICTION, not from a solution)

═══ CURRENT STATE INTELLIGENCE (verified-first — lead with what we can verify, extend with what we hypothesize) ═══
Company: ${c.name}${c.website ? ` (${c.website})` : ""}
Account context state: ${stateLabel}
Company confidence: ${c.confidence}
Web research available this turn: ${webAvailable ? "yes" : "no"}

═══ VERIFIED SIGNALS (real-world, source-tagged — PREFER THESE OVER HYPOTHESES) ═══
${verifiedBlock}

WORKING HYPOTHESES ABOUT ${c.name.toUpperCase()} (used ONLY to extend or fill gaps where verified signals are absent — speak in "likely" voice when reflecting them):
- Business model: ${bm}
- App posture: ${ap.mobile_app_strategy}
  · Deep linking maturity: ${ap.deep_linking_maturity}
  · Web-to-App setup:      ${ap.web_to_app_setup}
  · Deferred deep linking: ${ap.deferred_deep_linking}
- Measurement motion:
  · Current MMP (likely):       ${mp.current_mmp}
  · Adjust/AppsFlyer setup:     ${mp.adjust_appsflyer_setup}
  · Attribution gaps:           ${mp.attribution_gaps}
  · MMP consolidation risk:     ${mp.mmp_consolidation_risk}
- Branch expansion map (whitespace by product):
  · Deep linking:       ${bx.deep_linking_whitespace}
  · Universal Ads:      ${bx.universal_ads_whitespace}
  · Web-to-App:         ${bx.web_to_app_whitespace}
  · Email-to-App / SMS: ${bx.email_sms_whitespace}
  · Advanced products:  ${bx.advanced_products_whitespace}
- Strategic tension: ${t.strategic_tension}
- Likely gap (current footprint → future footprint): ${t.likely_gap}
- Why now: ${t.why_now}
- Future-state hypothesis: ${t.future_state_hypothesis}
- Working thesis: ${t.summary}

KNOWN FACTS (sourced — CRM + verified signals promoted):
${facts || "- (none in CRM/library — reason from public knowledge of this company)"}

═══ COMMERCIAL INSIGHT — CHALLENGER REFRAME (TOP ${insights.length || "1-2"} — OPEN YOUR RESPONSE FROM THE INSIGHT, NOT FROM A LIST) ═══
${insightsBlock}

═══ PRIORITIZED SIGNALS + STRATEGIC WHY (TOP ${signals.length || "2-3"} — these EXTEND the insight; do not let them replace it) ═══
${signalsBlock}
═══════════════════════════════════════════════════════════════════════

MUST-CONFIRM DISCOVERY QUESTIONS:
${mustConfirm}

═══ AUTHORITY RULE (single source of truth for THIS turn) ═══
Use the reasoning layers above (verified signals, current state, change vector, commercial insight, strategic why, friction, AI impact, risk) INTERNALLY to think.
Return ONLY the sharpest conversation strategy — what Corey should say or ask.

Internal thinking order:
  1. Grounding   — what do we know or have evidence for?
  2. Change      — what is changing in their business/market?
  3. Insight     — what is the non-obvious reframe?
  4. Friction    — what is hard or risky about this?
  5. Move        — what should Corey say or ask?

Only #5 dominates the visible answer.

═══ VISIBLE OUTPUT SHAPE (style, not template) ═══
- 1 primary conversation path. Optional 1 backup path only if materially different.
- Each path ≤ 180 words.
- Natural prose in Corey's first-person voice. No headings, no labeled idea blocks, no category buckets (Acquisition / Retention / Lifecycle / Personalization / Loyalty), no recommendation lists to the company, no rigid required phrase template.
- Anchor in specific current-state or verified-signal facts about ${c.name}. Express change as direction of travel where it sharpens the point. End with the question Corey would ask. Never dump URLs or citation labels in the body.
- Desired feel (style, do not copy verbatim): "I wouldn't lead with [the obvious]. The thing I'd focus on is that ${c.name} appears to be moving from X to Y. That creates a harder problem: [friction]. The reframe is [insight]. So I'd lead by [move]. The question I'd ask is: [validation question]."

═══ SINGLE GATE — run silently before sending; rewrite once if it fails ═══
Does the answer:
  1. reference specific current state or a verified signal for ${c.name}?
  2. describe what is changing?
  3. articulate a commercial insight or a friction (a real problem, not a category)?
  4. tell Corey what to say or ask?
  5. avoid generic marketing advice (micro-moments, customer engagement, personalized journey, segmentation, loyalty, lifecycle marketing, brand storytelling) UNLESS each phrase is tied to a verified company-specific change or friction?
If any check fails → rewrite once. Do not narrate the check.
═══════════════════════════════════
[Reasoning layers available — verified=${verifiedCount}, inferred=${inferredCount} · commercial_insights=${insights.length} · friction_paths=${signals.filter((s)=>!!s.friction).length}]`;
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

  // VERIFIED-FIRST: gather real-world signals BEFORE generating any
  // hypotheses. When web research is wired (Perplexity), tag signals
  // as source:"web". Otherwise fall back to model recall tagged as
  // source:"inference" (so they never masquerade as web-sourced).
  // Failure is non-fatal — pipeline degrades to pure hypothesis mode.
  const verifiedSignals = await gatherVerifiedSignals({
    entityName: entity.name,
    resolvedAccount,
    webCapabilityAvailable: webResearched,
  });

  // Generate REAL hypotheses (not placeholder scaffolding) before the
  // main model runs. Verified signals are passed in so hypotheses
  // build ON TOP of them rather than being generated in a vacuum.
  // Failure is non-fatal — we fall back to hedged prose, never to
  // "[Likely]" tokens.
  const hypotheses = await generateRealHypotheses({
    entityName: entity.name,
    resolvedAccount,
    userContent: args.userContent || "",
    verifiedSignals,
  });

  const intelligence = buildSkeletonIntelligence({
    entityName: entity.name,
    resolvedAccount,
    webResearched,
    hypotheses,
    verifiedSignals,
  });

  // Signal prioritization pass — ranks the top 2-3 highest-leverage
  // signals. Verified signals always outrank inferred ones (enforced
  // by stable verified-first sort inside generatePrioritizedSignals).
  // Failure is non-fatal — promptBlock falls back gracefully.
  const prioritizedSignals = await generatePrioritizedSignals({
    entityName: entity.name,
    resolvedAccount,
    userContent: args.userContent || "",
    hypotheses,
    sourcedFacts: intelligence.evidence.sourced_facts,
    verifiedSignals,
    webResearched,
  });
  intelligence.prioritized_signals = prioritizedSignals;

  // Commercial Insight (Challenger reframe) layer — runs AFTER
  // verified signals + prioritized signals so the insight is grounded
  // in real-world evidence and the already-ranked angles. Failure is
  // non-fatal — promptBlock falls back to signals only.
  const commercialInsights = await generateCommercialInsights({
    entityName: entity.name,
    resolvedAccount,
    userContent: args.userContent || "",
    hypotheses,
    verifiedSignals,
    prioritizedSignals,
    webResearched,
  });
  intelligence.commercial_insights = commercialInsights;

  const promptBlock = renderPromptBlock(
    intelligence,
    accountContextState,
    webResearched,
  );

  const verifiedSignalsCount = verifiedSignals.filter((v) => v.source !== "inference").length;
  const inferredSignalsCount = verifiedSignals.length - verifiedSignalsCount;
  const verifiedFirstApplied = verifiedSignalsCount > 0;
  const verifiedTopRanks = prioritizedSignals.filter(
    (p) => p.source_type !== "inference",
  ).length;

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
    // ── Verified-first telemetry ──────────────────────────────────
    verified_signals_count: verifiedSignalsCount,
    inferred_signals_count: inferredSignalsCount,
    verified_first_applied: verifiedFirstApplied,
    verified_signal_sources: verifiedSignals.map((v) => v.source),
    verified_signal_kinds: verifiedSignals.map((v) => v.kind || "unknown"),
    prioritized_signals_count: prioritizedSignals.length,
    prioritized_signal_types: prioritizedSignals.map((s) => s.signal_type),
    prioritized_signal_sources: prioritizedSignals.map((s) => s.source_type),
    prioritized_verified_top_count: verifiedTopRanks,
    // ── Change Vector (X → Y → Z) telemetry ───────────────────────
    change_vectors_count: prioritizedSignals.filter((s) => !!s.change_vector).length,
    change_vectors_y_verified_count: prioritizedSignals.filter(
      (s) => s.change_vector?.now_basis === "verified",
    ).length,
    change_vectors_y_inferred_count: prioritizedSignals.filter(
      (s) => s.change_vector?.now_basis === "inferred",
    ).length,
    // ── Reference Anchor telemetry ────────────────────────────────
    reference_types: prioritizedSignals.map((s) => s.reference?.reference_type ?? "missing"),
    reference_confidences: prioritizedSignals.map((s) => s.reference?.confidence ?? "missing"),
    reference_grounded_count: prioritizedSignals.filter(
      (s) => s.reference && s.reference.reference_type !== "inference",
    ).length,
    reference_with_url_count: prioritizedSignals.filter(
      (s) => !!s.reference?.reference_url,
    ).length,
    // ── Friction Layer (problem-first) telemetry ──────────────────
    friction_layer_applied: prioritizedSignals.every((s) => !!s.friction),
    friction_signals_count: prioritizedSignals.filter((s) => !!s.friction).length,
    friction_problem_first_moves: prioritizedSignals
      .map((s) => s.friction?.conversation_move ?? "")
      .filter(Boolean),
    // ── Commercial Insight (Challenger) telemetry ─────────────────
    commercial_insights_count: commercialInsights.length,
    commercial_insights_sources: commercialInsights.map((c) => c.source_type),
    commercial_insights_verified_count: commercialInsights.filter(
      (c) => c.source_type !== "inference",
    ).length,
    // ── 3 WHY + AI Impact + Risk telemetry ────────────────────────
    commercial_insights_three_why_complete_count: commercialInsights.filter(
      (c) => !!c.why_anything && !!c.why_now && !!c.why_you,
    ).length,
    commercial_insights_ai_impact_complete_count: commercialInsights.filter(
      (c) => !!c.ai_impact?.makes_easier && !!c.ai_impact?.makes_harder,
    ).length,
    commercial_insights_risk_complete_count: commercialInsights.filter(
      (c) => !!c.risk,
    ).length,
    commercial_insights_full_challenger_narrative_count: commercialInsights.filter(
      (c) =>
        !!c.why_anything && !!c.why_now && !!c.why_you &&
        !!c.ai_impact?.makes_easier && !!c.ai_impact?.makes_harder &&
        !!c.risk && !!c.conversation_move && !!c.validation_question,
    ).length,
    challenger_layer_applied: commercialInsights.length > 0 && commercialInsights.every(
      (c) =>
        !!c.why_anything && !!c.why_now && !!c.why_you &&
        !!c.ai_impact?.makes_easier && !!c.ai_impact?.makes_harder &&
        !!c.risk,
    ),
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
