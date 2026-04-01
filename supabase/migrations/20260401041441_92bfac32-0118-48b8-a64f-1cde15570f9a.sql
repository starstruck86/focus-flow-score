ALTER TABLE public.podcast_import_queue 
  ADD COLUMN IF NOT EXISTS raw_transcript text,
  ADD COLUMN IF NOT EXISTS structured_transcript text,
  ADD COLUMN IF NOT EXISTS review_reason text;