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

  // Back-compat from the earlier Prioritization layer (kept so the
  // conversation-mode digest and any prior consumers don't break):
  business_impact: string;            // 1-line revenue/growth/risk implication
  conversation_angle: string;         // Spoken-language opener
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
      `- Customer experience: ${hyp.customer_experience}\n` +
      `- Marketing motion: ${hyp.marketing_motion}\n` +
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
        business_impact: impact,
        conversation_angle: angle,
      });
    }

    // VERIFIED-FIRST stable sort: any signal with a verifiable
    // source_type (account / library / web) outranks inference,
    // regardless of model-assigned rank. Within each tier, preserve
    // the model's ordering (it already considered impact / tension).
    const verifiedFirst = (s: PrioritizedSignal) => s.source_type !== "inference" ? 0 : 1;
    cleaned.sort((a, b) => verifiedFirst(a) - verifiedFirst(b));
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
    prioritized_signals: [],
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

  const signals = intelligence.prioritized_signals || [];
  const signalsBlock = signals.length
    ? signals.map((s) =>
      `${s.rank}. [${s.signal_type} · source:${s.source_type} · confidence:${s.confidence}] ${s.signal}\n` +
      `   Why it matters:        ${s.why_it_matters}\n` +
      `   Why now:               ${s.why_now}\n` +
      `   Why this company:      ${s.why_this_company}\n` +
      `   Business pressure:     ${s.business_pressure}\n` +
      `   Customer behavior:     ${s.customer_behavior_implication}\n` +
      `   Marketing motion:      ${s.marketing_motion_implication}\n` +
      `   Future-state implied:  ${s.future_state_implication}\n` +
      `   Strategic tension:     ${s.strategic_tension}\n` +
      `   Conversation move:     ${s.conversation_move}\n` +
      `   Validation question:   ${s.validation_question}`
    ).join("\n\n")
    : "(prioritization pass produced no signals — fall back to the working hypotheses above, but still pick the 2-3 highest-leverage angles yourself before responding, and explain the why behind each.)";

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

═══ PRIORITIZED SIGNALS + STRATEGIC WHY (TOP ${signals.length || "2-3"} — DRIVE YOUR RESPONSE FROM THESE) ═══
${signalsBlock}
═══════════════════════════════════════════════════════════════════════

MUST-CONFIRM DISCOVERY QUESTIONS:
${mustConfirm}

GENERATION RULES FOR THIS TURN — NON-NEGOTIABLE:
- Your response MUST originate from the PRIORITIZED SIGNALS above. Each conversation path you produce must be traceable to one of those 2-3 ranked signals. Do not invent a fourth.
- For each path, your prose MUST make the strategic WHY visible — not as headings, but woven into the language. The reader should clearly hear: why this matters, why now, why for ${c.name} specifically, what tension to test, and what to ask. Use spoken-voice openers like "I'd lead here because…", "The reason this matters is…", "The tension I'd test is…", "The question I'd ask is…".
- Do NOT inventory everything that could matter. Surface ONLY what matters most. Fewer, sharper paths with deeper reasoning beat a long list every time.
- Each path must connect to business pressure (revenue, growth, margin, risk) AND name the customer-behavior or motion implication — not just the angle.
- Each path must include the validation question Corey would ask the customer to test the hypothesis. Plain language, the way Corey would actually ask it.
- Do NOT produce generic lifecycle / marketing / engagement categories ("Acquisition / Activation / Retention / Winback" buckets, "personalize the journey", "build a loyalty program"). The user can already produce that themselves.
- Frame ideas as conversation strategies, not capability checklists. Angles Corey can lead with, tensions to surface, hypotheses to test.
- Respect the source_type and confidence on each signal. If source_type=inference, frame it explicitly as a working hypothesis ("a reasonable assumption is…", "${c.name} likely…"). Never present an inferred signal as a sourced fact.
- Map current state → future state. Each path should imply the gap it closes for ${c.name} specifically.
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

  // Signal prioritization pass — ranks the top 2-3 highest-leverage
  // signals from hypotheses + sourced facts. This is what tells the
  // model what matters most, not everything that could matter.
  // Failure is non-fatal — promptBlock falls back gracefully.
  const prioritizedSignals = await generatePrioritizedSignals({
    entityName: entity.name,
    resolvedAccount,
    userContent: args.userContent || "",
    hypotheses,
    sourcedFacts: intelligence.evidence.sourced_facts,
    webResearched,
  });
  intelligence.prioritized_signals = prioritizedSignals;

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
    prioritized_signals_count: prioritizedSignals.length,
    prioritized_signal_types: prioritizedSignals.map((s) => s.signal_type),
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
