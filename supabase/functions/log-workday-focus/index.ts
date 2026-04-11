import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logServiceRoleUsage, logAuthMethod, logValidationWarnings } from '../_shared/securityLog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, x-trace-id',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // --- Auth: API key OR Bearer token ---
    const apiKey = req.headers.get('x-api-key');
    const expectedKey = Deno.env.get('FOCUS_TRACKER_API_KEY');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    let userId: string | null = null;

    if (apiKey && expectedKey && apiKey === expectedKey) {
      // API key auth — use service role to find the first user
      logAuthMethod('log-workday-focus', 'x-api-key');
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
      logServiceRoleUsage('log-workday-focus', 'system', { reason: 'api_key_auth_admin_listUsers' });
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1 });
      if (!users?.users?.length) {
        return new Response(JSON.stringify({ error: 'No user found' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = users.users[0].id;
    } else {
      // Bearer token auth
      const authHeader = req.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Send x-api-key header.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(
        authHeader.replace('Bearer ', '')
      );
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      userId = claimsData.claims.sub;
    }

    // Parse & validate body
    const body = await req.json();
    logValidationWarnings('log-workday-focus', body, ['distracted_minutes']);
    const { distracted_minutes, phone_pickups } = body;

    // Auto-default to today's date if not provided or invalid
    let date = body.date;
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const now = new Date();
      date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    const dm = typeof distracted_minutes === 'number' ? Math.max(0, Math.round(distracted_minutes)) : 0;
    const pp = typeof phone_pickups === 'number' ? Math.max(0, Math.round(phone_pickups)) : 0;

    // Calculate focus score & label
    const focus_score = Math.round(Math.max(0, 10 - (dm / 6)) * 10) / 10;
    let focus_label: string;
    if (dm < 15) {
      focus_label = 'Focus Day';
    } else if (dm <= 30) {
      focus_label = 'Normal Day';
    } else {
      focus_label = 'Drift Day';
    }

    // Upsert using service role (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    logServiceRoleUsage('log-workday-focus', 'single_user', { reason: 'upsert_bypass_rls' });
    const { data: entry, error } = await supabaseAdmin
      .from('daily_journal_entries')
      .upsert(
        {
          user_id: userId,
          date,
          distracted_minutes: dm,
          phone_pickups: pp,
          focus_score,
          focus_label,
        },
        { onConflict: 'user_id,date' }
      )
      .select('id, date, distracted_minutes, phone_pickups, focus_score, focus_label')
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, entry }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
