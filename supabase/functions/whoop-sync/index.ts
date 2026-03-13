import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function refreshTokenIfNeeded(
  supabase: any,
  connection: any,
): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(connection.token_expires_at);

  // Refresh if token expires within 5 minutes
  if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
    return connection.access_token;
  }

  console.log('Refreshing WHOOP token...');
  const WHOOP_CLIENT_ID = Deno.env.get('WHOOP_CLIENT_ID')!;
  const WHOOP_CLIENT_SECRET = Deno.env.get('WHOOP_CLIENT_SECRET')!;

  const response = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
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

    // Authenticate the user
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

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = claimsData.claims.sub;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Check for action type
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'sync';

    // Handle "claim" action — associate pending connection with authenticated user
    if (action === 'claim') {
      const { whoopUserId } = body;
      if (!whoopUserId) {
        return new Response(JSON.stringify({ error: 'whoopUserId required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Find the pending connection
      const { data: pending } = await supabase
        .from('whoop_connections')
        .select('*')
        .eq('user_id', '00000000-0000-0000-0000-000000000000')
        .eq('whoop_user_id', whoopUserId)
        .single();

      if (!pending) {
        return new Response(JSON.stringify({ error: 'No pending connection found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Delete any existing connection for this user
      await supabase.from('whoop_connections').delete().eq('user_id', userId);

      // Update the pending connection with the real user_id
      const { error: updateError } = await supabase
        .from('whoop_connections')
        .update({ user_id: userId, updated_at: new Date().toISOString() })
        .eq('id', pending.id);

      if (updateError) {
        console.error('Claim error:', updateError);
        return new Response(JSON.stringify({ error: 'Failed to claim connection' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle "disconnect" action
    if (action === 'disconnect') {
      await supabase.from('whoop_connections').delete().eq('user_id', userId);
      await supabase.from('whoop_daily_metrics').delete().eq('user_id', userId);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sync action — pull latest WHOOP data
    const { data: connection } = await supabase
      .from('whoop_connections')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!connection) {
      return new Response(JSON.stringify({ error: 'WHOOP not connected' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await refreshTokenIfNeeded(supabase, connection);

    // Get recent cycles (last 7 days)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const cyclesUrl = new URL('https://api.prod.whoop.com/developer/v1/cycle');
    cyclesUrl.searchParams.set('start', startDate.toISOString());
    cyclesUrl.searchParams.set('limit', '10');

    const cyclesResponse = await fetch(cyclesUrl.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!cyclesResponse.ok) {
      const errorText = await cyclesResponse.text();
      console.error('Cycles API error:', errorText);
      throw new Error(`WHOOP API error: ${cyclesResponse.status}`);
    }

    const cyclesData = await cyclesResponse.json();
    const cycles = cyclesData.records || [];

    // Get recovery data
    const recoveryUrl = new URL('https://api.prod.whoop.com/developer/v1/recovery');
    recoveryUrl.searchParams.set('start', startDate.toISOString());
    recoveryUrl.searchParams.set('limit', '10');

    const recoveryResponse = await fetch(recoveryUrl.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    const recoveryData = recoveryResponse.ok ? await recoveryResponse.json() : { records: [] };
    const recoveries = recoveryData.records || [];

    // Get sleep data
    const sleepUrl = new URL('https://api.prod.whoop.com/developer/v1/activity/sleep');
    sleepUrl.searchParams.set('start', startDate.toISOString());
    sleepUrl.searchParams.set('limit', '10');

    const sleepResponse = await fetch(sleepUrl.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    const sleepData = sleepResponse.ok ? await sleepResponse.json() : { records: [] };
    const sleeps = sleepData.records || [];

    // Build a map of date -> metrics
    const metricsMap: Record<string, any> = {};

    // Process cycles for strain
    for (const cycle of cycles) {
      const date = cycle.start ? cycle.start.substring(0, 10) : null;
      if (!date) continue;
      if (!metricsMap[date]) metricsMap[date] = { raw: {} };
      metricsMap[date].strain_score = cycle.score?.strain ?? null;
      metricsMap[date].raw.cycle = cycle;
    }

    // Process recoveries
    for (const rec of recoveries) {
      const date = rec.created_at ? rec.created_at.substring(0, 10) : 
                   rec.cycle?.start ? rec.cycle.start.substring(0, 10) : null;
      if (!date) continue;
      if (!metricsMap[date]) metricsMap[date] = { raw: {} };
      metricsMap[date].recovery_score = rec.score?.recovery_score ?? null;
      metricsMap[date].raw.recovery = rec;
    }

    // Process sleep
    for (const slp of sleeps) {
      const date = slp.start ? slp.start.substring(0, 10) : null;
      if (!date) continue;
      if (!metricsMap[date]) metricsMap[date] = { raw: {} };
      metricsMap[date].sleep_score = slp.score?.sleep_performance_percentage ?? slp.score?.stage_summary?.sleep_efficiency_percentage ?? null;
      metricsMap[date].raw.sleep = slp;
    }

    // Upsert metrics
    const upserts = Object.entries(metricsMap).map(([date, metrics]: [string, any]) => ({
      user_id: userId,
      date,
      recovery_score: metrics.recovery_score,
      sleep_score: metrics.sleep_score,
      strain_score: metrics.strain_score,
      raw_payload: metrics.raw,
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

    // Update last sync time on connection
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
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
