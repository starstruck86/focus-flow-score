-- Fix 1: Prevent client-side access to OAuth tokens in whoop_connections.
-- Client code only reads: id, whoop_user_id, updated_at, token_expires_at.
-- Edge functions use service_role which bypasses column-level grants.
-- This is reversible via: GRANT SELECT(access_token, refresh_token) ON whoop_connections TO authenticated, anon;

REVOKE SELECT (access_token, refresh_token) ON public.whoop_connections FROM authenticated;
REVOKE SELECT (access_token, refresh_token) ON public.whoop_connections FROM anon;

-- Add a comment for future reference
COMMENT ON COLUMN public.whoop_connections.access_token IS 'SERVER-ONLY: OAuth access token. Not readable by client roles (authenticated/anon). Only service_role can read.';
COMMENT ON COLUMN public.whoop_connections.refresh_token IS 'SERVER-ONLY: OAuth refresh token. Not readable by client roles (authenticated/anon). Only service_role can read.';