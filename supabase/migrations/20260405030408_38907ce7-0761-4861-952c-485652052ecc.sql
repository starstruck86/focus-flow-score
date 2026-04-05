UPDATE resources 
SET enrichment_status = 'deep_enriched',
    active_job_status = 'succeeded',
    active_job_finished_at = now(),
    active_job_error = NULL,
    active_job_type = 'extract',
    last_status_change_at = now(),
    updated_at = now()
WHERE id = 'fb04488f-c2e9-4cbf-b016-dd0d9e4da60c';