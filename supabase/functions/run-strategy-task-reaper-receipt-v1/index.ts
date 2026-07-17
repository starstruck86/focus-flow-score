// Strict attempt-receipted successor to run-strategy-task-reaper.
// This separate, currently unused slug cannot replace the legacy-compatible
// receiver before the reviewed sender handoff reaches its deployment gate.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createStrategyTaskReaperReceiptBusinessHandler,
  createStrategyTaskReaperReceiptHandler,
} from "./handler.ts";

const handleStrategyTaskReaperReceiptRequest =
  createStrategyTaskReaperReceiptBusinessHandler({
    createClient: (supabaseUrl, serviceRoleKey) =>
      createClient(supabaseUrl, serviceRoleKey),
    writeInfo: console.log,
    writeError: console.error,
  });

Deno.serve(createStrategyTaskReaperReceiptHandler(
  handleStrategyTaskReaperReceiptRequest,
));
