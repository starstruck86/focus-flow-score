import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildStrategyTaskReaperAttempt } from "../_shared/cronAttemptReceipt.ts";
import { createStrategyTaskReaperBusinessHandler } from "./handler.ts";

const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174000";

async function context() {
  return await buildStrategyTaskReaperAttempt(
    new Request("https://example.test/functions/v1/run-strategy-task-reaper", {
      method: "POST",
      headers: { "x-cron-attempt-id": ATTEMPT_ID },
    }),
    (name) => name === "SUPABASE_URL"
      ? "https://uujkmcbqavsmzhnbqvmm.supabase.co"
      : undefined,
  );
}

function appliedReceipt() {
  return [{
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
  }];
}

Deno.test("reaper business handler returns only the reviewed receipt fields", async () => {
  const info: string[] = [];
  const errors: string[] = [];
  const handler = createStrategyTaskReaperBusinessHandler({
    createClient: () => ({
      rpc: () => Promise.resolve({ data: appliedReceipt(), error: null }),
    }),
    writeInfo: (line) => info.push(line),
    writeError: (line) => errors.push(line),
  });
  const response = await handler(
    new Request("https://example.test", { method: "POST" }),
    true,
    await context(),
  );
  const visible = `${await response.text()}\n${info.join("\n")}`;
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(errors, []);
  assertEquals(visible.includes(ATTEMPT_ID), false);
  assertEquals(visible.includes("business-row-id"), false);
});

Deno.test("reaper business handler suppresses poisoned RPC errors", async () => {
  const sentinel =
    "PLANTED_CREDENTIAL_PAYLOAD_FILENAME_PATH_SQL_STACK_SENTINEL";
  const info: string[] = [];
  const errors: string[] = [];
  const handler = createStrategyTaskReaperBusinessHandler({
    createClient: () => ({
      rpc: () => Promise.resolve({
        data: [{ arbitrary_business_payload: sentinel }],
        error: { message: sentinel, details: sentinel, hint: sentinel },
      }),
    }),
    writeInfo: (line) => info.push(line),
    writeError: (line) => errors.push(line),
  });
  const response = await handler(
    new Request("https://example.test", { method: "POST" }),
    true,
    await context(),
  );
  const visible = JSON.stringify({
    body: await response.text(),
    info,
    errors,
  });
  assertEquals(response.status, 500);
  assertEquals(
    visible.includes(sentinel),
    false,
    "unreviewed RPC data must never escape",
  );
  assertEquals(
    errors,
    [
      '{"event_code":"strategy_task_reaper_receipt_failed","reason_code":"receipt_execution_failed"}',
    ],
  );
});
