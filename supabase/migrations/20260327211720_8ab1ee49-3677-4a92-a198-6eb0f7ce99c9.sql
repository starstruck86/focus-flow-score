ALTER TABLE public.audio_jobs
  ADD COLUMN IF NOT EXISTS platform_source_type text,
  ADD COLUMN IF NOT EXISTS source_episode_id text,
  ADD COLUMN IF NOT EXISTS source_show_id text,
  ADD COLUMN IF NOT EXISTS canonical_episode_url text,
  ADD COLUMN IF NOT EXISTS rss_feed_url text,
  ADD COLUMN IF NOT EXISTS transcript_source_url text,
  ADD COLUMN IF NOT EXISTS metadata_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resolver_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resolution_stage text,
  ADD COLUMN IF NOT EXISTS transcript_mode text DEFAULT 'direct_transcription',
  ADD COLUMN IF NOT EXISTS final_resolution_status text;