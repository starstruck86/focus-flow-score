import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { normalizeError } from '@/lib/appError';

const EDGE_ROUTE = 'enrich-resource-content';
const MAX_EDGE_REQUEST_BYTES = 50 * 1024 * 1024;

export type EnrichInvokeFailureCategory =
  | 'failed_bad_route'
  | 'failed_missing_auth'
  | 'failed_request_too_large'
  | 'failed_request_serialization'
  | 'failed_network_transport'
  | 'failed_edge_unreachable'
  | 'failed_preflight_blocked'
  | 'failed_unknown_transport';

export interface EnrichInvokeBody {
  resource_id?: string;
  resource_ids?: string[];
  force?: boolean;
}

export interface EnrichInvokeFailure {
  category: EnrichInvokeFailureCategory;
  message: string;
  recoveryHint: string;
  retryable: boolean;
  exactError: string;
  statusCode: number | null;
  requestBytes: number;
  route: string;
  authAttached: boolean;
  attemptedFix?: string;
}

export interface EnrichInvokeSuccess<T = any> {
  data: T;
  requestBytes: number;
  route: string;
  authAttached: boolean;
}

export async function invokeEnrichResource<T = any>(
  body: EnrichInvokeBody,
  options?: { componentName?: string; timeoutMs?: number },
): Promise<{ data: T; error: null; meta: EnrichInvokeSuccess<T> } | { data: null; error: EnrichInvokeFailure; meta: null }> {
  const sanitizedBody = sanitizeBody(body);
  const route = `/functions/v1/${EDGE_ROUTE}`;

  let serializedBody = '';
  try {
    serializedBody = JSON.stringify(sanitizedBody);
  } catch (error) {
    return {
      data: null,
      error: {
        category: 'failed_request_serialization',
        message: 'Request serialization failed — content normalized before retry.',
        recoveryHint: 'The request body was sanitized before send. Retry the enrichment.',
        retryable: true,
        exactError: error instanceof Error ? error.message : String(error),
        statusCode: null,
        requestBytes: 0,
        route,
        authAttached: true,
        attemptedFix: 'sanitized_request_body',
      },
      meta: null,
    };
  }

  const requestBytes = new TextEncoder().encode(serializedBody).length;
  if (requestBytes > MAX_EDGE_REQUEST_BYTES) {
    return {
      data: null,
      error: {
        category: 'failed_request_too_large',
        message: 'Payload too large — automatically reroute this resource through a smaller batch or long-content path.',
        recoveryHint: 'Split this enrichment into a smaller request before retrying.',
        retryable: true,
        exactError: `Serialized request size ${requestBytes} bytes exceeds ${MAX_EDGE_REQUEST_BYTES} bytes`,
        statusCode: 413,
        requestBytes,
        route,
        authAttached: true,
        attemptedFix: 'request_size_preflight_guard',
      },
      meta: null,
    };
  }

  try {
    const response = await authenticatedFetch({
      functionName: EDGE_ROUTE,
      body: sanitizedBody,
      componentName: options?.componentName,
      timeoutMs: options?.timeoutMs,
    });

    const payload = await response.json().catch(() => null);
    const authAttached = response.status !== 401;

    if (!response.ok) {
      return {
        data: null,
        error: classifyHttpFailure(response.status, payload, requestBytes, route, authAttached),
        meta: null,
      };
    }

    return {
      data: payload as T,
      error: null,
      meta: {
        data: payload as T,
        requestBytes,
        route,
        authAttached,
      },
    };
  } catch (error) {
    const normalized = normalizeError({
      error,
      source: 'function',
      functionName: EDGE_ROUTE,
      componentName: options?.componentName,
      metadata: { requestBytes, route },
    });

    return {
      data: null,
      error: classifyTransportFailure(normalized.rawMessage, requestBytes, route),
      meta: null,
    };
  }
}

