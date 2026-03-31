
-- 1. Add provenance columns to knowledge_items
ALTER TABLE public.knowledge_items
  ADD COLUMN IF NOT EXISTS source_segment_index integer,
  ADD COLUMN IF NOT EXISTS source_char_range jsonb,
  ADD COLUMN IF NOT EXISTS source_heading text,
  ADD COLUMN IF NOT EXISTS source_excerpt text;

-- 2. Allow null canonical_resource_id for all-reference cluster resolutions
ALTER TABLE public.cluster_resolutions
  ALTER COLUMN canonical_resource_id DROP NOT NULL;

-- 3. Remove text length limits on asset_provenance content columns
-- (they are already text type with no constraint, but ensure no truncation issues)
-- Add asset_type 'knowledge' to the check constraint
ALTER TABLE public.asset_provenance DROP CONSTRAINT IF EXISTS asset_provenance_asset_type_check;
ALTER TABLE public.asset_provenance ADD CONSTRAINT asset_provenance_asset_type_check
  CHECK (asset_type IN ('template', 'example', 'tactic', 'knowledge'));
