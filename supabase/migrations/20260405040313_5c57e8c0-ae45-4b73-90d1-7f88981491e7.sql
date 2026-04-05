-- Add multi-pass extraction tracking columns to resources
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS extraction_mode text DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS extraction_passes_run jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_candidate_counts jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS merged_candidate_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kis_per_1k_chars numeric(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_depth_bucket text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS under_extracted_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_extraction_summary text;