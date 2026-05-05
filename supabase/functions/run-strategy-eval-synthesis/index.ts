/**
 * Phase 3.5B — Strategy Evaluation Synthesis Endpoint.
 *
 * Evaluation-only: runs the full skill runtime (retrieval + gate),
 * then calls the LLM with a dedicated versioned synthesis prompt
 * to generate a REAL Strategy answer.
 *
 * Does NOT touch Discovery Prep templates, artifacts, or task pipelines.
 * Does NOT modify any production paths.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Versioned synthesis prompt ──────────────────────────────────────
export const STRATEGY_EVAL_SYNTHESIS_PROMPT_VERSION = "2.0.0";

/**
 * Detect if the output contract demands constrained prose:
 * shape=prose + forbid includes headings or bullets + short targetWords.
 */
function isConstrainedProse(
  outputContract: { shape: string; targetWords?: { min: number; max: number }; forbid?: string[] },
): boolean {
  if (outputContract.shape !== "prose") return false;
  const hasForbid = outputContract.forbid?.some(f => f === "headings" || f === "bullets");
  return !!hasForbid;
}

function buildEvalSynthesisSystemPrompt(
  inputs: Record<string, string>,
  manifest: { id: string; label: string; behaviorIntent: string; workspace: string },
  outputContract: { shape: string; targetWords?: { min: number; max: number }; forbid?: string[] },
  rubric: { mustHave: string[]; genericMarkers: string[]; maxGenericMarkers: number },
  synthesisAddendum: string,
  libraryHits: Array<{ kind: string; id: string; title: string; context?: string | null }>,
  expansionTrace: Array<{ term: string; source: string; rule: string }>,
): string {
  const sections: string[] = [];

  // ── Identity & purpose
  sections.push(`You are a Strategy synthesis engine generating a ${manifest.label} for evaluation.`);
  sections.push(`Skill: ${manifest.id} | Behavior: ${manifest.behaviorIntent} | Workspace: ${manifest.workspace}`);
  sections.push("");

  // ── Original inputs
  sections.push("=== ORIGINAL INPUTS ===");
  for (const [k, v] of Object.entries(inputs)) {
    if (v && v.trim()) sections.push(`${k}: ${v}`);
  }
  sections.push("");

  // ── Output contract
  sections.push("=== OUTPUT CONTRACT ===");
  sections.push(`Shape: ${outputContract.shape}`);
  if (outputContract.targetWords) {
    sections.push(`Target length: ${outputContract.targetWords.min}–${outputContract.targetWords.max} words`);
  }
  if (outputContract.forbid?.length) {
    sections.push(`Forbidden formatting: ${outputContract.forbid.join(", ")}`);
  }
  sections.push("");

  // ── V2: Prose density instructions for constrained prose skills
  if (isConstrainedProse(outputContract)) {
    sections.push("=== PROSE DENSITY REQUIREMENTS (V2) ===");
    sections.push("Because this skill demands constrained prose with no headings or bullets,");
    sections.push("every sentence must carry maximum business weight. Within the word limit:");
    sections.push("");
    sections.push("MANDATORY ELEMENTS (weave into flowing prose, do NOT use headings/bullets):");
    sections.push("1. BEFORE/CURRENT STATE — Name a specific, concrete current-state condition the buyer faces.");
    sections.push("2. COST-OF-INACTION — State the negative consequence of not acting: lost revenue, pipeline leakage, extended cycles, churn risk, margin erosion, or competitive exposure.");
    sections.push("3. AFTER-STATE / BUSINESS OUTCOME — Describe the measurable improvement: shorter cycles, higher conversion, increased pipeline velocity, reduced risk, or revenue uplift.");
    sections.push("4. REQUIRED CAPABILITY — Name the specific capability or behavior shift needed (e.g., \"structured discovery qualification\" not \"better process\").");
    sections.push("5. METRIC-ORIENTED PHRASE — Include at least one concrete metric reference: a percentage, a time frame, a dollar impact, or a named KPI (e.g., \"stage-2 conversion\" or \"30% faster qualification\").");
    sections.push("6. SELLER ACTION — End with or embed one concrete talk-track move, question, or positioning statement the seller can use verbatim in the conversation.");
    sections.push("");
    sections.push("TONE: Write as a sharp commercial POV — not a summary, not advice, not a framework description.");
    sections.push("Connect the business issue directly to money, risk, time, pipeline, conversion, retention, or operating efficiency.");
    sections.push("Include a clear \"so what\" for the buyer — why this matters to THEM specifically.");
    sections.push("The output must read like something a prepared seller would say, not like a consultant's memo.");
    sections.push("");
  }

  // ── Quality rubric
  sections.push("=== QUALITY RUBRIC ===");
  sections.push(`MUST cover: ${rubric.mustHave.join(", ")}`);
  sections.push(`AVOID generic phrases: ${rubric.genericMarkers.map(g => `"${g}"`).join(", ")}`);
  sections.push(`Max generic markers allowed: ${rubric.maxGenericMarkers}`);
  sections.push("");

  // ── Library proof (retrieved KIs/playbooks)
  sections.push("=== LIBRARY PROOF (Retrieved Knowledge Items & Playbooks) ===");
  if (libraryHits.length === 0) {
    sections.push("No library hits retrieved. State this explicitly — do not fabricate library references.");
  } else {
    for (const hit of libraryHits.slice(0, 15)) {
      const kind = hit.kind === "knowledge_item" ? "KI" : "PB";
      const ctx = hit.context ? ` — ${hit.context}` : "";
      sections.push(`- [${kind}:${hit.id.slice(0, 8)}] ${hit.title}${ctx}`);
    }
  }
  sections.push("");

  // ── Expansion trace
  if (expansionTrace.length > 0) {
    sections.push("=== RETRIEVAL EXPANSION TRACE ===");
    for (const e of expansionTrace.slice(0, 10)) {
      sections.push(`- "${e.term}" via ${e.source} (${e.rule})`);
    }
    sections.push("");
  }

  // ── Synthesis addendum (skill-level control context)
  sections.push("=== SKILL SYNTHESIS ADDENDUM (control context — DO NOT treat as the sole prompt) ===");
  sections.push(synthesisAddendum);
  sections.push("");

  // ── Hard rules
  sections.push("=== NON-NEGOTIABLE RULES ===");
  sections.push("1. Ground every claim in the retrieved library items above. CITE using exact format: [KI:xxxxxxxx] or [PB:xxxxxxxx] (first 8 chars of the ID shown in LIBRARY PROOF). Include at least 3 citations across the output.");
  sections.push("2. Do NOT invent library citations. If a tactic is not in the retrieved items, say so.");
  sections.push("3. Do NOT produce generic filler. Every sentence must be specific to the inputs.");
  sections.push("4. Do NOT reference tools, templates, or artifacts not present in the library proof.");
  sections.push("5. If library coverage is insufficient, state what is missing rather than fabricating.");
  sections.push("6. Tie recommendations to business impact: before-state, negative consequences, after-state, required capabilities, metrics.");
  sections.push("7. The manifest rubric is AUTHORITATIVE. Do not deviate based on prompt phrasing.");
  sections.push("");

  // ── Strategy Dominance Preflight (universal — hardened v2)
  sections.push("=== STRATEGY DOMINANCE PREFLIGHT (self-verify before outputting) ===");
  sections.push("Before finalizing your output, mentally verify ALL of the following.");
  sections.push("If ANY check fails, REWRITE the failing section before returning.");
  sections.push("");

  sections.push("── 1. MANIFEST COMPLETENESS ──");
  sections.push("Every item in MUST cover is EXPLICITLY present in the output.");
  sections.push("- Not implied. Not buried in a sentence. Not renamed beyond recognition.");
  sections.push("- For structured artifacts: each mustHave item must appear as a named section/key.");
  sections.push("- If a mustHave element has unknown data, include it with status: 'unknown/gap', a gap description, and a recommended next action.");
  sections.push("");

  sections.push("── 2. THINKING SUPERIORITY CHECK ──");
  sections.push("Your output must be MORE SPECIFIC than a generic best-practice answer. Verify:");
  sections.push("a) Does it contain concrete details — numbers, timelines, dollar amounts, percentages, named KPIs, or quantified tradeoffs?");
  sections.push("b) Does it name specific conditions, risks, or dynamics unique to THIS account/persona/stage — not generic industry truisms?");
  sections.push("c) Scan every sentence for these BANNED phrases. If found, replace with a concrete, quantified claim:");
  sections.push("   'improve efficiency', 'enhance experience', 'streamline operations', 'drive value',");
  sections.push("   'optimize performance', 'best-in-class', 'industry-leading', 'holistic approach',");
  sections.push("   'align stakeholders', 'transform the business', 'unlock potential', 'move the needle'.");
  sections.push("d) If a generic AI with no library could have written the same sentence, that sentence is not good enough. Rewrite it with a specific claim, metric, or tradeoff.");
  sections.push("");

  sections.push("── 3. COMMERCIAL SHARPNESS CHECK ──");
  sections.push("Every output MUST contain ALL of the following commercial elements:");
  sections.push("a) COST OF INACTION or MISSED OPPORTUNITY — What happens if the buyer does nothing? Name the consequence in dollars, time, risk exposure, or competitive loss. Not 'they may fall behind' — instead: 'every quarter of delay extends their 14-month renewal cycle and exposes $X in at-risk revenue.'");
  sections.push("b) BEFORE → AFTER CONTRAST — Name the current state (concrete, observable) and the target state (measurable outcome). Use numbers or named KPIs.");
  sections.push("c) PERSONA-SPECIFIC CONSEQUENCE — Why does this matter to THIS role? A GM cares about operational margin and guest satisfaction scores. A CRO cares about pipeline velocity and win rates. Tie the consequence to what the persona's boss measures them on.");
  sections.push("d) If you describe a problem without quantifying its impact, that is not commercial sharpness — rewrite.");
  sections.push("");

  sections.push("── 4. DECISION CLARITY CHECK (CRITICAL) ──");
  sections.push("Every output must answer: 'What should the seller DO next?'");
  sections.push("This MUST appear as one or more of:");
  sections.push("- Explicit next steps with named actions (e.g., 'Ask the GM: What is your current cost-per-occupied-room for guest tech support?')");
  sections.push("- Recommended positioning moves (e.g., 'Frame consolidation as a margin play, not a tech play')");
  sections.push("- Decision framing for the buyer (e.g., 'The choice is: continue paying $X/room/month for fragmented tools, or consolidate at $Y with measurable satisfaction uplift')");
  sections.push("REJECT outputs that only analyze, only describe structure, or do not move the deal forward.");
  sections.push("If a seller reads this and still doesn't know what to DO, the output has failed.");
  sections.push("");

  sections.push("── 5. DECISION-GRADE DEPTH ──");
  sections.push("Every required section must include:");
  sections.push("a) Current known state (what we know or suspect — with specifics, not generalities)");
  sections.push("b) Explicit gap (what is missing or at risk — named, not implied)");
  sections.push("c) Commercial implication (why the gap matters in $ / risk / time — quantified)");
  sections.push("d) Recommended next action (specific and executable, not 'explore further')");
  sections.push("e) Library/KI-informed reasoning when available (cite the KI/PB ID)");
  sections.push("");

  sections.push("── 6. EVIDENCE IS SUPPORT, NOT CRUTCH ──");
  sections.push("Keep citing [KI:xxxxxxxx] and [PB:xxxxxxxx] — but enforce:");
  sections.push("- Every citation must SUPPORT a specific claim or JUSTIFY a specific action.");
  sections.push("- No decorative citations. If a citation doesn't change the meaning of the sentence it's in, remove it.");
  sections.push("- LITMUS TEST: If you removed ALL citations and the output became vague or lost its reasoning, the reasoning is too weak. Rewrite so the logic stands on its own, THEN add citations as proof.");
  sections.push("- Citations amplify strong reasoning. They do not substitute for it.");
  sections.push("");

  sections.push("── 7. BASELINE COMPARISON GUARD ──");
  sections.push("Ask yourself:");
  sections.push("- Would a generic assistant (no library, no context) produce something equally specific?");
  sections.push("- Is any section thinner in detail, weaker in commercial consequence, or vaguer in next steps than what a generic AI would write?");
  sections.push("- Could someone read this and mistake it for generic sales advice?");
  sections.push("- If yes to ANY, add concrete specifics: named metrics, quantified consequences, persona-specific stakes, or executable actions.");
  sections.push("");

  return sections.join("\n");
}

