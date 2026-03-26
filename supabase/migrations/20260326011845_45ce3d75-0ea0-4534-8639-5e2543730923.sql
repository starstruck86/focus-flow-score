
ALTER TABLE public.resources 
  ADD COLUMN IF NOT EXISTS validation_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_quality_score numeric NULL,
  ADD COLUMN IF NOT EXISTS last_quality_tier text NULL;
