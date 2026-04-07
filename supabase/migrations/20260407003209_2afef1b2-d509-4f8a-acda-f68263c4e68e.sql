
-- Delete the most recent 42 KIs (12+17+13 = batches 6-8 saved_count)
DELETE FROM knowledge_items
WHERE id IN (
  SELECT id FROM knowledge_items
  WHERE source_resource_id = '8eb96a5b-6b03-4932-b6ac-533e394290dc'
  ORDER BY created_at DESC
  LIMIT 42
);

-- Reset batch rows 6-8 to pending
UPDATE extraction_batches
SET status = 'pending', saved_count = NULL, error = NULL, 
    extraction_run_id = NULL, started_at = NULL, completed_at = NULL,
    raw_count = NULL, validated_count = NULL, duplicates_skipped = NULL,
    cumulative_resource_ki_count = NULL
WHERE resource_id = '8eb96a5b-6b03-4932-b6ac-533e394290dc'
  AND batch_index >= 6;

-- Delete extraction_runs for those batches
DELETE FROM extraction_runs
WHERE id IN (
  'aac82b52-0773-47a2-89b2-ebbae9ffdefa',
  '034c9523-6b99-4955-b0fb-20696b2bc1f4',
  '21a85a53-89db-4a3b-bdea-5fe3c056d8b2'
);

-- Reset resource snapshot to partial state
UPDATE resources
SET current_resource_ki_count = 203,
    extraction_attempt_count = 6,
    extraction_batches_completed = 6,
    extraction_is_resumable = true,
    active_job_status = 'partial',
    extraction_batch_status = 'partial_complete_resumable',
    last_extraction_run_status = 'completed',
    updated_at = now()
WHERE id = '8eb96a5b-6b03-4932-b6ac-533e394290dc';
