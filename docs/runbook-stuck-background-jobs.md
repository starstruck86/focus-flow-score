# Runbook: Reconciling Stuck Background Jobs

## When to use

A `background_jobs` row is stuck in `running` or `queued` with no recent `updated_at`
and the corresponding edge function has already exited (check edge function logs).

## 1. Identify stale jobs

### From browser console (while logged in)

```js
import('@/lib/admin/staleJobQuery').then(m => m.logStaleJobs(60));
```

### From SQL (Lovable Cloud query tool)

```sql
SELECT id, type, title, status, updated_at,
       EXTRACT(EPOCH FROM (now() - updated_at)) / 60 AS stale_minutes
FROM background_jobs
WHERE status IN ('running', 'queued')
  AND updated_at < now() - interval '60 minutes'
ORDER BY updated_at ASC;
```

## 2. Confirm the backend worker has exited

Check edge function logs for the job ID. If the function completed or errored
but failed to write back (e.g. network blip), the row is orphaned.

## 3. Reconcile

Update the row to a terminal state:

```sql
UPDATE background_jobs
SET status = 'failed',
    error = 'Reconciled: backend worker exited without writing terminal state',
    completed_at = now(),
    step_label = 'Reconciled manually'
WHERE id = '<JOB_ID>';
```

Or via the admin query util:

```js
import { supabase } from '@/integrations/supabase/client';
await supabase.from('background_jobs').update({
  status: 'failed',
  error: 'Reconciled: stale job',
  completed_at: new Date().toISOString(),
  step_label: 'Reconciled manually',
}).eq('id', '<JOB_ID>');
```

## 4. Verify

The Zustand store will pick up the change via the Realtime subscription
and update the UI automatically. No page refresh needed.

## 5. Prevention

- All edge functions (`run-enrichment-job`, `batch-extract-kis`, `extract-tactics`)
  write terminal state to `background_jobs` in their finally/catch blocks.
- If a new edge function is added, ensure it follows the same pattern.
- The `findStaleJobs()` utility can be wired into a periodic check if needed.
