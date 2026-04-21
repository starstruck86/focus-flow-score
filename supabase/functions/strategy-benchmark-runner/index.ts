// ════════════════════════════════════════════════════════════════
// strategy-benchmark-runner — HEADLESS DIAGNOSTIC HARNESS
//
// NOT a product feature. NOT wired to any UI.
// Runs N hardcoded asks against three systems for ONE rich account:
//   1. Strategy (V2 pipeline via /strategy-chat with _v2:true)
//   2. Raw Anthropic Claude Sonnet 4.5 (no library, no context)
//   3. Raw OpenAI GPT (no library, no context)
//
// AUTH: requires `x-strategy-validation-key` header. Service-role gated.
//
// REQUEST BODY:
//   {
//     as_user_id: string                       // required
//     account_id?: string                      // optional override
//     asks?: string[]                          // optional override list of prompts
//     baseline_mode?: "raw_only"|"same_context"|"both"   default "both"
//     judge_mode?:    "heuristics_only"|"llm_only"|"both" default "both"
//     save_outputs?:  boolean                  default true
//   }
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

// Per-call hardening
const TIMEOUT_STRATEGY_MS = 60_000;
const TIMEOUT_RAW_MS = 45_000;
const TIMEOUT_JUDGE_MS = 30_000;

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
  attempts: number;
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
  attempts?: number;
  error?: string;
}
type StrategyFailureMode =
  | "reasoning"
  | "retrieval"
  | "routing"
  | "orchestration"
  | "shallow"
  | "wrong_question"
  | "none";

type BaselineMode = "raw_only" | "same_context" | "both";
type JudgeMode = "heuristics_only" | "llm_only" | "both";

// ─── Generic timeout/retry helper ───────────────────────────────
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); },
           (e) => { clearTimeout(timer); reject(e); });
  });
}

interface RetryOpts {
  retries: number; // additional attempts beyond the first
  timeoutMs: number;
  shouldRetry?: (err: unknown, status?: number) => boolean;
}
async function runWithRetry<T>(
  label: string,
  fn: () => Promise<{ value: T; status?: number }>,
  opts: RetryOpts,
): Promise<{ value: T | null; attempts: number; error?: string }> {
  let attempts = 0;
  let lastErr: unknown;
  for (let i = 0; i <= opts.retries; i++) {
    attempts++;
    try {
      const { value, status } = await withTimeout(fn(), opts.timeoutMs, label);
      // status-based retry decision (e.g. 5xx)
      if (status && status >= 500 && i < opts.retries && (opts.shouldRetry?.(null, status) ?? true)) {
        lastErr = new Error(`HTTP ${status}`);
        continue;
      }
      return { value, attempts };
    } catch (e) {
      lastErr = e;
      if (i >= opts.retries) break;
      if (opts.shouldRetry && !opts.shouldRetry(e)) break;
    }
  }
  return { value: null, attempts, error: lastErr instanceof Error ? lastErr.message : String(lastErr) };
}

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
    // still pull signal counts so the report explains the pick
    const sig = await accountSignal(admin, userId, data.id);
    return { ...data, _signal: sig, _selection_reason: "explicit account_id override" };
  }

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
      contacts * 3 + opps * 5 + calls * 4 + mems * 2 + Math.min(notesLen / 200, 5);
    if (score > bestScore) {
      bestScore = score;
      best = {
        ...a,
        _signal: { contacts, opps, calls, mems, notesLen, score: +score.toFixed(2) },
        _selection_reason:
          `auto-selected: highest signal density across ${accounts.length} active accounts ` +
          `(contacts*3 + opps*5 + calls*4 + memory*2 + notesChars/200, capped at 5)`,
      };
    }
  }
  return best;
}

