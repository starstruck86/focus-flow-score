
-- Clean up stale extraction_batches for canary resources so fresh reruns can proceed
DELETE FROM extraction_batches WHERE resource_id IN (
  '6929d0f0-cdfe-4b56-b9d9-7136393098e9',
  '50789cf2-eb43-4579-9ddc-3071d2af8833',
  'e15b8443-eb34-4923-a8f8-6720c66b8734',
  'a843b23b-6845-4ace-8b7d-69ae627ac006',
  'eefc3b01-508c-496b-aec5-76184d5786d1'
);

-- Reset resource active_job_status so they're not stuck
UPDATE resources SET 
  active_job_status = NULL,
  active_job_started_at = NULL,
  active_job_updated_at = NULL,
  extraction_batch_status = NULL,
  enrichment_status = 'extraction_retrying',
  extraction_retry_eligible = true
WHERE id IN (
  '6929d0f0-cdfe-4b56-b9d9-7136393098e9',
  '50789cf2-eb43-4579-9ddc-3071d2af8833',
  'e15b8443-eb34-4923-a8f8-6720c66b8734',
  'a843b23b-6845-4ace-8b7d-69ae627ac006',
  'eefc3b01-508c-496b-aec5-76184d5786d1'
);
