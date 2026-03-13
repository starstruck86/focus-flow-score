
-- Drop overly permissive policies
DROP POLICY "Service role can manage whoop_connections" ON public.whoop_connections;
DROP POLICY "Service role can manage whoop_daily_metrics" ON public.whoop_daily_metrics;
