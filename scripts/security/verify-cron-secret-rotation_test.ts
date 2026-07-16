import {
  loadVerificationInput,
  runCli,
  safeFailureReason,
  verifyCronSecretRotation,
  type ProbeFetch,
} from "./verify-cron-secret-rotation.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const acceptedSecret = "synthetic-accepted-sentinel";
const rejectedSecret = "synthetic-rejected-sentinel";
const apiKey = "sb_publishable_synthetic-api-key-sentinel";
const jwt = "syntheticHeader.syntheticPayload.syntheticSignature";

const baseInput = {
  environment: "dynamic-staging" as const,
  phase: "overlap-next" as const,
  acceptedSlot: "next" as const,
  url: "https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/daily-digest",
  acceptedSecret,
  rejectedSecret,
  apiKey,
};

function noStoreResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

Deno.test("verify_jwt=false probes repeat with API key and no Authorization", async () => {
  const methods: string[] = [];
  const fetcher: ProbeFetch = async (_input, init) => {
    methods.push(init?.method ?? "");
    const headers = new Headers(init?.headers);
    assert(headers.get("authorization") === null, "Authorization must be omitted");
    assert(headers.get("apikey") === apiKey, "API key missing");
    assert(headers.get("cache-control") === "no-store", "request cache policy missing");
    return noStoreResponse(
      headers.get("x-cron-secret") === acceptedSecret ? 204 : 401,
    );
  };

  const result = await verifyCronSecretRotation(baseInput, fetcher);
  const visible = JSON.stringify(result);
  assert(methods.length === 6, "three accepted/rejected propagation probes required");
  assert(methods.every((method) => method === "HEAD"), "HEAD only");
  assert(!visible.includes(acceptedSecret), "accepted secret must not escape");
  assert(!visible.includes(rejectedSecret), "rejected secret must not escape");
  assert(!visible.includes(apiKey), "API key must not escape");
  assert(result.result === "PASS", "expected a passing verification");
  assert(result.project_ref === "uujkmcbqavsmzhnbqvmm", "project binding missing");
  assert(result.function_slug === "daily-digest", "function binding missing");
  assert(result.verify_jwt === false, "reviewed gateway mode missing");
  assert(result.authorization_sent === false, "Authorization evidence incorrect");
  assert(result.probe_repetitions === 3, "propagation count missing");
});

Deno.test("verify_jwt=true uses a separately supplied JWT", async () => {
  const input = {
    ...baseInput,
    url:
      "https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/run-strategy-task-reaper",
    jwt,
  };
  let calls = 0;
  const fetcher: ProbeFetch = async (_input, init) => {
    calls += 1;
    const headers = new Headers(init?.headers);
    assert(headers.get("apikey") === apiKey, "API key missing");
    assert(headers.get("authorization") === `Bearer ${jwt}`, "separate JWT missing");
    assert(headers.get("authorization") !== `Bearer ${apiKey}`, "API key copied to Authorization");
    return noStoreResponse(
      headers.get("x-cron-secret") === acceptedSecret ? 204 : 401,
    );
  };

  const result = await verifyCronSecretRotation(input, fetcher);
  assert(calls === 6, "repeated gateway probes missing");
  assert(result.verify_jwt === true, "reviewed gateway mode missing");
  assert(result.authorization_sent === true, "JWT evidence missing");
});

Deno.test("gateway inputs fail closed before fetch", async () => {
  const trueUrl =
    "https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/run-strategy-task-reaper";
  const cases = [
    { ...baseInput, url: trueUrl },
    { ...baseInput, url: trueUrl, jwt: apiKey },
    { ...baseInput, url: trueUrl, apiKey: jwt, jwt },
    { ...baseInput, jwt },
  ];
  for (const input of cases) {
    let calls = 0;
    try {
      await verifyCronSecretRotation(input, async () => {
        calls += 1;
        return noStoreResponse(204);
      });
      throw new Error("expected failure");
    } catch (error) {
      assert(safeFailureReason(error) === "invalid_gateway_input", "wrong reason");
      assert(calls === 0, "invalid gateway input must fail before fetch");
    }
  }
});

Deno.test("wrong host, project, port, and path fail before fetch", async () => {
  const substitutions = [
    "https://example.invalid/functions/v1/daily-digest",
    "https://odbjjklumdsuqdvkgwyv.supabase.co/functions/v1/daily-digest",
    "https://uujkmcbqavsmzhnbqvmm.supabase.co:443/functions/v1/daily-digest",
    "https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/unreviewed",
    "https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/toString",
    "https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/daily-digest/extra",
  ];
  for (const url of substitutions) {
    let calls = 0;
    try {
      await verifyCronSecretRotation({ ...baseInput, url }, async () => {
        calls += 1;
        return noStoreResponse(204);
      });
      throw new Error("expected failure");
    } catch (error) {
      assert(safeFailureReason(error) === "invalid_url", "wrong failure reason");
      assert(calls === 0, "unbound destination must fail before fetch");
    }
  }
});

