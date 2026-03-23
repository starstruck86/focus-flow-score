import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');
    const errorParam = url.searchParams.get('error');

    // Handle WHOOP OAuth errors
    if (errorParam) {
      console.error('WHOOP OAuth error:', errorParam, url.searchParams.get('error_description'));
      return Response.redirect(`${getRedirectBase(stateParam)}/settings?whoop=error`, 302);
    }

    if (!code || !stateParam) {
      return new Response('Missing code or state parameter', { status: 400 });
    }

    // Decode and verify HMAC-signed state
    let userId = '';
    let redirectUri = '';
    try {
      const stateObj = JSON.parse(atob(stateParam));
      const { payload, sig } = stateObj;
      if (!payload || !sig) throw new Error('Missing payload or sig');

      const WHOOP_CLIENT_SECRET = Deno.env.get('WHOOP_CLIENT_SECRET')!;
      const hmacKey = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(WHOOP_CLIENT_SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
      );
      const sigBytes = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
      const valid = await crypto.subtle.verify('HMAC', hmacKey, sigBytes, new TextEncoder().encode(payload));
      if (!valid) {
        console.error('WHOOP callback: invalid state signature');
        return new Response('Invalid state parameter', { status: 400 });
      }

      const decoded = JSON.parse(payload);
      userId = decoded.userId || '';
      redirectUri = decoded.redirectUri || '';
    } catch {
      return new Response('Invalid state parameter', { status: 400 });
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
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      return Response.redirect(`${redirectUri}/settings?whoop=error`, 302);
    }

    const tokenData = await tokenResponse.json();
    console.log('Token response keys:', Object.keys(tokenData));

    const access_token = tokenData.access_token;
    const refresh_token = tokenData.refresh_token || null;
    const expires_in = tokenData.expires_in || 3600;
    const grantedScopes = typeof tokenData.scope === 'string' && tokenData.scope.trim().length > 0
      ? tokenData.scope
      : 'read:recovery read:sleep read:workout read:cycles read:profile offline';

    if (!access_token) {
      console.error('No access_token in response:', JSON.stringify(tokenData));
      return Response.redirect(`${redirectUri}/settings?whoop=error`, 302);
    }

    // Get WHOOP user profile
    let whoopUserId = null;
    try {
      const profileResponse = await fetch('https://api.prod.whoop.com/developer/v1/user/profile/basic', {
        headers: { 'Authorization': `Bearer ${access_token}` },
      });
      if (profileResponse.ok) {
        const profile = await profileResponse.json();
        whoopUserId = String(profile.user_id);
      } else {
        const profileErr = await profileResponse.text();
        console.error('Profile fetch failed:', profileResponse.status, profileErr);
      }
    } catch (e) {
      console.error('Profile fetch error:', e);
    }

    const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

    // Delete existing connection for this user, then insert new one
    await supabase.from('whoop_connections').delete().eq('user_id', userId);

    const { error: insertError } = await supabase
      .from('whoop_connections')
      .insert({
        user_id: userId,
        whoop_user_id: whoopUserId,
        access_token,
        refresh_token,
        token_expires_at: expiresAt,
        scopes: grantedScopes,
      });

    if (insertError) {
      console.error('Failed to store connection:', JSON.stringify(insertError));
      return Response.redirect(`${redirectUri}/settings?whoop=error`, 302);
    }

    console.log('WHOOP connection stored successfully for user:', userId, 'scopes:', grantedScopes, 'hasRefreshToken:', Boolean(refresh_token));
    return Response.redirect(`${redirectUri}/settings?whoop=success`, 302);
  } catch (error) {
    console.error('whoop-callback error:', error);
    const redirectBase = getRedirectBase(null);
    if (redirectBase) {
      return Response.redirect(`${redirectBase}/settings?whoop=error`, 302);
    }
    return new Response('An unexpected error occurred.', { status: 500 });
  }
});

function getRedirectBase(stateParam: string | null): string {
  try {
    if (stateParam) {
      const stateObj = JSON.parse(atob(stateParam));
      const decoded = stateObj.payload ? JSON.parse(stateObj.payload) : stateObj;
      return decoded.redirectUri || '';
    }
  } catch {}
  return '';
}