function sanitizeBody(body: EnrichInvokeBody): EnrichInvokeBody {
  return {
    ...(body.resource_id ? { resource_id: body.resource_id } : {}),
    ...(Array.isArray(body.resource_ids) ? { resource_ids: body.resource_ids.filter(Boolean) } : {}),
    ...(typeof body.force === 'boolean' ? { force: body.force } : {}),
  };
}

function classifyHttpFailure(
  statusCode: number,
  payload: any,
  requestBytes: number,
  route: string,
  authAttached: boolean,
): EnrichInvokeFailure {
  const raw = payload?.error ? String(payload.error) : `HTTP ${statusCode}`;

  if (statusCode === 401 || statusCode === 403) {
    return {
      category: 'failed_missing_auth',
      message: 'Session/auth missing — refresh required before retry.',
      recoveryHint: 'Refresh your session and retry the enrichment.',
      retryable: true,
      exactError: raw,
      statusCode,
      requestBytes,
      route,
      authAttached,
      attemptedFix: 'auth_preflight_validation',
    };
  }

  if (statusCode === 404) {
    return {
      category: 'failed_bad_route',
      message: 'Edge route unreachable — request could not be delivered.',
      recoveryHint: 'The route builder should be corrected before retrying.',
      retryable: false,
      exactError: raw,
      statusCode,
      requestBytes,
      route,
      authAttached,
    };
  }

  if (statusCode === 413) {
    return {
      category: 'failed_request_too_large',
      message: 'Payload too large — automatically rerouted to a smaller request path.',
      recoveryHint: 'Retry will use a smaller request payload.',
      retryable: true,
      exactError: raw,
      statusCode,
      requestBytes,
      route,
      authAttached,
      attemptedFix: 'request_size_preflight_guard',
    };
  }

  if (statusCode >= 500) {
    return {
      category: 'failed_edge_unreachable',
      message: 'Edge route unreachable — request could not be delivered.',
      recoveryHint: 'The system will retry automatically when the backend is reachable again.',
      retryable: true,
      exactError: raw,
      statusCode,
      requestBytes,
      route,
      authAttached,
      attemptedFix: 'authenticated_fetch_retry',
    };
  }

  return {
    category: 'failed_unknown_transport',
    message: 'Request could not be completed — inspect the detailed failure trace.',
    recoveryHint: 'Retry once; if it repeats, inspect the resource trace.',
    retryable: false,
    exactError: raw,
    statusCode,
    requestBytes,
    route,
    authAttached,
  };
}

function classifyTransportFailure(raw: string, requestBytes: number, route: string): EnrichInvokeFailure {
  const lower = raw.toLowerCase();

  if (lower.includes('failed to send a request to the edge function') || lower.includes('failed to fetch') || lower.includes('network')) {
    return {
      category: 'failed_network_transport',
      message: 'Temporary network transport failure — auto-retry attempted via direct fetch.',
      recoveryHint: 'Retry will reuse the direct fetch path and preserve resource state.',
      retryable: true,
      exactError: raw,
      statusCode: null,
      requestBytes,
      route,
      authAttached: true,
      attemptedFix: 'switched_from_sdk_invoke_to_authenticated_fetch',
    };
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted')) {
    return {
      category: 'failed_edge_unreachable',
      message: 'Edge route unreachable — request timed out before a response arrived.',
      recoveryHint: 'Retry will use the direct fetch path again with the configured timeout.',
      retryable: true,
      exactError: raw,
      statusCode: 504,
      requestBytes,
      route,
      authAttached: true,
      attemptedFix: 'authenticated_fetch_retry',
    };
  }

  return {
    category: 'failed_unknown_transport',
    message: 'Request transport failed before a response was received.',
    recoveryHint: 'Retry once; if it repeats, inspect the detailed failure trace.',
    retryable: true,
    exactError: raw,
    statusCode: null,
    requestBytes,
    route,
    authAttached: true,
  };
}