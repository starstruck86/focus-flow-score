-- Backfill resource-level KI metrics from actual knowledge_items
WITH ki_counts AS (
  SELECT 
    source_resource_id,
    COUNT(*) as ki_count
  FROM knowledge_items
  WHERE source_resource_id IS NOT NULL
  GROUP BY source_resource_id
)
UPDATE resources r
SET 
  current_resource_ki_count = COALESCE(kc.ki_count, 0),
  current_resource_kis_per_1k = CASE 
    WHEN r.content_length > 0 THEN ROUND((COALESCE(kc.ki_count, 0) * 1000.0 / r.content_length)::numeric, 2)
    ELSE 0
  END,
  kis_per_1k_chars = CASE 
    WHEN r.content_length > 0 THEN ROUND((COALESCE(kc.ki_count, 0) * 1000.0 / r.content_length)::numeric, 2)
    ELSE 0
  END,
  extraction_depth_bucket = CASE
    WHEN COALESCE(kc.ki_count, 0) = 0 THEN 'none'
    WHEN r.content_length > 0 AND (COALESCE(kc.ki_count, 0) * 1000.0 / r.content_length) < 0.75 THEN 'shallow'
    WHEN r.content_length > 0 AND (COALESCE(kc.ki_count, 0) * 1000.0 / r.content_length) < 1.5 THEN 'moderate'
    WHEN r.content_length > 0 THEN 'strong'
    ELSE 'none'
  END,
  extraction_method = COALESCE(r.extraction_method, 'llm')
FROM ki_counts kc
WHERE r.id = kc.source_resource_id;

-- Also set resources with zero KIs
UPDATE resources
SET 
  current_resource_ki_count = 0,
  current_resource_kis_per_1k = 0,
  kis_per_1k_chars = 0,
  extraction_depth_bucket = 'none'
WHERE id NOT IN (SELECT DISTINCT source_resource_id FROM knowledge_items WHERE source_resource_id IS NOT NULL);