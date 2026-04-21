// ════════════════════════════════════════════════════════════════
// strategy-benchmark-runner — HEADLESS DIAGNOSTIC HARNESS (v2)
//
// Async kickoff + status polling + list + replay + audit logging.
// Provider timing breakdown + smart 429 backoff with jitter.
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

// Env-backed defaults (overridable per-request)
const DEF_RETRY_MAX = parseInt(Deno.env.get("BENCHMARK_RETRY_MAX") ?? "3", 10);
const DEF_RETRY_BASE_MS = parseInt(Deno.env.get("BENCHMARK_RETRY_BASE_MS") ?? "750", 10);
const DEF_RETRY_MAX_MS = parseInt(Deno.env.get("BENCHMARK_RETRY_MAX_MS") ?? "20000", 10);
const DEF_PROVIDER_TIMEOUT_MS = parseInt(Deno.env.get("BENCHMARK_PROVIDER_TIMEOUT_MS") ?? "45000", 10);
const DEF_JUDGE_TIMEOUT_MS = parseInt(Deno.env.get("BENCHMARK_JUDGE_TIMEOUT_MS") ?? "30000", 10);
const TIMEOUT_STRATEGY_MS = 60_000;
const TOTAL_RETRY_BUDGET_MS = 60_000;

// ─── Types ──────────────────────────────────────────────────────
interface BenchmarkAsk { index: number; prompt: string; category: string; }

interface AttemptDetail {
  attempt_number: number;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: "ok" | "error" | "timeout" | "rate_limited" | "http_error";
  http_status?: number;
  error?: string;
  provider?: string;
  model?: string;
  retry_wait_ms?: number;
}
interface TimingBreakdown {
  queue_ms: number | null;
  request_ms: number;
  parse_ms: number;
  judge_ms?: number;
  retry_wait_ms_total: number;
  attempts_detail: AttemptDetail[];
}
interface SystemOutput {
  system: "strategy" | "claude" | "gpt";
  text: string;
  latency_ms_total: number;
  attempts: number;
  error?: string;
  http_status?: number;
  response_length: number;
  provider?: string;
  model?: string;
  timing_breakdown: TimingBreakdown;
}
interface HeuristicScore {
  operator_pov: number; decision_logic: number; commercial_sharpness: number;
  library_leverage: number; audience_fit: number; correctness: number; total: number;
}
interface JudgeScore {
  strategy: number; claude: number; gpt: number;
  winner: "strategy" | "claude" | "gpt" | "tie";
  rationale: string; attempts?: number; error?: string;
  timing_breakdown?: TimingBreakdown;
}
type StrategyFailureMode =
  | "reasoning" | "retrieval" | "routing" | "orchestration"
  | "shallow" | "wrong_question" | "none";
type BaselineMode = "raw_only" | "same_context" | "both";
type JudgeMode = "heuristics_only" | "llm_only" | "both";

interface RetryConfig {
  retry_max: number;
  retry_base_ms: number;
  retry_max_ms: number;
  provider_timeout_ms: number;
  judge_timeout_ms: number;
}

// ─── Audit logger (best-effort) ─────────────────────────────────
// IMPORTANT: writes use direct PostgREST fetch with explicit service-role
// headers, NOT the supabase-js client. The shared client's auth state was
// being lost / mutated inside EdgeRuntime.waitUntil(...) after the kickoff
// response returned, causing every background insert to fail with an RLS
// error even though the client was constructed with the service-role key.
// A direct fetch with explicit headers sidesteps any client-state weirdness.
// (The `admin` arg is kept in the signature for API compatibility with the
// rest of the file; it is not actually used here.)
async function audit(
  _admin: any,
  runId: string,
  event_type: string,
  opts: {
    level?: "info" | "warn" | "error";
    ask_index?: number | null;
    system?: string | null;
    provider?: string | null;
    model?: string | null;
    message?: string;
    details?: Record<string, any>;
  } = {},
) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/strategy_benchmark_audit_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        run_id: runId,
        ask_index: opts.ask_index ?? null,
        event_type,
        event_level: opts.level ?? "info",
        system: opts.system ?? null,
        provider: opts.provider ?? null,
        model: opts.model ?? null,
        message: opts.message ?? "",
        details: opts.details ?? {},
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error(`[audit] insert err: ${resp.status} ${txt} (event=${event_type})`);
    }
  } catch (e: any) {
    // Best-effort: never throw out of audit().
    console.error("[audit] exception:", e?.message || e);
  }
}

// ─── Timeout helper ─────────────────────────────────────────────
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); },
           (e) => { clearTimeout(timer); reject(e); });
  });
}

// ─── Smart retry: exponential backoff w/ jitter, 429-aware ─────
interface CallOnceResult { text: string; http_status: number; raw?: any; parse_ms?: number; }
interface RetryRunResult {
  value: CallOnceResult | null;
  attempts: number;
  attempts_detail: AttemptDetail[];
  retry_wait_ms_total: number;
  request_ms_last: number;
  parse_ms_last: number;
  error?: string;
}
function isRetryable(status?: number, errMsg?: string): boolean {
  if (status === 429) return true;
  if (status && status >= 500) return true;
  if (errMsg && /timeout|rate.?limit|429|ECONNRESET|fetch failed|network/i.test(errMsg)) return true;
  return false;
}
function classifyAttemptStatus(status?: number, errMsg?: string): AttemptDetail["status"] {
  if (errMsg && /timeout/i.test(errMsg)) return "timeout";
  if (status === 429) return "rate_limited";
  if (status && status >= 400) return "http_error";
  if (errMsg) return "error";
  return "ok";
}
function backoffMs(attempt: number, base: number, max: number, retryAfter?: number): number {
  if (retryAfter && retryAfter > 0) return Math.min(retryAfter, max);
  const exp = base * Math.pow(2, attempt - 1);
  const jitter = Math.random() * base;
  return Math.min(Math.floor(exp + jitter), max);
}
function parseRetryAfter(headerVal: string | null): number | undefined {
  if (!headerVal) return undefined;
  const n = parseInt(headerVal, 10);
  if (!isNaN(n)) return n * 1000;
  return undefined;
}

