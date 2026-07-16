/**
 * Read-only, sanitized receipt verifier.
 *
 * Required process-environment inputs (never command-line arguments):
 *   CRON_RECEIPT_VERIFY_ENVIRONMENT
 *   CRON_RECEIPT_VERIFY_PROJECT_REF
 *   CRON_RECEIPT_VERIFY_URL
 *   CRON_RECEIPT_VERIFY_API_KEY
 *   CRON_RECEIPT_VERIFY_JWT
 *   CRON_RECEIPT_VERIFY_ATTEMPT_ID
 */
import {
  buildStrategyTaskReaperAttempt,
  parseCronAttemptReceipt,
  type CronAttemptContext,
  type CronAttemptReceipt,
  type CronReceiptEnvironment,
  CronAttemptInputError,
  CronReceiptResultError,
  reviewedCronReceiptContract,
} from "../../supabase/functions/_shared/cronAttemptReceipt.ts";

const MAX_CREDENTIAL_BYTES = 4096;
const MAX_RESPONSE_BYTES = 16 * 1024;
const encoder = new TextEncoder();

type FailureReason =
  | "missing_input"
  | "invalid_input"
  | "invalid_url"
  | "invalid_gateway_input"
  | "transport_error"
  | "response_rejected"
  | "receipt_rejected";

class VerificationFailure extends Error {
  constructor(readonly reason: FailureReason) {
    super(reason);
    this.name = "VerificationFailure";
  }
}

export type EnvironmentReader = (name: string) => string | undefined;
export type ReceiptFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ReceiptVerificationInput = Readonly<{
  environment: CronReceiptEnvironment;
  projectRef: "uujkmcbqavsmzhnbqvmm" | "odbjjklumdsuqdvkgwyv";
  rpcUrl: string;
  apiKey: string;
  jwt: string;
  attemptId: string;
}>;

export type ReceiptVerificationResult = Readonly<{
  verification_version: 1;
  receiver: "run-strategy-task-reaper";
  attempt_present: boolean;
  terminal: boolean;
  outcome_code: CronAttemptReceipt["outcome_code"];
  effect_code: CronAttemptReceipt["effect_code"];
  receipt_at: string | null;
  exact_effect_count: number;
  identity_consistent: boolean;
  effect_consistent: boolean;
  result: "PASS" | "REVIEW_REQUIRED";
}>;

function requireEnvironment(
  readEnvironment: EnvironmentReader,
  name: string,
): string {
  const value = readEnvironment(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new VerificationFailure("missing_input");
  }
  return value;
}

function validHeaderCredential(value: string): boolean {
  const size = encoder.encode(value).byteLength;
  return size > 0 && size <= MAX_CREDENTIAL_BYTES && /^[\x21-\x7E]+$/.test(value);
}

function jwtShaped(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 3 &&
    parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part));
}

function validateRuntimeInput(
  value: unknown,
): asserts value is ReceiptVerificationInput {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new VerificationFailure("invalid_input");
  }
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    "apiKey",
    "attemptId",
    "environment",
    "jwt",
    "projectRef",
    "rpcUrl",
  ];
  const actualKeys = Object.keys(candidate).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    !actualKeys.every((key, index) => key === expectedKeys[index]) ||
    typeof candidate.environment !== "string" ||
    typeof candidate.projectRef !== "string" ||
    typeof candidate.rpcUrl !== "string" ||
    typeof candidate.apiKey !== "string" ||
    typeof candidate.jwt !== "string" ||
    typeof candidate.attemptId !== "string"
  ) {
    throw new VerificationFailure("invalid_input");
  }
  const environment = candidate.environment;
  const projectRef = candidate.projectRef;
  if (
    (environment !== "dynamic-staging" && environment !== "production") ||
    !Object.hasOwn(reviewedCronReceiptContract.projectEnvironments, projectRef) ||
    reviewedCronReceiptContract.projectEnvironments[
        projectRef as keyof typeof reviewedCronReceiptContract.projectEnvironments
      ] !== environment
  ) {
    throw new VerificationFailure("invalid_input");
  }
  if (
    !validHeaderCredential(candidate.apiKey) ||
    !validHeaderCredential(candidate.jwt) ||
    !jwtShaped(candidate.jwt) ||
    candidate.apiKey === candidate.jwt ||
    candidate.attemptId === candidate.apiKey ||
    candidate.attemptId === candidate.jwt
  ) {
    throw new VerificationFailure("invalid_gateway_input");
  }
  const expectedUrl =
    `https://${projectRef}.supabase.co/rest/v1/rpc/read_strategy_task_reaper_receipt`;
  if (candidate.rpcUrl !== expectedUrl) {
    throw new VerificationFailure("invalid_url");
  }
}

