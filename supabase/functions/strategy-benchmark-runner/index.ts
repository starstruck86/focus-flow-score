// ════════════════════════════════════════════════════════════════
// strategy-benchmark-runner — HEADLESS DIAGNOSTIC HARNESS
//
// NOT a product feature. NOT wired to any UI.
// Runs 6 hardcoded asks against three systems for ONE rich account:
//   1. Strategy (V2 pipeline via /strategy-chat with _v2:true)
//   2. Raw Anthropic Claude Sonnet 4.5 (no library, no context)
//   3. Raw OpenAI GPT (no library, no context)
//
// Scores each output with:
//   A. Heuristic rubric (operator POV, decision logic, commercial sharpness,
//      library leverage, audience fit, correctness)
//   B. LLM-as-judge (Claude) — 0-10 + rationale + winner pick
//
// Classifies Strategy failures:
//   reasoning | retrieval | routing | orchestration | shallow | wrong_question
//
// Returns ONE markdown report with side-by-side outputs, scores,
// failure modes, summary, ranked fix list.
//
// AUTH: requires `x-strategy-validation-key` header (same secret as the
// stress runner). Service-role gated. Run from sandbox / curl.
//
// POST { as_user_id }     → auto-selects best account, runs full suite
// POST { as_user_id, account_id } → uses explicit account
// ════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-strategy-validation-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const VALIDATION_KEY = Deno.env.get("STRATEGY_VALIDATION_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const GPT_MODEL = "gpt-5";
const JUDGE_MODEL = "claude-sonnet-4-5-20250929";

// ─── Types ──────────────────────────────────────────────────────
interface BenchmarkAsk {
  index: number;
  prompt: string;
  category: string;
}
interface SystemOutput {
  system: "strategy" | "claude" | "gpt";
  text: string;
  latencyMs: number;
  error?: string;
  meta?: Record<string, any>;
}
interface HeuristicScore {
  operator_pov: number;
  decision_logic: number;
  commercial_sharpness: number;
  library_leverage: number;
  audience_fit: number;
  correctness: number;
  total: number;
}
interface JudgeScore {
  strategy: number;
  claude: number;
  gpt: number;
  winner: "strategy" | "claude" | "gpt" | "tie";
  rationale: string;
}
type StrategyFailureMode =
  | "reasoning"
  | "retrieval"
  | "routing"
  | "orchestration"
  | "shallow"
  | "wrong_question"
  | "none";

// ─── Account auto-selection ─────────────────────────────────────
async function selectBestAccount(admin: any, userId: string, override?: string) {
  if (override) {
    const { data } = await admin
      .from("accounts")
      .select("id, name, website, industry, notes, tier, account_status")
      .eq("id", override)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!data) throw new Error(`account ${override} not found for user`);
    return data;
  }

  // Pull candidate accounts and score them by signal density.
  const { data: accounts } = await admin
    .from("accounts")
    .select("id, name, website, industry, notes, tier, account_status, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .limit(200);
  if (!accounts?.length) throw new Error("user has no active accounts");

  const ids = accounts.map((a: any) => a.id);

  const [contactsRes, oppsRes, callsRes, memRes] = await Promise.all([
    admin.from("contacts").select("account_id").in("account_id", ids).eq("user_id", userId),
    admin.from("opportunities").select("account_id, stage").in("account_id", ids).eq("user_id", userId),
    admin.from("call_transcripts").select("account_id, call_date").in("account_id", ids).eq("user_id", userId),
    admin.from("account_strategy_memory").select("account_id").in("account_id", ids).eq("user_id", userId),
  ]);

  const tally = (rows: any[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.account_id, (m.get(r.account_id) ?? 0) + 1);
    return m;
  };
  const cMap = tally(contactsRes.data);
  const oMap = tally(oppsRes.data);
  const tMap = tally(callsRes.data);
  const mMap = tally(memRes.data);

  let best: any = null;
  let bestScore = -1;
  for (const a of accounts) {
    const contacts = cMap.get(a.id) ?? 0;
    const opps = oMap.get(a.id) ?? 0;
    const calls = tMap.get(a.id) ?? 0;
    const mems = mMap.get(a.id) ?? 0;
    const notesLen = (a.notes ?? "").length;
    const score =
      contacts * 3 +
      opps * 5 +
      calls * 4 +
      mems * 2 +
      Math.min(notesLen / 200, 5);
    if (score > bestScore) {
      bestScore = score;
      best = { ...a, _signal: { contacts, opps, calls, mems, notesLen, score } };
    }
  }
  return best;
}

