const MAX_SECRET_BYTES = 4096;
const encoder = new TextEncoder();
const ENVIRONMENT_PROJECT_REFS = Object.freeze({
  "dynamic-staging": "uujkmcbqavsmzhnbqvmm",
  production: "odbjjklumdsuqdvkgwyv",
} as const);
const REVIEWED_FUNCTION_SLUGS = new Set([
  "daily-digest",
  "run-strategy-task-reaper",
  "schedule-daily-plan",
]);

export type RotationEnvironment = "dynamic-staging" | "production";
export type VerificationPhase = "current" | "overlap-next" | "retired-old";

export type VerificationInput = Readonly<{
  environment: RotationEnvironment;
  phase: VerificationPhase;
  url: string;
  acceptedSecret: string;
  rejectedSecret: string;
  gatewayToken?: string;
}>;

export type VerificationResult = Readonly<{
  verification_version: 1;
  environment: RotationEnvironment;
  project_ref: string;
  function_slug: string;
  phase: VerificationPhase;
  accepted_status: 204;
  rejected_status: 401;
  result: "PASS";
}>;

type FailureReason =
  | "missing_input"
  | "invalid_environment"
  | "invalid_phase"
  | "invalid_url"
  | "invalid_secret_input"
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

function validateSecretInput(value: string): void {
  const length = encoder.encode(value).byteLength;
  if (length === 0 || length > MAX_SECRET_BYTES) {
    throw new VerificationFailure("invalid_secret_input");
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

  const acceptedSecret = requireInput(readEnvironment, "CRON_VERIFY_ACCEPT_SECRET");
  const rejectedSecret = requireInput(readEnvironment, "CRON_VERIFY_REJECT_SECRET");
  validateSecretInput(acceptedSecret);
  validateSecretInput(rejectedSecret);
  const gatewayToken = readEnvironment("CRON_VERIFY_GATEWAY_TOKEN");
  if (gatewayToken !== undefined && gatewayToken.length > 0) {
    validateSecretInput(gatewayToken);
  }

  return {
    environment,
    phase,
    url: requireInput(readEnvironment, "CRON_VERIFY_URL"),
    acceptedSecret,
    rejectedSecret,
    gatewayToken: gatewayToken || undefined,
  };
}

function reviewedUrl(
  rawUrl: string,
  environment: RotationEnvironment,
): Readonly<{ url: URL; projectRef: string; functionSlug: string }> {
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
    !REVIEWED_FUNCTION_SLUGS.has(functionSlug) ||
    url.pathname !== `/functions/v1/${functionSlug}`
  ) {
    throw new VerificationFailure("invalid_url");
  }
  return { url, projectRef, functionSlug };
}

async function probe(
  url: URL,
  secret: string,
  gatewayToken: string | undefined,
  fetcher: ProbeFetch,
): Promise<number> {
  try {
    const headers = new Headers({ "x-cron-secret": secret });
    if (gatewayToken !== undefined) {
      headers.set("authorization", `Bearer ${gatewayToken}`);
      headers.set("apikey", gatewayToken);
    }
    const response = await fetcher(url, {
      method: "HEAD",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    // Never read or relay response headers or a response body.
    return response.status;
  } catch {
    throw new VerificationFailure("transport_error");
  }
}

export async function verifyCronSecretRotation(
  input: VerificationInput,
  fetcher: ProbeFetch = fetch,
): Promise<VerificationResult> {
  validateSecretInput(input.acceptedSecret);
  validateSecretInput(input.rejectedSecret);
  if (input.gatewayToken !== undefined) validateSecretInput(input.gatewayToken);
  const { url, projectRef, functionSlug } = reviewedUrl(input.url, input.environment);

  if ((await probe(url, input.acceptedSecret, input.gatewayToken, fetcher)) !== 204) {
    throw new VerificationFailure("accepted_probe_failed");
  }
  if ((await probe(url, input.rejectedSecret, input.gatewayToken, fetcher)) !== 401) {
    throw new VerificationFailure("rejected_probe_failed");
  }

  return {
    verification_version: 1,
    environment: input.environment,
    project_ref: projectRef,
    function_slug: functionSlug,
    phase: input.phase,
    accepted_status: 204,
    rejected_status: 401,
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
