CREATE OR REPLACE FUNCTION public.get_next_ki_for_dimension(
  p_user_id uuid,
  p_spider_dimension text,
  p_limit integer DEFAULT 1
)
RETURNS TABLE(
  id uuid, title text, tactic_summary text, why_it_matters text,
  when_to_use text, when_not_to_use text, example_usage text,
  framework text, chapter text, sub_chapter text, spider_dimension text,
  confidence_score integer, active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rolling_avg numeric;
  v_conf_min integer := 0;
  v_conf_max integer := 100;
BEGIN
  SELECT ROUND(AVG(avg_score)::numeric, 1)
  INTO v_rolling_avg
  FROM (
    SELECT km2.avg_score
    FROM ki_mastery km2
    WHERE km2.user_id = p_user_id
      AND km2.spider_dimension = p_spider_dimension
    ORDER BY km2.updated_at DESC
    LIMIT 10
  ) recent;

  IF v_rolling_avg IS NOT NULL THEN
    IF v_rolling_avg > 70 THEN
      v_conf_min := 70;
    ELSIF v_rolling_avg < 50 THEN
      v_conf_max := 75;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    ki.id, ki.title, ki.tactic_summary, ki.why_it_matters,
    ki.when_to_use, ki.when_not_to_use, ki.example_usage,
    ki.framework, ki.chapter, ki.sub_chapter, ki.spider_dimension,
    ki.confidence_score, ki.active
  FROM knowledge_items ki
  LEFT JOIN ki_mastery km ON km.ki_id = ki.id AND km.user_id = p_user_id
  WHERE ki.spider_dimension = p_spider_dimension
    AND ki.is_core_ae = true
    AND ki.active = true
    AND ki.confidence_score BETWEEN v_conf_min AND v_conf_max
  ORDER BY
    CASE WHEN km.decay_risk = true THEN 0 ELSE 1 END ASC,
    CASE WHEN km.next_review_at IS NOT NULL AND km.next_review_at <= now() THEN 0 ELSE 1 END ASC,
    CASE WHEN km.id IS NULL THEN 0 ELSE 1 END ASC,
    COALESCE(km.avg_score, 0) ASC,
    RANDOM()
  LIMIT p_limit;
END;
$$;