import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import type {
  CronReceiverBusinessHandler,
} from "./cronHeadReceiver.ts";
import { createDailyDigestHandler } from "../daily-digest/handler.ts";
import {
  createStrategyTaskReaperBusinessHandler,
  createStrategyTaskReaperHandler,
} from "../run-strategy-task-reaper/handler.ts";
import { createScheduleDailyPlanHandler } from "../schedule-daily-plan/handler.ts";

const SYNTHETIC_CURRENT_KEY = "synthetic-current-cron-key";

type CallLedger = {
  business: number;
  database: number;
  model: number;
  fetch: number;
};

type HandlerFactory = (
  business: CronReceiverBusinessHandler,
  readEnvironment: (name: string) => string | undefined,
) => (request: Request) => Promise<Response>;

function emptyLedger(): CallLedger {
  return { business: 0, database: 0, model: 0, fetch: 0 };
}

function businessHandler(ledger: CallLedger): CronReceiverBusinessHandler {
  return () => {
    ledger.business += 1;
    ledger.database += 1;
    ledger.model += 1;
    ledger.fetch += 1;
    return new Response("business callback must not run for HEAD");
  };
}

function environment(name: string): string | undefined {
  if (name === "CRON_SECRET") return SYNTHETIC_CURRENT_KEY;
  if (name === "SUPABASE_URL") {
    return "https://uujkmcbqavsmzhnbqvmm.supabase.co";
  }
  return undefined;
}

function headRequest(presented?: string): Request {
  const headers = new Headers();
  if (presented !== undefined) headers.set("x-cron-secret", presented);
  return new Request("https://example.test/functions/v1/probe", {
    method: "HEAD",
    headers,
  });
}

async function assertHeadBoundary(factory: HandlerFactory): Promise<void> {
  const cases = [
    { name: "valid", presented: SYNTHETIC_CURRENT_KEY, expectedStatus: 204 },
    { name: "invalid", presented: "synthetic-unknown-cron-key", expectedStatus: 401 },
    { name: "missing", presented: undefined, expectedStatus: 401 },
  ] as const;

  for (const testCase of cases) {
    const ledger = emptyLedger();
    const handler = factory(businessHandler(ledger), environment);
    const response = await handler(headRequest(testCase.presented));

    assertEquals(response.status, testCase.expectedStatus, testCase.name);
    assertEquals(
      response.headers.get("Cache-Control"),
      "no-store",
      testCase.name,
    );
    assertEquals(ledger, {
      business: 0,
      database: 0,
      model: 0,
      fetch: 0,
    }, testCase.name);
  }
}

Deno.test("daily-digest HEAD probes stop before every business dependency", async () => {
  await assertHeadBoundary(createDailyDigestHandler);
});

Deno.test("run-strategy-task-reaper HEAD probes stop before every business dependency", async () => {
  await assertHeadBoundary((business, readEnvironment) =>
    createStrategyTaskReaperHandler(
      (request, isCron, _attempt, requestEnvironment) =>
        business(request, isCron, requestEnvironment),
      readEnvironment,
    ));
});

Deno.test("schedule-daily-plan HEAD probes stop before every business dependency", async () => {
  await assertHeadBoundary(createScheduleDailyPlanHandler);
});

Deno.test("reaper attempt validation occurs after auth but before business work", async () => {
  const attempt = "123e4567-e89b-42d3-a456-426614174000";
  const cases = [
    {
      label: "missing",
      secret: SYNTHETIC_CURRENT_KEY,
      attempt: undefined,
      status: 400,
    },
    {
      label: "malformed",
      secret: SYNTHETIC_CURRENT_KEY,
      attempt: "123E4567-E89B-42D3-A456-426614174000",
      status: 400,
    },
    {
      label: "unauthenticated",
      secret: "synthetic-rejected",
      attempt,
      status: 401,
    },
  ] as const;

  for (const testCase of cases) {
    const ledger = emptyLedger();
    const handler = createStrategyTaskReaperHandler(
      () => {
        ledger.business += 1;
        ledger.database += 1;
        return new Response(null, { status: 200 });
      },
      environment,
    );
    const headers = new Headers({ "x-cron-secret": testCase.secret });
    if (testCase.attempt !== undefined) {
      headers.set("x-cron-attempt-id", testCase.attempt);
    }
    const response = await handler(new Request(
      "https://example.test/functions/v1/run-strategy-task-reaper",
      { method: "POST", headers },
    ));
    assertEquals(response.status, testCase.status, testCase.label);
    assertEquals(ledger.business, 0, testCase.label);
    assertEquals(ledger.database, 0, testCase.label);
  }
});

