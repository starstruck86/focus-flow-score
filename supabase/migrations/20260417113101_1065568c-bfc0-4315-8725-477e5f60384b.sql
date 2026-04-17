-- Reap the stuck run from validation pass (Stage 3 hang, no provider timeout)
UPDATE public.task_runs
SET status = 'failed',
    progress_step = 'failed',
    error = 'Stage 3 (document_authoring) hung — no provider timeout. Reaped by validation pass; provider hardened with 90s timeout + retry.',
    completed_at = now(),
    updated_at = now()
WHERE id = '6c174b0c-7992-4b15-8821-57b22a26a689'
  AND status = 'pending';