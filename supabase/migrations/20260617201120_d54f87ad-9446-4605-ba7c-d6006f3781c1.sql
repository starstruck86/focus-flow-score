CREATE OR REPLACE FUNCTION public.get_next_ki_for_dimension(
  p_user_id       uuid,
  p_spider_dimension text,
  p_exclude_ki_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id               uuid,
  chapter          text,
  spider_dimension text,
  tactic_summary   text,
  macro_situation  text,
  micro_strategy   text,
  when_to_use      text,
  when_not_to_use  text,
  how_to_execute   text,
  example_usage    text,
  why_it_matters   text,
  what_this_unlocks text,
  framework        text,
  "who"            text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  (
    SELECT ki.id, ki.chapter, ki.spider_dimension, ki.tactic_summary,
           ki.macro_situation, ki.micro_strategy, ki.when_to_use, ki.when_not_to_use,
           ki.how_to_execute, ki.example_usage, ki.why_it_matters, ki.what_this_unlocks,
           ki.framework, ki.who
    FROM knowledge_items ki
    INNER JOIN ki_mastery km ON km.ki_id = ki.id AND km.user_id = p_user_id
    WHERE ki.spider_dimension = p_spider_dimension
      AND ki.is_core_ae = true
      AND ki.active = true
      AND km.decay_risk = true
      AND (p_exclude_ki_id IS NULL OR ki.id != p_exclude_ki_id)
    ORDER BY km.last_drilled_at ASC
    LIMIT 1
  )
  UNION ALL
  (
    SELECT ki.id, ki.chapter, ki.spider_dimension, ki.tactic_summary,
           ki.macro_situation, ki.micro_strategy, ki.when_to_use, ki.when_not_to_use,
           ki.how_to_execute, ki.example_usage, ki.why_it_matters, ki.what_this_unlocks,
           ki.framework, ki.who
    FROM knowledge_items ki
    LEFT JOIN ki_mastery km ON km.ki_id = ki.id AND km.user_id = p_user_id
    WHERE ki.spider_dimension = p_spider_dimension
      AND ki.is_core_ae = true
      AND ki.active = true
      AND km.ki_id IS NULL
      AND (p_exclude_ki_id IS NULL OR ki.id != p_exclude_ki_id)
    ORDER BY RANDOM()
    LIMIT 1
  )
  UNION ALL
  (
    SELECT ki.id, ki.chapter, ki.spider_dimension, ki.tactic_summary,
           ki.macro_situation, ki.micro_strategy, ki.when_to_use, ki.when_not_to_use,
           ki.how_to_execute, ki.example_usage, ki.why_it_matters, ki.what_this_unlocks,
           ki.framework, ki.who
    FROM knowledge_items ki
    INNER JOIN ki_mastery km ON km.ki_id = ki.id AND km.user_id = p_user_id
    WHERE ki.spider_dimension = p_spider_dimension
      AND ki.is_core_ae = true
      AND ki.active = true
      AND (p_exclude_ki_id IS NULL OR ki.id != p_exclude_ki_id)
    ORDER BY km.avg_score ASC, km.last_drilled_at ASC
    LIMIT 1
  )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_next_ki_for_dimension(uuid, text, uuid) TO authenticated;