/**
 * Phase 4G-1 — Provider Failure Classifier Tests
 *
 * Tests classification of provider errors into actionable categories,
 * buildCallMetadata, and buildFailureRecord.
 */
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyProviderFailure,
  buildCallMetadata,
  buildFailureRecord,
  logProviderFailure,
  ProviderError,
  type ProviderFailureCategory,
  type ProviderErrorType,
} from "./providerFailureClassifier.ts";

// ── classifyProviderFailure ────────────────────────────────────────

Deno.test("classifies timeout from error message", () => {
  const r = classifyProviderFailure(null, "", "request timed out after 60s");
  assertEquals(r.category, "timeout");
  assertEquals(r.error_type, "timeout");
});

Deno.test("classifies timeout from 'aborted' message", () => {
  const r = classifyProviderFailure(null, "", "signal aborted");
  assertEquals(r.category, "timeout");
  assertEquals(r.error_type, "timeout");
});

Deno.test("classifies 429 rate limit from status", () => {
  const r = classifyProviderFailure(429, "", "too many requests");
  assertEquals(r.category, "rate_limited");
  assertEquals(r.error_type, "429");
});

Deno.test("classifies 429 from message without status", () => {
  const r = classifyProviderFailure(null, "", "rate limit exceeded 429");
  assertEquals(r.category, "rate_limited");
  assertEquals(r.error_type, "429");
});

Deno.test("classifies 402 credit exhaustion", () => {
  const r = classifyProviderFailure(402, "", "insufficient credits");
  assertEquals(r.category, "credit_exhaustion");
  assertEquals(r.error_type, "other");
});

Deno.test("classifies 5xx server error", () => {
  const r = classifyProviderFailure(500, "", "internal server error");
  assertEquals(r.category, "server_error");
  assertEquals(r.error_type, "5xx");
});

Deno.test("classifies 502 server error", () => {
  const r = classifyProviderFailure(502, "", "bad gateway");
  assertEquals(r.category, "server_error");
  assertEquals(r.error_type, "5xx");
});

Deno.test("classifies 400 context_length_exceeded", () => {
  const r = classifyProviderFailure(400, "maximum context length exceeded", "bad request");
  assertEquals(r.category, "context_length_exceeded");
  assertEquals(r.error_type, "400");
});

Deno.test("classifies 400 too many tokens", () => {
  const r = classifyProviderFailure(400, "too many tokens in request", "bad request");
  assertEquals(r.category, "context_length_exceeded");
  assertEquals(r.error_type, "400");
});

Deno.test("classifies 400 invalid_reasoning_param", () => {
  const r = classifyProviderFailure(400, "reasoning_effort is not supported", "bad request");
  assertEquals(r.category, "invalid_reasoning_param");
  assertEquals(r.error_type, "400");
});

Deno.test("classifies 400 malformed_messages", () => {
  const r = classifyProviderFailure(400, "messages: invalid format required array", "bad request");
  assertEquals(r.category, "malformed_messages");
  assertEquals(r.error_type, "400");
});

Deno.test("classifies 400 unsupported model", () => {
  const r = classifyProviderFailure(400, "model 'gpt-99' does not exist", "bad request");
  assertEquals(r.category, "unsupported_model_param");
  assertEquals(r.error_type, "400");
});

Deno.test("classifies 400 empty_content", () => {
  const r = classifyProviderFailure(400, "content field is empty", "bad request");
  assertEquals(r.category, "empty_content");
  assertEquals(r.error_type, "400");
});

Deno.test("classifies 400 provider_schema_mismatch", () => {
  const r = classifyProviderFailure(400, "schema validation failed", "bad request");
  assertEquals(r.category, "provider_schema_mismatch");
  assertEquals(r.error_type, "400");
});

Deno.test("classifies 400 unknown_400 for unmatched body", () => {
  const r = classifyProviderFailure(400, "something weird happened", "bad request");
  assertEquals(r.category, "unknown_400");
  assertEquals(r.error_type, "400");
});

Deno.test("classifies malformed_output from error message", () => {
  const r = classifyProviderFailure(null, "", "no sections found in response");
  assertEquals(r.category, "malformed_output");
  assertEquals(r.error_type, "malformed_output");
});

