import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
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
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
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
    const { date, distracted_minutes, phone_pickups } = body;

    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ error: 'Invalid date. Use YYYY-MM-DD.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
