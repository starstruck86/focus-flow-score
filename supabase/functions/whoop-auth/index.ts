import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const WHOOP_CLIENT_ID = Deno.env.get('WHOOP_CLIENT_ID');
    if (!WHOOP_CLIENT_ID) throw new Error('WHOOP_CLIENT_ID not configured');

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized — no Bearer token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized — invalid session', detail: userError?.message }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

    const { redirectUri } = await req.json();
    if (!redirectUri) throw new Error('redirectUri is required');

    const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/whoop-callback`;

    // Clear any stale connection before starting new OAuth flow
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(SUPABASE_URL, serviceRoleKey);
    await adminClient.from('whoop_connections').delete().eq('user_id', userId);

    // Encode userId + redirectUri in state so the callback knows which user to associate
    const encodedState = btoa(JSON.stringify({ userId, redirectUri, nonce: crypto.randomUUID() }));

    const scopes = 'read:recovery read:sleep read:workout read:cycles read:profile offline';

    const authUrl = new URL('https://api.prod.whoop.com/oauth/oauth2/auth');
    authUrl.searchParams.set('client_id', WHOOP_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', CALLBACK_URL);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('state', encodedState);

    return new Response(JSON.stringify({ authUrl: authUrl.toString() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('whoop-auth error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Unknown whoop-auth error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
