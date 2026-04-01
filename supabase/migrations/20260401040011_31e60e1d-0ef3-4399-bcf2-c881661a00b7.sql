ALTER TABLE public.podcast_import_queue
  ADD COLUMN IF NOT EXISTS transcript_preview text,
  ADD COLUMN IF NOT EXISTS transcript_length integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transcript_section_count integer DEFAULT 0;