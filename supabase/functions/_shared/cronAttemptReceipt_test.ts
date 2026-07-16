import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildStrategyTaskReaperAttempt,
  CronAttemptInputError,
  CronReceiptResultError,
  executeStrategyTaskReaperAttempt,
  parseCanonicalCronAttemptId,
  parseCronAttemptReceipt,
  type CronAttemptContext,
} from "./cronAttemptReceipt.ts";

const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174000";
const RECEIPT_AT = "2026-07-16T16:05:01.123456+00:00";

function environment(name: string): string | undefined {
  return name === "SUPABASE_URL"
    ? "https://uujkmcbqavsmzhnbqvmm.supabase.co"
    : undefined;
}

function request(attempt = ATTEMPT_ID, method = "POST"): Request {
  const headers = new Headers();
  if (attempt !== "") headers.set("x-cron-attempt-id", attempt);
  return new Request("https://example.test/functions/v1/run-strategy-task-reaper", {
    method,
    headers,
  });
}

function receipt(
  overrides: Record<string, unknown> = {},
): ReadonlyArray<Record<string, unknown>> {
  return [{
    receipt_version: 1,
    receiver: "run-strategy-task-reaper",
    attempt_present: true,
    terminal: true,
    outcome_code: "applied_success",
    effect_code: "stale_pending_runs_reaped",
    receipt_at: RECEIPT_AT,
    exact_effect_count: 2,
    identity_consistent: true,
    effect_consistent: true,
    replayed: false,
    ...overrides,
  }];
}

Deno.test("canonical reaper attempt binds the reviewed semantic identity", async () => {
  const result = await buildStrategyTaskReaperAttempt(request(), environment);
  assertEquals(result, {
    attemptId: ATTEMPT_ID,
    receiver: "run-strategy-task-reaper",
    protocolVersion: 1,
    environment: "dynamic-staging",
    projectRef: "uujkmcbqavsmzhnbqvmm",
    requestFingerprint:
      "61e0e027eafdbb977ba4519d07e226c401dc3ff96db23357d9e10f6a6e381312",
  });

  const production = await buildStrategyTaskReaperAttempt(
    request(),
    (name) => name === "SUPABASE_URL"
      ? "https://odbjjklumdsuqdvkgwyv.supabase.co"
      : undefined,
  );
  assertEquals(production.environment, "production");
  assertEquals(production.projectRef, "odbjjklumdsuqdvkgwyv");
  assertEquals(
    production.requestFingerprint,
    "cbc3f2c498ed4ccc2fb7937e9d5f2b00ea302fc5402b996cd0eac83276b37166",
  );
});

Deno.test("attempt identity cannot equal a request credential", async () => {
  const credentialHeaders: ReadonlyArray<Readonly<Record<string, string>>> = [
    { "x-cron-secret": ATTEMPT_ID },
    { apikey: ATTEMPT_ID },
    { authorization: ATTEMPT_ID },
    { authorization: `Bearer ${ATTEMPT_ID}` },
  ];
  for (const credentialHeader of credentialHeaders) {
    await assertRejects(
      () => buildStrategyTaskReaperAttempt(
        new Request(
          "https://example.test/functions/v1/run-strategy-task-reaper",
          {
            method: "POST",
            headers: {
              "x-cron-attempt-id": ATTEMPT_ID,
              ...credentialHeader,
            },
          },
        ),
        environment,
      ),
      CronAttemptInputError,
    );
  }
});

