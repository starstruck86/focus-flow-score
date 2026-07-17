// Strict attempt-receipted successor to run-strategy-task-reaper.
// No tracked caller targets this separate strict successor. Its deployment
// state is runtime-unverified, and deploy-all operations are prohibited while
// the receiver gate is blocked.

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
