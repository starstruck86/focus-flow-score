-- F2 hardening (final): circle_credentials becomes server-only.
-- Values are already encrypted at rest (AES-GCM via CIRCLE_CRED_KEY) and
-- accessed exclusively by the import-circle-browserless edge function via
-- SUPABASE_SERVICE_ROLE_KEY. Remove Data API grants and client-side RLS
-- policies so no browser client can reach the table at all.

REVOKE ALL ON public.circle_credentials FROM anon;
REVOKE ALL ON public.circle_credentials FROM authenticated;
GRANT ALL ON public.circle_credentials TO service_role;

DROP POLICY IF EXISTS "Users view own circle creds" ON public.circle_credentials;
DROP POLICY IF EXISTS "Users insert own circle creds" ON public.circle_credentials;
DROP POLICY IF EXISTS "Users update own circle creds" ON public.circle_credentials;
DROP POLICY IF EXISTS "Users delete own circle creds" ON public.circle_credentials;

-- RLS remains enabled; with no policies + no grants, only service_role reaches rows.
ALTER TABLE public.circle_credentials ENABLE ROW LEVEL SECURITY;