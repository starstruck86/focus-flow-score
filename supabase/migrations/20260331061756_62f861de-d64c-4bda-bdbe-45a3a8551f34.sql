
-- Extraction Pipeline Jobs table for batch processing
CREATE TABLE public.extraction_pipeline_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'batch_extract',
  job_scope TEXT NOT NULL DEFAULT 'all_ready',
  status TEXT NOT NULL DEFAULT 'queued',
  total_resources INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  filter_criteria JSONB DEFAULT '{}',
  progress_log JSONB DEFAULT '[]',
  error_summary JSONB DEFAULT '{}',
  cancelled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.extraction_pipeline_jobs ENABLE ROW LEVEL SECURITY;

-- Users can manage their own jobs
CREATE POLICY "Users manage own pipeline jobs"
  ON public.extraction_pipeline_jobs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add structured block diagnostics columns to resources
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS block_reason TEXT,
  ADD COLUMN IF NOT EXISTS block_auto_fixable BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_next_action TEXT,
  ADD COLUMN IF NOT EXISTS block_terminal BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS block_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_priority_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_priority_factors JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS lightweight_extraction JSONB,
  ADD COLUMN IF NOT EXISTS pipeline_queue TEXT DEFAULT 'unscored';

-- Index for efficient pipeline queries
CREATE INDEX IF NOT EXISTS idx_resources_pipeline_queue ON public.resources (pipeline_queue);
CREATE INDEX IF NOT EXISTS idx_resources_extraction_priority ON public.resources (extraction_priority_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_extraction_pipeline_jobs_user_status ON public.extraction_pipeline_jobs (user_id, status);
