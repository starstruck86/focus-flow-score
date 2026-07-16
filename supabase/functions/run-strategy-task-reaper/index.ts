// ════════════════════════════════════════════════════════════════
// run-strategy-task-reaper — cron-triggered, time-gated stale-run reaper.
//
// Sweeps ALL users for task_runs rows stuck in `pending` past their
// stage budget and fails them with explicit `stage_timeout:<step>`.
//
// Triggered by pg_cron every minute. Uses the service role so it can
// reach rows across users without auth.
// ════════════════════════════════════════════════════════════════

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createStrategyTaskReaperBusinessHandler,
  createStrategyTaskReaperHandler,
} from "./handler.ts";

const handleStrategyTaskReaperRequest = createStrategyTaskReaperBusinessHandler({
  createClient: (supabaseUrl, serviceRoleKey) =>
    createClient(supabaseUrl, serviceRoleKey),
  writeInfo: console.log,
  writeError: console.error,
});

Deno.serve(createStrategyTaskReaperHandler(handleStrategyTaskReaperRequest));