async function accountSignal(admin: any, userId: string, accountId: string) {
  const [c, o, t, m, a] = await Promise.all([
    admin.from("contacts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("account_id", accountId),
    admin.from("opportunities").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("account_id", accountId),
    admin.from("call_transcripts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("account_id", accountId),
    admin.from("account_strategy_memory").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("account_id", accountId),
    admin.from("accounts").select("notes").eq("user_id", userId).eq("id", accountId).maybeSingle(),
  ]);
  const notesLen = (a.data?.notes ?? "").length;
  const contacts = c.count ?? 0, opps = o.count ?? 0, calls = t.count ?? 0, mems = m.count ?? 0;
  const score = contacts * 3 + opps * 5 + calls * 4 + mems * 2 + Math.min(notesLen / 200, 5);
  return { contacts, opps, calls, mems, notesLen, score: +score.toFixed(2) };
}

// ─── Default benchmark asks ─────────────────────────────────────
function buildDefaultAsks(accountName: string, recentMessage: string): BenchmarkAsk[] {
  return [
    { index: 1, category: "account_brief",    prompt: `Tell me about ${accountName}` },
    { index: 2, category: "ramp_plan",        prompt: `Give me a 90 day plan as a new AE on ${accountName}` },
    { index: 3, category: "audience_rewrite", prompt: `Rewrite this for a CFO: ${recentMessage}` },
    { index: 4, category: "next_step",        prompt: `What should I do next on ${accountName}?` },
    { index: 5, category: "discovery",        prompt: `Build me a discovery framework for ${accountName}` },
    { index: 6, category: "renewal_memo",     prompt: `Draft a renewal memo for ${accountName}` },
  ];
}
function categorizeCustomAsk(p: string): string {
  const l = p.toLowerCase();
  if (/cfo|finance|payback|roi|board/.test(l)) return "audience_rewrite";
  if (/discovery/.test(l)) return "discovery";
  if (/renewal/.test(l)) return "renewal_memo";
  if (/90 ?day|ramp|new ae/.test(l)) return "ramp_plan";
  if (/next step|what (should|do) i/.test(l)) return "next_step";
  return "account_brief";
}

// ─── Provider calls ─────────────────────────────────────────────
async function callStrategyOnce(
  userJwt: string,
  threadId: string,
  prompt: string,
): Promise<{ value: { text: string; httpStatus: number }; status?: number }> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/strategy-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userJwt}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ action: "chat", threadId, content: prompt, _v2: true }),
  });
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
  return { value: { text, httpStatus: resp.status }, status: resp.status };
}

async function callStrategy(userJwt: string, threadId: string, prompt: string): Promise<SystemOutput> {
  const t0 = Date.now();
  const result = await runWithRetry(
    "strategy",
    () => callStrategyOnce(userJwt, threadId, prompt),
    { retries: 0, timeoutMs: TIMEOUT_STRATEGY_MS },
  );
  const v = result.value;
  return {
    system: "strategy",
    text: v?.text ?? "",
    latencyMs: Date.now() - t0,
    attempts: result.attempts,
    meta: { http: v?.httpStatus },
    error: result.error ?? (v && v.httpStatus >= 400 ? `HTTP ${v.httpStatus}` : undefined),
  };
}

async function callClaudeOnce(
  prompt: string,
  systemPrompt: string,
): Promise<{ value: { text: string; httpStatus: number; raw: any }; status?: number }> {
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
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await resp.json();
  const text = (data?.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  return { value: { text, httpStatus: resp.status, raw: data }, status: resp.status };
}

async function callClaudeRaw(prompt: string, accountName: string, extraContext?: string): Promise<SystemOutput> {
  const t0 = Date.now();
  if (!ANTHROPIC_KEY) {
    return { system: "claude", text: "", latencyMs: 0, attempts: 0, error: "ANTHROPIC_API_KEY missing" };
  }
  const sys = `You are a sales strategist. The account in question is "${accountName}". ${
    extraContext ?? "You have no internal library or CRM access — answer from general knowledge only."
  }`;
  const result = await runWithRetry(
    "claude",
    () => callClaudeOnce(prompt, sys),
    { retries: 1, timeoutMs: TIMEOUT_RAW_MS, shouldRetry: (_e, status) => !status || status >= 500 },
  );
  const v = result.value;
  return {
    system: "claude",
    text: v?.text ?? "",
    latencyMs: Date.now() - t0,
    attempts: result.attempts,
    meta: { model: CLAUDE_MODEL, http: v?.httpStatus },
    error: result.error ?? (v && v.httpStatus >= 400
      ? `HTTP ${v.httpStatus}: ${JSON.stringify(v.raw).slice(0, 300)}`
      : undefined),
  };
}

async function callGptOnce(
  prompt: string,
  systemPrompt: string,
): Promise<{ value: { text: string; httpStatus: number; raw: any }; status?: number }> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GPT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 2000,
    }),
  });
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { value: { text, httpStatus: resp.status, raw: data }, status: resp.status };
}

