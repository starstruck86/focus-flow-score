UPDATE public.task_runs
SET thread_id = '2e02861e-61f1-482f-be49-84577ee3b947'
WHERE id = '904720b9-6a89-4ea8-8995-48f650e4f947'
  AND thread_id IS NULL;

UPDATE public.strategy_threads
SET title = 'Sephora — Discovery Prep'
WHERE id = '2e02861e-61f1-482f-be49-84577ee3b947'
  AND title = 'Untitled thread';