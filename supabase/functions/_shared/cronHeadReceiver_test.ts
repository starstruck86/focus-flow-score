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
  return name === "CRON_SECRET" ? SYNTHETIC_CURRENT_KEY : undefined;
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