// ─── Prompt builder ─────────────────────────────────────────────
function buildAsks(accountName: string, recentMessage: string): BenchmarkAsk[] {
  return [
    { index: 1, category: "account_brief",   prompt: `Tell me about ${accountName}` },
    { index: 2, category: "ramp_plan",       prompt: `Give me a 90 day plan as a new AE on ${accountName}` },
    { index: 3, category: "audience_rewrite", prompt: `Rewrite this for a CFO: ${recentMessage}` },
    { index: 4, category: "next_step",       prompt: `What should I do next on ${accountName}?` },
    { index: 5, category: "discovery",       prompt: `Build me a discovery framework for ${accountName}` },
    { index: 6, category: "renewal_memo",    prompt: `Draft a renewal memo for ${accountName}` },
  ];
}

// ─── Provider calls ─────────────────────────────────────────────
async function callStrategy(
  userJwt: string,
  threadId: string,
  prompt: string,
): Promise<SystemOutput> {
  const t0 = Date.now();
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/strategy-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userJwt}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        action: "chat",
        threadId,
        content: prompt,
        _v2: true,
      }),
    });
    // Drain stream
    let text = "";
    if (resp.body) {
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
      }
    }
    return {
      system: "strategy",
      text,
      latencyMs: Date.now() - t0,
      meta: { http: resp.status },
      error: resp.status >= 400 ? `HTTP ${resp.status}` : undefined,
    };
  } catch (e: any) {
    return { system: "strategy", text: "", latencyMs: Date.now() - t0, error: String(e?.message || e) };
  }
}

async function callClaudeRaw(prompt: string, accountName: string): Promise<SystemOutput> {
  const t0 = Date.now();
  if (!ANTHROPIC_KEY) {
    return { system: "claude", text: "", latencyMs: 0, error: "ANTHROPIC_API_KEY missing" };
  }
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        system: `You are a sales strategist. The account in question is "${accountName}". You have no internal library or CRM access — answer from general knowledge only.`,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json();
    const text = (data?.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    return {
      system: "claude",
      text,
      latencyMs: Date.now() - t0,
      meta: { model: CLAUDE_MODEL },
      error: !resp.ok ? `HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 300)}` : undefined,
    };
  } catch (e: any) {
    return { system: "claude", text: "", latencyMs: Date.now() - t0, error: String(e?.message || e) };
  }
}

