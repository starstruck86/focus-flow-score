
CREATE OR REPLACE FUNCTION public.claim_podcast_queue_items(
  p_max_items INT DEFAULT 3,
  p_max_processing INT DEFAULT 3
)
RETURNS SETOF podcast_import_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currently_processing INT;
  v_slots_available INT;
  v_to_claim INT;
BEGIN
  -- Count globally processing items
  SELECT COUNT(*) INTO v_currently_processing
  FROM podcast_import_queue
  WHERE status = 'processing';

  v_slots_available := GREATEST(p_max_processing - v_currently_processing, 0);
  v_to_claim := LEAST(p_max_items, v_slots_available);

  IF v_to_claim <= 0 THEN
    RETURN;
  END IF;

  -- Atomically claim items using UPDATE ... RETURNING inside a CTE
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
$$;
