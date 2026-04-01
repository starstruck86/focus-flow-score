-- Add DELETE policies for tables that need cleanup during resource deletion
CREATE POLICY "Users delete own provenance" ON public.asset_provenance
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can delete own enrichment attempts" ON public.enrichment_attempts
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Users can delete own usage logs" ON public.knowledge_usage_log
  FOR DELETE TO authenticated USING (user_id = auth.uid());