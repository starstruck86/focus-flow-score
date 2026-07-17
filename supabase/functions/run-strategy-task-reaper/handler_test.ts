import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createStrategyTaskReaperHandler } from "./handler.ts";

const SYNTHETIC_CURRENT_KEY = "synthetic-current-cron-key";

Deno.test("legacy reaper accepts authenticated POST without an attempt header", async () => {
  let businessCalls = 0;
  const handler = createStrategyTaskReaperHandler(
    () => {
      businessCalls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    (name) => name === "CRON_SECRET" ? SYNTHETIC_CURRENT_KEY : undefined,
  );

  const response = await handler(new Request(
    "https://example.test/functions/v1/run-strategy-task-reaper",
    {
      method: "POST",
      headers: { "x-cron-secret": SYNTHETIC_CURRENT_KEY },
    },
  ));

  assertEquals(response.status, 200);
  assertEquals(businessCalls, 1);
});

Deno.test("legacy reaper still rejects an unauthenticated POST before business", async () => {
  let businessCalls = 0;
  const handler = createStrategyTaskReaperHandler(
    () => {
      businessCalls += 1;
      return new Response(null, { status: 200 });
    },
    (name) => name === "CRON_SECRET" ? SYNTHETIC_CURRENT_KEY : undefined,
  );

  const response = await handler(new Request(
    "https://example.test/functions/v1/run-strategy-task-reaper",
    {
      method: "POST",
      headers: { "x-cron-secret": "synthetic-rejected-cron-key" },
    },
  ));

  assertEquals(response.status, 401);
  assertEquals(businessCalls, 0);
});
