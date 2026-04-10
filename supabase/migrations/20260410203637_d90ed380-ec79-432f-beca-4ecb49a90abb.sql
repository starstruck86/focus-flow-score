-- Reset the 3 stalled items
UPDATE podcast_import_queue
SET status = 'queued',
    pipeline_stage = 'queued',
    updated_at = now()
WHERE status = 'processing'
  AND updated_at < now() - interval '10 minutes';

-- Upgrade claim function with stale-lock watchdog
CREATE OR REPLACE FUNCTION public.claim_podcast_queue_items(p_max_items integer DEFAULT 3, p_max_processing integer DEFAULT 3)
 RETURNS SETOF podcast_import_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_currently_processing INT;
  v_slots_available INT;
  v_to_claim INT;
  v_unstalled INT;
BEGIN
  -- Stale-lock watchdog: reset items stuck in processing for > 10 minutes
  UPDATE podcast_import_queue
  SET status = 'queued',
      pipeline_stage = 'queued',
      updated_at = now()
  WHERE status = 'processing'
    AND updated_at < now() - interval '10 minutes';

  GET DIAGNOSTICS v_unstalled = ROW_COUNT;
  IF v_unstalled > 0 THEN
    RAISE LOG 'podcast queue: unstalled % items', v_unstalled;
  END IF;

  -- Count globally processing items
  SELECT COUNT(*) INTO v_currently_processing
  FROM podcast_import_queue
  WHERE status = 'processing';

  v_slots_available := GREATEST(p_max_processing - v_currently_processing, 0);
  v_to_claim := LEAST(p_max_items, v_slots_available);

  IF v_to_claim <= 0 THEN
    RETURN;
  END IF;

  -- Atomically claim items
  RETURN QUERY
  WITH claimed AS (
    UPDATE podcast_import_queue
    SET status = 'processing',
        pipeline_stage = CASE
          WHEN transcript_status = 'transcript_ready' AND raw_transcript IS NOT NULL THEN 'preprocessing'
          ELSE 'resolving'
        END,
        updated_at = now()
    WHERE id IN (
      SELECT id FROM podcast_import_queue
      WHERE status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT v_to_claim
    )
    RETURNING *
  )
  SELECT * FROM claimed;
END;
$function$;