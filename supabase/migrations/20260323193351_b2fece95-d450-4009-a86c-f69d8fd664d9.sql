CREATE POLICY "Users can delete own scans"
  ON public.pipeline_hygiene_scans
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);