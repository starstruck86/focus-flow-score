const MAX_SECRET_BYTES = 4096;
const PROBE_REPETITIONS = 3;
const encoder = new TextEncoder();
const ENVIRONMENT_PROJECT_REFS = Object.freeze({
  "dynamic-staging": "uujkmcbqavsmzhnbqvmm",
  production: "odbjjklumdsuqdvkgwyv",
} as const);
const REVIEWED_EXPECTED_FUNCTIONS = Object.freeze({
  "daily-digest": Object.freeze({ reviewedExpectedVerifyJwt: false }),
  "run-strategy-task-reaper": Object.freeze({ reviewedExpectedVerifyJwt: true }),
  "run-strategy-task-reaper-receipt-v1": Object.freeze({ reviewedExpectedVerifyJwt: true }),
  "schedule-daily-plan": Object.freeze({ reviewedExpectedVerifyJwt: true }),
} as const);

export type RotationEnvironment = "dynamic-staging" | "production";
export type VerificationPhase = "current" | "overlap-next" | "retired-old";
export type CredentialSlot = "current" | "next";

export type VerificationInput = Readonly<{
  environment: RotationEnvironment;
  phase: VerificationPhase;
  acceptedSlot: CredentialSlot;
  url: string;
  acceptedSecret: string;
  rejectedSecret: string;
  apiKey: string;
  jwt?: string;
}>;

export type VerificationResult = Readonly<{
  verification_version: 1;
  environment: RotationEnvironment;
  project_ref: string;
  function_slug: string;
  phase_attestation: VerificationPhase;
  accepted_slot_attestation: CredentialSlot;
  reviewed_expected_verify_jwt: boolean;
  api_key_sent: true;
  authorization_sent: boolean;
  probe_repetitions: 3;
  accepted_status: 204;
  rejected_status: 401;
  cache_control: "no-store";
  result: "PASS";
}>;

type FailureReason =
  | "missing_input"
  | "invalid_environment"
  | "invalid_phase"
  | "invalid_attestation"
  | "invalid_url"
  | "invalid_secret_input"
  | "invalid_credential_domain"
  | "invalid_gateway_input"
  | "accepted_probe_failed"
  | "rejected_probe_failed"
  | "transport_error";

class VerificationFailure extends Error {
  constructor(readonly reason: FailureReason) {
    super(reason);
    this.name = "VerificationFailure";
  }
}

export type EnvironmentReader = (name: string) => string | undefined;
export type ProbeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function requireInput(readEnvironment: EnvironmentReader, name: string): string {
  const value = readEnvironment(name);
  if (value === undefined || value.length === 0) {
    throw new VerificationFailure("missing_input");
  }
  return value;
}

function validateSecretInput(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new VerificationFailure("invalid_secret_input");
  }
  const length = encoder.encode(value).byteLength;
  // Fetch normalizes optional whitespace in header values. Limit credentials
  // to one exact, non-normalizing wire representation before comparing them.
  if (
    length === 0 ||
    length > MAX_SECRET_BYTES ||
    !/^[\x21-\x7E]+$/.test(value)
  ) {
    throw new VerificationFailure("invalid_secret_input");
  }
}

function validateEnvironment(
  value: unknown,
): asserts value is RotationEnvironment {
  if (
    typeof value !== "string" ||
    (value !== "dynamic-staging" && value !== "production")
  ) {
    throw new VerificationFailure("invalid_environment");
  }
}

function validatePhase(value: unknown): asserts value is VerificationPhase {
  if (
    typeof value !== "string" ||
    (value !== "current" && value !== "overlap-next" &&
      value !== "retired-old")
  ) {
    throw new VerificationFailure("invalid_phase");
  }
}

function validateCredentialSlot(
  value: unknown,
): asserts value is CredentialSlot {
  if (
    typeof value !== "string" ||
    (value !== "current" && value !== "next")
  ) {
    throw new VerificationFailure("invalid_attestation");
  }
}

function validateUrlInput(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new VerificationFailure("invalid_url");
  }
}

function validateOptionalJwt(
  value: unknown,
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new VerificationFailure("invalid_gateway_input");
  }
}

