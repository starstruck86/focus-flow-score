DROP POLICY IF EXISTS "Service role can manage extraction runs" ON public.extraction_runs;

CREATE POLICY "Users can update their own extraction runs"
  ON public.extraction_runs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own extraction runs"
  ON public.extraction_runs FOR DELETE
  USING (auth.uid() = user_id);