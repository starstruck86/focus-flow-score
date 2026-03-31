
ALTER TABLE public.batch_run_jobs
  ADD COLUMN method_used TEXT,
  ADD COLUMN content_length_extracted INTEGER,
  ADD COLUMN quality_passed BOOLEAN;
