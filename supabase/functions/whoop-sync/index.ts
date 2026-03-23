import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ── Token refresh ──────────────────────────────────────────────
async function refreshTokenIfNeeded(supabase: any, connection: any): Promise<string> {
  const now = Date.now();
  const expiresAt = new Date(connection.token_expires_at).getTime();

  if (expiresAt - now > 5 * 60 * 1000) {
    return connection.access_token;
  }

  if (!connection.refresh_token) {
    await supabase
      .from('whoop_connections')
      .update({ token_expires_at: new Date(0).toISOString(), updated_at: new Date().toISOString() })
      .eq('id', connection.id);
    throw Object.assign(new Error('Token expired and no refresh token available. Please reconnect WHOOP.'), { errorDetail: 'no_refresh_token' });
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
    throw Object.assign(new Error(`Token refresh failed: ${errorText}`), { errorDetail: 'refresh_failed' });
  }

  const tokenData = await response.json();
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  await supabase
    .from('whoop_connections')
    .update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || connection.refresh_token,
      token_expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connection.id);

  return tokenData.access_token;
}

// ── Date helpers ───────────────────────────────────────────────
/** Extract the physiological calendar date from a WHOOP record.
 *  For sleep, use the END time (sleep that starts at 11pm belongs to the next day).
 *  For cycles/recovery, use the start time. */
function extractDate(record: any, preferEnd = false): string | null {
  const raw = preferEnd
    ? (record.end ?? record.during?.upper ?? record.start ?? record.during?.lower ?? record.created_at)
    : (record.start ?? record.during?.lower ?? record.created_at);
  if (!raw || typeof raw !== 'string') return null;
  return raw.substring(0, 10);
}

// ── Per-family fetch with diagnostics ──────────────────────────
interface FamilyResult {
  name: string;
  ok: boolean;
  count: number;
  error?: string;
  httpStatus?: number;
}