Deno.test("contradictory phase and slot attestations fail before fetch", async () => {
  let calls = 0;
  const environment = new Map<string, string>([
    ["CRON_VERIFY_ENVIRONMENT", "dynamic-staging"],
    ["CRON_VERIFY_PHASE", "overlap-next"],
    ["CRON_VERIFY_ACCEPTED_SLOT", "current"],
    ["CRON_VERIFY_URL", baseInput.url],
    ["CRON_VERIFY_ACCEPT_SECRET", acceptedSecret],
    ["CRON_VERIFY_REJECT_SECRET", rejectedSecret],
    ["CRON_VERIFY_API_KEY", apiKey],
  ]);
  try {
    await verifyCronSecretRotation(
      loadVerificationInput((name) => environment.get(name)),
      async () => {
        calls += 1;
        return noStoreResponse(204);
      },
    );
    throw new Error("expected failure");
  } catch (error) {
    assert(safeFailureReason(error) === "invalid_attestation", "wrong reason");
    assert(calls === 0, "invalid attestation must fail before fetch");
  }

  try {
    await verifyCronSecretRotation(
      { ...baseInput, acceptedSlot: "current" },
      async () => {
        calls += 1;
        return noStoreResponse(204);
      },
    );
    throw new Error("expected failure");
  } catch (error) {
    assert(safeFailureReason(error) === "invalid_attestation", "wrong direct reason");
    assert(calls === 0, "direct invalid attestation must fail before fetch");
  }
});

Deno.test("accepted status or cache-policy failure is canonical", async () => {
  for (const response of [
    noStoreResponse(401),
    new Response(null, { status: 204 }),
  ]) {
    try {
      await verifyCronSecretRotation(baseInput, async () => response.clone());
      throw new Error("expected failure");
    } catch (error) {
      assert(safeFailureReason(error) === "accepted_probe_failed", "wrong reason");
    }
  }
});

Deno.test("rejected status or cache-policy failure is canonical", async () => {
  for (const rejectedResponse of [
    noStoreResponse(204),
    new Response(null, { status: 401 }),
  ]) {
    let calls = 0;
    try {
      await verifyCronSecretRotation(baseInput, async () => {
        calls += 1;
        return calls % 2 === 1 ? noStoreResponse(204) : rejectedResponse.clone();
      });
      throw new Error("expected failure");
    } catch (error) {
      assert(safeFailureReason(error) === "rejected_probe_failed", "wrong reason");
    }
  }
});

Deno.test("poisoned transport errors collapse without leaking", async () => {
  const fetcher: ProbeFetch = async () => {
    throw new Error(`poison:${acceptedSecret}:${rejectedSecret}:${apiKey}:${jwt}`);
  };
  try {
    await verifyCronSecretRotation(baseInput, fetcher);
    throw new Error("expected failure");
  } catch (error) {
    const visible = JSON.stringify({ reason: safeFailureReason(error) });
    assert(visible === '{"reason":"transport_error"}', "transport failure must be canonical");
    for (const sentinel of ["poison", acceptedSecret, rejectedSecret, apiKey, jwt]) {
      assert(!visible.includes(sentinel), "poisoned input must not escape");
    }
  }
});

function falseModeEnvironment(): Map<string, string> {
  return new Map([
    ["CRON_VERIFY_ENVIRONMENT", "dynamic-staging"],
    ["CRON_VERIFY_PHASE", "overlap-next"],
    ["CRON_VERIFY_ACCEPTED_SLOT", "next"],
    ["CRON_VERIFY_URL", baseInput.url],
    ["CRON_VERIFY_ACCEPT_SECRET", acceptedSecret],
    ["CRON_VERIFY_REJECT_SECRET", rejectedSecret],
    ["CRON_VERIFY_API_KEY", apiKey],
  ]);
}

Deno.test("CLI boundary emits one canonical nonleaking diagnostic", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(
    (name) => falseModeEnvironment().get(name),
    async () => {
      throw new Error(`poison:${acceptedSecret}:${rejectedSecret}:${apiKey}:${baseInput.url}`);
    },
    (line) => stdout.push(line),
    (line) => stderr.push(line),
  );
  const visible = JSON.stringify({ stdout, stderr });
  assert(exitCode === 1, "CLI must fail");
  assert(stdout.length === 0, "failure must not write stdout");
  assert(stderr.length === 1, "failure must write exactly one diagnostic");
  assert(
    stderr[0] === '{"verification_version":1,"result":"FAIL","reason":"transport_error"}',
    "diagnostic must be canonical",
  );
  for (const sentinel of [acceptedSecret, rejectedSecret, apiKey, baseInput.url, "poison"]) {
    assert(!visible.includes(sentinel), "poisoned input must not escape");
  }
});

Deno.test("CLI success is bound, repeated, and nonleaking", async () => {
  const environment = falseModeEnvironment();
  const stdout: string[] = [];
  const stderr: string[] = [];
  let calls = 0;
  const exitCode = await runCli(
    (name) => environment.get(name),
    async (_input, init) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      return noStoreResponse(
        headers.get("x-cron-secret") === acceptedSecret ? 204 : 401,
      );
    },
    (line) => stdout.push(line),
    (line) => stderr.push(line),
  );
  const visible = JSON.stringify({ stdout, stderr });
  assert(exitCode === 0, "CLI should pass");
  assert(calls === 6, "CLI propagation probes missing");
  assert(stdout.length === 1 && stderr.length === 0, "unexpected CLI channels");
  const result = JSON.parse(stdout[0]);
  assert(result.project_ref === "uujkmcbqavsmzhnbqvmm", "project not bound");
  assert(result.function_slug === "daily-digest", "function not bound");
  assert(result.phase_attestation === "overlap-next", "phase attestation missing");
  assert(result.accepted_slot_attestation === "next", "slot attestation missing");
  for (const sentinel of [acceptedSecret, rejectedSecret, apiKey, baseInput.url]) {
    assert(!visible.includes(sentinel), "input must not escape");
  }
});

Deno.test("missing runtime inputs fail closed", () => {
  try {
    loadVerificationInput(() => undefined);
    throw new Error("expected failure");
  } catch (error) {
    assert(safeFailureReason(error) === "missing_input", "missing input must fail closed");
  }
});