async function runWithSmartRetry(
  admin: any,
  label: string,
  provider: string,
  model: string,
  fn: () => Promise<CallOnceResult & { retry_after_ms?: number }>,
  cfg: { retry_max: number; retry_base_ms: number; retry_max_ms: number; timeout_ms: number },
  runId: string,
  askIndex: number | null,
  system: string,
): Promise<RetryRunResult> {
  const attempts_detail: AttemptDetail[] = [];
  let attempt = 0;
  let retry_wait_ms_total = 0;
  let request_ms_last = 0;
  let parse_ms_last = 0;
  let lastErr: string | undefined;
  const startedTotal = Date.now();

  while (attempt < cfg.retry_max) {
    attempt++;
    const startedIso = new Date().toISOString();
    const t0 = Date.now();
    let status: number | undefined;
    let errMsg: string | undefined;
    let retry_after_ms: number | undefined;
    let value: CallOnceResult | null = null;

    try {
      const v = await withTimeout(fn(), cfg.timeout_ms, label);
      status = v.http_status;
      value = v;
      retry_after_ms = (v as any).retry_after_ms;
      request_ms_last = Date.now() - t0;
      parse_ms_last = v.parse_ms ?? 0;
    } catch (e: any) {
      errMsg = e?.message || String(e);
      request_ms_last = Date.now() - t0;
    }

    const ended = Date.now();
    const detail: AttemptDetail = {
      attempt_number: attempt,
      started_at: startedIso,
      ended_at: new Date(ended).toISOString(),
      duration_ms: ended - t0,
      status: classifyAttemptStatus(status, errMsg),
      http_status: status,
      error: errMsg,
      provider, model,
    };

    const success = !errMsg && status !== undefined && status < 400;
    if (success) {
      attempts_detail.push(detail);
      await audit(admin, runId, "provider_call_success", {
        ask_index: askIndex, system, provider, model,
        message: `${label} ok in ${detail.duration_ms}ms (attempt ${attempt})`,
        details: { duration_ms: detail.duration_ms, http_status: status },
      });
      return { value, attempts: attempt, attempts_detail, retry_wait_ms_total, request_ms_last, parse_ms_last };
    }

    const retryable = isRetryable(status, errMsg);
    const budgetLeft = TOTAL_RETRY_BUDGET_MS - (Date.now() - startedTotal);
    const canRetry = attempt < cfg.retry_max && retryable && budgetLeft > 100;

    if (canRetry) {
      const wait = Math.min(backoffMs(attempt, cfg.retry_base_ms, cfg.retry_max_ms, retry_after_ms), budgetLeft);
      detail.retry_wait_ms = wait;
      attempts_detail.push(detail);
      await audit(admin, runId, "retry_scheduled", {
        level: "warn", ask_index: askIndex, system, provider, model,
        message: `${label} retry ${attempt + 1}/${cfg.retry_max} in ${wait}ms (status=${status ?? "n/a"})`,
        details: { http_status: status, error: errMsg, wait_ms: wait, retry_after_ms },
      });
      retry_wait_ms_total += wait;
      lastErr = errMsg ?? `HTTP ${status}`;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    attempts_detail.push(detail);
    lastErr = errMsg ?? `HTTP ${status}`;
    await audit(admin, runId, retryable ? "retry_exhausted" : "provider_call_failure", {
      level: "error", ask_index: askIndex, system, provider, model,
      message: `${label} failed: ${lastErr}`,
      details: { http_status: status, error: errMsg, attempts: attempt },
    });
    return { value: null, attempts: attempt, attempts_detail, retry_wait_ms_total, request_ms_last, parse_ms_last, error: lastErr };
  }
  return { value: null, attempts: attempt, attempts_detail, retry_wait_ms_total, request_ms_last, parse_ms_last, error: lastErr ?? "exhausted" };
}

// ─── Account auto-selection ─────────────────────────────────────
async function selectBestAccount(admin: any, userId: string, override?: string) {
  if (override) {
    const { data } = await admin.from("accounts")
      .select("id, name, website, industry, notes, tier, account_status")
      .eq("id", override).eq("user_id", userId).is("deleted_at", null).maybeSingle();
    if (!data) throw new Error(`account ${override} not found for user`);
    const sig = await accountSignal(admin, userId, data.id);
    return { ...data, _signal: sig, _selection_reason: "explicit account_id override" };
  }
  const { data: accounts } = await admin.from("accounts")
    .select("id, name, website, industry, notes, tier, account_status, updated_at")
    .eq("user_id", userId).is("deleted_at", null).limit(200);
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
  const cMap = tally(contactsRes.data), oMap = tally(oppsRes.data), tMap = tally(callsRes.data), mMap = tally(memRes.data);
  let best: any = null; let bestScore = -1;
  for (const a of accounts) {
    const contacts = cMap.get(a.id) ?? 0, opps = oMap.get(a.id) ?? 0, calls = tMap.get(a.id) ?? 0, mems = mMap.get(a.id) ?? 0;
    const notesLen = (a.notes ?? "").length;
    const score = contacts * 3 + opps * 5 + calls * 4 + mems * 2 + Math.min(notesLen / 200, 5);
    if (score > bestScore) {
      bestScore = score;
      best = { ...a, _signal: { contacts, opps, calls, mems, notesLen, score: +score.toFixed(2) },
        _selection_reason: `auto-selected: highest signal density across ${accounts.length} active accounts` };
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

// ─── Default asks ───────────────────────────────────────────────
function buildDefaultAsks(accountName: string, recentMessage: string): BenchmarkAsk[] {
  return [
    { index: 1, category: "account_brief", prompt: `Tell me about ${accountName}` },
    { index: 2, category: "ramp_plan", prompt: `Give me a 90 day plan as a new AE on ${accountName}` },
    { index: 3, category: "audience_rewrite", prompt: `Rewrite this for a CFO: ${recentMessage}` },
    { index: 4, category: "next_step", prompt: `What should I do next on ${accountName}?` },
    { index: 5, category: "discovery", prompt: `Build me a discovery framework for ${accountName}` },
    { index: 6, category: "renewal_memo", prompt: `Draft a renewal memo for ${accountName}` },
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

// ─── Provider calls (each returns text + http_status + raw + parse_ms) ─
async function strategyCall(userJwt: string, threadId: string, prompt: string): Promise<CallOnceResult> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/strategy-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userJwt}`, apikey: ANON_KEY },
    body: JSON.stringify({ action: "chat", threadId, content: prompt, _v2: true }),
  });
  let text = "";
  const t1 = Date.now();
  if (resp.body) {
    const reader = resp.body.getReader(); const dec = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); }
  }
  return { text, http_status: resp.status, parse_ms: Date.now() - t1 };
}
async function claudeCall(prompt: string, systemPrompt: string): Promise<CallOnceResult & { retry_after_ms?: number }> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, system: systemPrompt, messages: [{ role: "user", content: prompt }] }),
  });
  const t1 = Date.now();
  const data = await resp.json();
  const text = (data?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  return { text, http_status: resp.status, raw: data, parse_ms: Date.now() - t1, retry_after_ms: parseRetryAfter(resp.headers.get("retry-after")) };
}
async function gptCall(prompt: string, systemPrompt: string): Promise<CallOnceResult & { retry_after_ms?: number }> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: GPT_MODEL, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }], max_completion_tokens: 2000 }),
  });
  const t1 = Date.now();
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { text, http_status: resp.status, raw: data, parse_ms: Date.now() - t1, retry_after_ms: parseRetryAfter(resp.headers.get("retry-after")) };
}

function buildSystemOutput(
  system: SystemOutput["system"], provider: string, model: string,
  result: RetryRunResult, total_ms: number,
): SystemOutput {
  const text = result.value?.text ?? "";
  return {
    system, text,
    latency_ms_total: total_ms,
    attempts: result.attempts,
    error: result.error,
    http_status: result.attempts_detail[result.attempts_detail.length - 1]?.http_status,
    response_length: text.length,
    provider, model,
    timing_breakdown: {
      queue_ms: null,
      request_ms: result.request_ms_last,
      parse_ms: result.parse_ms_last,
      retry_wait_ms_total: result.retry_wait_ms_total,
      attempts_detail: result.attempts_detail,
    },
  };
}

async function runStrategy(admin: any, runId: string, askIndex: number, userJwt: string, threadId: string, prompt: string, cfg: RetryConfig): Promise<SystemOutput> {
  await audit(admin, runId, "provider_call_start", { ask_index: askIndex, system: "strategy", provider: "internal", model: "strategy-v2", message: "strategy start" });
  const t0 = Date.now();
  const result = await runWithSmartRetry(admin, "strategy", "internal", "strategy-v2",
    () => strategyCall(userJwt, threadId, prompt),
    { retry_max: 1, retry_base_ms: cfg.retry_base_ms, retry_max_ms: cfg.retry_max_ms, timeout_ms: TIMEOUT_STRATEGY_MS },
    runId, askIndex, "strategy");
  return buildSystemOutput("strategy", "internal", "strategy-v2", result, Date.now() - t0);
}
async function runClaude(admin: any, runId: string, askIndex: number, prompt: string, accountName: string, extraContext: string | undefined, cfg: RetryConfig): Promise<SystemOutput> {
  if (!ANTHROPIC_KEY) {
    return { system: "claude", text: "", latency_ms_total: 0, attempts: 0, error: "ANTHROPIC_API_KEY missing",
      response_length: 0, provider: "anthropic", model: CLAUDE_MODEL,
      timing_breakdown: { queue_ms: null, request_ms: 0, parse_ms: 0, retry_wait_ms_total: 0, attempts_detail: [] } };
  }
  const sys = `You are a sales strategist. The account is "${accountName}". ${extraContext ?? "You have no internal library or CRM access — answer from general knowledge only."}`;
  await audit(admin, runId, "provider_call_start", { ask_index: askIndex, system: "claude", provider: "anthropic", model: CLAUDE_MODEL, message: "claude start" });
  const t0 = Date.now();
  const result = await runWithSmartRetry(admin, "claude", "anthropic", CLAUDE_MODEL,
    () => claudeCall(prompt, sys),
    { retry_max: cfg.retry_max, retry_base_ms: cfg.retry_base_ms, retry_max_ms: cfg.retry_max_ms, timeout_ms: cfg.provider_timeout_ms },
    runId, askIndex, "claude");
  return buildSystemOutput("claude", "anthropic", CLAUDE_MODEL, result, Date.now() - t0);
}
async function runGpt(admin: any, runId: string, askIndex: number, prompt: string, accountName: string, extraContext: string | undefined, cfg: RetryConfig): Promise<SystemOutput> {
  if (!OPENAI_KEY) {
    return { system: "gpt", text: "", latency_ms_total: 0, attempts: 0, error: "OPENAI_API_KEY missing",
      response_length: 0, provider: "openai", model: GPT_MODEL,
      timing_breakdown: { queue_ms: null, request_ms: 0, parse_ms: 0, retry_wait_ms_total: 0, attempts_detail: [] } };
  }
  const sys = `You are a sales strategist. The account is "${accountName}". ${extraContext ?? "You have no internal library or CRM access — answer from general knowledge only."}`;
  await audit(admin, runId, "provider_call_start", { ask_index: askIndex, system: "gpt", provider: "openai", model: GPT_MODEL, message: "gpt start" });
  const t0 = Date.now();
  const result = await runWithSmartRetry(admin, "gpt", "openai", GPT_MODEL,
    () => gptCall(prompt, sys),
    { retry_max: cfg.retry_max, retry_base_ms: cfg.retry_base_ms, retry_max_ms: cfg.retry_max_ms, timeout_ms: cfg.provider_timeout_ms },
    runId, askIndex, "gpt");
  return buildSystemOutput("gpt", "openai", GPT_MODEL, result, Date.now() - t0);
}

// ─── Heuristics ─────────────────────────────────────────────────
function scoreHeuristic(text: string, ask: BenchmarkAsk, accountName: string): HeuristicScore {
  const t = (text ?? "").trim(); const lower = t.toLowerCase(); const len = t.length;
  const hasNumbers = /\b\d+(\.\d+)?%?\b/.test(t);
  const hasBullets = /(^|\n)\s*([-*•]|\d+[.)])\s+/.test(t);
  const hasHeadings = /(^|\n)#{1,4}\s+\S/.test(t) || /(^|\n)\*\*[A-Z][^*]+\*\*/.test(t);
  const mentionsAccount = lower.includes(accountName.toLowerCase());
  const hasResourceCitations = /RESOURCE\[[^\]]+\]|KI\[[^\]]+\]|PLAYBOOK\[[^\]]+\]/i.test(t);
  const hasInternalLeverage = /\b(playbook|knowledge item|our (data|library|notes)|previous call|account memory)\b/i.test(t);
  const hasCommercialTerms = /\b(arr|ACV|pipeline|quota|close rate|win rate|expansion|renewal|MEDDIC|MEDDPICC|champion|economic buyer|stakeholder map)\b/i.test(t);
  const hasDecisionLogic = /\b(if|because|therefore|so that|the risk is|trade-?off|prioriti[sz]e|first|then|next)\b/i.test(t);
  const hasOperatorPOV = /\b(I would|do this|start by|book a meeting|send a|call|today|this week|next 7 days|first move)\b/i.test(t);
  const audienceMatch = ask.category === "audience_rewrite"
    ? /\b(CFO|cost of capital|payback|ROI|margin|cash|EBITDA|TCO|board|finance)\b/i.test(t) : true;
  const tooShort = len < 400; const wallOfText = !hasBullets && !hasHeadings && len > 1200;
  const operator_pov = clamp10((hasOperatorPOV ? 6 : 2) + (mentionsAccount ? 2 : 0) + (hasBullets ? 2 : 0) - (tooShort ? 4 : 0));
  const decision_logic = clamp10((hasDecisionLogic ? 5 : 1) + (hasHeadings ? 3 : 0) + (hasBullets ? 2 : 0) - (wallOfText ? 3 : 0));
  const commercial_sharpness = clamp10((hasCommercialTerms ? 5 : 1) + (hasNumbers ? 3 : 0) + (mentionsAccount ? 2 : 0));
  const library_leverage = clamp10((hasResourceCitations ? 7 : 0) + (hasInternalLeverage ? 3 : 0));
  const audience_fit = clamp10((audienceMatch ? 7 : 2) + (ask.category === "audience_rewrite" && /\b(CFO|finance)\b/i.test(t) ? 3 : 0));
  const correctness = clamp10((len > 200 ? 5 : 0) + (mentionsAccount ? 2 : 0) + (hasHeadings || hasBullets ? 2 : 0) +
    (tooShort ? -3 : 0) + (text && !text.toLowerCase().includes("i don't have") ? 1 : 0));
  const total = +((operator_pov + decision_logic + commercial_sharpness + library_leverage + audience_fit + correctness) / 6).toFixed(2);
  return { operator_pov, decision_logic, commercial_sharpness, library_leverage, audience_fit, correctness, total };
}
function clamp10(n: number) { return Math.max(0, Math.min(10, Math.round(n))); }
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

// ─── Judge ──────────────────────────────────────────────────────
async function judgeOnce(ask: BenchmarkAsk, outputs: SystemOutput[], accountName: string): Promise<CallOnceResult & { retry_after_ms?: number }> {
  const truncate = (s: string) => (s.length > 6000 ? s.slice(0, 6000) + "\n…[truncated]" : s);
  const findOut = (sys: string) => outputs.find((o) => o.system === sys);
  const system = `You are a brutally honest sales-execution evaluator. Score three responses 0-10. Account: "${accountName}". Return STRICT JSON only: {"strategy":N,"claude":N,"gpt":N,"winner":"strategy|claude|gpt|tie","rationale":"<=400 chars"}`;
  const user = `PROMPT:\n${ask.prompt}\n\n=== STRATEGY ===\n${truncate(findOut("strategy")?.text || "(empty)")}\n\n=== CLAUDE ===\n${truncate(findOut("claude")?.text || "(empty)")}\n\n=== GPT ===\n${truncate(findOut("gpt")?.text || "(empty)")}\n\nReturn JSON now.`;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: JUDGE_MODEL, max_tokens: 800, system, messages: [{ role: "user", content: user }] }),
  });
  const t1 = Date.now();
  const data = await resp.json();
  const raw = (data?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`judge_no_json: ${raw.slice(0, 200)}`);
  // We return raw text (the JSON match) — JSON.parse happens at caller
  return { text: m[0], http_status: resp.status, raw: data, parse_ms: Date.now() - t1, retry_after_ms: parseRetryAfter(resp.headers.get("retry-after")) };
}
async function judgeWithClaude(admin: any, runId: string, askIndex: number, ask: BenchmarkAsk, outputs: SystemOutput[], accountName: string, cfg: RetryConfig): Promise<JudgeScore> {
  if (!ANTHROPIC_KEY) {
    return { strategy: 0, claude: 0, gpt: 0, winner: "tie", rationale: "ANTHROPIC_API_KEY missing", attempts: 0 };
  }
  await audit(admin, runId, "judge_start", { ask_index: askIndex, system: "judge", provider: "anthropic", model: JUDGE_MODEL });
  const t0 = Date.now();
  const result = await runWithSmartRetry(admin, "judge", "anthropic", JUDGE_MODEL,
    () => judgeOnce(ask, outputs, accountName),
    { retry_max: cfg.retry_max, retry_base_ms: cfg.retry_base_ms, retry_max_ms: cfg.retry_max_ms, timeout_ms: cfg.judge_timeout_ms },
    runId, askIndex, "judge");
  const total_ms = Date.now() - t0;
  if (!result.value) {
    await audit(admin, runId, "judge_failure", { level: "error", ask_index: askIndex, system: "judge", message: result.error });
    return { strategy: 0, claude: 0, gpt: 0, winner: "tie", rationale: result.error ?? "judge failed", attempts: result.attempts, error: result.error,
      timing_breakdown: { queue_ms: null, request_ms: result.request_ms_last, parse_ms: result.parse_ms_last, judge_ms: total_ms, retry_wait_ms_total: result.retry_wait_ms_total, attempts_detail: result.attempts_detail } };
  }
  let p: any = {};
  try { p = JSON.parse(result.value.text); } catch (e: any) {
    await audit(admin, runId, "judge_failure", { level: "error", ask_index: askIndex, system: "judge", message: `parse fail: ${e?.message}` });
    return { strategy: 0, claude: 0, gpt: 0, winner: "tie", rationale: "judge JSON parse failed", attempts: result.attempts, error: e?.message };
  }
  await audit(admin, runId, "judge_success", { ask_index: askIndex, system: "judge", message: `winner=${p.winner}` });
  return {
    strategy: Number(p.strategy ?? 0), claude: Number(p.claude ?? 0), gpt: Number(p.gpt ?? 0),
    winner: (p.winner ?? "tie") as JudgeScore["winner"], rationale: String(p.rationale ?? "").slice(0, 600),
    attempts: result.attempts,
    timing_breakdown: { queue_ms: null, request_ms: result.request_ms_last, parse_ms: result.parse_ms_last, judge_ms: total_ms, retry_wait_ms_total: result.retry_wait_ms_total, attempts_detail: result.attempts_detail },
  };
}

// ─── Diagnostics: contract compliance + decision-logic signals ──
// Pure-text inspectors. NO behavior change. Persisted into payload
// alongside each Strategy result for offline analysis.

// strategy-chat returns its answer as an SSE stream (lines like
// `data: {"choices":[{"delta":{"content":"..."}}]}` plus a final
// `data: [DONE]`). The benchmark runner accumulates the raw stream
// into `strategyOut.text`, so naive header/regex checks were running
// against the wrapper, not the visible answer. This helper extracts
// the actual visible Strategy text. If the input is not SSE-shaped it
// returns the raw text unchanged.
function extractVisibleStrategyText(raw: string): { text: string; source: "parsed_sse" | "raw_text" } {
  const input = raw ?? "";
  if (!input) return { text: "", source: "raw_text" };
  // Quick sniff — only treat as SSE if we see at least one data: frame
  // that looks like JSON. Avoids false positives on plain markdown that
  // happens to mention "data:".
  const looksLikeSse = /(^|\n)\s*data:\s*[{\[]/.test(input) || /(^|\n)\s*data:\s*\[DONE\]/.test(input);
  if (!looksLikeSse) return { text: input, source: "raw_text" };

  let out = "";
  // Split on newlines; SSE frames are separated by blank lines but each
  // data line is independently parseable.
  for (const lineRaw of input.split(/\r?\n/)) {
    const line = lineRaw.trimEnd();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let obj: any;
    try { obj = JSON.parse(payload); } catch { continue; }
    // OpenAI/Lovable AI streaming shape
    const choices = obj?.choices;
    if (Array.isArray(choices)) {
      for (const c of choices) {
        const delta = c?.delta?.content ?? c?.message?.content;
        if (typeof delta === "string") out += delta;
      }
      continue;
    }
    // Anthropic-style streaming
    if (obj?.type === "content_block_delta" && typeof obj?.delta?.text === "string") {
      out += obj.delta.text;
      continue;
    }
    // Generic fallbacks
    if (typeof obj?.delta?.content === "string") out += obj.delta.content;
    else if (typeof obj?.content === "string") out += obj.content;
    else if (typeof obj?.text === "string") out += obj.text;
  }

  // If parsing produced nothing meaningful, fall back to raw.
  if (!out.trim()) return { text: input, source: "raw_text" };
  return { text: out, source: "parsed_sse" };
}
const FORBIDDEN_OPENING_PHRASES = [
  "Commercial POV:",
  "Buying Motion:",
  "Stakeholder Map:",
  "Top Risks:",
  "Lead Angle:",
  "The dominant lever",
  "The dominant move",
  "The real lever",
  "What actually matters",
  "The key motion",
];

function detectForbiddenOpening(text: string): { found: boolean; phrase: string | null } {
  const head = (text || "").trimStart().slice(0, 400);
  for (const p of FORBIDDEN_OPENING_PHRASES) {
    if (head.toLowerCase().includes(p.toLowerCase())) return { found: true, phrase: p };
  }
  return { found: false, phrase: null };
}

function extractSectionHeaders(text: string): string[] {
  const out: string[] = [];
  for (const line of (text || "").split(/\r?\n/)) {
    const m = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/);
    if (m) out.push(`${m[1]} ${m[2].trim()}`);
  }
  return out;
}

function startsWithHeader(text: string, header: string): boolean {
  const t = (text || "").replace(/^\uFEFF/, "").trimStart();
  return t.toLowerCase().startsWith(header.toLowerCase());
}

function buildContractCompliance(
  classifiedIntent: string | null,
  text: string,
): Record<string, unknown> | null {
  if (!classifiedIntent) return null;
  if (classifiedIntent !== "account_brief" && classifiedIntent !== "ninety_day_plan") return null;

  const opening_excerpt = (text || "").slice(0, 220);
  const section_headers_detected = extractSectionHeaders(text);
  const numbered_list_count = (text.match(/^\s{0,3}\d+\.\s+/gm) || []).length;
  const bullet_count = (text.match(/^\s{0,3}[-*]\s+/gm) || []).length;
  const forbidden = detectForbiddenOpening(text);
  const lower = (text || "").toLowerCase();

  if (classifiedIntent === "account_brief") {
    const first_header_expected = "## Company Snapshot";
    return {
      mode: "account_brief",
      first_header_expected,
      starts_with_expected_header: startsWithHeader(text, first_header_expected),
      contains_company_snapshot_header: /^##\s+company snapshot/im.test(text),
      contains_stakeholders_header: /^##\s+stakeholders/im.test(text),
      contains_operator_read_header: /^##\s+operator read/im.test(text),
      contains_next_moves_header: /^##\s+next moves/im.test(text),
      forbidden_opening_phrase_found: forbidden.found,
      forbidden_opening_phrase: forbidden.phrase,
      opening_excerpt,
      section_headers_detected,
      numbered_list_count,
      bullet_count,
    };
  }

  // ninety_day_plan
  const first_header_expected = "## Account Context";
  return {
    mode: "ninety_day_plan",
    first_header_expected,
    starts_with_expected_header: startsWithHeader(text, first_header_expected),
    contains_account_context_header: /^##\s+account context/im.test(text),
    contains_days_1_30_header: /^##\s+days?\s*1\s*[–-]\s*30/im.test(text),
    contains_days_31_60_header: /^##\s+days?\s*31\s*[–-]\s*60/im.test(text),
    contains_days_61_90_header: /^##\s+days?\s*61\s*[–-]\s*90/im.test(text),
    contains_operator_read_header: /^##\s+operator read/im.test(text),
    forbidden_opening_phrase_found: forbidden.found,
    forbidden_opening_phrase: forbidden.phrase,
    opening_excerpt,
    section_headers_detected,
    numbered_list_count,
    bullet_count,
  };
}

function buildDecisionLogicDiagnostics(text: string): Record<string, unknown> {
  const t = text || "";
  const lower = t.toLowerCase();
  const matched: string[] = [];
  const regs: Array<{ name: string; re: RegExp }> = [
    { name: "if_then", re: /\bif\b[^.\n]{1,80}\bthen\b/i },
    { name: "because", re: /\bbecause\b/i },
    { name: "numbered_steps", re: /^\s{0,3}\d+\.\s+/m },
    { name: "time_phases", re: /\bdays?\s*\d{1,3}\s*[–-]\s*\d{1,3}\b/i },
    { name: "explicit_tradeoff", re: /\b(trade[- ]?off|tradeoff|vs\.?|versus|instead of|rather than)\b/i },
    { name: "next_move", re: /\b(next move|next step|this week|by (mon|tue|wed|thu|fri|monday|tuesday|wednesday|thursday|friday)|do this|recommend(ed)?:?)\b/i },
  ];
  for (const r of regs) if (r.re.test(t)) matched.push(r.name);

  return {
    contains_if_then: matched.includes("if_then"),
    contains_because: matched.includes("because"),
    contains_numbered_steps: matched.includes("numbered_steps"),
    contains_time_phases: matched.includes("time_phases"),
    contains_explicit_tradeoff: matched.includes("explicit_tradeoff"),
    contains_next_move_language: matched.includes("next_move"),
    matched_decision_regexes: matched,
  };
}

// Lightweight intent inference for diagnostic tagging only. Does not
// affect routing; mirrors the patterns already used by strategy-chat
// so we can label persisted evidence even if the classified intent is
// not echoed back from runStrategy. NEVER changes product behavior.
function inferIntentForDiagnostics(prompt: string): string | null {
  const p = (prompt || "").toLowerCase();
  if (/\b(90[-\s]?day|ninety[-\s]?day)\b.*\b(plan|ramp|playbook)\b/.test(p) ||
      /\bplan\b.*\b(90|ninety)[-\s]?day/.test(p) ||
      /\b(as a new ae|new ae on this account)\b/.test(p)) return "ninety_day_plan";
  if (/\b(tell me about|brief me on|what do (you|we) know about|account brief|company brief)\b/.test(p)) return "account_brief";
  return null;
}

function classifyStrategyFailure(ask: BenchmarkAsk, strategyOut: SystemOutput, heur: HeuristicScore, judge: JudgeScore, accountName: string): StrategyFailureMode {
  if (judge.winner === "strategy") return "none";
  const text = strategyOut.text || ""; const lower = text.toLowerCase();
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
  meta: { total_runtime_ms: number; save_outputs: boolean; replayed_from_run_id?: string | null; retry_summary: any },
): string {
  const tally = { strategy: 0, claude: 0, gpt: 0, tie: 0 };
  for (const r of results) (tally as any)[r.judge.winner] = ((tally as any)[r.judge.winner] ?? 0) + 1;
  const failureCounts: Record<string, number> = {};
  for (const r of results) if (r.failure !== "none") failureCounts[r.failure] = (failureCounts[r.failure] ?? 0) + 1;

  const providerTimingAgg: Record<string, { total_ms: number; calls: number; retries: number }> = {};
  for (const r of results) for (const o of r.outputs) {
    const k = o.system; if (!providerTimingAgg[k]) providerTimingAgg[k] = { total_ms: 0, calls: 0, retries: 0 };
    providerTimingAgg[k].total_ms += o.latency_ms_total; providerTimingAgg[k].calls++;
    providerTimingAgg[k].retries += Math.max(0, o.attempts - 1);
  }

  const lines: string[] = [];
  lines.push(`# Strategy Benchmark Report`);
  lines.push("");
  lines.push(`## Execution Summary`);
  lines.push(`- **Total runtime:** ${(meta.total_runtime_ms / 1000).toFixed(1)}s`);
  lines.push(`- **Account:** ${account.name} — _${account._selection_reason ?? "n/a"}_`);
  if (account._signal) lines.push(`- **Signal density:** contacts=${account._signal.contacts}, opps=${account._signal.opps}, calls=${account._signal.calls}, memory=${account._signal.mems}, score=${account._signal.score}`);
  lines.push(`- **Config:** baseline=\`${baselineMode}\`, judge=\`${judgeMode}\`, asks=${results.length}`);
  lines.push(`- **Wins:** strategy=${tally.strategy}, claude=${tally.claude}, gpt=${tally.gpt}, tie=${tally.tie}`);
  lines.push(`- **Failure modes:** ${Object.keys(failureCounts).length ? Object.entries(failureCounts).map(([k, v]) => `${k}=${v}`).join(", ") : "(none)"}`);
  lines.push(`- **Provider timing:** ${Object.entries(providerTimingAgg).map(([k, v]) => `${k}=${(v.total_ms / Math.max(1, v.calls) / 1000).toFixed(1)}s avg, ${v.retries} retries`).join(" • ")}`);
  lines.push(`- **Retry summary:** ${meta.retry_summary.total_retries} total retries, ${meta.retry_summary.total_wait_ms}ms total wait`);
  lines.push(`- **Raw outputs stored:** ${meta.save_outputs ? "yes" : "no"}`);
  if (meta.replayed_from_run_id) lines.push(`- **Replayed from:** \`${meta.replayed_from_run_id}\``);
  lines.push(""); lines.push("---");

  for (const r of results) {
    lines.push(`## Ask ${r.ask.index}: ${r.ask.prompt}`);
    lines.push(`*Category:* ${r.ask.category}`);
    lines.push("");
    lines.push("| System | Latency | Attempts | Retry Wait | HTTP | Length | Heur Total | Judge | Winner |");
    lines.push("|---|---|---|---|---|---|---|---|---|");
    for (const sys of ["strategy", "claude", "gpt"] as const) {
      const o = r.outputs.find((x) => x.system === sys)!; const h = r.heur[sys]; const j = (r.judge as any)[sys];
      const winner = r.judge.winner === sys ? "🏆" : "";
      lines.push(`| ${sys} | ${o.latency_ms_total}ms | ${o.attempts} | ${o.timing_breakdown.retry_wait_ms_total}ms | ${o.http_status ?? "—"} | ${o.response_length} | ${h.total} | ${j} | ${winner} |`);
    }
    lines.push("");
    lines.push(`**Judge:** ${r.judge.winner.toUpperCase()} — ${r.judge.rationale}`);
    if (r.failure !== "none") lines.push(`**Strategy failure mode:** \`${r.failure}\``);
    lines.push(""); lines.push("---");
  }
  return lines.join("\n");
}

// ─── Auth + thread + context helpers ────────────────────────────
async function mintUserJwt(admin: any, asUserId: string): Promise<string> {
  const { data: targetUser, error: e1 } = await admin.auth.admin.getUserById(asUserId);
  if (e1 || !targetUser?.user) throw new Error(`as_user_id not found: ${e1?.message}`);
  const { data: linkData, error: e2 } = await admin.auth.admin.generateLink({ type: "magiclink", email: targetUser.user.email! });
  if (e2 || !linkData?.properties?.hashed_token) throw new Error(`generateLink failed: ${e2?.message}`);
  const { data: verifyData, error: e3 } = await admin.auth.verifyOtp({ type: "magiclink", token_hash: linkData.properties.hashed_token });
  if (e3 || !verifyData?.session?.access_token) throw new Error(`verifyOtp failed: ${e3?.message}`);
  return verifyData.session.access_token;
}
async function getRecentMessage(admin: any, userId: string, accountId: string): Promise<string> {
  const { data: threads } = await admin.from("strategy_threads").select("id").eq("user_id", userId).eq("linked_account_id", accountId).limit(5);
  const ids = (threads ?? []).map((t: any) => t.id);
  if (ids.length) {
    const { data: msgs } = await admin.from("strategy_messages").select("content_json, role, created_at").in("thread_id", ids).eq("role", "user").order("created_at", { ascending: false }).limit(1);
    const txt = msgs?.[0]?.content_json?.text;
    if (txt && typeof txt === "string" && txt.length > 40) return txt.slice(0, 800);
  }
  return "Hey team — pilot is going well, 12% lift in conversion on the test cohort, buying committee asking about expansion timeline. I think we have a real shot at locking in Q4. Thoughts on next steps?";
}
async function createScratchThread(admin: any, userId: string, accountId: string): Promise<string> {
  const { data, error } = await admin.from("strategy_threads").insert({
    user_id: userId, title: `[benchmark] ${new Date().toISOString().slice(0, 19)}`,
    thread_type: "general", lane: "general", linked_account_id: accountId, status: "active",
  }).select("id").single();
  if (error) throw new Error(`create thread failed: ${error.message}`);
  return data.id;
}
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
  admin: any, runId: string, asUserId: string, body: any,
  baselineMode: BaselineMode, judgeMode: JudgeMode, saveOutputs: boolean,
  customAsks: string[] | undefined, retryCfg: RetryConfig,
  replayedFromRunId: string | null,
) {
  const startedAt = Date.now();
  const updateRow = async (patch: Record<string, any>) => {
    try {
      const { error } = await admin.from("strategy_benchmark_runs")
        .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", runId);
      if (error) console.error("[benchmark] update err:", error.message);
    } catch (e: any) { console.error("[benchmark] update exception:", e?.message || e); }
  };

  try {
    await audit(admin, runId, "background_started", { message: `background work started in waitUntil for user ${asUserId}` });
    await audit(admin, runId, "kickoff", { message: `run started for user ${asUserId}` });
    await updateRow({ current_step: "selecting_account" });
    const account = await selectBestAccount(admin, asUserId, body?.account_id);
    await audit(admin, runId, "account_selection", { message: `selected ${account.name}`, details: { account_id: account.id, signal: account._signal, reason: account._selection_reason } });

    const recentMsg = await getRecentMessage(admin, asUserId, account.id);
    const asks: BenchmarkAsk[] = customAsks?.length
      ? customAsks.map((p, i) => ({ index: i + 1, prompt: p, category: categorizeCustomAsk(p) }))
      : buildDefaultAsks(account.name, recentMsg);

    await updateRow({
      current_step: "minting_jwt", account_id: account.id, account_name: account.name, ask_count: asks.length,
      payload: { account: { id: account.id, name: account.name, signal: account._signal, selection_reason: account._selection_reason }, save_outputs: saveOutputs, checkpoints: [], results: [] },
    });
    const userJwt = await mintUserJwt(admin, asUserId);
    const threadId = await createScratchThread(admin, asUserId, account.id);
    await audit(admin, runId, "thread_created", { message: `thread ${threadId}`, details: { thread_id: threadId } });

    const sameContextBlock = baselineMode === "raw_only" ? null : await buildSameContextBlock(admin, asUserId, account.id, account.name);

    const results: Array<{ ask: BenchmarkAsk; outputs: SystemOutput[]; heur: Record<string, HeuristicScore>; judge: JudgeScore; failure: StrategyFailureMode }> = [];
    const checkpoints: any[] = [];
    const persistedResults: any[] = [];

    for (const ask of asks) {
      const stepLabel = `ask_${ask.index}_of_${asks.length}`;
      await audit(admin, runId, "ask_start", { ask_index: ask.index, message: ask.prompt.slice(0, 120) });
      await updateRow({ current_step: `${stepLabel}:providers` });
      const rawContext = (baselineMode === "same_context" || baselineMode === "both") && sameContextBlock ? sameContextBlock : undefined;

      const settled = await Promise.allSettled([
        runStrategy(admin, runId, ask.index, userJwt, threadId, ask.prompt, retryCfg),
        runClaude(admin, runId, ask.index, ask.prompt, account.name, rawContext, retryCfg),
        runGpt(admin, runId, ask.index, ask.prompt, account.name, rawContext, retryCfg),
      ]);
      const emptyOut = (sys: SystemOutput["system"], err: string): SystemOutput =>
        ({ system: sys, text: "", latency_ms_total: 0, attempts: 0, error: err, response_length: 0,
           timing_breakdown: { queue_ms: null, request_ms: 0, parse_ms: 0, retry_wait_ms_total: 0, attempts_detail: [] } });
      const strategyOut = settled[0].status === "fulfilled" ? settled[0].value : emptyOut("strategy", String((settled[0] as any).reason?.message ?? (settled[0] as any).reason));
      const claudeOut = settled[1].status === "fulfilled" ? settled[1].value : emptyOut("claude", String((settled[1] as any).reason?.message ?? (settled[1] as any).reason));
      const gptOut = settled[2].status === "fulfilled" ? settled[2].value : emptyOut("gpt", String((settled[2] as any).reason?.message ?? (settled[2] as any).reason));
      const outputs = [strategyOut, claudeOut, gptOut];

      const heur = (judgeMode === "llm_only")
        ? { strategy: emptyHeur(), claude: emptyHeur(), gpt: emptyHeur() }
        : { strategy: scoreHeuristic(strategyOut.text, ask, account.name), claude: scoreHeuristic(claudeOut.text, ask, account.name), gpt: scoreHeuristic(gptOut.text, ask, account.name) };

      await updateRow({ current_step: `${stepLabel}:judge` });
      const judge = (judgeMode === "heuristics_only")
        ? heuristicWinnerAsJudge(heur)
        : await judgeWithClaude(admin, runId, ask.index, ask, outputs, account.name, retryCfg);

      const failure = classifyStrategyFailure(ask, strategyOut, heur.strategy, judge, account.name);
      results.push({ ask, outputs, heur, judge, failure });

      // ─── Diagnostic-only enrichment (no behavior change) ───
      // We don't have classified_intent surfaced from runStrategy here,
      // so we infer from the prompt for tagging purposes only. The
      // strategy-chat function continues to do the real classification.
      const _diagIntent = inferIntentForDiagnostics(ask.prompt);
      // Strategy output arrives as an SSE stream; the runner accumulates
      // the wrapper text. For diagnostics we need the *visible* answer.
      const _strategyVisible = extractVisibleStrategyText(strategyOut.text || "");
      const _strategyTextForDiag = _strategyVisible.text;
      const contract_compliance = buildContractCompliance(_diagIntent, _strategyTextForDiag);
      const decision_logic_diagnostics = buildDecisionLogicDiagnostics(_strategyTextForDiag);
      const strategy_text_source = _strategyVisible.source;
      try {
        console.log(JSON.stringify({
          diag: "strategy_output_diagnostics",
          ask_index: ask.index,
          inferred_intent: _diagIntent,
          strategy_text_source,
          contract_compliance,
          decision_logic_diagnostics,
        }));
      } catch { /* logging best-effort */ }

      const outputs_meta = outputs.map((o) => ({
        system: o.system, latency_ms_total: o.latency_ms_total, attempts: o.attempts, error: o.error,
        http_status: o.http_status, response_length: o.response_length, provider: o.provider, model: o.model,
        timing_breakdown: o.timing_breakdown,
      }));
      checkpoints.push({
        schema_version: 1,
        ask_index: ask.index, prompt: ask.prompt, category: ask.category,
        completed_at: new Date().toISOString(),
        outputs_meta, heuristics: heur, judge, failure_mode: failure,
        contract_compliance, decision_logic_diagnostics, strategy_text_source,
      });
      // When saveOutputs is true, also surface the parsed visible Strategy
      // text alongside the raw stream so downstream tooling can inspect
      // the actual answer without re-parsing SSE frames.
      const persistedOutputs = saveOutputs
        ? outputs.map((o) =>
            o.system === "strategy"
              ? { ...o, visible_text: _strategyTextForDiag, text_source: strategy_text_source }
              : o,
          )
        : outputs.map((o) => ({ system: o.system, latency_ms_total: o.latency_ms_total, attempts: o.attempts, error: o.error, http_status: o.http_status, response_length: o.response_length, provider: o.provider, model: o.model, timing_breakdown: o.timing_breakdown }));
      persistedResults.push({
        ask,
        outputs: persistedOutputs,
        heur, judge, failure,
        contract_compliance, decision_logic_diagnostics, strategy_text_source,
      });

      const summarySoFar = results.reduce((acc: any, r) => { acc[r.judge.winner] = (acc[r.judge.winner] ?? 0) + 1; return acc; }, { strategy: 0, claude: 0, gpt: 0, tie: 0 });
      const failuresSoFar: Record<string, number> = {};
      for (const r of results) if (r.failure !== "none") failuresSoFar[r.failure] = (failuresSoFar[r.failure] ?? 0) + 1;

      await updateRow({
        completed_asks: results.length, current_step: `${stepLabel}:done`,
        summary: summarySoFar, failures: failuresSoFar,
        payload: { account: { id: account.id, name: account.name, signal: account._signal, selection_reason: account._selection_reason }, thread_id: threadId, save_outputs: saveOutputs, checkpoints, results: persistedResults },
      });
      await audit(admin, runId, "checkpoint_persisted", { ask_index: ask.index, message: `cp ${results.length}/${asks.length}` });
    }

    // Aggregate retry summary
    let total_retries = 0, total_wait_ms = 0;
    for (const r of results) for (const o of r.outputs) {
      total_retries += Math.max(0, o.attempts - 1);
      total_wait_ms += o.timing_breakdown.retry_wait_ms_total;
    }
    const retry_summary = { total_retries, total_wait_ms };

    let markdown = "";
    try {
      markdown = buildMarkdown(account, results, baselineMode, judgeMode, {
        total_runtime_ms: Date.now() - startedAt, save_outputs: saveOutputs,
        replayed_from_run_id: replayedFromRunId, retry_summary,
      });
    } catch (e: any) { console.error("[benchmark] markdown build failed:", e?.message); markdown = `# Benchmark Report\nMarkdown generation failed: ${e?.message}`; }

    const summary = results.reduce((acc: any, r) => { acc[r.judge.winner] = (acc[r.judge.winner] ?? 0) + 1; return acc; }, { strategy: 0, claude: 0, gpt: 0, tie: 0 });
    const failureCounts: Record<string, number> = {};
    for (const r of results) if (r.failure !== "none") failureCounts[r.failure] = (failureCounts[r.failure] ?? 0) + 1;

    await updateRow({
      status: "completed", current_step: "completed", completed_asks: results.length,
      summary: { ...summary, retry_summary }, failures: failureCounts, markdown,
      completed_at: new Date().toISOString(),
      payload: { account: { id: account.id, name: account.name, signal: account._signal, selection_reason: account._selection_reason }, thread_id: threadId, save_outputs: saveOutputs, checkpoints, results: persistedResults, retry_summary },
    });
    await audit(admin, runId, "run_completed", { message: `${results.length} asks done in ${(Date.now() - startedAt) / 1000}s` });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error(`[benchmark] run ${runId} fatal:`, msg, e?.stack);
    await audit(admin, runId, "run_failed", { level: "error", message: msg });
    await updateRow({ status: "failed", current_step: "failed", error: msg, completed_at: new Date().toISOString() });
  }
}

// ─── Main handler ───────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!VALIDATION_KEY) {
    return new Response(JSON.stringify({ error: "STRATEGY_VALIDATION_KEY not configured" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const provided = req.headers.get("x-strategy-validation-key") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (provided !== VALIDATION_KEY && bearer !== SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "invalid validation key" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  // Note: admin is now passed explicitly to audit() everywhere.
  // Module-level singletons are unreliable inside EdgeRuntime.waitUntil(...).
  const action: string = body?.action ?? "run";

  // ── STATUS ──
  if (action === "status") {
    const runId = body?.run_id;
    if (!runId) return jsonErr(400, "run_id required");
    const { data, error } = await admin.from("strategy_benchmark_runs").select("*").eq("id", runId).maybeSingle();
    if (error || !data) return jsonErr(404, error?.message || "run not found");
    const checkpoints = (data.payload as any)?.checkpoints ?? [];
    const includeAuditLogs = body?.include_audit_logs === true;
    const { count: auditCount } = await admin.from("strategy_benchmark_audit_logs")
      .select("id", { count: "exact", head: true }).eq("run_id", runId);
    let audit_logs: any[] | undefined;
    if (includeAuditLogs) {
      const { data: logs } = await admin.from("strategy_benchmark_audit_logs")
        .select("*").eq("run_id", runId).order("created_at", { ascending: true }).limit(500);
      audit_logs = logs ?? [];
    }
    return json(200, {
      ok: true, run_id: data.id, status: data.status, current_step: data.current_step,
      completed_asks: data.completed_asks, total_asks: data.ask_count,
      summary: data.summary, failures: data.failures, error: data.error,
      updated_at: data.updated_at, created_at: data.created_at, completed_at: data.completed_at,
      account: { id: data.account_id, name: data.account_name },
      checkpoints_count: checkpoints.length, checkpoints,
      audit_log_count: auditCount ?? 0,
      ...(audit_logs ? { audit_logs } : {}),
      ...(data.replayed_from_run_id ? { replayed_from_run_id: data.replayed_from_run_id, replay_reason: data.replay_reason } : {}),
      ...(data.status === "completed" ? { markdown: data.markdown, results: (data.payload as any)?.results ?? [] } : {}),
    });
  }

  // ── LIST ──
  if (action === "list") {
    const limit = Math.min(Math.max(parseInt(body?.limit ?? 25, 10), 1), 100);
    const offset = Math.max(parseInt(body?.offset ?? 0, 10), 0);
    const includeMd = body?.include_markdown === true;
    const includePayload = body?.include_payload === true;

    const cols = ["id", "user_id", "account_id", "account_name", "status", "baseline_mode", "judge_mode",
      "ask_count", "completed_asks", "summary", "failures", "current_step", "error",
      "created_at", "updated_at", "completed_at", "replayed_from_run_id", "replay_reason"];
    if (includeMd) cols.push("markdown");
    if (includePayload) cols.push("payload", "config_snapshot");

    let q = admin.from("strategy_benchmark_runs").select(cols.join(","), { count: "exact" });
    if (body?.user_id) q = q.eq("user_id", body.user_id);
    if (body?.account_id) q = q.eq("account_id", body.account_id);
    if (body?.status) q = q.eq("status", body.status);
    if (body?.baseline_mode) q = q.eq("baseline_mode", body.baseline_mode);
    if (body?.judge_mode) q = q.eq("judge_mode", body.judge_mode);
    if (body?.created_after) q = q.gte("created_at", body.created_after);
    if (body?.created_before) q = q.lte("created_at", body.created_before);

    const { data, error, count } = await q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (error) return jsonErr(500, error.message);
    const runs = data ?? [];
    const total = count ?? 0;
    const has_more = offset + runs.length < total;
    return json(200, { ok: true, runs, total, limit, offset, has_more });
  }

  // ── REPLAY ──
  if (action === "replay") {
    const sourceId = body?.run_id;
    if (!sourceId) return jsonErr(400, "run_id required for replay");
    const { data: src, error: srcErr } = await admin.from("strategy_benchmark_runs").select("*").eq("id", sourceId).maybeSingle();
    if (srcErr || !src) return jsonErr(404, srcErr?.message || "source run not found");

    const origReq = (src.payload as any)?.request_body ?? {};
    const replayBody = {
      as_user_id: src.user_id,
      account_id: body?.account_id ?? origReq.account_id ?? src.account_id,
      asks: body?.asks ?? origReq.asks ?? null,
      baseline_mode: body?.baseline_mode ?? src.baseline_mode,
      judge_mode: body?.judge_mode ?? src.judge_mode,
      save_outputs: body?.save_outputs ?? origReq.save_outputs ?? true,
    };
    return await kickoff(admin, replayBody, { replayed_from_run_id: sourceId, replay_reason: body?.replay_reason ?? null });
  }

  // ── KICKOFF (default) ──
  return await kickoff(admin, body, { replayed_from_run_id: null, replay_reason: null });
});

async function kickoff(
  admin: any, body: any,
  meta: { replayed_from_run_id: string | null; replay_reason: string | null },
): Promise<Response> {
  const asUserId: string | undefined = body?.as_user_id;
  if (!asUserId) return jsonErr(400, "as_user_id required");

  const baselineMode: BaselineMode = (body?.baseline_mode ?? "both") as BaselineMode;
  const judgeMode: JudgeMode = (body?.judge_mode ?? "both") as JudgeMode;
  const saveOutputs: boolean = body?.save_outputs !== false;
  const customAsks: string[] | undefined = Array.isArray(body?.asks) ? body.asks : undefined;

  const retryCfg: RetryConfig = {
    retry_max: Math.max(1, Math.min(parseInt(body?.retry_max ?? DEF_RETRY_MAX, 10), 6)),
    retry_base_ms: Math.max(100, parseInt(body?.retry_base_ms ?? DEF_RETRY_BASE_MS, 10)),
    retry_max_ms: Math.max(500, parseInt(body?.retry_max_ms ?? DEF_RETRY_MAX_MS, 10)),
    provider_timeout_ms: DEF_PROVIDER_TIMEOUT_MS,
    judge_timeout_ms: DEF_JUDGE_TIMEOUT_MS,
  };

  let account: any;
  try { account = await selectBestAccount(admin, asUserId, body?.account_id); }
  catch (e: any) { return jsonErr(400, `account selection failed: ${e?.message || String(e)}`); }

  const askCount = customAsks?.length || 6;

  const { data: inserted, error: insErr } = await admin.from("strategy_benchmark_runs").insert({
    user_id: asUserId, account_id: account.id, account_name: account.name,
    baseline_mode: baselineMode, judge_mode: judgeMode, ask_count: askCount,
    status: "running", current_step: "queued", completed_asks: 0,
    summary: {}, failures: {},
    replayed_from_run_id: meta.replayed_from_run_id, replay_reason: meta.replay_reason,
    config_snapshot: {
      retry: retryCfg, baseline_mode: baselineMode, judge_mode: judgeMode,
      save_outputs: saveOutputs, asks: customAsks ?? null, account_id_override: body?.account_id ?? null,
    },
    payload: {
      account: { id: account.id, name: account.name, signal: account._signal, selection_reason: account._selection_reason },
      save_outputs: saveOutputs, checkpoints: [], results: [],
      request_body: { as_user_id: asUserId, account_id: body?.account_id ?? null, asks: customAsks ?? null,
        baseline_mode: baselineMode, judge_mode: judgeMode, save_outputs: saveOutputs },
    },
    markdown: "",
  }).select("id").single();
  if (insErr || !inserted) return jsonErr(500, `persist_failed_at_kickoff: ${insErr?.message ?? "unknown"}`);

  const runId = inserted.id;
  await audit(admin, runId, "kickoff_persisted", { message: `run row inserted, scheduling background work` });
  if (meta.replayed_from_run_id) {
    await audit(admin, runId, "replay_started", { message: `replayed from ${meta.replayed_from_run_id}`, details: { source_run_id: meta.replayed_from_run_id, reason: meta.replay_reason } });
  }

  const work = runBenchmarkInBackground(admin, runId, asUserId, body, baselineMode, judgeMode, saveOutputs, customAsks, retryCfg, meta.replayed_from_run_id);
  // @ts-ignore
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  } else { work.catch((e) => console.error("[benchmark] background error:", e)); }

  return json(202, {
    ok: true, run_id: runId, status: "running",
    account: { id: account.id, name: account.name, signal: account._signal, selection_reason: account._selection_reason },
    selection_reason: account._selection_reason, signal: account._signal,
    config: { baseline_mode: baselineMode, judge_mode: judgeMode, save_outputs: saveOutputs, ask_count: askCount, retry: retryCfg },
    ...(meta.replayed_from_run_id ? { replayed_from_run_id: meta.replayed_from_run_id, replay_reason: meta.replay_reason } : {}),
    poll_instructions: {
      method: "POST", path: "/functions/v1/strategy-benchmark-runner",
      headers: { "x-strategy-validation-key": "<key>", "Content-Type": "application/json" },
      body: { action: "status", run_id: runId }, poll_every_ms: 5000,
      terminal_states: ["completed", "failed"],
    },
  });
}

function json(status: number, body: any): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
