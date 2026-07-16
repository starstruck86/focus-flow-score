import {
  loadReceiptVerificationInput,
  runReceiptVerificationCli,
  safeReceiptVerificationFailure,
  verifyCronAttemptReceipt,
  type ReceiptFetch,
} from "./verify-cron-attempt-receipt.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174000";
const API_KEY = "sb_publishable_synthetic_receipt_api_key";
const JWT = "syntheticHeader.syntheticPayload.syntheticSignature";
const RPC_URL =
  "https://uujkmcbqavsmzhnbqvmm.supabase.co/rest/v1/rpc/read_strategy_task_reaper_receipt";
const FINGERPRINT =
  "61e0e027eafdbb977ba4519d07e226c401dc3ff96db23357d9e10f6a6e381312";

function environment(): Map<string, string> {
  return new Map([
    ["CRON_RECEIPT_VERIFY_ENVIRONMENT", "dynamic-staging"],
    ["CRON_RECEIPT_VERIFY_PROJECT_REF", "uujkmcbqavsmzhnbqvmm"],
    ["CRON_RECEIPT_VERIFY_URL", RPC_URL],
    ["CRON_RECEIPT_VERIFY_API_KEY", API_KEY],
    ["CRON_RECEIPT_VERIFY_JWT", JWT],
    ["CRON_RECEIPT_VERIFY_ATTEMPT_ID", ATTEMPT_ID],
  ]);
}