async function callGptRaw(prompt: string, accountName: string, extraContext?: string): Promise<SystemOutput> {
  const t0 = Date.now();
  if (!OPENAI_KEY) {
    return { system: "gpt", text: "", latencyMs: 0, attempts: 0, error: "OPENAI_API_KEY missing" };
  }
  const sys = `You are a sales strategist. The account in question is "${accountName}". ${
    extraContext ?? "You have no internal library or CRM access — answer from general knowledge only."
  }`;
  const result = await runWithRetry(
    "gpt",
    () => callGptOnce(prompt, sys),
    { retries: 1, timeoutMs: TIMEOUT_RAW_MS, shouldRetry: (_e, status) => !status || status >= 500 },
  );
  const v = result.value;
  return {
    system: "gpt",
    text: v?.text ?? "",
    latencyMs: Date.now() - t0,
    attempts: result.attempts,
    meta: { model: GPT_MODEL, http: v?.httpStatus },
    error: result.error ?? (v && v.httpStatus >= 400
      ? `HTTP ${v.httpStatus}: ${JSON.stringify(v.raw).slice(0, 300)}`
      : undefined),
  };
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
    /\b(arr|ACV|pipeline|quota|close rate|win rate|expansion|renewal|MEDDIC|MEDDPICC|champion|economic buyer|stakeholder map)\b/i.test(t);
  const hasDecisionLogic =
    /\b(if|because|therefore|so that|the risk is|trade-?off|prioriti[sz]e|first|then|next)\b/i.test(t);
  const hasOperatorPOV =
    /\b(I would|do this|start by|book a meeting|send a|call|today|this week|next 7 days|first move)\b/i.test(t);
  const audienceMatch =
    ask.category === "audience_rewrite"
      ? /\b(CFO|cost of capital|payback|ROI|margin|cash|EBITDA|TCO|board|finance)\b/i.test(t)
      : true;
  const tooShort = len < 400;
  const wallOfText = !hasBullets && !hasHeadings && len > 1200;

  const operator_pov = clamp10((hasOperatorPOV ? 6 : 2) + (mentionsAccount ? 2 : 0) + (hasBullets ? 2 : 0) - (tooShort ? 4 : 0));
  const decision_logic = clamp10((hasDecisionLogic ? 5 : 1) + (hasHeadings ? 3 : 0) + (hasBullets ? 2 : 0) - (wallOfText ? 3 : 0));
  const commercial_sharpness = clamp10((hasCommercialTerms ? 5 : 1) + (hasNumbers ? 3 : 0) + (mentionsAccount ? 2 : 0));
  const library_leverage = clamp10((hasResourceCitations ? 7 : 0) + (hasInternalLeverage ? 3 : 0));
  const audience_fit = clamp10((audienceMatch ? 7 : 2) + (ask.category === "audience_rewrite" && /\b(CFO|finance)\b/i.test(t) ? 3 : 0));
  const correctness = clamp10(
    (len > 200 ? 5 : 0) + (mentionsAccount ? 2 : 0) + (hasHeadings || hasBullets ? 2 : 0) +
    (tooShort ? -3 : 0) + (text && !text.toLowerCase().includes("i don't have") ? 1 : 0),
  );
  const total = +(
    (operator_pov + decision_logic + commercial_sharpness + library_leverage + audience_fit + correctness) / 6
  ).toFixed(2);
  return { operator_pov, decision_logic, commercial_sharpness, library_leverage, audience_fit, correctness, total };
}
function clamp10(n: number) { return Math.max(0, Math.min(10, Math.round(n))); }