async function callGptRaw(prompt: string, accountName: string): Promise<SystemOutput> {
  const t0 = Date.now();
  if (!OPENAI_KEY) {
    return { system: "gpt", text: "", latencyMs: 0, error: "OPENAI_API_KEY missing" };
  }
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GPT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a sales strategist. The account in question is "${accountName}". You have no internal library or CRM access — answer from general knowledge only.`,
          },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 2000,
      }),
    });
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return {
      system: "gpt",
      text,
      latencyMs: Date.now() - t0,
      meta: { model: GPT_MODEL },
      error: !resp.ok ? `HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 300)}` : undefined,
    };
  } catch (e: any) {
    return { system: "gpt", text: "", latencyMs: Date.now() - t0, error: String(e?.message || e) };
  }
}

// ─── Heuristic scoring ──────────────────────────────────────────
function scoreHeuristic(text: string, ask: BenchmarkAsk, accountName: string): HeuristicScore {
  const t = (text ?? "").trim();
  const lower = t.toLowerCase();
  const len = t.length;

  const hasNumbers = /\b\d+(\.\d+)?%?\b/.test(t);
  const hasBullets = /(^|\n)\s*([-*•]|\d+[.)])\s+/.test(t);
  const hasHeadings = /(^|\n)#{1,4}\s+\S/.test(t) || /(^|\n)\*\*[A-Z][^*]+\*\*/.test(t);
  const mentionsAccount = lower.includes(accountName.toLowerCase());
  const hasResourceCitations = /RESOURCE\[[^\]]+\]|KI\[[^\]]+\]|PLAYBOOK\[[^\]]+\]/i.test(t);
  const hasInternalLeverage =
    /\b(playbook|knowledge item|our (data|library|notes)|previous call|account memory)\b/i.test(t);
  const hasCommercialTerms =
    /\b(arr|ACV|pipeline|quota|close rate|win rate|expansion|renewal|MEDDIC|MEDDPICC|champion|economic buyer|stakeholder map)\b/i.test(
      t,
    );
  const hasDecisionLogic =
    /\b(if|because|therefore|so that|the risk is|trade-?off|prioriti[sz]e|first|then|next)\b/i.test(t);
  const hasOperatorPOV =
    /\b(I would|do this|start by|book a meeting|send a|call|today|this week|next 7 days|first move)\b/i.test(
      t,
    );
  const audienceMatch =
    ask.category === "audience_rewrite"
      ? /\b(CFO|cost of capital|payback|ROI|margin|cash|EBITDA|TCO|board|finance)\b/i.test(t)
      : true;
  const tooShort = len < 400;
  const wallOfText = !hasBullets && !hasHeadings && len > 1200;

  // 0-10 each
  const operator_pov = clamp10(
    (hasOperatorPOV ? 6 : 2) + (mentionsAccount ? 2 : 0) + (hasBullets ? 2 : 0) - (tooShort ? 4 : 0),
  );
  const decision_logic = clamp10(
    (hasDecisionLogic ? 5 : 1) + (hasHeadings ? 3 : 0) + (hasBullets ? 2 : 0) - (wallOfText ? 3 : 0),
  );
  const commercial_sharpness = clamp10(
    (hasCommercialTerms ? 5 : 1) + (hasNumbers ? 3 : 0) + (mentionsAccount ? 2 : 0),
  );
  const library_leverage = clamp10(
    (hasResourceCitations ? 7 : 0) + (hasInternalLeverage ? 3 : 0),
  );
  const audience_fit = clamp10(
    (audienceMatch ? 7 : 2) +
      (ask.category === "audience_rewrite" && /\b(CFO|finance)\b/i.test(t) ? 3 : 0),
  );
  const correctness = clamp10(
    (len > 200 ? 5 : 0) +
      (mentionsAccount ? 2 : 0) +
      (hasHeadings || hasBullets ? 2 : 0) +
      (tooShort ? -3 : 0) +
      (text && !text.toLowerCase().includes("i don't have") ? 1 : 0),
  );
  const total = +(
    (operator_pov + decision_logic + commercial_sharpness + library_leverage + audience_fit + correctness) /
    6
  ).toFixed(2);
  return { operator_pov, decision_logic, commercial_sharpness, library_leverage, audience_fit, correctness, total };
}
function clamp10(n: number) {
  return Math.max(0, Math.min(10, Math.round(n)));
}

// ─── LLM-as-judge ───────────────────────────────────────────────
async function judgeWithClaude(
  ask: BenchmarkAsk,
  outputs: SystemOutput[],
  accountName: string,
): Promise<JudgeScore> {
  if (!ANTHROPIC_KEY) {
    return { strategy: 0, claude: 0, gpt: 0, winner: "tie", rationale: "ANTHROPIC_API_KEY missing" };
  }
  const truncate = (s: string) => (s.length > 6000 ? s.slice(0, 6000) + "\n…[truncated]" : s);
  const findOut = (sys: string) => outputs.find((o) => o.system === sys);
  const system = `You are a brutally honest sales-execution evaluator. Score three responses to the same prompt. Account: "${accountName}". Score each 0-10 on overall usefulness to a working AE. Pick a single winner. Be terse and specific. Return STRICT JSON only, no prose: {"strategy":N,"claude":N,"gpt":N,"winner":"strategy|claude|gpt|tie","rationale":"<=400 chars"}`;
  const user = `PROMPT:
${ask.prompt}

=== STRATEGY OUTPUT ===
${truncate(findOut("strategy")?.text || "(empty)")}

=== CLAUDE RAW OUTPUT ===
${truncate(findOut("claude")?.text || "(empty)")}

=== GPT RAW OUTPUT ===
${truncate(findOut("gpt")?.text || "(empty)")}