function receipt(overrides: Record<string, unknown> = {}): unknown {
  return [{
    receipt_version: 1,
    receiver: "run-strategy-task-reaper",
    attempt_present: true,
    terminal: true,
    outcome_code: "applied_success",
    effect_code: "stale_pending_runs_reaped",
    receipt_at: "2026-07-16T16:05:01.123456+00:00",
    exact_effect_count: 2,
    identity_consistent: true,
    effect_consistent: true,
    replayed: false,
    ...overrides,
  }];
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("read-only verifier sends the exact attempt-bound RPC and emits reviewed fields", async () => {
  const env = environment();
  let calls = 0;
  const fetcher: ReceiptFetch = async (input, init) => {
    calls += 1;
    assert(String(input) === RPC_URL, "wrong fixed RPC URL");
    assert(init?.method === "POST", "read wrapper must use POST");
    const headers = new Headers(init?.headers);
    assert(headers.get("apikey") === API_KEY, "API key missing");
    assert(headers.get("authorization") === `Bearer ${JWT}`, "JWT missing");
    const body = JSON.parse(String(init?.body));
    assert(body.p_attempt_id === ATTEMPT_ID, "attempt missing");
    assert(body.p_protocol_version === 1, "protocol missing");
    assert(body.p_environment === "dynamic-staging", "environment missing");
    assert(body.p_project_ref === "uujkmcbqavsmzhnbqvmm", "project missing");
    assert(body.p_request_fingerprint === FINGERPRINT, "fingerprint missing");
    return response(receipt());
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runReceiptVerificationCli(
    (name) => env.get(name),
    fetcher,
    (line) => stdout.push(line),
    (line) => stderr.push(line),
  );
  assert(exitCode === 0, "terminal application proof must pass");
  assert(calls === 1, "exactly one read RPC expected");
  assert(stderr.length === 0, "success must not emit stderr");
  assert(stdout.length === 1, "one canonical result expected");
  assert(
    stdout[0] ===
      '{"verification_version":1,"receiver":"run-strategy-task-reaper","attempt_present":true,"terminal":true,"outcome_code":"applied_success","effect_code":"stale_pending_runs_reaped","receipt_at":"2026-07-16T16:05:01.123456+00:00","exact_effect_count":2,"identity_consistent":true,"effect_consistent":true,"result":"PASS"}',
    "unexpected visible schema",
  );
  for (const hidden of [ATTEMPT_ID, API_KEY, JWT, RPC_URL, FINGERPRINT]) {
    assert(!stdout[0].includes(hidden), "protected input escaped");
  }
});

Deno.test("missing or invalid environment input fails before network access", async () => {
  const cases = [
    ["CRON_RECEIPT_VERIFY_ATTEMPT_ID", ""],
    ["CRON_RECEIPT_VERIFY_ATTEMPT_ID", "not-a-canonical-uuid"],
    ["CRON_RECEIPT_VERIFY_ENVIRONMENT", "production"],
    ["CRON_RECEIPT_VERIFY_PROJECT_REF", "odbjjklumdsuqdvkgwyv"],
    ["CRON_RECEIPT_VERIFY_URL", "https://example.invalid/rest/v1/rpc/read"],
    ["CRON_RECEIPT_VERIFY_JWT", API_KEY],
    ["CRON_RECEIPT_VERIFY_API_KEY", ATTEMPT_ID],
  ] as const;
  for (const [name, value] of cases) {
    const env = environment();
    env.set(name, value);
    let calls = 0;
    try {
      await verifyCronAttemptReceipt(
        loadReceiptVerificationInput((key) => env.get(key)),
        async () => {
          calls += 1;
          return response(receipt());
        },
      );
      throw new Error(`expected failure for ${name}`);
    } catch (error) {
      assert(
        ["missing_input", "invalid_input", "invalid_url", "invalid_gateway_input"]
          .includes(safeReceiptVerificationFailure(error)),
        `unexpected reason for ${name}`,
      );
      assert(calls === 0, `${name} must fail before fetch`);
    }
  }
});

Deno.test("nonterminal receipt is visible but cannot pass verification", async () => {
  const env = environment();
  const stdout: string[] = [];
  const exitCode = await runReceiptVerificationCli(
    (name) => env.get(name),
    async () => response(receipt({
      terminal: false,
      outcome_code: "in_progress",
      effect_code: "attempt_in_progress",
      receipt_at: null,
      exact_effect_count: 0,
    })),
    (line) => stdout.push(line),
    () => undefined,
  );
  assert(exitCode === 2, "nonterminal attempt must require review");
  assert(stdout.length === 1, "review result must be canonical");
  assert(stdout[0].includes('"terminal":false'), "terminal state missing");
  assert(stdout[0].includes('"result":"REVIEW_REQUIRED"'), "hard gate missing");
});

Deno.test("absent attempt is sanitized, visible, and cannot pass", async () => {
  const env = environment();
  const stdout: string[] = [];
  const exitCode = await runReceiptVerificationCli(
    (name) => env.get(name),
    async () => response(receipt({
      attempt_present: false,
      terminal: false,
      outcome_code: "indeterminate",
      effect_code: "effect_indeterminate",
      receipt_at: null,
      exact_effect_count: 0,
      identity_consistent: false,
      effect_consistent: false,
      replayed: false,
    })),
    (line) => stdout.push(line),
    () => undefined,
  );
  assert(exitCode === 2, "absent attempt must require review");
  assert(stdout.length === 1, "one sanitized result expected");
  assert(stdout[0].includes('"attempt_present":false'), "absence not visible");
  assert(stdout[0].includes('"result":"REVIEW_REQUIRED"'), "hard gate missing");
  assert(!stdout[0].includes(ATTEMPT_ID), "attempt identifier must stay hidden");
});

Deno.test("erased runtime input types fail before fetch", async () => {
  const input = loadReceiptVerificationInput((name) => environment().get(name));
  const cases: unknown[] = [
    { ...input, attemptId: 123 },
    { ...input, attemptId: new String(ATTEMPT_ID) },
    { ...input, environment: ["dynamic-staging"] },
    { ...input, projectRef: { toString: () => "uujkmcbqavsmzhnbqvmm" } },
    { ...input, apiKey: new String(API_KEY) },
    { ...input, jwt: [JWT] },
    { ...input, unexpected: "field" },
  ];
  for (const candidate of cases) {
    let calls = 0;
    try {
      await verifyCronAttemptReceipt(
        candidate as Parameters<typeof verifyCronAttemptReceipt>[0],
        async () => {
          calls += 1;
          return response(receipt());
        },
      );
      throw new Error("expected erased-type rejection");
    } catch (error) {
      assert(
        ["invalid_input", "invalid_gateway_input"].includes(
          safeReceiptVerificationFailure(error),
        ),
        "wrong erased-type reason",
      );
      assert(calls === 0, "erased-type input must fail before fetch");
    }
  }
});

Deno.test("poisoned transport and result data never reach visible output", async () => {
  const sentinels = [
    "PLANTED_CREDENTIAL_SENTINEL",
    "PLANTED_ROW_PAYLOAD_SENTINEL",
    "PLANTED_FILENAME_PATH_SENTINEL",
    "PLANTED_SQL_ERROR_SENTINEL",
  ];
  const scenarios: ReceiptFetch[] = [
    async () => {
      throw new Error(sentinels.join("|"));
    },
    async () => new Response(sentinels.join("|"), { status: 500 }),
    async () => response(receipt({ arbitrary_payload: sentinels.join("|") })),
    async () => response(receipt({ receipt_at: sentinels.join("|") })),
    async () => new Response("x".repeat(16 * 1024 + 1), { status: 200 }),
    async () => new Response(new Uint8Array([0xff, 0xfe]), { status: 200 }),
  ];
  for (const fetcher of scenarios) {
    const env = environment();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runReceiptVerificationCli(
      (name) => env.get(name),
      fetcher,
      (line) => stdout.push(line),
      (line) => stderr.push(line),
    );
    const visible = JSON.stringify({ stdout, stderr });
    assert(exitCode === 1, "unsafe result must fail");
    assert(stdout.length === 0, "failure must not emit stdout");
    assert(stderr.length === 1, "one canonical failure expected");
    for (const sentinel of sentinels) {
      assert(!visible.includes(sentinel), "planted data escaped verifier");
    }
  }
});

Deno.test("legitimate no-op remains distinct and passes exact receipt proof", async () => {
  const input = loadReceiptVerificationInput((name) => environment().get(name));
  const result = await verifyCronAttemptReceipt(
    input,
    async () => response(receipt({
      outcome_code: "legitimate_noop",
      effect_code: "no_eligible_stale_pending_runs",
      exact_effect_count: 0,
      replayed: true,
    })),
  );
  assert(result.result === "PASS", "durable no-op must pass");
  assert(result.outcome_code === "legitimate_noop", "no-op distinction lost");
  assert(result.exact_effect_count === 0, "no-op effect proof incorrect");
});

Deno.test("proven rollback receipt is terminal but never passes as success", async () => {
  const input = loadReceiptVerificationInput((name) => environment().get(name));
  const result = await verifyCronAttemptReceipt(
    input,
    async () => response(receipt({
      outcome_code: "known_failure_rolled_back",
      effect_code: "execution_rolled_back",
      exact_effect_count: 0,
      replayed: true,
    })),
  );
  assert(result.terminal, "durable rollback proof must be terminal");
  assert(result.outcome_code === "known_failure_rolled_back", "failure lost");
  assert(result.result === "REVIEW_REQUIRED", "failure must never pass");
});
