ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS active_job_step_label text,
  ADD COLUMN IF NOT EXISTS active_job_progress_current integer,
  ADD COLUMN IF NOT EXISTS active_job_progress_total integer,
  ADD COLUMN IF NOT EXISTS active_job_progress_pct integer;