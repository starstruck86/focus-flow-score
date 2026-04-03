-- Add generic active-job tracking columns to resources
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS active_job_type text,
  ADD COLUMN IF NOT EXISTS active_job_status text DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS active_job_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS active_job_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS active_job_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS active_job_result_summary text,
  ADD COLUMN IF NOT EXISTS active_job_error text;

-- Index for quickly finding resources with active jobs
CREATE INDEX IF NOT EXISTS idx_resources_active_job
  ON public.resources (user_id, active_job_status)
  WHERE active_job_status IS NOT NULL AND active_job_status NOT IN ('idle', 'succeeded', 'failed');