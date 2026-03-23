import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Deploy-group: whoop (whoop-auth, whoop-callback, whoop-sync) ──
// These functions share state-signing logic and MUST be deployed together.
// See supabase/FUNCTION_GROUPS.md for details.
const FUNCTION_GROUP_VERSION = "whoop-v2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

type FamilyName = 'cycles' | 'recovery' | 'sleep';
type FamilyFailureReason = 'missing_scope' | 'endpoint_error' | 'parse_error' | 'empty_response' | 'auth_error';

interface ScopeDiagnostics {
  grantedScopes: string[];
  missingScopes: string[];
  refreshTokenAvailable: boolean;
  refreshCapability: 'available' | 'missing_refresh_token' | 'missing_offline_scope';
}

interface FamilyResult {
  name: FamilyName;
  ok: boolean;
  count: number;
  valueCount?: number;
  reason?: FamilyFailureReason;
  error?: string;
  httpStatus?: number;
  endpoint: string;
  requiredScopes: string[];
  grantedScopes: string[];
}

function parseScopes(scopes: string | null | undefined): string[] {
  return (scopes ?? '').split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
}

function getScopeDiagnostics(connection: any): ScopeDiagnostics {
  const grantedScopes = parseScopes(connection.scopes);
  const missingScopes = ['read:cycles', 'read:recovery', 'read:sleep'].filter((scope) => !grantedScopes.includes(scope));

  return {
    grantedScopes,
    missingScopes,
    refreshTokenAvailable: Boolean(connection.refresh_token),
    refreshCapability: connection.refresh_token
      ? 'available'
      : grantedScopes.includes('offline')
        ? 'missing_refresh_token'
        : 'missing_offline_scope',
  };
}

async function refreshTokenIfNeeded(supabase: any, connection: any): Promise<string> {
  const now = Date.now();
  const expiresAt = new Date(connection.token_expires_at).getTime();
  const scopeDiagnostics = getScopeDiagnostics(connection);

  if (expiresAt - now > 5 * 60 * 1000) {
    return connection.access_token;
  }

  if (!connection.refresh_token) {
    await supabase
      .from('whoop_connections')
      .update({ token_expires_at: new Date(0).toISOString(), updated_at: new Date().toISOString() })
      .eq('id', connection.id);

    throw Object.assign(
      new Error(
        scopeDiagnostics.refreshCapability === 'missing_offline_scope'
          ? 'Token expired and no refresh token is available because the offline scope was not granted. Please reconnect WHOOP.'
          : 'Token expired and no refresh token available. Please reconnect WHOOP.',
      ),
      {
        errorDetail: scopeDiagnostics.refreshCapability === 'missing_offline_scope' ? 'missing_offline_scope' : 'no_refresh_token',
        scopeDiagnostics,
      },
    );
  }

  console.log('Refreshing WHOOP token for user', connection.user_id);
  const response = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
      client_id: Deno.env.get('WHOOP_CLIENT_ID')!,
      client_secret: Deno.env.get('WHOOP_CLIENT_SECRET')!,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    await supabase
      .from('whoop_connections')
      .update({ token_expires_at: new Date(0).toISOString(), updated_at: new Date().toISOString() })
      .eq('id', connection.id);
    throw Object.assign(new Error(`Token refresh failed: ${errorText}`), {
      errorDetail: 'refresh_failed',
      scopeDiagnostics,
    });
  }

  const tokenData = await response.json();
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  const nextScopes = typeof tokenData.scope === 'string' && tokenData.scope.trim().length > 0
    ? tokenData.scope
    : connection.scopes;

  await supabase
    .from('whoop_connections')
    .update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || connection.refresh_token,
      token_expires_at: newExpiresAt,
      scopes: nextScopes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connection.id);

  return tokenData.access_token;
}

function extractDate(record: any, preferEnd = false): string | null {
  const raw = preferEnd
    ? (record.end ?? record.during?.upper ?? record.start ?? record.during?.lower ?? record.created_at)
    : (record.start ?? record.during?.lower ?? record.created_at);
  if (!raw || typeof raw !== 'string') return null;
  return raw.substring(0, 10);
}

