-- Create extraction_runs audit table
CREATE TABLE public.extraction_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resource_id UUID NOT NULL,
  user_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  extraction_method TEXT,
  extraction_mode TEXT,
  model TEXT,
  passes_run TEXT[],
  chunks_total INTEGER DEFAULT 0,
  chunks_processed INTEGER DEFAULT 0,
  chunks_failed INTEGER DEFAULT 0,
  raw_candidate_counts JSONB,
  merged_candidate_count INTEGER DEFAULT 0,
  validated_candidate_count INTEGER DEFAULT 0,
  saved_candidate_count INTEGER DEFAULT 0,
  kis_per_1k_chars NUMERIC(6,2),
  extraction_depth_bucket TEXT,
  under_extracted_flag BOOLEAN DEFAULT false,
  validation_rejection_counts JSONB,
  dedupe_merge_counts JSONB,
  error_message TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.extraction_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own extraction runs"
  ON public.extraction_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own extraction runs"
  ON public.extraction_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage extraction runs"
  ON public.extraction_runs FOR ALL
  USING (true) WITH CHECK (true);

CREATE INDEX idx_extraction_runs_resource ON public.extraction_runs(resource_id);
CREATE INDEX idx_extraction_runs_user ON public.extraction_runs(user_id);

-- Add server-owned last-extraction snapshot columns to resources
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS last_extraction_run_id UUID,
  ADD COLUMN IF NOT EXISTS last_extraction_run_status TEXT,
  ADD COLUMN IF NOT EXISTS last_extraction_returned_ki_count INTEGER,
  ADD COLUMN IF NOT EXISTS last_extraction_deduped_ki_count INTEGER,
  ADD COLUMN IF NOT EXISTS last_extraction_validated_ki_count INTEGER,
  ADD COLUMN IF NOT EXISTS last_extraction_saved_ki_count INTEGER,
  ADD COLUMN IF NOT EXISTS last_extraction_error TEXT,
  ADD COLUMN IF NOT EXISTS last_extraction_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_extraction_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_extraction_duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS last_extraction_model TEXT;