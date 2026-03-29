
UPDATE resources SET
  recovery_reason = NULL,
  next_best_action = NULL,
  last_recovery_error = NULL,
  platform_status = NULL,
  failure_count = 0,
  content_status = 'full',
  manual_content_present = true,
  enriched_at = now(),
  last_status_change_at = now()
WHERE id IN (
  '33b9da5d-6572-4fcf-91ea-c4e4fda0163d',
  '9d51b8bf-ac0e-42a2-97a7-4492bdf94867',
  'd28210eb-fa64-4544-a107-1c49bfdc86e0'
)
AND content_length > 1000;