async function fetchFamily(
  url: string,
  accessToken: string,
  name: string,
): Promise<{ result: FamilyResult; records: any[] }> {
  try {
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (resp.status === 401) {
      return {
        result: { name, ok: false, count: 0, error: 'unauthorized', httpStatus: 401 },
        records: [],
      };
    }
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[whoop-sync] ${name} API error ${resp.status}:`, text);
      return {
        result: { name, ok: false, count: 0, error: text.substring(0, 200), httpStatus: resp.status },
        records: [],
      };
    }

    const body = await resp.json();
    const records = body.records ?? body.data ?? [];
    return {
      result: { name, ok: true, count: records.length },
      records,
    };
  } catch (err: any) {
    console.error(`[whoop-sync] ${name} fetch exception:`, err.message);
    return {
      result: { name, ok: false, count: 0, error: err.message },
      records: [],
    };
  }
}

// ── Fetch & upsert metrics ─────────────────────────────────────
async function fetchAndUpsertMetrics(
  supabase: any,
  connection: any,
): Promise<{ synced: number; families: FamilyResult[] }> {
  const accessToken = await refreshTokenIfNeeded(supabase, connection);
  const userId = connection.user_id;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  const startISO = startDate.toISOString();

  // Fetch all three families in parallel
  const [cyclesFetch, recoveryFetch, sleepFetch] = await Promise.all([
    fetchFamily(
      `https://api.prod.whoop.com/developer/v1/cycle?start=${startISO}&limit=10`,
      accessToken, 'cycles',
    ),
    fetchFamily(
      `https://api.prod.whoop.com/developer/v1/recovery?start=${startISO}&limit=10`,
      accessToken, 'recovery',
    ),
    fetchFamily(
      `https://api.prod.whoop.com/developer/v1/activity/sleep?start=${startISO}&limit=10`,
      accessToken, 'sleep',
    ),
  ]);

  const families = [cyclesFetch.result, recoveryFetch.result, sleepFetch.result];

  // If any returned 401, mark token expired
  if (families.some(f => f.httpStatus === 401)) {
    await supabase
      .from('whoop_connections')
      .update({ token_expires_at: new Date(0).toISOString(), updated_at: new Date().toISOString() })
      .eq('id', connection.id);
    throw Object.assign(
      new Error('WHOOP API returned 401. Please reconnect.'),
      { errorDetail: 'api_unauthorized' },
    );
  }

  // ── Build per-date metrics map ────────────────────────────────
  const metricsMap: Record<string, {
    recovery_score: number | null;
    sleep_score: number | null;
    strain_score: number | null;
    raw: Record<string, any>;
  }> = {};

  function ensureDate(date: string) {
    if (!metricsMap[date]) {
      metricsMap[date] = { recovery_score: null, sleep_score: null, strain_score: null, raw: {} };
    }
  }

  // Cycles → strain
  for (const cycle of cyclesFetch.records) {
    const date = extractDate(cycle, false);
    if (!date) { console.warn('[whoop-sync] cycle missing date:', JSON.stringify(cycle).substring(0, 120)); continue; }
    ensureDate(date);
    metricsMap[date].strain_score = cycle.score?.strain ?? null;
    metricsMap[date].raw.cycle = cycle;
  }

  // Recovery → recovery_score
  // WHOOP recovery records contain a nested `score` with `recovery_score`.
  // The record may have `cycle_id` linking to a cycle, or its own start/created_at.
  for (const rec of recoveryFetch.records) {
    // Try to get date from the recovery's cycle start, or sleep start, or created_at
    const date = extractDate(rec, false)
      || rec.cycle_id && cyclesFetch.records.find((c: any) => c.id === rec.cycle_id)?.start?.substring(0, 10)
      || null;
    if (!date) { console.warn('[whoop-sync] recovery missing date:', JSON.stringify(rec).substring(0, 120)); continue; }
    ensureDate(date);
    metricsMap[date].recovery_score = rec.score?.recovery_score ?? null;
    metricsMap[date].raw.recovery = rec;
  }

  // Sleep → sleep_score
  // Sleep sessions start late at night; use END time for the physiological date
  for (const slp of sleepFetch.records) {
    const date = extractDate(slp, true); // use end time
    if (!date) { console.warn('[whoop-sync] sleep missing date:', JSON.stringify(slp).substring(0, 120)); continue; }
    ensureDate(date);
    metricsMap[date].sleep_score =
      slp.score?.sleep_performance_percentage
      ?? slp.score?.stage_summary?.sleep_efficiency_percentage
      ?? slp.score?.sleep_score
      ?? null;
    metricsMap[date].raw.sleep = slp;
  }

  // ── Upsert: merge with existing data (don't null-out fields that already exist) ──
  const upserts = Object.entries(metricsMap).map(([date, m]) => {
    const row: Record<string, any> = {
      user_id: userId,
      date,
      raw_payload: m.raw,
      imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Only set score fields if we got a value — prevents overwriting existing data with null
    if (m.recovery_score !== null) row.recovery_score = m.recovery_score;
    if (m.sleep_score !== null) row.sleep_score = m.sleep_score;
    if (m.strain_score !== null) row.strain_score = m.strain_score;
    return row;
  });

  if (upserts.length > 0) {
    // Use upsert with onConflict, but since we may be omitting null fields,
    // we need to do individual upserts to avoid overwriting existing non-null values
    for (const row of upserts) {
      const { error: upsertError } = await supabase
        .from('whoop_daily_metrics')
        .upsert(row, { onConflict: 'user_id,date' });

      if (upsertError) {
        console.error('[whoop-sync] Upsert error for date', row.date, ':', upsertError);
      }
    }
  }

  await supabase
    .from('whoop_connections')
    .update({ updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  console.log(`[whoop-sync] User ${userId}: synced ${upserts.length} days. Families:`,
    families.map(f => `${f.name}=${f.count}${f.ok ? '' : '(FAIL)'}`).join(', '));

  return { synced: upserts.length, families };
}

// ── Main handler ───────────────────────────────────────────────
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

    // ── Cron / sync_all ──
    if (action === 'sync_all') {
      console.log('[whoop-sync] Running daily sync_all');
      const { data: connections, error: connErr } = await supabase.from('whoop_connections').select('*');
      if (connErr) throw new Error(`Failed to fetch connections: ${connErr.message}`);
      if (!connections?.length) {
        return new Response(JSON.stringify({ success: true, synced_users: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const results: { user_id: string; synced: number; families: FamilyResult[]; error?: string }[] = [];
      for (const conn of connections) {
        try {
          const r = await fetchAndUpsertMetrics(supabase, conn);
          results.push({ user_id: conn.user_id, synced: r.synced, families: r.families });
        } catch (err: any) {
          console.error(`[whoop-sync] User ${conn.user_id} failed:`, err.message);
          results.push({ user_id: conn.user_id, synced: 0, families: [], error: err.message });
        }
      }

      return new Response(JSON.stringify({ success: true, synced_users: results.length, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Per-user actions require auth ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

    // Disconnect
    if (action === 'disconnect') {
      await supabase.from('whoop_connections').delete().eq('user_id', userId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Single-user sync
    const { data: connection } = await supabase
      .from('whoop_connections')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!connection) {
      return new Response(JSON.stringify({ error: 'WHOOP not connected', errorDetail: 'no_connection' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { synced, families } = await fetchAndUpsertMetrics(supabase, connection);

    return new Response(JSON.stringify({ success: true, synced, families }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('whoop-sync error:', error);
    const msg = error.message || 'Unknown error';
    const errorDetail = error.errorDetail || 'unknown';
    const isTokenIssue = ['no_refresh_token', 'refresh_failed', 'api_unauthorized'].includes(errorDetail) ||
      msg.includes('Token refresh failed') || msg.includes('reconnect');

    if (isTokenIssue) {
      return new Response(JSON.stringify({ success: false, needsReconnect: true, error: msg, errorDetail }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: msg, errorDetail }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
