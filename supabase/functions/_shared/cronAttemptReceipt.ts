const ATTEMPT_HEADER = "x-cron-attempt-id";
const RECEIVER = "run-strategy-task-reaper";
const PROTOCOL_VERSION = 1;
const MAX_EFFECT_COUNT = 200;

const PROJECT_ENVIRONMENTS = Object.freeze({
  uujkmcbqavsmzhnbqvmm: "dynamic-staging",
  odbjjklumdsuqdvkgwyv: "production",
} as const);

export type CronReceiptEnvironment =
  (typeof PROJECT_ENVIRONMENTS)[keyof typeof PROJECT_ENVIRONMENTS];

export type CronAttemptContext = Readonly<{
  attemptId: string;
  receiver: typeof RECEIVER;
  protocolVersion: typeof PROTOCOL_VERSION;
  environment: CronReceiptEnvironment;
  projectRef: keyof typeof PROJECT_ENVIRONMENTS;
  requestFingerprint: string;
}>;

export type CronReceiptOutcome =
  | "in_progress"
  | "applied_success"
  | "legitimate_noop"
  | "known_failure_rolled_back"
  | "indeterminate";

export type CronReceiptEffect =
  | "attempt_in_progress"
  | "stale_pending_runs_reaped"
  | "no_eligible_stale_pending_runs"
  | "execution_rolled_back"
  | "effect_indeterminate";

export type CronAttemptReceipt = Readonly<{
  receipt_version: 1;
  receiver: typeof RECEIVER;
  attempt_present: boolean;
  terminal: boolean;
  outcome_code: CronReceiptOutcome;
  effect_code: CronReceiptEffect;
  receipt_at: string | null;
  exact_effect_count: number;
  identity_consistent: boolean;
  effect_consistent: boolean;
  replayed: boolean;
}>;

export type CronReceiptRpcClient = Readonly<{
  rpc: (
    functionName: "execute_strategy_task_reaper_attempt",
    args: Readonly<{
      p_attempt_id: string;
      p_protocol_version: 1;
      p_environment: CronReceiptEnvironment;
      p_project_ref: keyof typeof PROJECT_ENVIRONMENTS;
      p_request_fingerprint: string;
    }>,
  ) => PromiseLike<Readonly<{ data: unknown; error: unknown }>>;
}>;

export class CronAttemptInputError extends Error {
  constructor() {
    super("invalid_cron_attempt");
    this.name = "CronAttemptInputError";
  }
}

export class CronReceiptResultError extends Error {
  constructor() {
    super("invalid_receipt_result");
    this.name = "CronReceiptResultError";
  }
}

function invalidAttempt(): never {
  throw new CronAttemptInputError();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const reviewed = [...expected].sort();
  return actual.length === reviewed.length &&
    actual.every((key, index) => key === reviewed[index]);
}

export function parseCanonicalCronAttemptId(value: unknown): string {
  // gen_random_uuid() emits canonical lower-case RFC 4122 variant UUIDs.
  // Header coalescing, whitespace, upper case, and noncanonical forms fail.
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    invalidAttempt();
  }
  return value;
}

function authorizationCredential(value: string | null): string | null {
  if (value === null) return null;
  const bearer = /^Bearer ([\x21-\x7e]+)$/i.exec(value);
  return bearer?.[1] ?? value;
}

function requireCredentialDomainSeparation(
  request: Request,
  attemptId: string,
): void {
  const credentialInputs = [
    request.headers.get("x-cron-secret"),
    request.headers.get("apikey"),
    authorizationCredential(request.headers.get("authorization")),
  ];
  if (credentialInputs.some((value) => value !== null && value === attemptId)) {
    invalidAttempt();
  }
}

function projectIdentity(
  rawUrl: string | undefined,
): Readonly<{
  environment: CronReceiptEnvironment;
  projectRef: keyof typeof PROJECT_ENVIRONMENTS;
}> {
  if (rawUrl === undefined || rawUrl.length === 0) invalidAttempt();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    invalidAttempt();
  }
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  const projectRef = match?.[1];
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    projectRef === undefined ||
    !Object.hasOwn(PROJECT_ENVIRONMENTS, projectRef)
  ) {
    invalidAttempt();
  }
  const reviewedProjectRef = projectRef as keyof typeof PROJECT_ENVIRONMENTS;
  return {
    environment: PROJECT_ENVIRONMENTS[reviewedProjectRef],
    projectRef: reviewedProjectRef,
  };
}

function semanticFingerprintInput(
  environment: CronReceiptEnvironment,
  projectRef: keyof typeof PROJECT_ENVIRONMENTS,
): string {
  return "focus-flow-score/cron-application-request/v1\n" +
    `receiver=${RECEIVER}\n` +
    `protocol=${PROTOCOL_VERSION}\n` +
    `environment=${environment}\n` +
    `project_ref=${projectRef}\n` +
    "semantic=sweep-stale-pending-runs\n";
}

function lowercaseHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildStrategyTaskReaperAttempt(
  request: Request,
  readEnvironment: (name: string) => string | undefined = (name) =>
    Deno.env.get(name),
): Promise<CronAttemptContext> {
  if (request.method !== "POST") invalidAttempt();
  const attemptId = parseCanonicalCronAttemptId(
    request.headers.get(ATTEMPT_HEADER),
  );
  // The durable attempt UUID is not a credential. Reject equality with every
  // credential-bearing request header before hashing, RPC construction, or
  // business work so a UUID-shaped secret can never become a receipt key.
  requireCredentialDomainSeparation(request, attemptId);
  const { environment, projectRef } = projectIdentity(
    readEnvironment("SUPABASE_URL"),
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(semanticFingerprintInput(environment, projectRef)),
  );
  return Object.freeze({
    attemptId,
    receiver: RECEIVER,
    protocolVersion: PROTOCOL_VERSION,
    environment,
    projectRef,
    requestFingerprint: lowercaseHex(new Uint8Array(digest)),
  });
}

const RECEIPT_KEYS = Object.freeze([
  "receipt_version",
  "receiver",
  "attempt_present",
  "terminal",
  "outcome_code",
  "effect_code",
  "receipt_at",
  "exact_effect_count",
  "identity_consistent",
  "effect_consistent",
  "replayed",
] as const);

const OUTCOME_EFFECTS = Object.freeze({
  in_progress: "attempt_in_progress",
  applied_success: "stale_pending_runs_reaped",
  legitimate_noop: "no_eligible_stale_pending_runs",
  known_failure_rolled_back: "execution_rolled_back",
  indeterminate: "effect_indeterminate",
} as const);

function isReceiptTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(
      value,
    )
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

export function parseCronAttemptReceipt(value: unknown): CronAttemptReceipt {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new CronReceiptResultError();
  }
  const candidate = value[0];
  if (!isPlainRecord(candidate)) throw new CronReceiptResultError();
  const row = candidate;
  if (!exactKeys(row, RECEIPT_KEYS)) throw new CronReceiptResultError();

  const outcome = row.outcome_code;
  const effect = row.effect_code;
  if (
    typeof outcome !== "string" ||
    !Object.hasOwn(OUTCOME_EFFECTS, outcome) ||
    effect !== OUTCOME_EFFECTS[outcome as keyof typeof OUTCOME_EFFECTS]
  ) {
    throw new CronReceiptResultError();
  }
  const terminal = row.terminal;
  const terminalExpected = outcome !== "in_progress" && outcome !== "indeterminate";
  const count = row.exact_effect_count;
  const countValid = Number.isSafeInteger(count) && Number(count) >= 0 &&
    Number(count) <= MAX_EFFECT_COUNT;
  const countMatches = outcome === "applied_success"
    ? Number(count) > 0
    : Number(count) === 0;
  const timestampValid = terminalExpected
    ? isReceiptTimestamp(row.receipt_at)
    : row.receipt_at === null;

  const attemptPresent = row.attempt_present;
  const identityConsistent = row.identity_consistent;
  const effectConsistent = row.effect_consistent;
  const absentCombination = attemptPresent === false &&
    terminal === false &&
    outcome === "indeterminate" &&
    effect === "effect_indeterminate" &&
    row.receipt_at === null &&
    count === 0 &&
    identityConsistent === false &&
    effectConsistent === false &&
    row.replayed === false;
  if (
    row.receipt_version !== 1 ||
    row.receiver !== RECEIVER ||
    typeof attemptPresent !== "boolean" ||
    terminal !== terminalExpected ||
    !countValid ||
    !countMatches ||
    !timestampValid ||
    typeof identityConsistent !== "boolean" ||
    typeof effectConsistent !== "boolean" ||
    (attemptPresent === true &&
      (identityConsistent !== true || effectConsistent !== true)) ||
    (attemptPresent === false && !absentCombination) ||
    typeof row.replayed !== "boolean"
  ) {
    throw new CronReceiptResultError();
  }

  return Object.freeze({
    receipt_version: 1,
    receiver: RECEIVER,
    attempt_present: attemptPresent,
    terminal: terminalExpected,
    outcome_code: outcome as CronReceiptOutcome,
    effect_code: effect as CronReceiptEffect,
    receipt_at: row.receipt_at as string | null,
    exact_effect_count: Number(count),
    identity_consistent: identityConsistent,
    effect_consistent: effectConsistent,
    replayed: row.replayed,
  });
}

export async function executeStrategyTaskReaperAttempt(
  client: CronReceiptRpcClient,
  context: CronAttemptContext,
): Promise<CronAttemptReceipt> {
  let result: Readonly<{ data: unknown; error: unknown }>;
  try {
    result = await client.rpc("execute_strategy_task_reaper_attempt", {
      p_attempt_id: context.attemptId,
      p_protocol_version: context.protocolVersion,
      p_environment: context.environment,
      p_project_ref: context.projectRef,
      p_request_fingerprint: context.requestFingerprint,
    });
  } catch {
    throw new CronReceiptResultError();
  }
  if (result.error !== null) throw new CronReceiptResultError();
  const receipt = parseCronAttemptReceipt(result.data);
  if (
    !receipt.attempt_present ||
    !receipt.identity_consistent ||
    !receipt.effect_consistent ||
    (receipt.outcome_code !== "applied_success" &&
      receipt.outcome_code !== "legitimate_noop")
  ) {
    throw new CronReceiptResultError();
  }
  return receipt;
}

export const reviewedCronReceiptContract = Object.freeze({
  attemptHeader: ATTEMPT_HEADER,
  receiver: RECEIVER,
  protocolVersion: PROTOCOL_VERSION,
  projectEnvironments: PROJECT_ENVIRONMENTS,
});
