CREATE OR REPLACE FUNCTION public.signal_dimension_weakness(
  p_user_id uuid,
  p_spider_dimension text,
  p_signal_score numeric
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_ki_id uuid;
BEGIN
  FOR v_ki_id IN (
    SELECT ki.id
    FROM knowledge_items ki
    LEFT JOIN ki_mastery km ON km.ki_id = ki.id AND km.user_id = p_user_id
    WHERE ki.spider_dimension = p_spider_dimension
      AND ki.is_core_ae = true
      AND ki.active = true
    ORDER BY
      COALESCE(km.last_drilled_at, '1970-01-01'::timestamptz) ASC,
      RANDOM()
    LIMIT 5
  ) LOOP
    INSERT INTO ki_mastery (
      user_id, ki_id, spider_dimension,
      times_drilled, avg_score, best_score,
      decay_risk, created_at, updated_at
    )
    VALUES (
      p_user_id, v_ki_id, p_spider_dimension,
      0, p_signal_score, p_signal_score,
      true, now(), now()
    )
    ON CONFLICT (user_id, ki_id) DO UPDATE SET
      decay_risk = true,
      updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.signal_dimension_weakness(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signal_dimension_weakness(uuid, text, numeric) TO authenticated, service_role;