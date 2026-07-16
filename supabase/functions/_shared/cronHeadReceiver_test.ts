import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import type {
  CronReceiverBusinessHandler,
} from "./cronHeadReceiver.ts";
import { createDailyDigestHandler } from "../daily-digest/handler.ts";
import { createStrategyTaskReaperHandler } from "../run-strategy-task-reaper/handler.ts";
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
  await assertHeadBoundary(createStrategyTaskReaperHandler);
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