export function loadReceiptVerificationInput(
  readEnvironment: EnvironmentReader,
): ReceiptVerificationInput {
  const environment = requireEnvironment(
    readEnvironment,
    "CRON_RECEIPT_VERIFY_ENVIRONMENT",
  );
  const projectRef = requireEnvironment(
    readEnvironment,
    "CRON_RECEIPT_VERIFY_PROJECT_REF",
  );
  const rpcUrl = requireEnvironment(readEnvironment, "CRON_RECEIPT_VERIFY_URL");
  const apiKey = requireEnvironment(
    readEnvironment,
    "CRON_RECEIPT_VERIFY_API_KEY",
  );
  const jwt = requireEnvironment(readEnvironment, "CRON_RECEIPT_VERIFY_JWT");
  // The attempt identifier is deliberately available through the protected
  // process environment only. It is never accepted as a command-line value.
  const attemptId = requireEnvironment(
    readEnvironment,
    "CRON_RECEIPT_VERIFY_ATTEMPT_ID",
  );

  if (
    (environment !== "dynamic-staging" && environment !== "production") ||
    !Object.hasOwn(reviewedCronReceiptContract.projectEnvironments, projectRef) ||
    reviewedCronReceiptContract.projectEnvironments[
        projectRef as keyof typeof reviewedCronReceiptContract.projectEnvironments
      ] !== environment
  ) {
    throw new VerificationFailure("invalid_input");
  }
  if (
    !validHeaderCredential(apiKey) ||
    !validHeaderCredential(jwt) ||
    !jwtShaped(jwt) ||
    apiKey === jwt ||
    attemptId === apiKey ||
    attemptId === jwt
  ) {
    throw new VerificationFailure("invalid_gateway_input");
  }

  const expectedUrl =
    `https://${projectRef}.supabase.co/rest/v1/rpc/read_strategy_task_reaper_receipt`;
  if (rpcUrl !== expectedUrl) throw new VerificationFailure("invalid_url");

  const input = {
    environment,
    projectRef: projectRef as ReceiptVerificationInput["projectRef"],
    rpcUrl,
    apiKey,
    jwt,
    attemptId,
  };
  validateRuntimeInput(input);
  return Object.freeze(input as ReceiptVerificationInput);
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declared)) {
      throw new VerificationFailure("response_rejected");
    }
    const parsed = Number(declared);
    if (!Number.isSafeInteger(parsed) || parsed > MAX_RESPONSE_BYTES) {
      throw new VerificationFailure("response_rejected");
    }
  }
  if (response.body === null) throw new VerificationFailure("response_rejected");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw new VerificationFailure("response_rejected");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new VerificationFailure("response_rejected");
  }
}