function buildEvalSynthesisUserPrompt(
  inputs: Record<string, string>,
  manifest: { label: string; behaviorIntent: string },
): string {
  const parts: string[] = [];
  parts.push(`Generate a ${manifest.label} for the following scenario:`);
  if (inputs.account) parts.push(`Account: ${inputs.account}`);
  if (inputs.persona) parts.push(`Persona: ${inputs.persona}`);
  if (inputs.stage) parts.push(`Stage: ${inputs.stage}`);
  if (inputs.topic) parts.push(`Topic: ${inputs.topic}`);
  if (inputs.opportunity) parts.push(`Opportunity: ${inputs.opportunity}`);
  if (inputs.industry) parts.push(`Industry: ${inputs.industry}`);
  if (inputs.objection) parts.push(`Objection: ${inputs.objection}`);
  if (inputs.use_case) parts.push(`Use Case: ${inputs.use_case}`);
  parts.push("");
  parts.push("Produce a complete, actionable, library-grounded answer. Follow the output contract and rubric exactly.");
  return parts.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // ── Auth (with validation-key bypass for automated testing)
    const validationKey = req.headers.get("x-validation-key");
    const expectedKey = Deno.env.get("STRATEGY_VALIDATION_KEY");
    const isValidationBypass = validationKey && expectedKey && validationKey === expectedKey;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader && !isValidationBypass) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let supabase: ReturnType<typeof createClient>;
    let userId: string;

    if (isValidationBypass) {
      // Use service role for validation bypass
      supabase = createClient(supabaseUrl, serviceRoleKey);
      // Look up the owner user
      const { data: ownerData } = await supabase
        .from("approved_users")
        .select("user_id")
        .eq("is_active", true)
        .limit(1)
        .single();
      userId = ownerData?.user_id ?? "validation-user";
    } else {
      supabase = createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: authHeader! } },
      });
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      userId = user.id;
    }

    // ── Parse body
    const body = await req.json();
    const skillPayload = body.skill;
    if (!skillPayload || typeof skillPayload !== "object" || !skillPayload.id) {
      return new Response(
        JSON.stringify({ error: "skill.id is required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const skillInputs: Record<string, string> = skillPayload.inputs ?? {};

    // ── Run skill runtime (retrieval + gate)
    const { runSkill } = await import("../_shared/strategy-skills/index.ts");

    const skillResult = await runSkill({
      envelope: skillPayload,
      ctx: { thread: body.threadId ? { threadId: body.threadId } : undefined },
      supabase,
      userId,
    });

    // If gate refused, return refusal with envelope
    if (!skillResult.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          source: "strategy-eval-synthesis",
          prompt_version: STRATEGY_EVAL_SYNTHESIS_PROMPT_VERSION,
          refusal: skillResult.envelope.refusal,
          envelope: skillResult.envelope,
          reason: skillResult.reason,
          code: skillResult.code,
        }),
        { status: 422, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Extract manifest info from envelope trace
    const trace = skillResult.envelope.trace;
    const manifest = {
      id: trace.skill_id,
      label: trace.skill_id, // Will be enriched below
      behaviorIntent: trace.behavior_intent,
      workspace: trace.workspace,
    };

    // Enrich label from registry
    try {
      const { SKILL_REGISTRY } = await import("../_shared/strategy-skills/manifests.ts");
      const m = SKILL_REGISTRY[trace.skill_id];
      if (m) {
        manifest.label = m.label;
      }
    } catch { /* use id as label */ }

    // Get full manifest for output contract + rubric
    let outputContract = { shape: "prose" as string, targetWords: undefined as { min: number; max: number } | undefined, forbid: undefined as string[] | undefined };
    let rubric = { mustHave: [] as string[], genericMarkers: [] as string[], maxGenericMarkers: 1 };
    try {
      const { SKILL_REGISTRY } = await import("../_shared/strategy-skills/manifests.ts");
      const m = SKILL_REGISTRY[trace.skill_id];
      if (m) {
        outputContract = {
          shape: m.output.shape,
          targetWords: m.output.targetWords,
          forbid: m.output.forbid as string[] | undefined,
        };
        rubric = {
          mustHave: [...m.rubric.mustHave],
          genericMarkers: [...m.rubric.genericMarkers],
          maxGenericMarkers: m.rubric.maxGenericMarkers,
        };
      }
    } catch { /* defaults */ }

    // ── Build library hits summary
    const libraryHits = (skillResult.hits ?? []).map((h: any) => ({
      kind: h.kind ?? "knowledge_item",
      id: String(h.id ?? ""),
      title: String(h.title ?? "(untitled)"),
      context: h.context ?? null,
    }));

    // ── Build expansion trace summary
    const expansionTrace = (trace.plan.expansion_trace ?? []).map((e: any) => ({
      term: String(e.term ?? ""),
      source: String(e.source ?? ""),
      rule: String(e.rule ?? ""),
    }));

    // ── Build dedicated synthesis prompt
    const systemPrompt = buildEvalSynthesisSystemPrompt(
      skillInputs,
      manifest,
      outputContract,
      rubric,
      skillResult.synthesisAddendum,
      libraryHits,
      expansionTrace,
    );

    const userPrompt = buildEvalSynthesisUserPrompt(skillInputs, manifest);

    // ── Call LLM
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const synthesisModel = "google/gemini-2.5-flash";
    const started = Date.now();

    const llmResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: synthesisModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_completion_tokens: 4096,
      }),
    });

    const synthesisLatencyMs = Date.now() - started;

    if (!llmResp.ok) {
      const errText = await llmResp.text().catch(() => "");
      const status = llmResp.status === 429 ? 429 : llmResp.status === 402 ? 402 : 502;
      return new Response(
        JSON.stringify({
          ok: false,
          source: "strategy-eval-synthesis",
          error: `LLM error: ${llmResp.status}`,
          detail: errText.slice(0, 500),
          envelope: skillResult.envelope,
          prompt_version: STRATEGY_EVAL_SYNTHESIS_PROMPT_VERSION,
        }),
        { status, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const llmData = await llmResp.json();
    const generatedText = llmData?.choices?.[0]?.message?.content ?? "";

    // ── Return full result
    return new Response(
      JSON.stringify({
        ok: true,
        source: "strategy-eval-synthesis",
        prompt_version: STRATEGY_EVAL_SYNTHESIS_PROMPT_VERSION,
        generated_text: generatedText,
        synthesis_latency_ms: synthesisLatencyMs,
        model: synthesisModel,
        envelope: skillResult.envelope,
        synthesis_addendum: skillResult.synthesisAddendum,
        library_hits: libraryHits.map((h: any) => ({ id: h.id, title: h.title, kind: h.kind })),
        expansion_trace: expansionTrace,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[run-strategy-eval-synthesis] error:", (e as Error).message);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
