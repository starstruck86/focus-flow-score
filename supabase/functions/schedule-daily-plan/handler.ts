import {
  createCronReceiverHandler,
  type CronReceiverBusinessHandler,
} from "../_shared/cronHeadReceiver.ts";
import type { EnvironmentReader } from "../_shared/cronSecretAuth.ts";

export const scheduleDailyPlanCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

export function createScheduleDailyPlanHandler(
  handleBusinessRequest: CronReceiverBusinessHandler,
  readEnvironment?: EnvironmentReader,
): (request: Request) => Promise<Response> {
  return createCronReceiverHandler({
    allowNonCronRequests: false,
    corsHeaders: scheduleDailyPlanCorsHeaders,
    handleBusinessRequest,
    readEnvironment,
  });
}
