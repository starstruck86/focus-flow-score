-- Belt-and-suspenders: explicitly allow service role and audit-emitting paths to insert audit logs.
-- Service role already bypasses RLS, but having an explicit permissive INSERT policy
-- prevents any future ambiguity (e.g. forced RLS, schema migrations, or PostgREST quirks).
CREATE POLICY "Service role and authenticated can insert audit logs"
ON public.strategy_benchmark_audit_logs
FOR INSERT
TO public
WITH CHECK (true);