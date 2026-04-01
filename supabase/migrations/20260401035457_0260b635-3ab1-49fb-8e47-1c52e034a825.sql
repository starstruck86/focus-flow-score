ALTER TABLE public.podcast_import_queue
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS transcript_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS failure_type text,
  ADD COLUMN IF NOT EXISTS content_validation jsonb,
  ADD COLUMN IF NOT EXISTS ki_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ki_count integer DEFAULT 0;