Return JSON now.`;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        max_tokens: 800,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const data = await resp.json();
    const raw = (data?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { strategy: 0, claude: 0, gpt: 0, winner: "tie", rationale: `judge no-json: ${raw.slice(0, 200)}` };
    const parsed = JSON.parse(m[0]);
    return {
      strategy: Number(parsed.strategy ?? 0),
      claude: Number(parsed.claude ?? 0),
      gpt: Number(parsed.gpt ?? 0),
      winner: (parsed.winner ?? "tie") as JudgeScore["winner"],
      rationale: String(parsed.rationale ?? "").slice(0, 600),
    };
  } catch (e: any) {
    return { strategy: 0, claude: 0, gpt: 0, winner: "tie", rationale: `judge error: ${e?.message || e}` };
  }
}

// ─── Strategy failure classification ────────────────────────────
function classifyStrategyFailure(
  ask: BenchmarkAsk,
  strategyOut: SystemOutput,
  heur: HeuristicScore,
  judge: JudgeScore,
  accountName: string,
): StrategyFailureMode {
  if (judge.winner === "strategy") return "none";
  const text = strategyOut.text || "";
  const lower = text.toLowerCase();

  if (strategyOut.error || !text.trim()) return "orchestration";
  if (text.length < 500) return "shallow";
  if (heur.library_leverage <= 1 && /no (relevant )?(library|resources|knowledge)/i.test(text))
    return "retrieval";
  if (heur.library_leverage <= 1 && judge.claude > judge.strategy + 1) return "retrieval";
  if (!lower.includes(accountName.toLowerCase()) && ask.category !== "audience_rewrite")
    return "wrong_question";
  if (ask.category === "audience_rewrite" && !/\b(CFO|finance|payback|ROI)\b/i.test(text))
    return "wrong_question";
  if (heur.decision_logic <= 3 && heur.operator_pov <= 3) return "reasoning";
  if (judge.strategy < judge.claude && judge.strategy < judge.gpt) return "shallow";
  return "shallow";
}

// ─── Markdown report ────────────────────────────────────────────
function buildMarkdown(
  account: any,
  results: Array<{
    ask: BenchmarkAsk;
    outputs: SystemOutput[];
    heur: Record<string, HeuristicScore>;
    judge: JudgeScore;
    failure: StrategyFailureMode;
  }>,
): string {
  const tally = { strategy: 0, claude: 0, gpt: 0, tie: 0 };
  for (const r of results) tally[r.judge.winner] = (tally[r.judge.winner] ?? 0) + 1;

  const failureCounts: Record<string, number> = {};
  for (const r of results)
    if (r.failure !== "none") failureCounts[r.failure] = (failureCounts[r.failure] ?? 0) + 1;

  // Ranked fix list — derived from failure counts + lowest heuristic dimensions
  const dimSums: Record<string, number> = {
    operator_pov: 0,
    decision_logic: 0,
    commercial_sharpness: 0,
    library_leverage: 0,
    audience_fit: 0,
    correctness: 0,
  };
  for (const r of results) {
    const h = r.heur.strategy;
    if (!h) continue;
    for (const k of Object.keys(dimSums)) dimSums[k] += (h as any)[k];
  }
  const weakDims = Object.entries(dimSums).sort((a, b) => a[1] - b[1]).slice(0, 3);

  const fixes: string[] = [];
  const sortedFailures = Object.entries(failureCounts).sort((a, b) => b[1] - a[1]);
  for (const [mode, count] of sortedFailures) {
    fixes.push(`**${mode}** failure in ${count}/${results.length} asks → ${fixHint(mode)}`);
  }
  for (const [dim, sum] of weakDims) {
    fixes.push(`Weak heuristic dimension **${dim}** (cumulative ${sum}/${results.length * 10}) → ${dimFixHint(dim)}`);
  }

  const lines: string[] = [];
  lines.push(`# Strategy Benchmark Report`);
  lines.push("");
  lines.push(`**Account:** ${account.name}  `);
  if (account._signal)
    lines.push(
      `**Signal density:** contacts=${account._signal.contacts}, opps=${account._signal.opps}, calls=${account._signal.calls}, mems=${account._signal.mems}, notesChars=${account._signal.notesLen}`,
    );
  lines.push(`**Run timestamp:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");

  for (const r of results) {
    lines.push(`## Ask ${r.ask.index}: ${r.ask.prompt}`);
    lines.push(`*Category:* ${r.ask.category}`);
    lines.push("");
    for (const sys of ["strategy", "claude", "gpt"] as const) {
      const o = r.outputs.find((x) => x.system === sys)!;
      lines.push(`### ${sys.toUpperCase()}  _(latency ${o.latencyMs}ms${o.error ? `, ERROR: ${o.error}` : ""})_`);
      const t = (o.text || "_(empty)_").trim();
      lines.push(t.length > 4000 ? t.slice(0, 4000) + "\n…[truncated]" : t);
      lines.push("");
    }
    lines.push(`### Scores`);
    lines.push("| System | Op POV | Decision | Commercial | Library | Audience | Correct | Total | Judge |");
    lines.push("|---|---|---|---|---|---|---|---|---|");
    for (const sys of ["strategy", "claude", "gpt"] as const) {
      const h = r.heur[sys];
      const judgeScore = (r.judge as any)[sys];
      lines.push(
        `| ${sys} | ${h.operator_pov} | ${h.decision_logic} | ${h.commercial_sharpness} | ${h.library_leverage} | ${h.audience_fit} | ${h.correctness} | **${h.total}** | ${judgeScore} |`,
      );
    }
    lines.push("");
    lines.push(`**Judge winner:** ${r.judge.winner.toUpperCase()}`);
    lines.push(`**Judge rationale:** ${r.judge.rationale}`);
    if (r.failure !== "none") lines.push(`**Strategy failure mode:** \`${r.failure}\``);
    lines.push("");
    lines.push("---");
  }

  lines.push(`## SUMMARY`);
  lines.push(`- Strategy wins: **${tally.strategy} / ${results.length}**`);
  lines.push(`- Claude wins:   **${tally.claude} / ${results.length}**`);
  lines.push(`- GPT wins:      **${tally.gpt} / ${results.length}**`);
  lines.push(`- Ties:          **${tally.tie} / ${results.length}**`);
  lines.push("");
  if (Object.keys(failureCounts).length) {
    lines.push(`### Strategy failure modes`);
    for (const [mode, n] of sortedFailures) lines.push(`- \`${mode}\`: ${n}`);
    lines.push("");
  }
  lines.push(`## RANKED FIX LIST`);
  if (!fixes.length) lines.push("_(none — Strategy won every ask)_");
  fixes.slice(0, 5).forEach((f, i) => lines.push(`${i + 1}. ${f}`));

  return lines.join("\n");
}