export async function verifyCronAttemptReceipt(
  input: ReceiptVerificationInput,
  fetcher: ReceiptFetch = fetch,
): Promise<ReceiptVerificationResult> {
  // Re-establish the canonical attempt and reviewed non-secret deployment
  // binding before constructing a request. TypeScript types are erased at
  // runtime, so loadReceiptVerificationInput is the required public entry.
  validateRuntimeInput(input);
  let attempt: CronAttemptContext;
  try {
    const headers = new Headers({
      "x-cron-attempt-id": input.attemptId,
    });
    attempt = await buildStrategyTaskReaperAttempt(
      new Request("https://local.invalid/run-strategy-task-reaper", {
        method: "POST",
        headers,
      }),
      (name) => name === "SUPABASE_URL"
        ? `https://${input.projectRef}.supabase.co`
        : undefined,
    );
  } catch (error) {
    if (error instanceof CronAttemptInputError) {
      throw new VerificationFailure("invalid_input");
    }
    throw new VerificationFailure("invalid_input");
  }
  if (attempt.environment !== input.environment) {
    throw new VerificationFailure("invalid_input");
  }

  let response: Response;
  try {
    response = await fetcher(input.rpcUrl, {
      method: "POST",
      headers: {
        apikey: input.apiKey,
        authorization: `Bearer ${input.jwt}`,
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify({
        p_attempt_id: attempt.attemptId,
        p_protocol_version: attempt.protocolVersion,
        p_environment: attempt.environment,
        p_project_ref: attempt.projectRef,
        p_request_fingerprint: attempt.requestFingerprint,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new VerificationFailure("transport_error");
  }
  if (response.status !== 200) {
    try {
      await response.body?.cancel();
    } catch {
      // A body-cancellation failure is deliberately not observable.
    }
    throw new VerificationFailure("response_rejected");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(await boundedResponseText(response));
  } catch (error) {
    if (error instanceof VerificationFailure) throw error;
    throw new VerificationFailure("receipt_rejected");
  }
  let receipt: CronAttemptReceipt;
  try {
    receipt = parseCronAttemptReceipt(decoded);
  } catch (error) {
    if (error instanceof CronReceiptResultError) {
      throw new VerificationFailure("receipt_rejected");
    }
    throw new VerificationFailure("receipt_rejected");
  }

  const passes = receipt.attempt_present &&
    receipt.identity_consistent &&
    receipt.effect_consistent &&
    receipt.terminal &&
    (receipt.outcome_code === "applied_success" ||
      receipt.outcome_code === "legitimate_noop");
  return Object.freeze({
    verification_version: 1,
    receiver: "run-strategy-task-reaper",
    attempt_present: receipt.attempt_present,
    terminal: receipt.terminal,
    outcome_code: receipt.outcome_code,
    effect_code: receipt.effect_code,
    receipt_at: receipt.receipt_at,
    exact_effect_count: receipt.exact_effect_count,
    identity_consistent: receipt.identity_consistent,
    effect_consistent: receipt.effect_consistent,
    result: passes ? "PASS" : "REVIEW_REQUIRED",
  });
}

export function safeReceiptVerificationFailure(error: unknown): FailureReason {
  return error instanceof VerificationFailure ? error.reason : "receipt_rejected";
}

export async function runReceiptVerificationCli(
  readEnvironment: EnvironmentReader = (name) => Deno.env.get(name),
  fetcher: ReceiptFetch = fetch,
  writeStdout: (line: string) => void = console.log,
  writeStderr: (line: string) => void = console.error,
): Promise<number> {
  try {
    const result = await verifyCronAttemptReceipt(
      loadReceiptVerificationInput(readEnvironment),
      fetcher,
    );
    writeStdout(JSON.stringify(result));
    return result.result === "PASS" ? 0 : 2;
  } catch (error) {
    writeStderr(JSON.stringify({
      verification_version: 1,
      result: "FAIL",
      reason: safeReceiptVerificationFailure(error),
    }));
    return 1;
  }
}

if (import.meta.main) {
  if (Deno.args.length !== 0) {
    console.error(
      '{"verification_version":1,"result":"FAIL","reason":"invalid_input"}',
    );
    Deno.exit(1);
  }
  Deno.exit(await runReceiptVerificationCli());
}