function normalizeWhoopRecords(body: any): { records: any[]; parseError?: string } {
  if (Array.isArray(body?.records)) return { records: body.records };
  if (Array.isArray(body?.data)) return { records: body.data };
  if (Array.isArray(body)) return { records: body };

  if (body && typeof body === 'object' && ('id' in body || 'cycle_id' in body || 'sleep_id' in body)) {
    return { records: [body] };
  }

  const descriptor = body && typeof body === 'object'
    ? `keys: ${Object.keys(body).slice(0, 8).join(', ')}`
    : `type: ${typeof body}`;

  return { records: [], parseError: `Unexpected response shape (${descriptor})` };
}

async function fetchFamily(
  url: string,
  accessToken: string,
  name: FamilyName,
  requiredScopes: string[],
  grantedScopes: string[],
): Promise<{ result: FamilyResult; records: any[] }> {
  const endpoint = new URL(url).pathname;
  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));

  if (missingScopes.length > 0) {
    return {
      result: {
        name,
        ok: false,
        count: 0,
        reason: 'missing_scope',
        error: `Missing required scope: ${missingScopes.join(', ')}`,
        endpoint,
        requiredScopes,
        grantedScopes,
      },
      records: [],
    };
  }

  try {
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (resp.status === 401) {
      return {
        result: {
          name,
          ok: false,
          count: 0,
          reason: 'auth_error',
          error: 'Unauthorized',
          httpStatus: 401,
          endpoint,
          requiredScopes,
          grantedScopes,
        },
        records: [],
      };
    }

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[whoop-sync] ${name} API error ${resp.status}:`, text);
      return {
        result: {
          name,
          ok: false,
          count: 0,
          reason: 'endpoint_error',
          error: text.substring(0, 200) || `HTTP ${resp.status}`,
          httpStatus: resp.status,
          endpoint,
          requiredScopes,
          grantedScopes,
        },
        records: [],
      };
    }

    let body: any;
    try {
      body = await resp.json();
    } catch (err: any) {
      return {
        result: {
          name,
          ok: false,
          count: 0,
          reason: 'parse_error',
          error: `Invalid JSON response: ${err.message}`,
          endpoint,
          requiredScopes,
          grantedScopes,
        },
        records: [],
      };
    }

    const normalized = normalizeWhoopRecords(body);
    if (normalized.parseError) {
      return {
        result: {
          name,
          ok: false,
          count: 0,
          reason: 'parse_error',
          error: normalized.parseError,
          endpoint,
          requiredScopes,
          grantedScopes,
        },
        records: [],
      };
    }

    if (normalized.records.length === 0) {
      return {
        result: {
          name,
          ok: false,
          count: 0,
          reason: 'empty_response',
          error: 'Endpoint returned 0 records',
          endpoint,
          requiredScopes,
          grantedScopes,
        },
        records: [],
      };
    }

    return {
      result: {
        name,
        ok: true,
        count: normalized.records.length,
        endpoint,
        requiredScopes,
        grantedScopes,
      },
      records: normalized.records,
    };
  } catch (err: any) {
    console.error(`[whoop-sync] ${name} fetch exception:`, err.message);
    return {
      result: {
        name,
        ok: false,
        count: 0,
        reason: 'endpoint_error',
        error: err.message,
        endpoint,
        requiredScopes,
        grantedScopes,
      },
      records: [],
    };
  }
}

async function fetchAndUpsertMetrics(
  supabase: any,
  connection: any,
): Promise<{ synced: number; families: FamilyResult[]; scopeDiagnostics: ScopeDiagnostics }> {
  const accessToken = await refreshTokenIfNeeded(supabase, connection);
  const userId = connection.user_id;
  const scopeDiagnostics = getScopeDiagnostics(connection);
  const grantedScopes = scopeDiagnostics.grantedScopes;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  const startISO = startDate.toISOString();

  const [cyclesFetch, recoveryFetch, sleepFetch] = await Promise.all([
    fetchFamily(
      `https://api.prod.whoop.com/developer/v2/cycle?start=${encodeURIComponent(startISO)}&limit=10`,
      accessToken,
      'cycles',
      ['read:cycles'],
      grantedScopes,
    ),
    fetchFamily(
      `https://api.prod.whoop.com/developer/v2/recovery?start=${encodeURIComponent(startISO)}&limit=10`,
      accessToken,
      'recovery',
      ['read:recovery'],
      grantedScopes,
    ),
    fetchFamily(
      `https://api.prod.whoop.com/developer/v2/activity/sleep?start=${encodeURIComponent(startISO)}&limit=10`,
      accessToken,
      'sleep',
      ['read:sleep'],
      grantedScopes,
    ),
  ]);

  const rawFamilies = [cyclesFetch.result, recoveryFetch.result, sleepFetch.result];

  if (rawFamilies.some((family) => family.httpStatus === 401)) {
    await supabase
      .from('whoop_connections')
      .update({ token_expires_at: new Date(0).toISOString(), updated_at: new Date().toISOString() })
      .eq('id', connection.id);
    throw Object.assign(
      new Error('WHOOP API returned 401. Please reconnect.'),
      { errorDetail: 'api_unauthorized', scopeDiagnostics },
    );
  }

  const metricsMap: Record<string, {
    recovery_score: number | null;
    sleep_score: number | null;
    strain_score: number | null;
    raw: Record<string, any>;
  }> = {};

  const cycleById = new Map(cyclesFetch.records.map((cycle: any) => [String(cycle.id), cycle]));
  const sleepById = new Map(sleepFetch.records.map((sleep: any) => [String(sleep.id), sleep]));
  const familyValueDates: Record<FamilyName, Set<string>> = {
    cycles: new Set(),
    recovery: new Set(),
    sleep: new Set(),
  };

  function ensureDate(date: string) {
    if (!metricsMap[date]) {
      metricsMap[date] = { recovery_score: null, sleep_score: null, strain_score: null, raw: {} };
    }
  }

  for (const cycle of cyclesFetch.records) {
    const date = extractDate(cycle, false);
    if (!date) {
      console.warn('[whoop-sync] cycle missing date:', JSON.stringify(cycle).substring(0, 120));
      continue;
    }

    ensureDate(date);
    const strainScore = cycle.score?.strain ?? null;
    if (strainScore !== null) {
      metricsMap[date].strain_score = strainScore;
      familyValueDates.cycles.add(date);
    }
    metricsMap[date].raw.cycle = cycle;
  }

  for (const rec of recoveryFetch.records) {
    const linkedSleep = rec.sleep_id ? sleepById.get(String(rec.sleep_id)) : null;
    const linkedCycle = rec.cycle_id ? cycleById.get(String(rec.cycle_id)) : null;
    const date = (linkedSleep ? extractDate(linkedSleep, true) : null)
      ?? extractDate(rec, false)
      ?? (linkedCycle ? extractDate(linkedCycle, false) : null);

    if (!date) {
      console.warn('[whoop-sync] recovery missing date:', JSON.stringify(rec).substring(0, 120));
      continue;
    }

    ensureDate(date);
    const recoveryScore = rec.score_state === 'SCORED'
      ? (rec.score?.recovery_score ?? null)
      : null;

    if (recoveryScore !== null) {
      metricsMap[date].recovery_score = recoveryScore;
      familyValueDates.recovery.add(date);
    }

    metricsMap[date].raw.recovery = rec;
  }

  for (const slp of sleepFetch.records) {
    const date = extractDate(slp, true);
    if (!date) {
      console.warn('[whoop-sync] sleep missing date:', JSON.stringify(slp).substring(0, 120));
      continue;
    }

    ensureDate(date);
    const existingSleep = metricsMap[date].raw.sleep;
    if (existingSleep && existingSleep.nap === false && slp.nap === true) {
      continue;
    }

    const sleepScore = slp.score_state === 'SCORED'
      ? (
        slp.score?.sleep_performance_percentage
        ?? slp.score?.sleep_efficiency_percentage
        ?? slp.score?.stage_summary?.sleep_efficiency_percentage
        ?? slp.score?.sleep_score
        ?? null
      )
      : null;

    if (sleepScore !== null) {
      metricsMap[date].sleep_score = sleepScore;
      familyValueDates.sleep.add(date);
    }

    metricsMap[date].raw.sleep = slp;
  }

  const families = rawFamilies.map((family) => {
    const valueCount = familyValueDates[family.name].size;
    if (!family.ok) return { ...family, valueCount };
    if (valueCount === 0) {
      return {
        ...family,
        ok: false,
        valueCount,
        reason: 'empty_response' as const,
        error: 'Records were returned but none contained scored values',
      };
    }
    return { ...family, valueCount };
  });

  const upserts = Object.entries(metricsMap).map(([date, metric]) => {
    const row: Record<string, any> = {
      user_id: userId,
      date,
      raw_payload: metric.raw,
      imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (metric.recovery_score !== null) row.recovery_score = metric.recovery_score;
    if (metric.sleep_score !== null) row.sleep_score = metric.sleep_score;
    if (metric.strain_score !== null) row.strain_score = metric.strain_score;
    return row;
  });

  if (upserts.length > 0) {
    const dates = upserts.map((row) => row.date);
    const { data: existingRows } = await supabase
      .from('whoop_daily_metrics')
      .select('date, raw_payload')
      .eq('user_id', userId)
      .in('date', dates);

    const existingPayloads = new Map((existingRows ?? []).map((row: any) => [row.date, row.raw_payload]));

    for (const row of upserts) {
      const existingPayload = existingPayloads.get(row.date);
      const mergedRow = {
        ...row,
        raw_payload: {
          ...((existingPayload && typeof existingPayload === 'object') ? existingPayload : {}),
          ...row.raw_payload,
        },
      };

      const { error: upsertError } = await supabase
        .from('whoop_daily_metrics')
        .upsert(mergedRow, { onConflict: 'user_id,date' });

      if (upsertError) {
        console.error('[whoop-sync] Upsert error for date', row.date, ':', upsertError);
      }
    }
  }

  await supabase
    .from('whoop_connections')
    .update({ updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  console.log(
    `[whoop-sync] User ${userId}: synced ${upserts.length} days. Families:`,
    families.map((family) => `${family.name}=${family.count}/${family.valueCount ?? 0}${family.ok ? '' : `(${family.reason ?? 'FAIL'})`}`).join(', '),
  );

  return { synced: upserts.length, families, scopeDiagnostics };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'sync';

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (action === 'sync_all') {
      console.log('[whoop-sync] Running daily sync_all');
      const { data: connections, error: connErr } = await supabase.from('whoop_connections').select('*');
      if (connErr) throw new Error(`Failed to fetch connections: ${connErr.message}`);
      if (!connections?.length) {
        return new Response(JSON.stringify({ success: true, synced_users: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const results: { user_id: string; synced: number; families: FamilyResult[]; scopeDiagnostics?: ScopeDiagnostics; error?: string }[] = [];
      for (const conn of connections) {
        try {
          const result = await fetchAndUpsertMetrics(supabase, conn);
          results.push({
            user_id: conn.user_id,
            synced: result.synced,
            families: result.families,
            scopeDiagnostics: result.scopeDiagnostics,
          });
        } catch (err: any) {
          console.error(`[whoop-sync] User ${conn.user_id} failed:`, err.message);
          results.push({
            user_id: conn.user_id,
            synced: 0,
            families: [],
            scopeDiagnostics: err.scopeDiagnostics,
            error: err.message,
          });
        }
      }

      return new Response(JSON.stringify({ success: true, synced_users: results.length, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

    if (action === 'disconnect') {
      await supabase.from('whoop_connections').delete().eq('user_id', userId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: connection } = await supabase
      .from('whoop_connections')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!connection) {
      return new Response(JSON.stringify({ error: 'WHOOP not connected', errorDetail: 'no_connection' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { synced, families, scopeDiagnostics } = await fetchAndUpsertMetrics(supabase, connection);

    return new Response(JSON.stringify({ success: true, synced, families, scopeDiagnostics }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('whoop-sync error:', error);
    const msg = error.message || 'Unknown error';
    const errorDetail = error.errorDetail || 'unknown';
    const isTokenIssue = ['no_refresh_token', 'missing_offline_scope', 'refresh_failed', 'api_unauthorized'].includes(errorDetail) ||
      msg.includes('Token refresh failed') || msg.includes('reconnect');

    if (isTokenIssue) {
      return new Response(JSON.stringify({
        success: false,
        needsReconnect: true,
        error: 'WHOOP connection needs to be re-established.',
        errorDetail,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'An unexpected error occurred. Please try again.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
