import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const WHOOP_CLIENT_ID = Deno.env.get('WHOOP_CLIENT_ID');
    if (!WHOOP_CLIENT_ID) {
      throw new Error('WHOOP_CLIENT_ID not configured');
    }

    const { redirectUri } = await req.json();
    if (!redirectUri) {
      throw new Error('redirectUri is required');
    }

    const CALLBACK_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/whoop-callback`;

    // Generate a random state for CSRF protection
    const state = crypto.randomUUID();

    // Store the state and redirectUri temporarily — we encode them in state param
    // Format: state|redirectUri (the callback will parse this)
    const encodedState = btoa(JSON.stringify({ state, redirectUri }));

    const scopes = 'read:recovery read:sleep read:workout read:cycles read:profile';

    const authUrl = new URL('https://api.prod.whoop.com/oauth/oauth2/auth');
    authUrl.searchParams.set('client_id', WHOOP_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', CALLBACK_URL);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('state', encodedState);

    return new Response(JSON.stringify({ authUrl: authUrl.toString() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('whoop-auth error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
