
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Service role full access" ON public.strategy_run_telemetry;

-- Service role bypasses RLS by default, so we don't need an explicit policy for it.
-- The existing user-scoped SELECT and INSERT policies are sufficient.
