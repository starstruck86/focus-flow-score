import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function refreshTokenIfNeeded(supabase: any, connection: any): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(connection.token_expires_at);

  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return connection.access_token;
  }

  if (!connection.refresh_token) {
    throw new Error('Token expired and no refresh token available. Please reconnect WHOOP.');
  }

  console.log('Refreshing WHOOP token...');
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
    throw new Error(`Token refresh failed: ${errorText}`);
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = claimsData.claims.sub;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'sync';

    // Disconnect
    if (action === 'disconnect') {
      await supabase.from('whoop_connections').delete().eq('user_id', userId);
      await supabase.from('whoop_daily_metrics').delete().eq('user_id', userId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sync
    const { data: connection } = await supabase
      .from('whoop_connections')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!connection) {
      return new Response(JSON.stringify({ error: 'WHOOP not connected' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await refreshTokenIfNeeded(supabase, connection);

    // Get recent cycles (last 7 days)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const [cyclesResponse, recoveryResponse, sleepResponse] = await Promise.all([
      fetch(`https://api.prod.whoop.com/developer/v1/cycle?start=${startDate.toISOString()}&limit=10`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
      fetch(`https://api.prod.whoop.com/developer/v1/recovery?start=${startDate.toISOString()}&limit=10`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
      fetch(`https://api.prod.whoop.com/developer/v1/activity/sleep?start=${startDate.toISOString()}&limit=10`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
    ]);

    const cycles = cyclesResponse.ok ? (await cyclesResponse.json()).records || [] : [];
    const recoveries = recoveryResponse.ok ? (await recoveryResponse.json()).records || [] : [];
    const sleeps = sleepResponse.ok ? (await sleepResponse.json()).records || [] : [];

    if (!cyclesResponse.ok) {
      const errText = await cyclesResponse.text().catch(() => '');
      console.error('Cycles API error:', cyclesResponse.status, errText);
    }
    if (!recoveryResponse.ok) {
      const errText = await recoveryResponse.text().catch(() => '');
      console.error('Recovery API error:', recoveryResponse.status, errText);
    }
    if (!sleepResponse.ok) {
      const errText = await sleepResponse.text().catch(() => '');
      console.error('Sleep API error:', sleepResponse.status, errText);
    }

    // Build date -> metrics map
    const metricsMap: Record<string, any> = {};

    for (const cycle of cycles) {
      const date = cycle.start?.substring(0, 10);
      if (!date) continue;
      if (!metricsMap[date]) metricsMap[date] = { raw: {} };
      metricsMap[date].strain_score = cycle.score?.strain ?? null;
      metricsMap[date].raw.cycle = cycle;
    }

    for (const rec of recoveries) {
      const date = rec.created_at?.substring(0, 10) || rec.cycle?.start?.substring(0, 10);
      if (!date) continue;
      if (!metricsMap[date]) metricsMap[date] = { raw: {} };
      metricsMap[date].recovery_score = rec.score?.recovery_score ?? null;
      metricsMap[date].raw.recovery = rec;
    }

    for (const slp of sleeps) {
      const date = slp.start?.substring(0, 10);
      if (!date) continue;
      if (!metricsMap[date]) metricsMap[date] = { raw: {} };
      metricsMap[date].sleep_score = slp.score?.sleep_performance_percentage ?? slp.score?.stage_summary?.sleep_efficiency_percentage ?? null;
      metricsMap[date].raw.sleep = slp;
    }

    const upserts = Object.entries(metricsMap).map(([date, m]: [string, any]) => ({
      user_id: userId,
      date,
      recovery_score: m.recovery_score ?? null,
      sleep_score: m.sleep_score ?? null,
      strain_score: m.strain_score ?? null,
      raw_payload: m.raw,
      imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    if (upserts.length > 0) {
      const { error: upsertError } = await supabase
        .from('whoop_daily_metrics')
        .upsert(upserts, { onConflict: 'user_id,date' });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        throw new Error(`Failed to save metrics: ${upsertError.message}`);
      }
    }

    await supabase
      .from('whoop_connections')
      .update({ updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    return new Response(JSON.stringify({
      success: true,
      synced: upserts.length,
      dates: Object.keys(metricsMap),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('whoop-sync error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