function fixHint(mode: string): string {
  switch (mode) {
    case "retrieval":
      return "Retrieval is missing relevant KIs/playbooks/resources for the user's prompt. Audit `libraryRetrieval.ts` scope inference and scoring; verify embeddings/keyword matches actually fire on these prompts.";
    case "reasoning":
      return "Outputs are structurally weak. Reasoning prompt likely under-constrains operator POV and decision logic — tighten the synthesis system prompt to demand 'first move / why / risk' framing.";
    case "routing":
      return "Wrong provider/path selected for the intent. Audit `resolveLLMRoute` against these prompts.";
    case "orchestration":
      return "Pipeline crashed or returned empty. Inspect strategy-chat logs for this turn — likely fallback or audit gate kill.";
    case "shallow":
      return "Output is on-topic but generic vs raw models. Strategy is failing to leverage internal context — verify library context is actually injected into the prompt, not just retrieved.";
    case "wrong_question":
      return "Strategy answered something other than what was asked (e.g. ignored audience-rewrite framing, ignored the named account). Audit intent classifier and prompt assembly.";
    default:
      return "Investigate.";
  }
}
function dimFixHint(dim: string): string {
  const map: Record<string, string> = {
    operator_pov: "Force outputs to lead with concrete first-person operator moves ('this week, I would…').",
    decision_logic: "Require explicit if/then reasoning + risk callouts in the synthesis contract.",
    commercial_sharpness: "Inject ARR/ACV/pipeline/MEDDIC vocabulary requirements into the system prompt.",
    library_leverage: "Surface RESOURCE[]/KI[]/PLAYBOOK[] citations as a hard contract in the appendix.",
    audience_fit: "Strengthen audience-rewrite branch — detect persona keywords and rewrite tone/metrics accordingly.",
    correctness: "Check for empty/hedging outputs; raise minimum body length and tighten gating.",
  };
  return map[dim] ?? "Investigate.";
}

// ─── Auth: mint a user JWT (same trick as stress-runner) ────────
async function mintUserJwt(admin: any, asUserId: string): Promise<string> {
  const { data: targetUser, error: e1 } = await admin.auth.admin.getUserById(asUserId);
  if (e1 || !targetUser?.user) throw new Error(`as_user_id not found: ${e1?.message}`);
  const { data: linkData, error: e2 } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: targetUser.user.email!,
  });
  if (e2 || !linkData?.properties?.hashed_token) throw new Error(`generateLink failed: ${e2?.message}`);
  const { data: verifyData, error: e3 } = await admin.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (e3 || !verifyData?.session?.access_token) throw new Error(`verifyOtp failed: ${e3?.message}`);
  return verifyData.session.access_token;
}

