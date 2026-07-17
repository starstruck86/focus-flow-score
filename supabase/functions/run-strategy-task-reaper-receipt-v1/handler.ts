import {
  createCronReceiverHandler,
} from "../_shared/cronHeadReceiver.ts";
import type { EnvironmentReader } from "../_shared/cronSecretAuth.ts";
import {
  buildStrategyTaskReaperAttempt,
  type CronAttemptContext,
  type CronReceiptRpcClient,
  executeStrategyTaskReaperAttempt,
} from "../_shared/cronAttemptReceipt.ts";

export const strategyTaskReaperReceiptCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-cron-attempt-id",
};

export type StrategyTaskReaperReceiptBusinessHandler = (
  request: Request,
  isCron: true,
  attempt: CronAttemptContext,
  readEnvironment: EnvironmentReader,
) => Response | Promise<Response>;

export type StrategyTaskReaperReceiptRuntimeDependencies = Readonly<{
  createClient: (
    supabaseUrl: string,
    serviceRoleKey: string,
  ) => CronReceiptRpcClient;
  writeInfo?: (line: string) => void;
  writeError?: (line: string) => void;
}>;

function receiptResponseHeaders(): HeadersInit {
  return {
    ...strategyTaskReaperReceiptCorsHeaders,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

export function createStrategyTaskReaperReceiptBusinessHandler(
  dependencies: StrategyTaskReaperReceiptRuntimeDependencies,
): StrategyTaskReaperReceiptBusinessHandler {
  return async (_request, _isCron, attempt, readEnvironment) => {
    try {
      // These values come from the request-local, per-key memoized environment
      // view used for cron authentication, credential-domain separation, and
      // project binding. They are never copied into the attempt context,
      // receipt, or logs.
      const supabaseUrl = readEnvironment("SUPABASE_URL");
      const serviceRoleKey = readEnvironment("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceRoleKey) throw new Error("runtime_unavailable");
      const receipt = await executeStrategyTaskReaperAttempt(
        dependencies.createClient(supabaseUrl, serviceRoleKey),
        attempt,
      );
      dependencies.writeInfo?.(JSON.stringify({
        event_code: "strategy_task_reaper_receipt",
        receiver: receipt.receiver,
        outcome_code: receipt.outcome_code,
        effect_code: receipt.effect_code,
        exact_effect_count: receipt.exact_effect_count,
        replayed: receipt.replayed,
      }));
      return new Response(JSON.stringify(receipt), {
        status: 200,
        headers: receiptResponseHeaders(),
      });
    } catch {
      const errorCode = "receipt_execution_failed";
      dependencies.writeError?.(JSON.stringify({
        event_code: "strategy_task_reaper_receipt_failed",
        reason_code: errorCode,
      }));
      return new Response(JSON.stringify({ error_code: errorCode }), {
        status: 500,
        headers: receiptResponseHeaders(),
      });
    }
  };
}

function invalidAttemptResponse(): Response {
  return new Response(JSON.stringify({ error_code: "invalid_cron_attempt" }), {
    status: 400,
    headers: {
      ...strategyTaskReaperReceiptCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function createStrategyTaskReaperReceiptHandler(
  handleBusinessRequest: StrategyTaskReaperReceiptBusinessHandler,
  readEnvironment?: EnvironmentReader,
): (request: Request) => Promise<Response> {
  return createCronReceiverHandler({
    allowNonCronRequests: false,
    corsHeaders: strategyTaskReaperReceiptCorsHeaders,
    handleBusinessRequest: async (
      authenticatedRequest,
      isCron,
      requestEnvironment,
    ) => {
      // createCronReceiverHandler authenticates and handles HEAD before this
      // callback. Its request-local, per-key memoized environment view is also
      // used for attempt-domain separation, so a rotation cannot authenticate
      // one slot and omit it from the protected comparison set.
      if (!isCron) return invalidAttemptResponse();
      let attempt: CronAttemptContext;
      try {
        attempt = await buildStrategyTaskReaperAttempt(
          authenticatedRequest,
          requestEnvironment,
        );
      } catch {
        return invalidAttemptResponse();
      }
      return await handleBusinessRequest(
        authenticatedRequest,
        true,
        attempt,
        requestEnvironment,
      );
    },
    readEnvironment,
  });
}
