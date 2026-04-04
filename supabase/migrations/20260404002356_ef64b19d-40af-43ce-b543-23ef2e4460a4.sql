ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS extraction_attempt_history jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS next_retry_at timestamptz DEFAULT NULL;
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS retry_scheduled_at timestamptz DEFAULT NULL;