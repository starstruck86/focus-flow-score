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

export const strategyTaskReaperCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-cron-attempt-id",
};

export type StrategyTaskReaperBusinessHandler = (
  request: Request,
  isCron: true,
  attempt: CronAttemptContext,
) => Response | Promise<Response>;

export type StrategyTaskReaperRuntimeDependencies = Readonly<{
  createClient: () => CronReceiptRpcClient;
  writeInfo?: (line: string) => void;
  writeError?: (line: string) => void;
}>;

function receiptResponseHeaders(): HeadersInit {
  return {
    ...strategyTaskReaperCorsHeaders,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

export function createStrategyTaskReaperBusinessHandler(
  dependencies: StrategyTaskReaperRuntimeDependencies,
): StrategyTaskReaperBusinessHandler {
  return async (_request, _isCron, attempt) => {
    try {
      const receipt = await executeStrategyTaskReaperAttempt(
        dependencies.createClient(),
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
      ...strategyTaskReaperCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function createStrategyTaskReaperHandler(
  handleBusinessRequest: StrategyTaskReaperBusinessHandler,
  readEnvironment?: EnvironmentReader,
): (request: Request) => Promise<Response> {
  const environment = readEnvironment ?? ((name: string) => Deno.env.get(name));
  return createCronReceiverHandler({
    allowNonCronRequests: false,
    corsHeaders: strategyTaskReaperCorsHeaders,
    handleBusinessRequest: async (request, isCron) => {
      // createCronReceiverHandler authenticates before reaching this callback,
      // and handles HEAD before it. Attempt parsing therefore cannot persist a
      // receipt, build a database client, or perform business work for an
      // unauthenticated request or an authenticated HEAD probe.
      if (!isCron) return invalidAttemptResponse();
      let attempt: CronAttemptContext;
      try {
        attempt = await buildStrategyTaskReaperAttempt(
          request,
          environment,
        );
      } catch {
        return invalidAttemptResponse();
      }
      return await handleBusinessRequest(request, true, attempt);
    },
    readEnvironment,
  });
}
