/**
 * Phase 4G-1 — Provider Failure Classifier & Instrumentation
 *
 * Captures exact failing payload metadata, classifies provider errors
 * into actionable categories, and persists structured failure telemetry.
 *
 * INVARIANT: This module is observational only. It never modifies
 * provider behavior, retries, or fallback logic.
 */

// ── Failure categories ─────────────────────────────────────────────

export type ProviderFailureCategory =
  | "context_length_exceeded"
  | "invalid_reasoning_param"
  | "malformed_messages"
  | "unsupported_model_param"
  | "empty_content"
  | "provider_schema_mismatch"
  | "rate_limited"
  | "credit_exhaustion"
  | "timeout"
  | "server_error"
  | "malformed_output"
  | "unknown_400"
  | "unknown";

export type ProviderErrorType = "400" | "429" | "timeout" | "5xx" | "malformed_output" | "other";

// ── Payload metadata captured on every provider call ───────────────

export interface ProviderCallMetadata {
  provider: string;
  model: string;
  max_tokens: number | null;
  reasoning_effort: string | null;
  message_count: number;
  total_char_count: number;
  estimated_token_count: number;
  stage: string;
  batch_index: number | null;
  task_type: string;
  run_id: string;
}

// ── Structured failure record ──────────────────────────────────────

export interface ProviderFailureRecord {
  category: ProviderFailureCategory;
  error_type: ProviderErrorType;
  http_status: number | null;
  error_message: string;
  provider_response_body: string;
  call_metadata: ProviderCallMetadata;
  timestamp: string;
}

// ── Classify from HTTP status + error body ─────────────────────────

export function classifyProviderFailure(
  httpStatus: number | null,
  errorBody: string,
  errorMessage: string,
): { category: ProviderFailureCategory; error_type: ProviderErrorType } {
  const body = (errorBody || "").toLowerCase();
  const msg = (errorMessage || "").toLowerCase();

  // Timeout
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("aborted")) {
    return { category: "timeout", error_type: "timeout" };
  }

  // Rate limit
  if (httpStatus === 429 || msg.includes("rate") || msg.includes("429")) {
    return { category: "rate_limited", error_type: "429" };
  }

  // Credit exhaustion
  if (httpStatus === 402 || msg.includes("credit") || msg.includes("402") || msg.includes("insufficient")) {
    return { category: "credit_exhaustion", error_type: "other" };
  }

  // Server errors
  if (httpStatus != null && httpStatus >= 500) {
    return { category: "server_error", error_type: "5xx" };
  }

  // 400-class errors — drill into body
  if (httpStatus === 400) {
    if (body.includes("context_length") || body.includes("maximum context") || body.includes("too many tokens") || body.includes("max_tokens")) {
      return { category: "context_length_exceeded", error_type: "400" };
    }
    if (body.includes("reasoning_effort") || body.includes("reasoning") && body.includes("invalid")) {
      return { category: "invalid_reasoning_param", error_type: "400" };
    }
    if (body.includes("messages") && (body.includes("invalid") || body.includes("required") || body.includes("empty"))) {
      return { category: "malformed_messages", error_type: "400" };
    }
    if (body.includes("model") && (body.includes("not found") || body.includes("invalid") || body.includes("does not exist"))) {
      return { category: "unsupported_model_param", error_type: "400" };
    }
    if (body.includes("content") && (body.includes("empty") || body.includes("blank") || body.includes("null"))) {
      return { category: "empty_content", error_type: "400" };
    }
    if (body.includes("schema") || body.includes("invalid_request") || body.includes("validation")) {
      return { category: "provider_schema_mismatch", error_type: "400" };
    }
    return { category: "unknown_400", error_type: "400" };
  }

  // Malformed output (non-HTTP — model returned garbage)
  if (msg.includes("no sections") || msg.includes("invalid json") || msg.includes("unparseable")) {
    return { category: "malformed_output", error_type: "malformed_output" };
  }

  return { category: "unknown", error_type: "other" };
}

// ── Build call metadata from provider call args ────────────────────

export function buildCallMetadata(args: {
  provider: string;
  model: string;
  messages: { role: string; content: string }[];
  maxTokens?: number | null;
  reasoningEffort?: string | null;
  stage?: string;
  batchIndex?: number | null;
  taskType?: string;
  runId?: string;
}): ProviderCallMetadata {
  const totalChars = args.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  return {
    provider: args.provider,
    model: args.model,
    max_tokens: args.maxTokens ?? null,
    reasoning_effort: args.reasoningEffort ?? null,
    message_count: args.messages.length,
    total_char_count: totalChars,
    // Rough estimate: ~4 chars per token for English text
    estimated_token_count: Math.ceil(totalChars / 4),
    stage: args.stage ?? "unknown",
    batch_index: args.batchIndex ?? null,
    task_type: args.taskType ?? "unknown",
    run_id: args.runId ?? "unknown",
  };
}

// ── Build and log a structured failure record ──────────────────────

export function buildFailureRecord(args: {
  httpStatus: number | null;
  errorBody: string;
  errorMessage: string;
  callMetadata: ProviderCallMetadata;
}): ProviderFailureRecord {
  const { category, error_type } = classifyProviderFailure(
    args.httpStatus,
    args.errorBody,
    args.errorMessage,
  );
  return {
    category,
    error_type,
    http_status: args.httpStatus,
    error_message: args.errorMessage.slice(0, 500),
    provider_response_body: args.errorBody.slice(0, 1000),
    call_metadata: args.callMetadata,
    timestamp: new Date().toISOString(),
  };
}

export function logProviderFailure(record: ProviderFailureRecord): void {
  console.error(JSON.stringify({
    tag: "[provider_failure]",
    category: record.category,
    error_type: record.error_type,
    http_status: record.http_status,
    provider: record.call_metadata.provider,
    model: record.call_metadata.model,
    stage: record.call_metadata.stage,
    batch_index: record.call_metadata.batch_index,
    task_type: record.call_metadata.task_type,
    run_id: record.call_metadata.run_id,
    message_count: record.call_metadata.message_count,
    total_char_count: record.call_metadata.total_char_count,
    estimated_token_count: record.call_metadata.estimated_token_count,
    max_tokens: record.call_metadata.max_tokens,
    reasoning_effort: record.call_metadata.reasoning_effort,
    error_message: record.error_message.slice(0, 300),
    provider_response_excerpt: record.provider_response_body.slice(0, 200),
  }));
}

// ── Enriched error that carries failure metadata ───────────────────

export class ProviderError extends Error {
  public readonly failure: ProviderFailureRecord;
  public readonly status: number | null;

  constructor(message: string, failure: ProviderFailureRecord) {
    super(message);
    this.name = "ProviderError";
    this.failure = failure;
    this.status = failure.http_status;
  }
}
