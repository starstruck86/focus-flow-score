
-- ═══════════════════════════════════════════════════════════
-- podcast_import_queue: add source identity columns
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.podcast_import_queue
  ADD COLUMN IF NOT EXISTS original_episode_url text,
  ADD COLUMN IF NOT EXISTS resolved_url text,
  ADD COLUMN IF NOT EXISTS audio_url text,
  ADD COLUMN IF NOT EXISTS host_platform text,
  ADD COLUMN IF NOT EXISTS episode_description text,
  ADD COLUMN IF NOT EXISTS artwork_url text,
  ADD COLUMN IF NOT EXISTS show_title text,
  ADD COLUMN IF NOT EXISTS resolution_method text,
  ADD COLUMN IF NOT EXISTS metadata_status text DEFAULT 'pending';

-- Backfill original_episode_url from episode_url for existing rows
UPDATE public.podcast_import_queue
SET original_episode_url = episode_url
WHERE original_episode_url IS NULL;

-- ═══════════════════════════════════════════════════════════
-- resources: add audio source identity columns
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS original_url text,
  ADD COLUMN IF NOT EXISTS audio_url text,
  ADD COLUMN IF NOT EXISTS host_platform text,
  ADD COLUMN IF NOT EXISTS show_title text,
  ADD COLUMN IF NOT EXISTS episode_description text,
  ADD COLUMN IF NOT EXISTS artwork_url text,
  ADD COLUMN IF NOT EXISTS transcript_status text,
  ADD COLUMN IF NOT EXISTS metadata_status text;

-- Backfill original_url from file_url for existing resources
UPDATE public.resources
SET original_url = file_url
WHERE original_url IS NULL AND file_url IS NOT NULL;
