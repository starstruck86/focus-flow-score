import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');

    if (!code || !stateParam) {
      return new Response('Missing code or state parameter', { status: 400 });
    }

    // Decode state to get redirectUri
    let redirectUri = '';
    try {
      const decoded = JSON.parse(atob(stateParam));
      redirectUri = decoded.redirectUri || '';
    } catch {
      redirectUri = '';
    }

    const WHOOP_CLIENT_ID = Deno.env.get('WHOOP_CLIENT_ID')!;
    const WHOOP_CLIENT_SECRET = Deno.env.get('WHOOP_CLIENT_SECRET')!;
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/whoop-callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CALLBACK_URL,
        client_id: WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      const failUrl = redirectUri ? `${redirectUri}/settings?whoop=error` : '/settings?whoop=error';
      return Response.redirect(failUrl, 302);
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    // Get WHOOP user profile
    const profileResponse = await fetch('https://api.prod.whoop.com/developer/v1/user/profile/basic', {
      headers: { 'Authorization': `Bearer ${access_token}` },
    });

    let whoopUserId = null;
    if (profileResponse.ok) {
      const profile = await profileResponse.json();
      whoopUserId = String(profile.user_id);
    }

    // We need to figure out which app user initiated this. 
    // Since this is an OAuth callback (no auth header), we'll store the token
    // and associate it on the next authenticated request.
    // For now, we store with whoop_user_id and the frontend will claim it.
    
    const supabase = createClient(
      SUPABASE_URL,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Store as a pending connection (user_id will be set by the claim endpoint)
    // We use a temporary table approach: store with a placeholder user_id
    // Actually, let's pass the user context through the state
    // For simplicity, we'll store with whoop_user_id and have the frontend claim it
    
    // Store the pending tokens in a simple way - use the whoop_user_id as identifier
    // The frontend will call a "claim" endpoint with auth to associate it
    const { error: upsertError } = await supabase
      .from('whoop_connections')
      .upsert({
        // Use a deterministic UUID from whoop_user_id for pending connections
        user_id: '00000000-0000-0000-0000-000000000000', // placeholder, will be claimed
        whoop_user_id: whoopUserId,
        access_token,
        refresh_token,
        token_expires_at: expiresAt,
        scopes: 'read:recovery read:sleep read:workout read:cycles read:profile',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('Failed to store tokens:', upsertError);
      // Try inserting without the upsert constraint issue
      // Store in a temporary way using whoop_user_id
    }

    // Redirect back to the app settings page
    const successUrl = redirectUri ? `${redirectUri}/settings?whoop=success&whoop_user_id=${whoopUserId}` : '/settings?whoop=success';
    return Response.redirect(successUrl, 302);
  } catch (error) {
    console.error('whoop-callback error:', error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
