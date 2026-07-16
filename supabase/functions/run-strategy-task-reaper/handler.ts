import {
  createCronReceiverHandler,
  type CronReceiverBusinessHandler,
} from "../_shared/cronHeadReceiver.ts";
import type { EnvironmentReader } from "../_shared/cronSecretAuth.ts";

export const strategyTaskReaperCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function createStrategyTaskReaperHandler(
  handleBusinessRequest: CronReceiverBusinessHandler,
  readEnvironment?: EnvironmentReader,
): (request: Request) => Promise<Response> {
  return createCronReceiverHandler({
    allowNonCronRequests: false,
    corsHeaders: strategyTaskReaperCorsHeaders,
    handleBusinessRequest,
    readEnvironment,
  });
}