// ─── Pull a recent message for the audience-rewrite ask ────────
async function getRecentMessage(admin: any, userId: string, accountId: string): Promise<string> {
  // try strategy_messages on a thread linked to this account
  const { data: threads } = await admin
    .from("strategy_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("linked_account_id", accountId)
    .limit(5);
  const ids = (threads ?? []).map((t: any) => t.id);
  if (ids.length) {
    const { data: msgs } = await admin
      .from("strategy_messages")
      .select("content_json, role, created_at")
      .in("thread_id", ids)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1);
    const txt = msgs?.[0]?.content_json?.text;
    if (txt && typeof txt === "string" && txt.length > 40) return txt.slice(0, 800);
  }
  return "Hey team — wanted to share a quick update on where we are: the pilot is going well, we've seen a 12% lift in conversion on the test cohort, and the buying committee is asking about expansion timeline. I think we have a real shot at locking in Q4. Let me know your thoughts on next steps.";
}

// ─── Create scratch thread for Strategy ─────────────────────────
async function createScratchThread(admin: any, userId: string, accountId: string): Promise<string> {
  const { data, error } = await admin
    .from("strategy_threads")
    .insert({
      user_id: userId,
      title: `[benchmark] ${new Date().toISOString().slice(0, 19)}`,
      thread_type: "general",
      lane: "general",
      linked_account_id: accountId,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw new Error(`create thread failed: ${error.message}`);
  return data.id;
}

// ─── Main handler ───────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!VALIDATION_KEY) {
    return new Response(JSON.stringify({ error: "STRATEGY_VALIDATION_KEY not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const provided = req.headers.get("x-strategy-validation-key") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (provided !== VALIDATION_KEY && bearer !== SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "invalid validation key" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const asUserId: string | undefined = body?.as_user_id;
  if (!asUserId) {
    return new Response(JSON.stringify({ error: "as_user_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const account = await selectBestAccount(admin, asUserId, body?.account_id);
    const recentMsg = await getRecentMessage(admin, asUserId, account.id);
    const asks = buildAsks(account.name, recentMsg);
    const userJwt = await mintUserJwt(admin, asUserId);
    const threadId = await createScratchThread(admin, asUserId, account.id);

    const results: Array<{
      ask: BenchmarkAsk;
      outputs: SystemOutput[];
      heur: Record<string, HeuristicScore>;
      judge: JudgeScore;
      failure: StrategyFailureMode;
    }> = [];

    for (const ask of asks) {
      console.log(`[benchmark] ask ${ask.index}/${asks.length}: ${ask.prompt.slice(0, 80)}`);
      // Strategy must run sequentially on the thread; raw models can run in parallel WITH it.
      const [strategyOut, claudeOut, gptOut] = await Promise.all([
        callStrategy(userJwt, threadId, ask.prompt),
        callClaudeRaw(ask.prompt, account.name),
        callGptRaw(ask.prompt, account.name),
      ]);
      const outputs = [strategyOut, claudeOut, gptOut];
      const heur = {
        strategy: scoreHeuristic(strategyOut.text, ask, account.name),
        claude: scoreHeuristic(claudeOut.text, ask, account.name),
        gpt: scoreHeuristic(gptOut.text, ask, account.name),
      };
      const judge = await judgeWithClaude(ask, outputs, account.name);
      const failure = classifyStrategyFailure(ask, strategyOut, heur.strategy, judge, account.name);
      results.push({ ask, outputs, heur, judge, failure });
    }

    const markdown = buildMarkdown(account, results);

    return new Response(
      JSON.stringify({
        ok: true,
        account: { id: account.id, name: account.name, signal: account._signal },
        thread_id: threadId,
        summary: results.reduce(
          (acc: any, r) => {
            acc[r.judge.winner] = (acc[r.judge.winner] ?? 0) + 1;
            return acc;
          },
          { strategy: 0, claude: 0, gpt: 0, tie: 0 },
        ),
        results: results.map((r) => ({
          ask: r.ask,
          judge: r.judge,
          failure: r.failure,
          heur: r.heur,
          lengths: {
            strategy: r.outputs.find((o) => o.system === "strategy")?.text.length ?? 0,
            claude: r.outputs.find((o) => o.system === "claude")?.text.length ?? 0,
            gpt: r.outputs.find((o) => o.system === "gpt")?.text.length ?? 0,
          },
        })),
        markdown,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[benchmark] fatal:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e), stack: e?.stack }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
