-- Harden whoop_connections: remove client INSERT and UPDATE policies.
-- All writes happen via service_role (whoop-auth, whoop-callback, whoop-sync).
-- Client only needs SELECT (safe columns, token columns already revoked) and DELETE (disconnect).
-- Reversible via re-creating the dropped policies.

DROP POLICY IF EXISTS "Users can insert own whoop_connections" ON public.whoop_connections;
DROP POLICY IF EXISTS "Users can update own whoop_connections" ON public.whoop_connections;

-- Add comments documenting the security model
COMMENT ON TABLE public.whoop_connections IS 'OAuth connection state. Writes are SERVER-ONLY (service_role). Client has SELECT (token columns revoked) and DELETE only.';