// ─── LLM-as-judge ───────────────────────────────────────────────
async function judgeOnce(ask: BenchmarkAsk, outputs: SystemOutput[], accountName: string) {
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
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: JUDGE_MODEL, max_tokens: 800, system, messages: [{ role: "user", content: user }] }),
  });
  const data = await resp.json();
  const raw = (data?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`judge no-json: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]);
  return { value: parsed, status: resp.status };
}

async function judgeWithClaude(ask: BenchmarkAsk, outputs: SystemOutput[], accountName: string): Promise<JudgeScore> {
  if (!ANTHROPIC_KEY) {
    return { strategy: 0, claude: 0, gpt: 0, winner: "tie", rationale: "ANTHROPIC_API_KEY missing", attempts: 0 };
  }
  const result = await runWithRetry(
    "judge",
    () => judgeOnce(ask, outputs, accountName),
    { retries: 1, timeoutMs: TIMEOUT_JUDGE_MS, shouldRetry: (e) => /no-json|JSON|parse/i.test(String((e as any)?.message || e)) },
  );
  if (!result.value) {
    return { strategy: 0, claude: 0, gpt: 0, winner: "tie", rationale: result.error ?? "judge failed", attempts: result.attempts, error: result.error };
  }
  const p = result.value;
  return {
    strategy: Number(p.strategy ?? 0),
    claude: Number(p.claude ?? 0),
    gpt: Number(p.gpt ?? 0),
    winner: (p.winner ?? "tie") as JudgeScore["winner"],
    rationale: String(p.rationale ?? "").slice(0, 600),
    attempts: result.attempts,
  };
}

// ─── Strategy failure classification ────────────────────────────
function classifyStrategyFailure(
  ask: BenchmarkAsk, strategyOut: SystemOutput, heur: HeuristicScore, judge: JudgeScore, accountName: string,
): StrategyFailureMode {
  if (judge.winner === "strategy") return "none";
  const text = strategyOut.text || "";
  const lower = text.toLowerCase();
  if (strategyOut.error || !text.trim()) return "orchestration";
  if (text.length < 500) return "shallow";
  if (heur.library_leverage <= 1 && /no (relevant )?(library|resources|knowledge)/i.test(text)) return "retrieval";
  if (heur.library_leverage <= 1 && judge.claude > judge.strategy + 1) return "retrieval";
  if (!lower.includes(accountName.toLowerCase()) && ask.category !== "audience_rewrite") return "wrong_question";
  if (ask.category === "audience_rewrite" && !/\b(CFO|finance|payback|ROI)\b/i.test(text)) return "wrong_question";
  if (heur.decision_logic <= 3 && heur.operator_pov <= 3) return "reasoning";
  return "shallow";
}

// ─── Markdown report ────────────────────────────────────────────
function buildMarkdown(
  account: any,
  results: Array<{ ask: BenchmarkAsk; outputs: SystemOutput[]; heur: Record<string, HeuristicScore>; judge: JudgeScore; failure: StrategyFailureMode }>,
  baselineMode: BaselineMode, judgeMode: JudgeMode,
): string {
  const tally = { strategy: 0, claude: 0, gpt: 0, tie: 0 };
  for (const r of results) (tally as any)[r.judge.winner] = ((tally as any)[r.judge.winner] ?? 0) + 1;
  const failureCounts: Record<string, number> = {};
  for (const r of results) if (r.failure !== "none") failureCounts[r.failure] = (failureCounts[r.failure] ?? 0) + 1;

  const dimSums: Record<string, number> = {
    operator_pov: 0, decision_logic: 0, commercial_sharpness: 0, library_leverage: 0, audience_fit: 0, correctness: 0,
  };
  for (const r of results) {
    const h = r.heur.strategy;
    if (!h) continue;
    for (const k of Object.keys(dimSums)) dimSums[k] += (h as any)[k];
  }
  const weakDims = Object.entries(dimSums).sort((a, b) => a[1] - b[1]).slice(0, 3);

  const fixes: string[] = [];
  const sortedFailures = Object.entries(failureCounts).sort((a, b) => b[1] - a[1]);
  for (const [mode, count] of sortedFailures) fixes.push(`**${mode}** failure in ${count}/${results.length} asks → ${fixHint(mode)}`);
  for (const [dim, sum] of weakDims) fixes.push(`Weak heuristic dimension **${dim}** (cumulative ${sum}/${results.length * 10}) → ${dimFixHint(dim)}`);

  const lines: string[] = [];
  lines.push(`# Strategy Benchmark Report`);
  lines.push("");
  lines.push(`**Account:** ${account.name}  `);
  lines.push(`**Selection:** ${account._selection_reason ?? "n/a"}  `);
  if (account._signal) {
    lines.push(`**Signal density:** contacts=${account._signal.contacts}, opps=${account._signal.opps}, calls=${account._signal.calls}, memory=${account._signal.mems}, notesChars=${account._signal.notesLen}, **score=${account._signal.score}**`);
  }
  lines.push(`**Baseline mode:** ${baselineMode}  `);
  lines.push(`**Judge mode:** ${judgeMode}  `);
  lines.push(`**Run timestamp:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");

  for (const r of results) {
    lines.push(`## Ask ${r.ask.index}: ${r.ask.prompt}`);
    lines.push(`*Category:* ${r.ask.category}`);
    lines.push("");
    for (const sys of ["strategy", "claude", "gpt"] as const) {
      const o = r.outputs.find((x) => x.system === sys)!;
      lines.push(`### ${sys.toUpperCase()}  _(latency ${o.latencyMs}ms, attempts ${o.attempts}${o.error ? `, ERROR: ${o.error}` : ""})_`);
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
      lines.push(`| ${sys} | ${h.operator_pov} | ${h.decision_logic} | ${h.commercial_sharpness} | ${h.library_leverage} | ${h.audience_fit} | ${h.correctness} | **${h.total}** | ${judgeScore} |`);
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
    case "retrieval": return "Retrieval is missing relevant KIs/playbooks/resources for the user's prompt. Audit `libraryRetrieval.ts` scope inference and scoring; verify embeddings/keyword matches actually fire on these prompts.";
    case "reasoning": return "Outputs are structurally weak. Reasoning prompt likely under-constrains operator POV and decision logic — tighten the synthesis system prompt to demand 'first move / why / risk' framing.";
    case "routing": return "Wrong provider/path selected for the intent. Audit `resolveLLMRoute` against these prompts.";
    case "orchestration": return "Pipeline crashed or returned empty. Inspect strategy-chat logs for this turn — likely fallback or audit gate kill.";
    case "shallow": return "Output is on-topic but generic vs raw models. Strategy is failing to leverage internal context — verify library context is actually injected into the prompt, not just retrieved.";
    case "wrong_question": return "Strategy answered something other than what was asked. Audit intent classifier and prompt assembly.";
    default: return "Investigate.";
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

// ─── Auth helper: mint user JWT (stress-runner pattern) ─────────
async function mintUserJwt(admin: any, asUserId: string): Promise<string> {
  const { data: targetUser, error: e1 } = await admin.auth.admin.getUserById(asUserId);
  if (e1 || !targetUser?.user) throw new Error(`as_user_id not found: ${e1?.message}`);
  const { data: linkData, error: e2 } = await admin.auth.admin.generateLink({
    type: "magiclink", email: targetUser.user.email!,
  });
  if (e2 || !linkData?.properties?.hashed_token) throw new Error(`generateLink failed: ${e2?.message}`);
  const { data: verifyData, error: e3 } = await admin.auth.verifyOtp({
    type: "magiclink", token_hash: linkData.properties.hashed_token,
  });
  if (e3 || !verifyData?.session?.access_token) throw new Error(`verifyOtp failed: ${e3?.message}`);
  return verifyData.session.access_token;
}

async function getRecentMessage(admin: any, userId: string, accountId: string): Promise<string> {
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

// Build "same context" baseline: fetch a small slice of account context to feed raw models.
async function buildSameContextBlock(admin: any, userId: string, accountId: string, accountName: string): Promise<string> {
  const [contactsR, oppsR, callsR, memR] = await Promise.all([
    admin.from("contacts").select("name, title, email").eq("user_id", userId).eq("account_id", accountId).limit(8),
    admin.from("opportunities").select("name, stage, amount, close_date").eq("user_id", userId).eq("account_id", accountId).limit(5),
    admin.from("call_transcripts").select("title, call_date, summary").eq("user_id", userId).eq("account_id", accountId).order("call_date", { ascending: false }).limit(3),
    admin.from("account_strategy_memory").select("content").eq("user_id", userId).eq("account_id", accountId).limit(3),
  ]);
  const lines: string[] = [`CONTEXT FOR ${accountName} (use this; you still have no library):`];
  if (contactsR.data?.length) lines.push(`Contacts:\n${contactsR.data.map((c: any) => `- ${c.name ?? "?"} (${c.title ?? "?"})`).join("\n")}`);
  if (oppsR.data?.length) lines.push(`Opportunities:\n${oppsR.data.map((o: any) => `- ${o.name ?? "?"} • ${o.stage ?? "?"} • $${o.amount ?? "?"} • close ${o.close_date ?? "?"}`).join("\n")}`);
  if (callsR.data?.length) lines.push(`Recent calls:\n${callsR.data.map((c: any) => `- ${c.title ?? "call"} (${c.call_date ?? "?"}): ${(c.summary ?? "").slice(0, 200)}`).join("\n")}`);
  if (memR.data?.length) lines.push(`Account memory:\n${memR.data.map((m: any) => `- ${(typeof m.content === "string" ? m.content : JSON.stringify(m.content)).slice(0, 240)}`).join("\n")}`);
  return lines.join("\n\n");
}

// ─── Async background execution ─────────────────────────────────
async function runBenchmarkInBackground(
  admin: any,
  runId: string,
  asUserId: string,
  body: any,
  baselineMode: BaselineMode,
  judgeMode: JudgeMode,
  saveOutputs: boolean,
  customAsks: string[] | undefined,
) {
  const updateRow = async (patch: Record<string, any>) => {
    try {
      const { error } = await admin
        .from("strategy_benchmark_runs")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", runId);
      if (error) console.error("[benchmark] update err:", error.message);
    } catch (e: any) {
      console.error("[benchmark] update exception:", e?.message || e);
    }
  };

  try {
    await updateRow({ current_step: "selecting_account" });
    const account = await selectBestAccount(admin, asUserId, body?.account_id);
    const recentMsg = await getRecentMessage(admin, asUserId, account.id);
    const asks: BenchmarkAsk[] = customAsks?.length
      ? customAsks.map((p, i) => ({ index: i + 1, prompt: p, category: categorizeCustomAsk(p) }))
      : buildDefaultAsks(account.name, recentMsg);

    await updateRow({
      current_step: "minting_jwt",
      account_id: account.id,
      account_name: account.name,
      ask_count: asks.length,
      payload: {
        account: { id: account.id, name: account.name, signal: account._signal, selection_reason: account._selection_reason },
        save_outputs: saveOutputs,
        checkpoints: [],
        results: [],
      },
    });

    const userJwt = await mintUserJwt(admin, asUserId);
    const threadId = await createScratchThread(admin, asUserId, account.id);

    const sameContextBlock = baselineMode === "raw_only"
      ? null
      : await buildSameContextBlock(admin, asUserId, account.id, account.name);

    await updateRow({
      current_step: `ready:thread_${threadId.slice(0, 8)}`,
      payload: {
        account: { id: account.id, name: account.name, signal: account._signal, selection_reason: account._selection_reason },
        thread_id: threadId,
        save_outputs: saveOutputs,
        checkpoints: [],
        results: [],
      },
    });

    const results: Array<{ ask: BenchmarkAsk; outputs: SystemOutput[]; heur: Record<string, HeuristicScore>; judge: JudgeScore; failure: StrategyFailureMode }> = [];
    const checkpoints: any[] = [];
    const persistedResults: any[] = [];

    for (const ask of asks) {
      const stepLabel = `ask_${ask.index}_of_${asks.length}`;
      console.log(`[benchmark] ${stepLabel}: ${ask.prompt.slice(0, 80)}`);
      await updateRow({ current_step: `${stepLabel}:providers` });

      const rawContext = (baselineMode === "same_context" || baselineMode === "both") && sameContextBlock
        ? sameContextBlock
        : undefined;

      // PARALLEL provider calls — Promise.allSettled so one failure does not kill the ask
      const settled = await Promise.allSettled([
        callStrategy(userJwt, threadId, ask.prompt),
        callClaudeRaw(ask.prompt, account.name, rawContext),
        callGptRaw(ask.prompt, account.name, rawContext),
      ]);
      const emptyOut = (sys: SystemOutput["system"], err: string): SystemOutput =>
        ({ system: sys, text: "", latencyMs: 0, attempts: 0, error: err });
      const strategyOut = settled[0].status === "fulfilled" ? settled[0].value : emptyOut("strategy", String((settled[0] as any).reason?.message ?? (settled[0] as any).reason));
      const claudeOut   = settled[1].status === "fulfilled" ? settled[1].value : emptyOut("claude",   String((settled[1] as any).reason?.message ?? (settled[1] as any).reason));
      const gptOut      = settled[2].status === "fulfilled" ? settled[2].value : emptyOut("gpt",      String((settled[2] as any).reason?.message ?? (settled[2] as any).reason));
      const outputs = [strategyOut, claudeOut, gptOut];

      const heur = (judgeMode === "llm_only")
        ? { strategy: emptyHeur(), claude: emptyHeur(), gpt: emptyHeur() }
        : {
            strategy: scoreHeuristic(strategyOut.text, ask, account.name),
            claude: scoreHeuristic(claudeOut.text, ask, account.name),
            gpt: scoreHeuristic(gptOut.text, ask, account.name),
          };

      await updateRow({ current_step: `${stepLabel}:judge` });
      const judge = (judgeMode === "heuristics_only")
        ? heuristicWinnerAsJudge(heur)
        : await judgeWithClaude(ask, outputs, account.name);

      const failure = classifyStrategyFailure(ask, strategyOut, heur.strategy, judge, account.name);
      results.push({ ask, outputs, heur, judge, failure });

      const outputsMeta = outputs.map((o) => ({
        system: o.system, latencyMs: o.latencyMs, attempts: o.attempts, error: o.error,
        httpStatus: o.meta?.http, length: (o.text ?? "").length,
      }));
      checkpoints.push({
        ask_index: ask.index,
        prompt: ask.prompt,
        category: ask.category,
        completed_at: new Date().toISOString(),
        outputs_meta: outputsMeta,
        heuristics: heur,
        judge,
        failure_mode: failure,
      });
      persistedResults.push({
        ask,
        outputs: saveOutputs
          ? outputs
          : outputs.map((o) => ({
              system: o.system, latencyMs: o.latencyMs, attempts: o.attempts,
              error: o.error, httpStatus: o.meta?.http, length: (o.text ?? "").length,
            })),
        heur, judge, failure,
      });

      // Recompute summary + failures so far
      const summarySoFar = results.reduce((acc: any, r) => { acc[r.judge.winner] = (acc[r.judge.winner] ?? 0) + 1; return acc; },
        { strategy: 0, claude: 0, gpt: 0, tie: 0 });
      const failuresSoFar: Record<string, number> = {};
      for (const r of results) if (r.failure !== "none") failuresSoFar[r.failure] = (failuresSoFar[r.failure] ?? 0) + 1;

      await updateRow({
        completed_asks: results.length,
        current_step: `${stepLabel}:done`,
        summary: summarySoFar,
        failures: failuresSoFar,
        payload: {
          account: { id: account.id, name: account.name, signal: account._signal, selection_reason: account._selection_reason },
          thread_id: threadId,
          save_outputs: saveOutputs,
          checkpoints,
          results: persistedResults,
        },
      });
    }

    const markdown = buildMarkdown(account, results, baselineMode, judgeMode);
    const summary = results.reduce((acc: any, r) => { acc[r.judge.winner] = (acc[r.judge.winner] ?? 0) + 1; return acc; },
      { strategy: 0, claude: 0, gpt: 0, tie: 0 });
    const failureCounts: Record<string, number> = {};
    for (const r of results) if (r.failure !== "none") failureCounts[r.failure] = (failureCounts[r.failure] ?? 0) + 1;

    await updateRow({
      status: "completed",
      current_step: "completed",
      completed_asks: results.length,
      summary,
      failures: failureCounts,
      markdown,
      completed_at: new Date().toISOString(),
      payload: {
        account: { id: account.id, name: account.name, signal: account._signal, selection_reason: account._selection_reason },
        thread_id: threadId,
        save_outputs: saveOutputs,
        checkpoints,
        results: persistedResults,
      },
    });
    console.log(`[benchmark] run ${runId} completed`);
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error(`[benchmark] run ${runId} fatal:`, msg, e?.stack);
    await updateRow({
      status: "failed",
      current_step: "failed",
      error: msg,
      completed_at: new Date().toISOString(),
    });
  }
}

// ─── Main handler ───────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!VALIDATION_KEY) {
    return new Response(JSON.stringify({ error: "STRATEGY_VALIDATION_KEY not configured" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const provided = req.headers.get("x-strategy-validation-key") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (provided !== VALIDATION_KEY && bearer !== SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "invalid validation key" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const action: string = body?.action ?? "run";

  // ── STATUS endpoint ──
  if (action === "status") {
    const runId = body?.run_id;
    if (!runId) {
      return new Response(JSON.stringify({ error: "run_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data, error } = await admin
      .from("strategy_benchmark_runs")
      .select("*")
      .eq("id", runId)
      .maybeSingle();
    if (error || !data) {
      return new Response(JSON.stringify({ error: error?.message || "run not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const checkpoints = (data.payload as any)?.checkpoints ?? [];
    return new Response(JSON.stringify({
      ok: true,
      run_id: data.id,
      status: data.status,
      current_step: data.current_step,
      completed_asks: data.completed_asks,
      total_asks: data.ask_count,
      summary: data.summary,
      failures: data.failures,
      error: data.error,
      updated_at: data.updated_at,
      created_at: data.created_at,
      completed_at: data.completed_at,
      account: { id: data.account_id, name: data.account_name },
      checkpoints_count: checkpoints.length,
      checkpoints,
      ...(data.status === "completed"
        ? { markdown: data.markdown, results: (data.payload as any)?.results ?? [] }
        : {}),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ── KICKOFF ──
  const asUserId: string | undefined = body?.as_user_id;
  if (!asUserId) {
    return new Response(JSON.stringify({ error: "as_user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const baselineMode: BaselineMode = (body?.baseline_mode ?? "both") as BaselineMode;
  const judgeMode: JudgeMode = (body?.judge_mode ?? "both") as JudgeMode;
  const saveOutputs: boolean = body?.save_outputs !== false;
  const customAsks: string[] | undefined = Array.isArray(body?.asks) ? body.asks : undefined;

  // Pre-select account so kickoff response carries the picked account + signal.
  let account: any;
  try {
    account = await selectBestAccount(admin, asUserId, body?.account_id);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: `account selection failed: ${e?.message || String(e)}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const askCount = customAsks?.length || 6;

  // Insert run row UP FRONT (status=running) so caller can poll immediately.
  const { data: inserted, error: insErr } = await admin
    .from("strategy_benchmark_runs")
    .insert({
      user_id: asUserId,
      account_id: account.id,
      account_name: account.name,
      baseline_mode: baselineMode,
      judge_mode: judgeMode,
      ask_count: askCount,
      status: "running",
      current_step: "queued",
      completed_asks: 0,
      summary: {},
      failures: {},
      payload: {
        account: { id: account.id, name: account.name, signal: account._signal, selection_reason: account._selection_reason },
        save_outputs: saveOutputs,
        checkpoints: [],
        results: [],
        request_body: {
          as_user_id: asUserId,
          account_id: body?.account_id ?? null,
          asks: customAsks ?? null,
          baseline_mode: baselineMode,
          judge_mode: judgeMode,
          save_outputs: saveOutputs,
        },
      },
      markdown: "",
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    return new Response(JSON.stringify({
      error: "persist_failed_at_kickoff",
      persist_error: insErr?.message || "unknown",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const runId = inserted.id;

  // Detach the actual benchmark work — survive client disconnect.
  const work = runBenchmarkInBackground(admin, runId, asUserId, body, baselineMode, judgeMode, saveOutputs, customAsks);
  // @ts-ignore EdgeRuntime is provided by Supabase edge runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  } else {
    // local fallback (won't be used in production)
    work.catch((e) => console.error("[benchmark] background error:", e));
  }

  return new Response(JSON.stringify({
    ok: true,
    run_id: runId,
    status: "running",
    account: {
      id: account.id, name: account.name,
      signal: account._signal,
      selection_reason: account._selection_reason,
      selected_account_signal: account._signal,
      selected_account_reason: account._selection_reason,
    },
    selection_reason: account._selection_reason,
    signal: account._signal,
    config: { baseline_mode: baselineMode, judge_mode: judgeMode, save_outputs: saveOutputs, ask_count: askCount },
    request_body_used: {
      as_user_id: asUserId,
      account_id: body?.account_id ?? null,
      asks: customAsks ?? null,
      baseline_mode: baselineMode,
      judge_mode: judgeMode,
      save_outputs: saveOutputs,
    },
    poll_instructions: {
      method: "POST",
      path: "/functions/v1/strategy-benchmark-runner",
      headers: { "x-strategy-validation-key": "<key>", "Content-Type": "application/json" },
      body: { action: "status", run_id: runId },
      poll_every_ms: 5000,
      terminal_states: ["completed", "failed"],
    },
  }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

function emptyHeur(): HeuristicScore {
  return { operator_pov: 0, decision_logic: 0, commercial_sharpness: 0, library_leverage: 0, audience_fit: 0, correctness: 0, total: 0 };
}
function heuristicWinnerAsJudge(heur: Record<string, HeuristicScore>): JudgeScore {
  const s = heur.strategy.total, c = heur.claude.total, g = heur.gpt.total;
  let winner: JudgeScore["winner"] = "tie";
  const max = Math.max(s, c, g);
  if (max === s && s > c && s > g) winner = "strategy";
  else if (max === c && c > s && c > g) winner = "claude";
  else if (max === g && g > s && g > c) winner = "gpt";
  return { strategy: s, claude: c, gpt: g, winner, rationale: "heuristics_only mode — no LLM judge", attempts: 0 };
}
