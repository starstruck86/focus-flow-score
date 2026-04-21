DROP POLICY IF EXISTS "Service role and authenticated can insert audit logs" ON public.strategy_benchmark_audit_logs;

CREATE POLICY "Service role can insert audit logs"
ON public.strategy_benchmark_audit_logs
FOR INSERT
TO service_role
WITH CHECK (true);