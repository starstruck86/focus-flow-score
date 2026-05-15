-- Guardrail: surface "enriched but zero active KI" resources
-- so the same drift never goes unnoticed again.
CREATE OR REPLACE VIEW public.resource_truth_drift
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.user_id,
  r.title,
  r.resource_type,
  r.enrichment_status,
  r.content_length,
  r.extraction_attempt_count,
  r.extraction_failure_type,
  r.updated_at,
  coalesce(k.active_ki, 0) AS active_ki_count,
  CASE
    WHEN coalesce(k.active_ki, 0) = 0
     AND r.content_length >= 500
     AND r.enrichment_status IN ('enriched', 'deep_enriched', 'verified')
    THEN 'phantom_enriched'
    WHEN coalesce(k.active_ki, 0) BETWEEN 1 AND 4
     AND r.content_length >= 5000
    THEN 'under_extracted'
    WHEN r.enrichment_status = 'extraction_retrying'
     AND r.next_retry_at IS NULL
    THEN 'orphaned_retry'
    WHEN r.enrichment_status IN ('enriched', 'deep_enriched', 'verified')
     AND coalesce(r.content_length, 0) < 500
    THEN 'enriched_but_empty'
    ELSE NULL
  END AS drift_reason
FROM public.resources r
LEFT JOIN (
  SELECT source_resource_id, count(*) FILTER (WHERE active) AS active_ki
  FROM public.knowledge_items
  WHERE source_resource_id IS NOT NULL
  GROUP BY source_resource_id
) k ON k.source_resource_id = r.id;

COMMENT ON VIEW public.resource_truth_drift IS
  'Single source of truth for resource/KI drift. Any row with non-null drift_reason is a real anomaly that should be surfaced in audit panels.';