
-- Add fingerprint column
ALTER TABLE public.knowledge_items ADD COLUMN ki_fingerprint text;

-- Add resource-level coverage columns
ALTER TABLE public.resources 
ADD COLUMN IF NOT EXISTS current_resource_ki_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_resource_kis_per_1k numeric DEFAULT 0;

-- Delete duplicates first (before setting fingerprints)
DELETE FROM public.knowledge_items
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id,
          source_resource_id || '::' || 
          LEFT(LOWER(REGEXP_REPLACE(COALESCE(title,''), '[^a-z0-9\s]', '', 'g')), 80) || '::' ||
          LEFT(LOWER(REGEXP_REPLACE(COALESCE(tactic_summary,''), '[^a-z0-9\s]', '', 'g')), 100)
        ORDER BY user_edited DESC, created_at ASC
      ) as rn
    FROM public.knowledge_items
  ) dupes
  WHERE rn > 1
);

-- Backfill fingerprints
UPDATE public.knowledge_items
SET ki_fingerprint = source_resource_id || '::' || 
  LEFT(LOWER(REGEXP_REPLACE(COALESCE(title,''), '[^a-z0-9\s]', '', 'g')), 80) || '::' ||
  LEFT(LOWER(REGEXP_REPLACE(COALESCE(tactic_summary,''), '[^a-z0-9\s]', '', 'g')), 100);

-- Create unique constraint
CREATE UNIQUE INDEX idx_knowledge_items_fingerprint_unique
ON public.knowledge_items (user_id, ki_fingerprint)
WHERE ki_fingerprint IS NOT NULL;
