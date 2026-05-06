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
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Versioned synthesis prompt ──────────────────────────────────────
export const STRATEGY_EVAL_SYNTHESIS_PROMPT_VERSION = "3.1.0-structural-diff";
const MAX_ADVERSARIAL_ITERATIONS = 2;
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

/**
 * Detect if the output is a "decision artifact" — any structured output whose
 * purpose is executive alignment, business case, deal review, or decision support.
 * This is universal, not skill-specific.
 */
function isDecisionArtifact(
  manifest: { behaviorIntent: string; workspace: string },
  outputContract: { shape: string },
): boolean {
  const decisionIntents = ["account_brief", "deal_review", "business_case", "executive_summary", "decision_support"];
  const decisionWorkspaces = ["artifacts"];
  const decisionShapes = ["structured_artifact", "executive_brief"];
  return (
    decisionIntents.includes(manifest.behaviorIntent) ||
    (decisionWorkspaces.includes(manifest.workspace) && decisionShapes.includes(outputContract.shape))
  );
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
    sections.push("=== PROSE DENSITY & STRUCTURE REQUIREMENTS (V2.1) ===");
    sections.push("Because this skill demands constrained prose with no headings or bullets,");
    sections.push("every sentence must carry maximum business weight. Within the word limit:");
    sections.push("");
    sections.push("MANDATORY SEQUENTIAL STRUCTURE — your prose MUST follow this exact progression:");
    sections.push("The output is flowing prose with NO headings, NO bullets, NO labels.");
    sections.push("PARAGRAPH RULE: Break into 2-4 SHORT paragraphs (max 100 words each) separated by blank lines.");
    sections.push("Each paragraph maps to one phase of the progression below:");
    sections.push("");
    sections.push("  SENTENCE 1-2: CURRENT STATE — Open by naming what is concretely true right now for this account.");
    sections.push("    Use phrases like 'Currently...', 'Today...', 'Right now...', 'The [persona] is facing...'");
    sections.push("    Name the specific condition, not a generic industry trend.");
    sections.push("");
    sections.push("  SENTENCE 3-4: CONSEQUENCE — Immediately follow with the cost, risk, or negative impact of this state.");
    sections.push("    Use phrases like 'This means...', 'The result is...', 'Which creates...', 'Without addressing this...'");
    sections.push("    Include a specific number, dollar figure, percentage, or time metric.");
    sections.push("");
    sections.push("  SENTENCE 5-6: INSIGHT / SHIFT — State the core insight, reframe, or required capability shift.");
    sections.push("    Use phrases like 'The real issue is...', 'The shift required is...', 'The opportunity is...', 'What changes the trajectory is...'");
    sections.push("    This must be specific to THIS situation — not a generic observation.");
    sections.push("");
    sections.push("  SENTENCE 7+: ACTION — Close with a concrete seller action directed at a specific persona.");
    sections.push("    Use executable verbs: Ask, Confirm, Map, Validate, Challenge, Position, Quantify.");
    sections.push("    Name the specific person/role and the specific question or deliverable.");
    sections.push("");
    sections.push("CRITICAL: This ordering is NON-NEGOTIABLE. Do not interleave or reorder.");
    sections.push("Context first. Then consequence. Then insight. Then action. Always.");
    sections.push("");
    sections.push("ADDITIONAL MANDATORY ELEMENTS (embed within the progression above):");
    sections.push("- At least one concrete metric: a percentage, dollar figure, timeframe, or named KPI.");
    sections.push("- A specific capability or behavior shift (not 'better process' — name the actual capability).");
    sections.push("- A talk-track move the seller can use verbatim.");
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

  // ── Phase 3.5C: Explicit section enforcement
  sections.push("=== MANDATORY SECTION ENFORCEMENT (Phase 3.5C — NON-NEGOTIABLE) ===");
  sections.push("Your final output MUST include these exact required concepts in this exact order:");
  for (let i = 0; i < rubric.mustHave.length; i++) {
    sections.push(`  ${i + 1}. "${rubric.mustHave[i]}"`);
  }
  sections.push("");
  if (outputContract.shape === "structured_artifact" || outputContract.shape === "executive_brief") {
    sections.push("FOR STRUCTURED ARTIFACTS:");
    sections.push("- Each mustHave above MUST appear as a named top-level JSON key or section heading.");
    sections.push("- Use the EXACT phrase from the list above as the key/heading name. Do NOT rename, merge, or use synonyms.");
    sections.push("- Example: if mustHave says 'commercial insight', your key must be 'commercial insight' or 'commercial_insight' — NOT 'business opportunity' or 'key insight'.");
    sections.push("");
  } else {
    sections.push("FOR PROSE:");
    sections.push("- Each mustHave concept above MUST appear explicitly in the prose using the EXACT phrase at least once.");
    sections.push("- Example: if mustHave says 'change vectors', your prose must literally contain the words 'change vectors' somewhere.");
    sections.push("- Example: if mustHave says 'commercial insight', your prose must contain those exact words together.");
    sections.push("- Do NOT rely on synonyms alone. The exact phrase must be present.");
    sections.push("");
  }

  // ── Phase 3.5C: Evidence placement enforcement
  sections.push("=== EVIDENCE PLACEMENT RULES (Phase 3.5C — DETERMINISTIC GATE) ===");
  sections.push("A DETERMINISTIC GATE will check these rules. Violations = automatic rejection:");
  sections.push("");
  sections.push("RULE 1: Max 3 citations per sentence. NEVER put 4+ citations in one sentence. Spread them across sentences.");
  sections.push("RULE 2: Every citation MUST have causal language in the SAME sentence or the sentence immediately before/after.");
  sections.push("  Causal words: because, therefore, resulting in, which means, this creates, this drives, demonstrates, validates, confirms, consequently, as a result, leading to, supporting.");
  sections.push("RULE 3: No citation lists or reference sections at the end. Each citation must be inline with reasoning.");
  sections.push("");
  sections.push("PATTERN TO FOLLOW for EVERY citation:");
  sections.push("  '[Causal claim] because [evidence reasoning] [KI:xxxxxxxx].'");
  sections.push("  OR: '[KI:xxxxxxxx] demonstrates that [specific claim], resulting in [consequence].'");
  sections.push("");
  sections.push("PATTERN TO AVOID:");
  sections.push("  'The team should focus on improvement [KI:abc123].' — NO causal word = GATE FAIL");
  sections.push("  'Sources: [KI:abc] [KI:def] [KI:ghi] [KI:jkl]' — 4 citations in one sentence = GATE FAIL");
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

  // ── FORCED TRANSFORMATION ENGINE (v3 — active rewrite loops, not passive checks)
  sections.push("=== GENERATION PROTOCOL: DRAFT → TRANSFORM → DELIVER ===");
  sections.push("");
  sections.push("You do NOT produce a single draft and return it. You follow a 3-phase protocol:");
  sections.push("");
  sections.push("PHASE 1: DRAFT — Generate complete output covering all manifest requirements.");
  sections.push("PHASE 2: TRANSFORM — Run every transformation below against your draft. For each one that fails, REWRITE the failing section IN PLACE. Do not merely note the failure.");
  sections.push("PHASE 3: DELIVER — Return ONLY the transformed output. Do not show your critique or transformation notes.");
  sections.push("");
  sections.push("You must internalize this loop. The output the user sees is the FINAL transformed version, not the first draft.");
  sections.push("");

  // ── T1: Structural Spine
  sections.push("═══ TRANSFORMATION 1: STRUCTURAL SPINE ═══");
  sections.push("Every output — prose or artifact — must contain these 4 elements, whether labeled or woven:");
  sections.push("");
  sections.push("  CURRENT STATE  → What is concretely true right now for this account/persona?");
  sections.push("  CONSEQUENCE    → What is the cost, risk, or missed upside of staying here? (Quantified.)");
  sections.push("  INSIGHT/CHANGE → What shift, capability, or reframe changes the trajectory?");
  sections.push("  ACTION         → What does the seller DO next? (Executable. Not 'explore' or 'consider'.)");
  sections.push("");
  sections.push("REWRITE RULE: If any element is missing or vague, rewrite until it is concrete.");
  sections.push("For structured artifacts: each manifest section must contain its own micro-spine (state → gap → implication → action).");
  sections.push("");

  // ── T2: Generic Language Exterminator
  sections.push("═══ TRANSFORMATION 2: GENERIC LANGUAGE EXTERMINATOR ═══");
  sections.push("Scan every sentence. Apply this test:");
  sections.push("");
  sections.push("  'Could this sentence appear in advice for ANY company in ANY industry?'");
  sections.push("");
  sections.push("If YES → the sentence is generic. REWRITE it with:");
  sections.push("  - A named condition specific to this account, persona, or stage");
  sections.push("  - A number, percentage, timeframe, or dollar figure");
  sections.push("  - A tradeoff or tension unique to this situation");
  sections.push("");
  sections.push("KILL LIST (rewrite on sight — these are never acceptable):");
  sections.push("  'improve efficiency', 'enhance experience', 'drive better outcomes',");
  sections.push("  'streamline operations', 'optimize performance', 'best-in-class',");
  sections.push("  'industry-leading', 'holistic approach', 'align stakeholders',");
  sections.push("  'transform the business', 'unlock potential', 'move the needle',");
  sections.push("  'drive value', 'leverage insights', 'empower teams',");
  sections.push("  'create synergies', 'scalable solution', 'innovative approach',");
  sections.push("  'world-class', 'cutting-edge', 'game-changer', 'paradigm shift',");
  sections.push("  'thought leadership', 'value-add', 'low-hanging fruit',");
  sections.push("  'deep dive', 'circle back', 'take it to the next level'.");
  sections.push("");
  sections.push("REPLACEMENT STANDARD: The rewritten sentence must name THIS account's specific pain, THIS persona's metric, or THIS stage's qualifying gap.");
  sections.push("");

  // ── T3: Decision Pressure Injection
  sections.push("═══ TRANSFORMATION 3: DECISION PRESSURE INJECTION ═══");
  sections.push("The output must explicitly answer: 'What happens if they do nothing?'");
  sections.push("");
  sections.push("This is not optional. If the cost-of-inaction is not stated with specifics:");
  sections.push("  - Name the dollar exposure, timeline risk, or competitive threat");
  sections.push("  - Tie it to what the persona is measured on (margin, NPS, pipeline, quota attainment)");
  sections.push("  - Frame it as a choice: 'Continue doing X and accept Y consequence, or...'");
  sections.push("");
  sections.push("REWRITE RULE: Scan your output for the cost-of-inaction. If it reads like 'they may fall behind' or 'risk losing competitive advantage', that is not pressure — it is filler. Replace with: 'Every quarter without consolidated guest data costs ~$X/room in redundant licensing and adds 2+ weeks to each technology evaluation cycle.'");
  sections.push("");

  // ── T4: Executability Enforcement
  sections.push("═══ TRANSFORMATION 4: EXECUTABILITY ENFORCEMENT ═══");
  sections.push("The output must contain at least one thing a seller can DO immediately — not tomorrow, not 'after further analysis.'");
  sections.push("");
  sections.push("ACCEPTABLE action verbs: Ask, Confirm, Map, Draft, Send, Schedule, Validate, Challenge, Quantify, Present, Position, Propose, Test, Document.");
  sections.push("BANNED action verbs: Explore, Consider, Evaluate, Assess, Look into, Think about, Investigate further, Keep in mind.");
  sections.push("");
  sections.push("REWRITE RULE: Find every instance of a banned verb. Replace with a specific executable:");
  sections.push("  ✗ 'Consider exploring their budget process' → ✓ 'Ask the GM: Who signs off on technology spend above $50K, and what is the approval cycle?'");
  sections.push("  ✗ 'Evaluate their current stack' → ✓ 'Map the 3 guest-facing systems they mentioned and confirm per-system annual cost with IT lead.'");
  sections.push("");

  // ── T5: Stance Hardening
  sections.push("═══ TRANSFORMATION 5: STANCE HARDENING ═══");
  sections.push("Strategy outputs take positions. They do not hedge.");
  sections.push("");
  sections.push("Scan for weak stance signals:");
  sections.push("  - 'It might be worth...' → State what IS worth doing and why.");
  sections.push("  - 'They could potentially...' → State what they WILL face.");
  sections.push("  - 'This may help...' → State the specific outcome with a metric.");
  sections.push("  - 'There are several options...' → Name the best option and defend it.");
  sections.push("  - 'It depends on...' → Name the dependency, state the most likely scenario, and give the action for it.");
  sections.push("");
  sections.push("REWRITE RULE: Every hedged sentence must be rewritten as a committed position with evidence.");
  sections.push("A top 1% AE does not say 'it might be worth exploring.' They say 'You need to do X because Y, and here is the data.'");
  sections.push("");

  // ── T6: Evidence Integration (not decoration)
  sections.push("═══ TRANSFORMATION 6: EVIDENCE INTEGRATION ═══");
  sections.push("Citations ([KI:xxxxxxxx], [PB:xxxxxxxx]) must be load-bearing, not decorative.");
  sections.push("");
  sections.push("For each citation in your draft, apply this test:");
  sections.push("  'If I delete this citation AND the sentence still makes the same point with the same force, the citation is decorative.'");
  sections.push("");
  sections.push("REWRITE RULE: If decorative, either:");
  sections.push("  a) Remove the citation, OR");
  sections.push("  b) Rewrite the sentence so the KI/PB content CHANGES the claim — adds a specific tactic, names a qualifying criterion, or introduces a framework the seller wouldn't otherwise know.");
  sections.push("");
  sections.push("Good: 'Frame consolidation around operational margin, not technology — GMs respond to cost-per-occupied-room, not platform features [KI:a1b2c3d4].'");
  sections.push("Bad: 'It is important to understand the buyer's needs [KI:a1b2c3d4].'");
  sections.push("");

  // ── T7: Manifest Completeness (structural)
  sections.push("═══ TRANSFORMATION 7: MANIFEST COMPLETENESS ═══");
  sections.push("Cross-check your output against the MUST cover list.");
  sections.push("Every item must be EXPLICITLY present — not implied, not renamed beyond recognition.");
  sections.push("For structured artifacts: each mustHave must appear as a named key/section.");
  sections.push("For prose: each mustHave must be addressable by a reader scanning for it.");
  sections.push("");
  sections.push("REWRITE RULE: If a mustHave element has no data, include it with:");
  sections.push("  - status: 'unknown/gap'");
  sections.push("  - what we need to learn");
  sections.push("  - specific discovery action to fill the gap");
  sections.push("Do NOT omit it. Gaps named are more valuable than gaps hidden.");
  sections.push("");

  // ── T8: Decision Artifact Transformation (universal for executive-alignment outputs)
  if (isDecisionArtifact(manifest, outputContract)) {
    sections.push("═══ TRANSFORMATION 8: DECISION ARTIFACT TRANSFORMATION ═══");
    sections.push("This output is a DECISION ARTIFACT — its purpose is to arm an executive or seller with enough clarity to act.");
    sections.push("A decision artifact is NOT a summary. It is a persuasion instrument with commercial teeth.");
    sections.push("");
    sections.push("MANDATORY SECTIONS — each section must contain its own micro-spine:");
    sections.push("");
    sections.push("  1. EXECUTIVE DECISION THESIS");
    sections.push("     What is happening → Why does it matter commercially → What decision does this create?");
    sections.push("     Must be one crisp paragraph that an exec can read in 15 seconds and say 'I understand the ask.'");
    sections.push("");
    sections.push("  2. BUSINESS RISK OF DELAY");
    sections.push("     Quantify what the account loses per quarter/month by not acting.");
    sections.push("     Name the metric the executive is measured on (margin, RevPAR, NPS, pipeline velocity, churn).");
    sections.push("     Frame as: 'Every [time unit] without [action] costs [specific $$ or KPI erosion].'");
    sections.push("");
    sections.push("  3. COMMERCIAL STAKES");
    sections.push("     Estimated deal size, competitive exposure, or budget window.");
    sections.push("     If unknown, state the gap and the discovery question that fills it.");
    sections.push("     Never say 'significant opportunity' — name a number or range.");
    sections.push("");
    sections.push("  4. RECOMMENDED EXECUTIVE ACTION");
    sections.push("     What should the executive sponsor/champion DO? Not 'align stakeholders' — name the meeting, the approval, the sign-off.");
    sections.push("     Tie this to their decision process: 'Schedule a 30-min review with [role] to validate [criteria] before [date].'");
    sections.push("");
    sections.push("  5. SELLER NEXT MOVE");
    sections.push("     The single most important thing the seller does after reading this artifact.");
    sections.push("     Must be an executable action with a specific verb, target person, and deliverable.");
    sections.push("");
    sections.push("  6. DECISION FRICTION / LIKELY OBJECTION");
    sections.push("     Name the #1 reason this deal stalls or the exec says no.");
    sections.push("     Provide the counter-positioning: how the seller neutralizes it.");
    sections.push("     If unknown, name the discovery question that surfaces it.");
    sections.push("");
    sections.push("  7. PROOF / SOURCE SUPPORT");
    sections.push("     Ground claims in library KIs/PBs. Every assertion of impact must cite a source or explicitly state 'gap — needs validation.'");
    sections.push("");
    sections.push("REWRITE RULE: If any of the 7 sections is missing, vague, or reads like a generic summary, rewrite it.");
    sections.push("Each section must pass the test: 'Does this give the reader something they can act on RIGHT NOW?'");
    sections.push("If yes → keep. If no → rewrite with specifics from the account context and library proof.");
    sections.push("");
  }

  // ── T9: Structural Differentiation (universal — makes output impossible for generic AI to replicate)
  sections.push("═══ TRANSFORMATION 9: STRUCTURAL DIFFERENTIATION (MANDATORY) ═══");
  sections.push("Before returning, verify ALL FOUR of the following are present in your output.");
  sections.push("If ANY are missing, REWRITE until they appear. This is non-negotiable.");
  sections.push("");
  sections.push("  1. QUANTIFIED CONSEQUENCE");
  sections.push("     At least one number, percentage, dollar figure, or time metric tied to business impact.");
  sections.push("     Must describe cost-of-inaction OR missed opportunity with specifics.");
  sections.push("     ✗ 'significant revenue impact' → ✓ '$2.3M in pipeline at risk across 4 open opps this quarter'");
  sections.push("     ✗ 'potential cost savings' → ✓ '~18% reduction in evaluation cycle time, saving 6 weeks per vendor review'");
  sections.push("");
  sections.push("  2. NAMED ENTITY + METRIC");
  sections.push("     A specific role, team, department, or stakeholder tied to a measurable outcome they own.");
  sections.push("     ✗ 'leadership alignment' → ✓ 'VP Sales owns pipeline conversion, currently at 22% vs 31% benchmark'");
  sections.push("     ✗ 'the team should focus' → ✓ 'SDR team's meeting-to-opp rate dropped from 38% to 24% after Q2 territory changes'");
  sections.push("");
  sections.push("  3. CAUSAL CHAIN");
  sections.push("     At least one explicit X → Y → Z reasoning chain showing cause and downstream effect.");
  sections.push("     ✗ 'fragmented data leads to problems' → ✓ 'Fragmented guest profiles → duplicate outreach across properties → 12% opt-out rate on loyalty comms → $1.8M annual retention leakage'");
  sections.push("     The chain must be specific to THIS account/situation, not a generic industry pattern.");
  sections.push("");
  sections.push("  4. STAKEHOLDER-TIED ACTION");
  sections.push("     At least one action using an executable verb (Ask / Confirm / Map / Validate / Challenge / Quantify / Draft / Position)");
  sections.push("     directed at a SPECIFIC persona or role.");
  sections.push("     ✗ 'Discuss priorities with the team' → ✓ 'Ask the VP Revenue: What is the cost per month of running 3 separate guest databases?'");
  sections.push("     ✗ 'Validate alignment' → ✓ 'Confirm with IT Director whether the PMS integration timeline blocks Q1 renewal decision'");
  sections.push("");
  sections.push("SELF-CHECK: Read your output. For each of the 4 elements, find the EXACT sentence that satisfies it.");
  sections.push("If you cannot point to a specific sentence for any element, your output FAILS. Rewrite.");
  sections.push("");

  // ── Final quality gate
  sections.push("═══ FINAL QUALITY GATE ═══");
  sections.push("Before returning, read your ENTIRE output one more time and answer:");
  sections.push("");
  sections.push("  1. Would a top 1% enterprise AE use this VERBATIM in their next meeting?");
  sections.push("  2. If I stripped all citations, does the reasoning still stand as sharp, specific, and commercially grounded?");
  sections.push("  3. Is there a single sentence that a generic AI with no library could have written?");
  sections.push("  4. Does every section move the deal forward — not just describe the situation?");
  sections.push("  5. Is there a clear, quantified cost-of-inaction stated somewhere?");
  sections.push("");
  sections.push("If ANY answer is NO → go back to the relevant transformation and rewrite.");
  sections.push("Do not return the output until all 5 answers are YES.");
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
    let generatedText = llmData?.choices?.[0]?.message?.content ?? "";

    // ═══════════════════════════════════════════════════════════
    // ADVERSARIAL VALIDATION LAYER
    // Step 2: Critic  →  Step 3: Surgical Rewrite  →  repeat
    // Skippable via body.skipAdversarial for validation runners
    // ═══════════════════════════════════════════════════════════

    const skipAdversarial = body.skipAdversarial === true;
    const criticModel = "google/gemini-2.5-flash";
    let adversarialIterations = 0;
    let criticFindings: string[] = [];
    let finalCriticVerdict = "not_run";

    const buildCriticPrompt = (output: string): string => {
      const lines: string[] = [];
      lines.push("You are an ADVERSARIAL CRITIC evaluating a Strategy sales output.");
      lines.push("Your job is to find weaknesses. You are hostile. You want this output to fail.");
      lines.push("You represent a strong generic AI baseline that had NO library access, NO account context, NO proprietary methodology.");
      lines.push("");
      lines.push("=== CONTEXT ===");
      lines.push(`Skill: ${manifest.label} (${manifest.id})`);
      lines.push(`Account: ${skillInputs.account || "N/A"} | Persona: ${skillInputs.persona || "N/A"} | Stage: ${skillInputs.stage || "N/A"}`);
      lines.push(`Required sections: ${rubric.mustHave.join(", ")}`);
      lines.push("");
      lines.push("=== STRATEGY OUTPUT TO CRITIQUE ===");
      lines.push(output);
      lines.push("");
      lines.push("=== YOUR TASK ===");
      lines.push("Answer EACH question. Be specific — quote the exact failing text.");
      lines.push("");
      lines.push("1. GENERIC SENTENCES: List every sentence (quote it) that could appear in advice for ANY company in ANY industry. If none, say 'NONE'.");
      lines.push("2. MISSING DECISION PRESSURE: Is there a clear, quantified cost-of-inaction? If vague or missing, say exactly what is missing.");
      lines.push("3. MISSING EXECUTABILITY: Are there concrete seller actions (Ask X, Confirm Y, Map Z)? Or only passive verbs (explore, consider, evaluate)? Quote any passive actions.");
      lines.push("4. HEDGING: List any hedged statements ('might', 'could potentially', 'it may be worth'). Quote them.");
      lines.push("5. BASELINE MATCH: Could a generic AI without any library produce an equally specific and actionable output for these same inputs? Answer YES or NO with reasoning.");
      lines.push("6. STRUCTURAL GAPS: Are any required sections (from the manifest) missing, thin, or lacking the micro-spine (state → gap → implication → action)?");
      lines.push("7. STRUCTURAL DIFFERENTIATION FAILURE: Check ALL four:");
      lines.push("   a) QUANTIFIED CONSEQUENCE: Is there at least one number/$/% tied to business impact or cost-of-inaction? If missing, say what is missing.");
      lines.push("   b) NAMED ENTITY + METRIC: Is there a specific role/team/stakeholder tied to a measurable outcome they own? If missing, say what is missing.");
      lines.push("   c) CAUSAL CHAIN: Is there at least one explicit X → Y → Z reasoning chain specific to this account? If missing, say what is missing.");
      lines.push("   d) STAKEHOLDER-TIED ACTION: Is there at least one executable action (Ask/Confirm/Map/Validate/Challenge) directed at a specific persona? If missing, say what is missing.");
      lines.push("   If ANY of a-d are missing, this is a STRUCTURAL DIFFERENTIATION FAILURE.");
      lines.push("");
      lines.push("=== RESPONSE FORMAT (strict JSON) ===");
      lines.push("Return ONLY valid JSON with this schema:");
      lines.push(JSON.stringify({
        pass: false,
        generic_sentences: ["quoted sentence 1"],
        missing_pressure: "description or NONE",
        passive_actions: ["quoted passive action"],
        hedging: ["quoted hedge"],
        baseline_could_match: false,
        baseline_reasoning: "why or why not",
        structural_gaps: ["gap description"],
        structural_differentiation: {
          quantified_consequence: true,
          named_entity_metric: true,
          causal_chain: true,
          stakeholder_action: true,
          failures: ["description of each missing element"]
        },
        rewrite_instructions: ["specific instruction for each weakness"]
      }, null, 2));
      return lines.join("\n");
    };

    const buildRewritePrompt = (original: string, instructions: string[]): string => {
      const lines: string[] = [];
      lines.push("You are performing a SURGICAL REWRITE of a Strategy output.");
      lines.push("An adversarial critic found weaknesses. You must fix ONLY the weak sections.");
      lines.push("");
      lines.push("RULES:");
      lines.push("- Do NOT regenerate the entire output.");
      lines.push("- PRESERVE all strong sections exactly as they are.");
      lines.push("- REWRITE only the sections identified as weak.");
      lines.push("- Every rewrite must INCREASE specificity, causality, and decision pressure.");
      lines.push("- If a rewrite instruction mentions STRUCTURAL DIFFERENTIATION FAILURE, ensure the fix adds the missing element (quantified consequence, named entity+metric, causal chain, or stakeholder-tied action).");
      lines.push("- Do NOT expand length unnecessarily. Do NOT change output format.");
      lines.push("- Maintain the same output format/shape.");
      lines.push(`- Output shape: ${outputContract.shape}`);
      if (outputContract.targetWords) {
        lines.push(`- STRICT word limit: ${outputContract.targetWords.min}–${outputContract.targetWords.max} words. Do NOT exceed.`);
      }
      if (outputContract.forbid?.length) {
        lines.push(`- FORBIDDEN formatting: ${outputContract.forbid.join(", ")}. Do NOT add headings, bullets, or lists if forbidden.`);
      }
      lines.push("");
      lines.push("=== ORIGINAL OUTPUT ===");
      lines.push(original);
      lines.push("");
      lines.push("=== REQUIRED REWRITES ===");
      for (let i = 0; i < instructions.length; i++) {
        lines.push(`${i + 1}. ${instructions[i]}`);
      }
      lines.push("");
      lines.push("=== CONTEXT (for rewrites) ===");
      lines.push(`Account: ${skillInputs.account || "N/A"} | Persona: ${skillInputs.persona || "N/A"} | Stage: ${skillInputs.stage || "N/A"}`);
      lines.push(`Required sections: ${rubric.mustHave.join(", ")}`);
      lines.push("");
      lines.push("Return the COMPLETE output with surgical fixes applied. No commentary.");
      return lines.join("\n");
    };

    for (let iteration = 0; !skipAdversarial && iteration < MAX_ADVERSARIAL_ITERATIONS; iteration++) {
      adversarialIterations++;

      // ── Step 2: Adversarial Critic
      const criticResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: criticModel,
          messages: [{ role: "user", content: buildCriticPrompt(generatedText) }],
          temperature: 0.3,
          max_completion_tokens: 2048,
        }),
      });

      if (!criticResp.ok) {
        console.error(`[adversarial] critic call failed iteration ${iteration}: ${criticResp.status}`);
        finalCriticVerdict = "critic_error";
        break;
      }

      const criticData = await criticResp.json();
      const criticRaw = criticData?.choices?.[0]?.message?.content ?? "";

      // Parse critic JSON (extract from code fences if needed)
      let criticResult: any = null;
      try {
        const jsonMatch = criticRaw.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : criticRaw.trim();
        criticResult = JSON.parse(jsonStr);
      } catch {
        console.error(`[adversarial] critic JSON parse failed iteration ${iteration}`);
        finalCriticVerdict = "parse_error";
        break;
      }

      // Collect findings
      const issues: string[] = [];
      if (criticResult.generic_sentences?.length > 0 && criticResult.generic_sentences[0] !== "NONE") {
        issues.push(...criticResult.generic_sentences.map((s: string) => `Generic sentence found: "${s}" — rewrite with account-specific detail`));
      }
      if (criticResult.missing_pressure && criticResult.missing_pressure !== "NONE") {
        issues.push(`Missing decision pressure: ${criticResult.missing_pressure}`);
      }
      if (criticResult.passive_actions?.length > 0) {
        issues.push(...criticResult.passive_actions.map((s: string) => `Passive action: "${s}" — replace with executable verb (Ask/Confirm/Map/Draft)`));
      }
      if (criticResult.hedging?.length > 0) {
        issues.push(...criticResult.hedging.map((s: string) => `Hedging: "${s}" — rewrite as committed position`));
      }
      if (criticResult.baseline_could_match === true) {
        issues.push(`Baseline could match: ${criticResult.baseline_reasoning} — add library-grounded specificity`);
      }
      if (criticResult.structural_gaps?.length > 0) {
        issues.push(...criticResult.structural_gaps.map((s: string) => `Structural gap: ${s}`));
      }
      // T9: Structural differentiation failures
      const sd = criticResult.structural_differentiation;
      if (sd) {
        if (sd.quantified_consequence === false) issues.push("STRUCTURAL DIFFERENTIATION FAILURE: Missing quantified consequence — add a specific number/$/% tied to business impact");
        if (sd.named_entity_metric === false) issues.push("STRUCTURAL DIFFERENTIATION FAILURE: Missing named entity + metric — tie a specific role/team to a measurable outcome");
        if (sd.causal_chain === false) issues.push("STRUCTURAL DIFFERENTIATION FAILURE: Missing causal chain — add explicit X → Y → Z reasoning specific to this account");
        if (sd.stakeholder_action === false) issues.push("STRUCTURAL DIFFERENTIATION FAILURE: Missing stakeholder-tied action — add Ask/Confirm/Map/Validate directed at a specific persona");
        if (sd.failures?.length > 0) {
          issues.push(...sd.failures.map((f: string) => `Structural differentiation detail: ${f}`));
        }
      }

      // Use rewrite_instructions if provided, otherwise use collected issues
      const rewriteInstructions = criticResult.rewrite_instructions?.length > 0
        ? criticResult.rewrite_instructions
        : issues;

      criticFindings = issues;

      // ── Check pass condition
      if (issues.length === 0 || criticResult.pass === true) {
        finalCriticVerdict = "pass";
        break;
      }

      // ── Step 3: Surgical Rewrite
      const rewriteResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: synthesisModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildRewritePrompt(generatedText, rewriteInstructions) },
          ],
          temperature: 0.5,
          max_completion_tokens: 4096,
        }),
      });

      if (!rewriteResp.ok) {
        console.error(`[adversarial] rewrite call failed iteration ${iteration}: ${rewriteResp.status}`);
        finalCriticVerdict = "rewrite_error";
        break;
      }

      const rewriteData = await rewriteResp.json();
      const rewrittenText = rewriteData?.choices?.[0]?.message?.content ?? "";

      if (rewrittenText.length > generatedText.length * 0.3) {
        generatedText = rewrittenText;
      } else {
        console.error(`[adversarial] rewrite too short, keeping original`);
        finalCriticVerdict = "rewrite_too_short";
        break;
      }

      // If last iteration, mark as max_iterations
      if (iteration === MAX_ADVERSARIAL_ITERATIONS - 1) {
        finalCriticVerdict = "max_iterations";
      }
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 3.5C — ARTIFACT GATE (after adversarial, before return)
    // Hard stop: deterministic quality gates on final output.
    // If fail → ONE strict regen → re-gate → mark if still failing.
    // ═══════════════════════════════════════════════════════════

    const artGateManifest = {
      rubric: { mustHave: rubric.mustHave as readonly string[] },
      output: { shape: outputContract.shape, forbid: outputContract.forbid as readonly string[] | undefined },
    };

    // --- Inline artifact gate (edge functions can't import from src/) ---
    function _normalizeKey(s: string): string {
      return s.toLowerCase().replace(/[^a-z0-9]/g, "");
    }
    function _checkTemplateFidelity(output: string, mf: typeof artGateManifest) {
      const diags: string[] = [];
      if (mf.output.shape === "structured_artifact" || mf.output.shape === "executive_brief") {
        let keys: string[] = [];
        try {
          const fm = output.match(/```(?:json|structured_artifact)\s*([\s\S]*?)```/);
          const raw = fm ? fm[1] : output.trim();
          if (raw.startsWith("{") || raw.startsWith("[")) {
            const parsed = JSON.parse(raw);
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) keys = Object.keys(parsed);
          }
        } catch { const km = output.match(/"([^"]+)"\s*:/g); if (km) keys = km.map(m => m.replace(/"/g, "").replace(":", "").trim()); }
        const nk = keys.map(_normalizeKey);
        for (const req of mf.rubric.mustHave) { const n = _normalizeKey(req); if (!nk.some(k => k.includes(n) || n.includes(k))) diags.push(`Missing required section: "${req}"`); }
      } else {
        const lower = output.toLowerCase();
        for (const req of mf.rubric.mustHave) {
          const norm = req.toLowerCase();
          if (lower.includes(norm)) continue;
          const words = norm.split(/\s+/).filter((w: string) => w.length > 2);
          if (words.every((w: string) => lower.includes(w)) && words.length >= 2) continue;
          diags.push(`Missing required element: "${req}"`);
        }
      }
      return { gate: "template_fidelity", pass: diags.length === 0, diagnostics: diags };
    }
    function _checkReadability(text: string) {
      const diags: string[] = [];
      let tc = text;
      const tr = text.trim();
      if (tr.startsWith("{") || tr.startsWith("[")) { try { const p = JSON.parse(tr); if (typeof p === "object" && p !== null) { tc = Object.values(p as Record<string, unknown>).filter((v): v is string => typeof v === "string").join("\n\n"); } } catch {} }
      const paras = tc.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0);
      let total = 0, dense = 0;
      for (let i = 0; i < paras.length; i++) {
        const p = paras[i].trim();
        if (p.startsWith("```") || p.startsWith("{") || p.startsWith("[") || /^#+\s/.test(p)) continue;
        const w = p.split(/\s+/).length; total += w;
        if (w > 120) diags.push(`Paragraph ${i+1} has ${w} words (max 120)`);
        if (w >= 200 && (p.match(/\n/g) || []).length === 0) diags.push(`Paragraph ${i+1} is a wall of text`);
        if (w > 80) dense += w;
      }
      if (total > 0 && dense / total > 0.7) diags.push(`${Math.round((dense/total)*100)}% dense prose`);
      return { gate: "readability", pass: diags.length === 0, diagnostics: diags };
    }
    const _FILLER = [/^this section (?:covers|describes|explains|outlines)/i, /^in this section/i, /^(?:the following|below) (?:is|are|describes)/i];
    const _SUBSTANCE = [/\b\d[\d,.]*%?\b/, /\b(?:VP|CEO|CFO|CRO|CTO|CMO|COO|GM|Director|Manager|Head of)\b/i, /\b(?:because|therefore|resulting in|which means|leading to|causing|driving|this creates|consequently)\b/i];
    function _checkSectionCompleteness(output: string, mustHave: readonly string[]) {
      const diags: string[] = [];
      const lower = output.toLowerCase();
      for (const req of mustHave) {
        const norm = req.toLowerCase();
        const words = norm.split(/\s+/).filter((w: string) => w.length > 2);
        const paras = output.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0);
        let sec = "";
        for (const p of paras) { const pl = p.toLowerCase(); if (pl.includes(norm) || words.every((w: string) => pl.includes(w))) { sec = p; break; } }
        if (!sec && !lower.includes(norm)) { if (!words.some((w: string) => lower.includes(w))) { diags.push(`Section "${req}" not found`); } continue; }
        if (sec) {
          const wc = sec.trim().split(/\s+/).length;
          if (wc < 40) { diags.push(`Section "${req}" is a stub (${wc} words)`); continue; }
          if (_FILLER.some(p => p.test(sec.trim()))) { diags.push(`Section "${req}" is filler`); continue; }
          if (!_SUBSTANCE.some(p => p.test(sec))) diags.push(`Section "${req}" lacks substance`);
        }
      }
      return { gate: "section_completeness", pass: diags.length === 0, diagnostics: diags };
    }
    const _CITE = /\[(?:KI|PB|SRC):[^\]]+\]/g;
    const _CAUSAL = /\b(?:because|therefore|resulting|which means|leading to|this (?:means|creates|drives|shows)|consequently|as a result|the data shows|evidence suggests|according to|proves|demonstrates|confirms|validates|supporting)\b/i;
    function _checkEvidenceDiscipline(text: string) {
      const diags: string[] = [];
      // For JSON artifacts, extract string values to check citations in prose context
      let textToCheck = text;
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed === "object" && parsed !== null) {
            const vals = Object.values(parsed as Record<string, unknown>)
              .filter((v): v is string => typeof v === "string");
            textToCheck = vals.join("\n\n");
          }
        } catch { /* not JSON, check raw */ }
      }
      // Also try extracting from code fences
      const fenceMatch = text.match(/```(?:json|structured_artifact)\s*([\s\S]*?)```/);
      if (fenceMatch) {
        try {
          const parsed = JSON.parse(fenceMatch[1]);
          if (typeof parsed === "object" && parsed !== null) {
            const vals = Object.values(parsed as Record<string, unknown>)
              .filter((v): v is string => typeof v === "string");
            textToCheck = vals.join("\n\n");
          }
        } catch { /* use raw */ }
      }
      const sents = textToCheck.split(/(?<=[.!?])\s+/).filter((s: string) => s.trim().length > 0);
      for (let i = 0; i < sents.length; i++) { const c = (sents[i].match(_CITE) || []).length; if (c > 3) diags.push(`Sentence ${i+1} has ${c} citations (max 3)`); }
      const citeSents: number[] = [];
      for (let i = 0; i < sents.length; i++) { if (_CITE.test(sents[i])) { _CITE.lastIndex = 0; citeSents.push(i); } }
      for (const idx of citeSents) { let ok = false; for (let j = Math.max(0,idx-2); j <= Math.min(sents.length-1,idx+2); j++) { if (_CAUSAL.test(sents[j])) { ok=true; break; } } if (!ok) diags.push(`Citation at sentence ${idx+1} has no causal reasoning nearby`); }
      return { gate: "evidence_discipline", pass: diags.length === 0, diagnostics: diags };
    }
    function _runArtifactGate(output: string, mf: typeof artGateManifest) {
      const gates = [_checkTemplateFidelity(output, mf), _checkReadability(output), _checkSectionCompleteness(output, mf.rubric.mustHave), _checkEvidenceDiscipline(output)];
      const failed = gates.filter(g => !g.pass).map(g => g.gate);
      return { pass: failed.length === 0, gates, failed_dimensions: failed };
    }
    // --- End inline artifact gate ---

    const artifactGateStartMs = Date.now();
    let artifactGateResult = _runArtifactGate(generatedText, artGateManifest);
    let artifactGateRegenerated = false;
    let artifactGateRegenSuccess = false;
    let artifactGateFailed = false;
    let artifactGateRegenAttempts = 0;
    const MAX_ARTIFACT_GATE_REGEN = 1;

    if (!artifactGateResult.pass) {
      console.log(`[artifact-gate] FAIL on first pass: ${JSON.stringify(artifactGateResult.failed_dimensions)}`);

      // Build strict gate-specific regen prompt with diagnostics
      const regenLines: string[] = [];
      regenLines.push("You FAILED these deterministic quality gates. Fix each diagnostic EXACTLY. Do not preserve failing sections.");
      regenLines.push("");
      regenLines.push("RULES:");
      regenLines.push("- Do NOT change output format/shape.");
      regenLines.push(`- Output shape: ${outputContract.shape}`);
      if (outputContract.targetWords) regenLines.push(`- Word limit: ${outputContract.targetWords.min}–${outputContract.targetWords.max}`);
      if (outputContract.forbid?.length) regenLines.push(`- Forbidden formatting: ${outputContract.forbid.join(", ")}`);
      regenLines.push("");

      // Exact required section list
      regenLines.push("=== REQUIRED SECTIONS (exact, in this order) ===");
      for (let i = 0; i < rubric.mustHave.length; i++) {
        regenLines.push(`  ${i + 1}. "${rubric.mustHave[i]}"`);
      }
      regenLines.push("");

      regenLines.push("=== ORIGINAL OUTPUT ===");
      regenLines.push(generatedText);
      regenLines.push("");
      regenLines.push("=== ARTIFACT GATE FAILURES ===");
      for (const g of artifactGateResult.gates) {
        if (!g.pass) {
          regenLines.push(`[${g.gate}] FAILED:`);
          for (const d of g.diagnostics) regenLines.push(`  - ${d}`);
        }
      }
      regenLines.push("");

      // Gate-specific fix instructions
      regenLines.push("=== GATE-SPECIFIC FIX INSTRUCTIONS ===");
      for (const g of artifactGateResult.gates) {
        if (g.pass) continue;
        if (g.gate === "template_fidelity") {
          regenLines.push("TEMPLATE FIDELITY FIX:");
          if (outputContract.shape === "structured_artifact" || outputContract.shape === "executive_brief") {
            regenLines.push("- Rename/reorder your sections to use these EXACT keys: " + rubric.mustHave.map(m => `"${m}"`).join(", "));
          } else {
            regenLines.push("- Ensure each of these EXACT phrases appears literally in your prose: " + rubric.mustHave.map(m => `"${m}"`).join(", "));
          }
        } else if (g.gate === "evidence_discipline") {
          regenLines.push("EVIDENCE DISCIPLINE FIX:");
          regenLines.push("- Every citation ([KI:...], [PB:...]) must be inside a sentence containing causal language: because, therefore, resulting in, which means, this creates, this drives, demonstrates, validates, confirms.");
          regenLines.push("- Rewrite each flagged citation sentence into a causal claim. Example: 'This drives $420K in annual savings because consolidated systems eliminate redundant licensing [KI:abc123].'");
        } else if (g.gate === "readability") {
          regenLines.push("READABILITY FIX:");
          regenLines.push("- Split dense paragraphs into ≤120 words each.");
          regenLines.push("- Add line breaks to walls of text.");
        } else if (g.gate === "section_completeness") {
          regenLines.push("SECTION COMPLETENESS FIX:");
          regenLines.push("- Expand stub/filler sections with: specific metrics, named stakeholder, and causal reasoning (because X → Y).");
          regenLines.push("- Every required section must have ≥40 words of substantive content.");
        }
        regenLines.push("");
      }
      regenLines.push("Return the COMPLETE fixed output. No commentary. No meta-text.");

      try {
        artifactGateRegenAttempts = 1;
        const regenResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: synthesisModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: regenLines.join("\n") },
            ],
            temperature: 0.5,
            max_completion_tokens: 4096,
          }),
        });

        if (regenResp.ok) {
          const regenData = await regenResp.json();
          const regenText = regenData?.choices?.[0]?.message?.content ?? "";
          if (regenText.length > generatedText.length * 0.3) {
            generatedText = regenText;
            artifactGateRegenerated = true;
            // Re-run gate on regenerated output
            artifactGateResult = _runArtifactGate(generatedText, artGateManifest);
            if (!artifactGateResult.pass) {
              console.log(`[artifact-gate] FAIL on regen: ${JSON.stringify(artifactGateResult.failed_dimensions)}`);
              artifactGateFailed = true;
            } else {
              artifactGateRegenSuccess = true;
            }
          } else {
            console.error("[artifact-gate] regen too short, marking failed");
            artifactGateFailed = true;
          }
        } else {
          console.error(`[artifact-gate] regen LLM error: ${regenResp.status}`);
          artifactGateFailed = true;
        }
      } catch (regenErr) {
        console.error("[artifact-gate] regen error:", String(regenErr).slice(0, 200));
        artifactGateFailed = true;
      }
    }
    const artifactGateLatencyMs = Date.now() - artifactGateStartMs;

    // Compute failure reason counts
    const failureReasonCounts: Record<string, number> = {};
    for (const g of artifactGateResult.gates) {
      if (!g.pass) failureReasonCounts[g.gate] = g.diagnostics.length;
    }
    const topFailureDimension = artifactGateResult.failed_dimensions[0] || null;

    const totalLatencyMs = Date.now() - started;

    // ── Return full result
    return new Response(
      JSON.stringify({
        ok: true,
        source: "strategy-eval-synthesis",
        prompt_version: STRATEGY_EVAL_SYNTHESIS_PROMPT_VERSION,
        generated_text: generatedText,
        synthesis_latency_ms: synthesisLatencyMs,
        total_latency_ms: totalLatencyMs,
        model: synthesisModel,
        adversarial: {
          iterations: adversarialIterations,
          verdict: finalCriticVerdict,
          findings_last_pass: criticFindings,
          critic_model: criticModel,
        },
        artifact_gate: {
          pass: artifactGateResult.pass,
          failed_dimensions: artifactGateResult.failed_dimensions,
          gates: artifactGateResult.gates,
          regenerated: artifactGateRegenerated,
          regen_success: artifactGateRegenSuccess,
          failure_reason_counts: failureReasonCounts,
          top_failure_dimension: topFailureDimension,
          regen_attempts: artifactGateRegenAttempts,
          max_regen_attempts: MAX_ARTIFACT_GATE_REGEN,
          total_gate_latency_ms: artifactGateLatencyMs,
        },
        artifact_gate_failed: artifactGateFailed,
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