Deno.test("attempt identity cannot equal either configured receiver slot or service credential", async () => {
  for (const protectedName of [
    "CRON_SECRET",
    "CRON_SECRET_NEXT",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    let projectIdentityReads = 0;
    await assertRejects(
      () => buildStrategyTaskReaperAttempt(
        request(),
        (name) => {
          if (name === protectedName) return ATTEMPT_ID;
          if (name === "SUPABASE_URL") {
            projectIdentityReads += 1;
            return "https://uujkmcbqavsmzhnbqvmm.supabase.co";
          }
          return undefined;
        },
      ),
      CronAttemptInputError,
    );
    assertEquals(
      projectIdentityReads,
      0,
      `${protectedName} equality must reject before semantic hashing`,
    );
  }
});

Deno.test("attempt and project inputs fail closed before receipt execution", async () => {
  const cases: Array<readonly [Request, (name: string) => string | undefined]> = [
    [request(""), environment],
    [request(ATTEMPT_ID.toUpperCase()), environment],
    [request("123e4567-e89b-42d3-c456-426614174000"), environment],
    [request(ATTEMPT_ID, "GET"), environment],
    [request(), () => undefined],
    [request(), () => "http://uujkmcbqavsmzhnbqvmm.supabase.co"],
    [request(), () => "https://unreviewedprojectref.supabase.co"],
    [request(), () => "https://uujkmcbqavsmzhnbqvmm.supabase.co/path"],
  ];
  const duplicate = request();
  duplicate.headers.append("x-cron-attempt-id", ATTEMPT_ID);
  cases.push([duplicate, environment]);

  for (const [candidate, readEnvironment] of cases) {
    await assertRejects(
      () => buildStrategyTaskReaperAttempt(candidate, readEnvironment),
      CronAttemptInputError,
    );
  }
});

Deno.test("canonical attempt parser rejects wrong runtime types without coercion", () => {
  const cases: unknown[] = [
    undefined,
    null,
    123,
    new String(ATTEMPT_ID),
    [ATTEMPT_ID],
    { toString: () => ATTEMPT_ID },
  ];
  for (const candidate of cases) {
    try {
      parseCanonicalCronAttemptId(candidate);
      throw new Error("expected wrong-type rejection");
    } catch (error) {
      assertEquals(error instanceof CronAttemptInputError, true);
    }
  }
  assertEquals(parseCanonicalCronAttemptId(ATTEMPT_ID), ATTEMPT_ID);
});

Deno.test("receipt parser accepts only the exact reviewed result schema", () => {
  const applied = parseCronAttemptReceipt(receipt());
  assertEquals(applied.outcome_code, "applied_success");
  assertEquals(applied.exact_effect_count, 2);

  const noop = parseCronAttemptReceipt(receipt({
    outcome_code: "legitimate_noop",
    effect_code: "no_eligible_stale_pending_runs",
    exact_effect_count: 0,
    replayed: true,
  }));
  assertEquals(noop.outcome_code, "legitimate_noop");
  assertEquals(noop.replayed, true);

  const absent = parseCronAttemptReceipt(receipt({
    attempt_present: false,
    terminal: false,
    outcome_code: "indeterminate",
    effect_code: "effect_indeterminate",
    receipt_at: null,
    exact_effect_count: 0,
    identity_consistent: false,
    effect_consistent: false,
    replayed: false,
  }));
  assertEquals(absent.attempt_present, false);
  assertEquals(absent.terminal, false);
});

Deno.test("receipt parser rejects malformed, contradictory, and arbitrary fields", () => {
  const sentinel = "PLANTED_ROW_PAYLOAD_SECRET_PATH_SQL_ERROR_SENTINEL";
  const cases: unknown[] = [
    null,
    [],
    [receipt()[0], receipt()[0]],
    receipt({ receiver: "daily-digest" }),
    receipt({ outcome_code: "applied_success", effect_code: "execution_rolled_back" }),
    receipt({ outcome_code: "legitimate_noop", exact_effect_count: 1 }),
    receipt({ terminal: false }),
    receipt({ receipt_at: sentinel }),
    receipt({ exact_effect_count: 201 }),
    receipt({ identity_consistent: false }),
    receipt({ effect_consistent: false }),
    receipt({ arbitrary_payload: sentinel }),
  ];
  for (const value of cases) {
    try {
      parseCronAttemptReceipt(value);
      throw new Error("expected receipt validation failure");
    } catch (error) {
      assertEquals(error instanceof CronReceiptResultError, true);
      assertEquals(String(error).includes(sentinel), false);
    }
  }
});

Deno.test("execution calls only the fixed RPC with bound arguments", async () => {
  const context = await buildStrategyTaskReaperAttempt(request(), environment);
  let observedName = "";
  let observedArgs: unknown;
  const result = await executeStrategyTaskReaperAttempt({
    rpc: (name, args) => {
      observedName = name;
      observedArgs = args;
      return Promise.resolve({ data: receipt(), error: null });
    },
  }, context);
  assertEquals(observedName, "execute_strategy_task_reaper_attempt");
  assertEquals(observedArgs, {
    p_attempt_id: ATTEMPT_ID,
    p_protocol_version: 1,
    p_environment: "dynamic-staging",
    p_project_ref: "uujkmcbqavsmzhnbqvmm",
    p_request_fingerprint:
      "61e0e027eafdbb977ba4519d07e226c401dc3ff96db23357d9e10f6a6e381312",
  });
  assertEquals(result.outcome_code, "applied_success");
});

Deno.test("execution rejects RPC errors and non-success terminal states", async () => {
  const context = await buildStrategyTaskReaperAttempt(request(), environment);
  const clients = [
    {
      rpc: () => Promise.resolve({
        data: receipt(),
        error: { message: "PLANTED_RAW_SQL_ERROR_SENTINEL" },
      }),
    },
    {
      rpc: () => Promise.resolve({
        data: receipt({
          outcome_code: "known_failure_rolled_back",
          effect_code: "execution_rolled_back",
          exact_effect_count: 0,
        }),
        error: null,
      }),
    },
    {
      rpc: () => Promise.reject(new Error("PLANTED_THROWN_SECRET_SENTINEL")),
    },
  ];
  for (const client of clients) {
    await assertRejects(
      () => executeStrategyTaskReaperAttempt(client, context as CronAttemptContext),
      CronReceiptResultError,
      "invalid_receipt_result",
    );
  }
});
