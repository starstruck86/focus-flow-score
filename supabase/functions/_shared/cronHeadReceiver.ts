import {
  hasValidCronSecret,
  type EnvironmentReader,
} from "./cronSecretAuth.ts";

export type CronReceiverBusinessHandler = (
  request: Request,
  isCron: boolean,
  readEnvironment: EnvironmentReader,
) => Response | Promise<Response>;

export type CronReceiverHandlerOptions = Readonly<{
  allowNonCronRequests: boolean;
  corsHeaders: HeadersInit;
  handleBusinessRequest: CronReceiverBusinessHandler;
  readEnvironment?: EnvironmentReader;
}>;

function responseHeaders(
  corsHeaders: HeadersInit,
  contentType: boolean,
  noStore: boolean,
): Headers {
  const headers = new Headers(corsHeaders);
  if (contentType) headers.set("Content-Type", "application/json");
  if (noStore) headers.set("Cache-Control", "no-store");
  return headers;
}

function unauthorizedResponse(
  corsHeaders: HeadersInit,
  noStore = false,
): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: responseHeaders(corsHeaders, true, noStore),
  });
}

/**
 * Creates the request boundary shared by the reviewed cron receivers.
 *
 * HEAD is intentionally handled before the injected business callback. A
 * valid probe therefore verifies only the custom cron-secret boundary; it
 * cannot create a client, read a request body, call a model, fetch an
 * outbound service, or perform application work through that callback.
 */
export function createCronReceiverHandler(
  options: CronReceiverHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: options.corsHeaders });
    }

    const sourceEnvironment = options.readEnvironment ??
      ((name: string) => Deno.env.get(name));
    const environmentValues = new Map<string, string | undefined>();
    const requestEnvironment: EnvironmentReader = (name) => {
      if (!environmentValues.has(name)) {
        environmentValues.set(name, sourceEnvironment(name));
      }
      return environmentValues.get(name);
    };

    const isCron = await hasValidCronSecret(
      request.headers,
      requestEnvironment,
    );

    if (request.method === "HEAD") {
      return new Response(null, {
        status: isCron ? 204 : 401,
        headers: responseHeaders(options.corsHeaders, false, true),
      });
    }

    if (!isCron && !options.allowNonCronRequests) {
      return unauthorizedResponse(options.corsHeaders);
    }

    return await options.handleBusinessRequest(
      request,
      isCron,
      requestEnvironment,
    );
  };
}
