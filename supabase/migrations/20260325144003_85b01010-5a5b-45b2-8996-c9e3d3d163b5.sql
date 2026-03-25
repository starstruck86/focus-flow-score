
-- Add canonical enrichment lifecycle columns to resources table
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS enrichment_status text NOT NULL DEFAULT 'not_enriched',
  ADD COLUMN IF NOT EXISTS last_enrichment_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_status_change_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS enrichment_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS enrichment_audit_log jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Reconcile legacy content_status → enrichment_status
-- Resources with content_status='enriched' AND enriched_at set AND content_length > 200 → deep_enriched
UPDATE public.resources
SET enrichment_status = 'deep_enriched',
    enrichment_version = 1,
    last_status_change_at = COALESCE(enriched_at, now())
WHERE content_status = 'enriched'
  AND enriched_at IS NOT NULL
  AND content_length > 200;

-- Resources marked enriched but with missing/short content → not_enriched (false positive repair)
UPDATE public.resources
SET enrichment_status = 'not_enriched',
    last_status_change_at = now()
WHERE content_status = 'enriched'
  AND (enriched_at IS NULL OR content_length IS NULL OR content_length <= 200);

-- Stuck 'enriching' → not_enriched
UPDATE public.resources
SET enrichment_status = 'not_enriched',
    last_status_change_at = now()
WHERE content_status = 'enriching';

-- Everything else stays not_enriched (default)

-- Add index for fast eligibility queries
CREATE INDEX IF NOT EXISTS idx_resources_enrichment_status ON public.resources(enrichment_status);