function validateCredentialDomains(
  acceptedSecret: string,
  rejectedSecret: string,
  apiKey: string,
  jwt?: string,
): void {
  const values = jwt === undefined
    ? [acceptedSecret, rejectedSecret, apiKey]
    : [acceptedSecret, rejectedSecret, apiKey, jwt];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      if (values[left] === values[right]) {
        throw new VerificationFailure("invalid_credential_domain");
      }
    }
  }
}

function isJwtShaped(value: string): boolean {
  if (encoder.encode(value).byteLength > MAX_SECRET_BYTES) return false;
  const parts = value.split(".");
  return parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part));
}

function validateAttestation(
  phase: VerificationPhase,
  acceptedSlot: CredentialSlot,
): void {
  const expectedSlot = phase === "overlap-next" ? "next" : "current";
  if (acceptedSlot !== expectedSlot) {
    throw new VerificationFailure("invalid_attestation");
  }
}

export function loadVerificationInput(
  readEnvironment: EnvironmentReader,
): VerificationInput {
  const environment = requireInput(readEnvironment, "CRON_VERIFY_ENVIRONMENT");
  if (environment !== "dynamic-staging" && environment !== "production") {
    throw new VerificationFailure("invalid_environment");
  }

  const phase = requireInput(readEnvironment, "CRON_VERIFY_PHASE");
  if (phase !== "current" && phase !== "overlap-next" && phase !== "retired-old") {
    throw new VerificationFailure("invalid_phase");
  }

  const acceptedSlot = requireInput(readEnvironment, "CRON_VERIFY_ACCEPTED_SLOT");
  if (acceptedSlot !== "current" && acceptedSlot !== "next") {
    throw new VerificationFailure("invalid_attestation");
  }
  validateAttestation(phase, acceptedSlot);

  const acceptedSecret = requireInput(readEnvironment, "CRON_VERIFY_ACCEPT_SECRET");
  const rejectedSecret = requireInput(readEnvironment, "CRON_VERIFY_REJECT_SECRET");
  const apiKey = requireInput(readEnvironment, "CRON_VERIFY_API_KEY");
  validateSecretInput(acceptedSecret);
  validateSecretInput(rejectedSecret);
  validateSecretInput(apiKey);
  const jwt = readEnvironment("CRON_VERIFY_JWT") || undefined;
  validateCredentialDomains(acceptedSecret, rejectedSecret, apiKey, jwt);

  return {
    environment,
    phase,
    acceptedSlot,
    url: requireInput(readEnvironment, "CRON_VERIFY_URL"),
    acceptedSecret,
    rejectedSecret,
    apiKey,
    jwt,
  };
}

function reviewedUrl(
  rawUrl: string,
  environment: RotationEnvironment,
): Readonly<{
  url: URL;
  projectRef: string;
  functionSlug: keyof typeof REVIEWED_EXPECTED_FUNCTIONS;
  verifyJwt: boolean;
}> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new VerificationFailure("invalid_url");
  }
  const projectRef = ENVIRONMENT_PROJECT_REFS[environment];
  const expectedHostname = `${projectRef}.supabase.co`;
  const pathParts = url.pathname.split("/");
  const functionSlug = pathParts.length === 4 && pathParts[1] === "functions" &&
      pathParts[2] === "v1"
    ? pathParts[3]
    : "";
  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedHostname ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    rawUrl !== url.href ||
    !Object.hasOwn(REVIEWED_EXPECTED_FUNCTIONS, functionSlug) ||
    url.pathname !== `/functions/v1/${functionSlug}`
  ) {
    throw new VerificationFailure("invalid_url");
  }
  const reviewedSlug = functionSlug as keyof typeof REVIEWED_EXPECTED_FUNCTIONS;
  return {
    url,
    projectRef,
    functionSlug: reviewedSlug,
    verifyJwt:
      REVIEWED_EXPECTED_FUNCTIONS[reviewedSlug].reviewedExpectedVerifyJwt,
  };
}

type ProbeResult = Readonly<{ status: number; cacheControlNoStore: boolean }>;

