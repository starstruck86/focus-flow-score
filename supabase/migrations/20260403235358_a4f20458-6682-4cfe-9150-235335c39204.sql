ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS extraction_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_extraction_attempts integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS extraction_failure_type text,
  ADD COLUMN IF NOT EXISTS extractor_strategy text,
  ADD COLUMN IF NOT EXISTS extraction_retry_eligible boolean NOT NULL DEFAULT false;