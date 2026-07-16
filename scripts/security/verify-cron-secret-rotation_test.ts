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
const gatewayToken = "synthetic-gateway-sentinel";

const baseInput = {
  environment: "dynamic-staging" as const,
  phase: "overlap-next" as const,
  url: "https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/daily-digest",
  acceptedSecret,
  rejectedSecret,
  gatewayToken,
};

Deno.test("verification harness uses HEAD and emits only sanitized status evidence", async () => {
  const methods: string[] = [];
  const fetcher: ProbeFetch = async (_input, init) => {
    methods.push(init?.method ?? "");
    const headers = new Headers(init?.headers);
    assert(headers.get("authorization") === `Bearer ${gatewayToken}`, "gateway token missing");
    assert(headers.get("apikey") === gatewayToken, "gateway API key missing");
    return new Response(null, {
      status: headers.get("x-cron-secret") === acceptedSecret ? 204 : 401,
    });
  };

  const result = await verifyCronSecretRotation(baseInput, fetcher);
  const visible = JSON.stringify(result);
  assert(methods.length === 2 && methods.every((method) => method === "HEAD"), "HEAD only");
  assert(!visible.includes(acceptedSecret), "accepted secret must not escape");
  assert(!visible.includes(rejectedSecret), "rejected secret must not escape");
  assert(!visible.includes(gatewayToken), "gateway token must not escape");
  assert(result.result === "PASS", "expected a passing verification");
  assert(result.project_ref === "uujkmcbqavsmzhnbqvmm", "project binding missing");
  assert(result.function_slug === "daily-digest", "function binding missing");
});

Deno.test("wrong host, project, port, and path fail before fetch", async () => {
  const substitutions = [
    "https://example.invalid/functions/v1/daily-digest",
    "https://odbjjklumdsuqdvkgwyv.supabase.co/functions/v1/daily-digest",
    "https://uujkmcbqavsmzhnbqvmm.supabase.co:443/functions/v1/daily-digest",
    "https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/unreviewed",
    "https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/daily-digest/extra",
  ];
  for (const url of substitutions) {
    let calls = 0;
    const fetcher: ProbeFetch = async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    };
    try {
      await verifyCronSecretRotation({ ...baseInput, url }, fetcher);
      throw new Error("expected failure");
    } catch (error) {
      assert(safeFailureReason(error) === "invalid_url", "wrong failure reason");
      assert(calls === 0, "unbound destination must fail before fetch");
    }
  }
});

Deno.test("accepted probe failure is canonical and nonleaking", async () => {
  const fetcher: ProbeFetch = async () => new Response(null, { status: 401 });
  try {
    await verifyCronSecretRotation(baseInput, fetcher);
    throw new Error("expected failure");
  } catch (error) {
    const visible = JSON.stringify({ reason: safeFailureReason(error) });
    assert(visible.includes("accepted_probe_failed"), "wrong reason");
    assert(!visible.includes(acceptedSecret), "accepted secret must not escape");
  }
});

Deno.test("rejected probe failure is canonical and nonleaking", async () => {
  const fetcher: ProbeFetch = async () => new Response(null, { status: 204 });
  try {
    await verifyCronSecretRotation(baseInput, fetcher);
    throw new Error("expected failure");
  } catch (error) {
    const visible = JSON.stringify({ reason: safeFailureReason(error) });
    assert(visible.includes("rejected_probe_failed"), "wrong reason");
    assert(!visible.includes(rejectedSecret), "rejected secret must not escape");
  }
});

Deno.test("poisoned transport errors collapse without leaking", async () => {
  const fetcher: ProbeFetch = async () => {
    throw new Error(`poison:${acceptedSecret}:${rejectedSecret}:${gatewayToken}`);
  };
  try {
    await verifyCronSecretRotation(baseInput, fetcher);
    throw new Error("expected failure");
  } catch (error) {
    const visible = JSON.stringify({ reason: safeFailureReason(error) });
    assert(visible === '{"reason":"transport_error"}', "transport failure must be canonical");
    assert(!visible.includes("poison"), "poison text must not escape");
    assert(!visible.includes(acceptedSecret), "accepted secret must not escape");
    assert(!visible.includes(rejectedSecret), "rejected secret must not escape");
    assert(!visible.includes(gatewayToken), "gateway token must not escape");
  }
});

Deno.test("CLI boundary emits one canonical nonleaking diagnostic", async () => {
  const environment = new Map<string, string>([
    ["CRON_VERIFY_ENVIRONMENT", "dynamic-staging"],
    ["CRON_VERIFY_PHASE", "overlap-next"],
    ["CRON_VERIFY_URL", baseInput.url],
    ["CRON_VERIFY_ACCEPT_SECRET", acceptedSecret],
    ["CRON_VERIFY_REJECT_SECRET", rejectedSecret],
    ["CRON_VERIFY_GATEWAY_TOKEN", gatewayToken],
  ]);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(
    (name) => environment.get(name),
    async () => {
      throw new Error(`poison:${acceptedSecret}:${rejectedSecret}:${gatewayToken}:${baseInput.url}`);
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
  for (const sentinel of [acceptedSecret, rejectedSecret, gatewayToken, baseInput.url, "poison"]) {
    assert(!visible.includes(sentinel), "poisoned input must not escape");
  }
});

Deno.test("CLI success is bound and nonleaking", async () => {
  const environment = new Map<string, string>([
    ["CRON_VERIFY_ENVIRONMENT", "dynamic-staging"],
    ["CRON_VERIFY_PHASE", "overlap-next"],
    ["CRON_VERIFY_URL", baseInput.url],
    ["CRON_VERIFY_ACCEPT_SECRET", acceptedSecret],
    ["CRON_VERIFY_REJECT_SECRET", rejectedSecret],
    ["CRON_VERIFY_GATEWAY_TOKEN", gatewayToken],
  ]);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(
    (name) => environment.get(name),
    async (_input, init) => {
      const headers = new Headers(init?.headers);
      return new Response(null, {
        status: headers.get("x-cron-secret") === acceptedSecret ? 204 : 401,
      });
    },
    (line) => stdout.push(line),
    (line) => stderr.push(line),
  );
  const visible = JSON.stringify({ stdout, stderr });
  assert(exitCode === 0, "CLI should pass");
  assert(stdout.length === 1 && stderr.length === 0, "unexpected CLI channels");
  const result = JSON.parse(stdout[0]);
  assert(result.project_ref === "uujkmcbqavsmzhnbqvmm", "project not bound");
  assert(result.function_slug === "daily-digest", "function not bound");
  for (const sentinel of [acceptedSecret, rejectedSecret, gatewayToken, baseInput.url]) {
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