async function probe(
  url: URL,
  secret: string,
  apiKey: string,
  jwt: string | undefined,
  fetcher: ProbeFetch,
): Promise<ProbeResult> {
  try {
    const headers = new Headers({
      "apikey": apiKey,
      "cache-control": "no-store",
      "x-cron-secret": secret,
    });
    if (jwt !== undefined) {
      headers.set("authorization", `Bearer ${jwt}`);
    }
    const response = await fetcher(url, {
      method: "HEAD",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    // Read only the reviewed cache policy. Never read or relay any other
    // response header or a response body.
    const cacheControlNoStore = (response.headers.get("cache-control") ?? "")
      .split(",")
      .some((directive) => directive.trim().toLowerCase() === "no-store");
    return { status: response.status, cacheControlNoStore };
  } catch {
    throw new VerificationFailure("transport_error");
  }
}

export async function verifyCronSecretRotation(
  input: VerificationInput,
  fetcher: ProbeFetch = fetch,
): Promise<VerificationResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new VerificationFailure("invalid_environment");
  }
  // TypeScript's VerificationInput type is erased at runtime. Snapshot every
  // field as unknown and establish primitive/enumerated identities before URL
  // parsing, header construction, or any fetch can occur.
  const candidate = input as unknown as Readonly<Record<string, unknown>>;
  const environment = candidate.environment;
  const phase = candidate.phase;
  const acceptedSlot = candidate.acceptedSlot;
  const rawUrl = candidate.url;
  const acceptedSecret = candidate.acceptedSecret;
  const rejectedSecret = candidate.rejectedSecret;
  const apiKey = candidate.apiKey;
  const jwt = candidate.jwt;

  validateEnvironment(environment);
  validatePhase(phase);
  validateCredentialSlot(acceptedSlot);
  validateUrlInput(rawUrl);
  validateSecretInput(acceptedSecret);
  validateSecretInput(rejectedSecret);
  validateSecretInput(apiKey);
  validateOptionalJwt(jwt);
  validateAttestation(phase, acceptedSlot);
  validateCredentialDomains(
    acceptedSecret,
    rejectedSecret,
    apiKey,
    jwt,
  );
  const { url, projectRef, functionSlug, verifyJwt } = reviewedUrl(
    rawUrl,
    environment,
  );
  if (verifyJwt) {
    if (jwt === undefined || !isJwtShaped(jwt)) {
      throw new VerificationFailure("invalid_gateway_input");
    }
  } else if (jwt !== undefined) {
    throw new VerificationFailure("invalid_gateway_input");
  }

  for (let repetition = 0; repetition < PROBE_REPETITIONS; repetition += 1) {
    const accepted = await probe(
      url,
      acceptedSecret,
      apiKey,
      jwt,
      fetcher,
    );
    if (accepted.status !== 204 || !accepted.cacheControlNoStore) {
      throw new VerificationFailure("accepted_probe_failed");
    }
    const rejected = await probe(
      url,
      rejectedSecret,
      apiKey,
      jwt,
      fetcher,
    );
    if (rejected.status !== 401 || !rejected.cacheControlNoStore) {
      throw new VerificationFailure("rejected_probe_failed");
    }
  }

  return {
    verification_version: 1,
    environment,
    project_ref: projectRef,
    function_slug: functionSlug,
    phase_attestation: phase,
    accepted_slot_attestation: acceptedSlot,
    reviewed_expected_verify_jwt: verifyJwt,
    api_key_sent: true,
    authorization_sent: verifyJwt,
    probe_repetitions: PROBE_REPETITIONS,
    accepted_status: 204,
    rejected_status: 401,
    cache_control: "no-store",
    result: "PASS",
  };
}

export function safeFailureReason(error: unknown): FailureReason {
  return error instanceof VerificationFailure ? error.reason : "transport_error";
}

export async function runCli(
  readEnvironment: EnvironmentReader,
  fetcher: ProbeFetch,
  writeOutput: (line: string) => void,
  writeError: (line: string) => void,
): Promise<0 | 1> {
  try {
    const result = await verifyCronSecretRotation(
      loadVerificationInput(readEnvironment),
      fetcher,
    );
    writeOutput(JSON.stringify(result));
    return 0;
  } catch (error) {
    writeError(JSON.stringify({
      verification_version: 1,
      result: "FAIL",
      reason: safeFailureReason(error),
    }));
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await runCli(
    (name) => Deno.env.get(name),
    fetch,
    console.log,
    console.error,
  );
  if (exitCode !== 0) Deno.exit(exitCode);
}