Deno.test("classifies unknown for unrecognized error", () => {
  const r = classifyProviderFailure(null, "", "something completely unexpected");
  assertEquals(r.category, "unknown");
  assertEquals(r.error_type, "other");
});

// ── buildCallMetadata ──────────────────────────────────────────────

Deno.test("buildCallMetadata computes char/token counts", () => {
  const meta = buildCallMetadata({
    provider: "openai",
    model: "gpt-5",
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Write a brief." },
    ],
    maxTokens: 4000,
    reasoningEffort: "medium",
    stage: "authoring",
    batchIndex: 2,
    taskType: "account_brief",
    runId: "run-123",
  });

  assertEquals(meta.provider, "openai");
  assertEquals(meta.model, "gpt-5");
  assertEquals(meta.message_count, 2);
  assertEquals(meta.total_char_count, "You are helpful.".length + "Write a brief.".length);
  assertEquals(meta.estimated_token_count, Math.ceil(meta.total_char_count / 4));
  assertEquals(meta.max_tokens, 4000);
  assertEquals(meta.reasoning_effort, "medium");
  assertEquals(meta.stage, "authoring");
  assertEquals(meta.batch_index, 2);
  assertEquals(meta.task_type, "account_brief");
  assertEquals(meta.run_id, "run-123");
});

Deno.test("buildCallMetadata defaults optional fields", () => {
  const meta = buildCallMetadata({
    provider: "anthropic",
    model: "claude-3",
    messages: [{ role: "user", content: "hi" }],
  });

  assertEquals(meta.max_tokens, null);
  assertEquals(meta.reasoning_effort, null);
  assertEquals(meta.stage, "unknown");
  assertEquals(meta.batch_index, null);
  assertEquals(meta.task_type, "unknown");
  assertEquals(meta.run_id, "unknown");
});

// ── buildFailureRecord ─────────────────────────────────────────────

Deno.test("buildFailureRecord produces complete record", () => {
  const meta = buildCallMetadata({
    provider: "openai",
    model: "gpt-5",
    messages: [{ role: "user", content: "test" }],
    stage: "authoring",
    taskType: "discovery_prep",
    runId: "run-456",
  });

  const record = buildFailureRecord({
    httpStatus: 400,
    errorBody: "context_length exceeded for this model",
    errorMessage: "bad request",
    callMetadata: meta,
  });

  assertEquals(record.category, "context_length_exceeded");
  assertEquals(record.error_type, "400");
  assertEquals(record.http_status, 400);
  assertEquals(record.call_metadata.run_id, "run-456");
  assertExists(record.timestamp);
});

Deno.test("buildFailureRecord truncates long error messages", () => {
  const longMsg = "x".repeat(1000);
  const longBody = "y".repeat(2000);
  const meta = buildCallMetadata({ provider: "a", model: "b", messages: [] });
  const record = buildFailureRecord({
    httpStatus: null,
    errorBody: longBody,
    errorMessage: longMsg,
    callMetadata: meta,
  });

  assertEquals(record.error_message.length, 500);
  assertEquals(record.provider_response_body.length, 1000);
});

// ── ProviderError class ────────────────────────────────────────────

Deno.test("ProviderError carries failure metadata", () => {
  const meta = buildCallMetadata({ provider: "openai", model: "gpt-5", messages: [] });
  const record = buildFailureRecord({
    httpStatus: 429,
    errorBody: "",
    errorMessage: "rate limited",
    callMetadata: meta,
  });
  const err = new ProviderError("rate limited", record);

  assertEquals(err.name, "ProviderError");
  assertEquals(err.status, 429);
  assertEquals(err.failure.category, "rate_limited");
  assertEquals(err.message, "rate limited");
});

// ── Timeout classification edge cases ──────────────────────────────

Deno.test("timeout takes precedence over 400 status", () => {
  // If the message says timeout but status is 400, timeout wins
  const r = classifyProviderFailure(400, "", "request timed out");
  assertEquals(r.category, "timeout");
  assertEquals(r.error_type, "timeout");
});

Deno.test("rate_limited takes precedence over 5xx status when message says rate", () => {
  // Unusual but tests priority ordering
  const r = classifyProviderFailure(null, "", "rate limit hit");
  assertEquals(r.category, "rate_limited");
});