Deno.test("authenticated UUID-shaped cron secret cannot become an attempt key", async () => {
  const syntheticUuidCredential = "123e4567-e89b-42d3-a456-426614174000";
  const ledger = emptyLedger();
  const handler = createStrategyTaskReaperHandler(
    () => {
      ledger.business += 1;
      ledger.database += 1;
      return new Response(null, { status: 200 });
    },
    (name) => {
      if (name === "CRON_SECRET") return syntheticUuidCredential;
      if (name === "SUPABASE_URL") {
        return "https://uujkmcbqavsmzhnbqvmm.supabase.co";
      }
      return undefined;
    },
  );
  const response = await handler(new Request(
    "https://example.test/functions/v1/run-strategy-task-reaper",
    {
      method: "POST",
      headers: {
        "x-cron-secret": syntheticUuidCredential,
        "x-cron-attempt-id": syntheticUuidCredential,
      },
    },
  ));
  assertEquals(response.status, 400);
  assertEquals(ledger.business, 0);
  assertEquals(ledger.database, 0);
});

Deno.test("every protected reaper credential domain rejects before client or RPC creation", async () => {
  const current = "10000000-0000-4000-8000-000000000001";
  const next = "20000000-0000-4000-8000-000000000002";
  const apiKey = "30000000-0000-4000-8000-000000000003";
  const jwt = "40000000-0000-4000-8000-000000000004";
  const serviceRole = "50000000-0000-4000-8000-000000000005";
  const cases: ReadonlyArray<Readonly<{
    label: string;
    presented: string;
    attempt: string;
    extraHeaders?: Readonly<Record<string, string>>;
  }>> = [
    {
      label: "current authenticates while attempt equals next",
      presented: current,
      attempt: next,
    },
    {
      label: "next authenticates while attempt equals current",
      presented: next,
      attempt: current,
    },
    {
      label: "attempt equals presented cron credential",
      presented: current,
      attempt: current,
    },
    {
      label: "attempt equals gateway API key",
      presented: current,
      attempt: apiKey,
      extraHeaders: { apikey: apiKey },
    },
    {
      label: "attempt equals gateway bearer JWT",
      presented: current,
      attempt: jwt,
      extraHeaders: { authorization: `Bearer ${jwt}` },
    },
    {
      label: "attempt equals raw authorization credential",
      presented: current,
      attempt: jwt,
      extraHeaders: { authorization: jwt },
    },
    {
      label: "attempt equals service-role credential",
      presented: current,
      attempt: serviceRole,
    },
  ];

  for (const testCase of cases) {
    let clientCalls = 0;
    let rpcCalls = 0;
    const business = createStrategyTaskReaperBusinessHandler({
      createClient: () => {
        clientCalls += 1;
        return {
          rpc: () => {
            rpcCalls += 1;
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    });
    const handler = createStrategyTaskReaperHandler(
      business,
      (name) => {
        if (name === "CRON_SECRET") return current;
        if (name === "CRON_SECRET_NEXT") return next;
        if (name === "SUPABASE_SERVICE_ROLE_KEY") return serviceRole;
        if (name === "SUPABASE_URL") {
          return "https://uujkmcbqavsmzhnbqvmm.supabase.co";
        }
        return undefined;
      },
    );
    const response = await handler(new Request(
      "https://example.test/functions/v1/run-strategy-task-reaper",
      {
        method: "POST",
        headers: {
          "x-cron-secret": testCase.presented,
          "x-cron-attempt-id": testCase.attempt,
          ...testCase.extraHeaders,
        },
      },
    ));
    const visible = await response.text();
    assertEquals(response.status, 400, testCase.label);
    assertEquals(response.headers.get("Cache-Control"), "no-store", testCase.label);
    assertEquals(clientCalls, 0, testCase.label);
    assertEquals(rpcCalls, 0, testCase.label);
    for (const protectedValue of [current, next, apiKey, jwt, serviceRole]) {
      assertEquals(visible.includes(protectedValue), false, testCase.label);
    }
  }
});

Deno.test("concurrent reaper requests use isolated single-read environment snapshots", async () => {
  const currentValues = ["synthetic-current-a", "synthetic-current-b"];
  const nextValues = ["synthetic-next-a", "synthetic-next-b"];
  const urlValues = [
    "https://uujkmcbqavsmzhnbqvmm.supabase.co",
    "https://odbjjklumdsuqdvkgwyv.supabase.co",
  ];
  const serviceValues = ["synthetic-service-a", "synthetic-service-b"];
  const sequences: Readonly<Record<string, readonly string[]>> = {
    CRON_SECRET: currentValues,
    CRON_SECRET_NEXT: nextValues,
    SUPABASE_URL: urlValues,
    SUPABASE_SERVICE_ROLE_KEY: serviceValues,
  };
  const reads = new Map<string, number>();
  const sourceEnvironment = (name: string): string | undefined => {
    const values = sequences[name];
    if (!values) return undefined;
    const ordinal = reads.get(name) ?? 0;
    reads.set(name, ordinal + 1);
    return values[ordinal];
  };
  const clients: Array<readonly [string, string]> = [];
  const business = createStrategyTaskReaperBusinessHandler({
    createClient: (url, key) => {
      clients.push([url, key]);
      return {
        rpc: () => Promise.resolve({
          data: [{
            receipt_version: 1,
            receiver: "run-strategy-task-reaper",
            attempt_present: true,
            terminal: true,
            outcome_code: "applied_success",
            effect_code: "stale_pending_runs_reaped",
            receipt_at: "2026-07-16T16:05:01.123456+00:00",
            exact_effect_count: 1,
            identity_consistent: true,
            effect_consistent: true,
            replayed: false,
          }],
          error: null,
        }),
      };
    },
  });
  const handler = createStrategyTaskReaperHandler(
    business,
    sourceEnvironment,
  );
  const request = (secret: string, attempt: string) =>
    new Request(
      "https://example.test/functions/v1/run-strategy-task-reaper",
      {
        method: "POST",
        headers: {
          "x-cron-secret": secret,
          "x-cron-attempt-id": attempt,
        },
      },
    );

  const responses = await Promise.all([
    handler(request(currentValues[0], "61000000-0000-4000-8000-000000000001")),
    handler(request(currentValues[1], "62000000-0000-4000-8000-000000000002")),
  ]);

  assertEquals(responses.map((response) => response.status), [200, 200]);
  assertEquals(
    [...clients].sort((left, right) => left[0].localeCompare(right[0])),
    [
      [urlValues[1], serviceValues[1]],
      [urlValues[0], serviceValues[0]],
    ],
  );
  for (const name of Object.keys(sequences)) {
    assertEquals(
      reads.get(name),
      2,
      `${name} must be read once per concurrent request and reused`,
    );
  }
});

Deno.test("valid authenticated reaper request passes one bound attempt", async () => {
  let observed: unknown;
  const handler = createStrategyTaskReaperHandler(
    (_request, _isCron, attempt) => {
      observed = attempt;
      return new Response(null, { status: 200 });
    },
    environment,
  );
  const response = await handler(new Request(
    "https://example.test/functions/v1/run-strategy-task-reaper",
    {
      method: "POST",
      headers: {
        "x-cron-secret": SYNTHETIC_CURRENT_KEY,
        "x-cron-attempt-id": "123e4567-e89b-42d3-a456-426614174000",
      },
    },
  ));
  assertEquals(response.status, 200);
  assertEquals(observed, {
    attemptId: "123e4567-e89b-42d3-a456-426614174000",
    receiver: "run-strategy-task-reaper",
    protocolVersion: 1,
    environment: "dynamic-staging",
    projectRef: "uujkmcbqavsmzhnbqvmm",
    requestFingerprint:
      "61e0e027eafdbb977ba4519d07e226c401dc3ff96db23357d9e10f6a6e381312",
  });
});
