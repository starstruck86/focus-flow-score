CREATE OR REPLACE VIEW public.dimension_scores AS
SELECT
  tg.user_id,
  dim.spider_dimension,
  COUNT(tg.id)::integer AS call_count,
  ROUND(AVG(
    CASE dim.spider_dimension
      WHEN 'discovery'              THEN tg.discovery_score
      WHEN 'internal_prospecting'   THEN (tg.structure_score + tg.cotm_score) / 2.0
      WHEN 'stakeholder_navigation' THEN tg.meddicc_score
      WHEN 'messaging'              THEN tg.cotm_score
      WHEN 'deal_control'           THEN (tg.next_step_score + tg.meddicc_score) / 2.0
      WHEN 'objection_handling'     THEN tg.cotm_score
      WHEN 'expansion_strategy'     THEN tg.meddicc_score
      WHEN 'c_suite_engagement'     THEN tg.presence_score
      WHEN 'competitive'            THEN tg.cotm_score
      WHEN 'qualification'          THEN (tg.meddicc_score + tg.discovery_score) / 2.0
      ELSE NULL
    END * 20
  ), 1)::numeric AS avg_score_100,
  ROUND(MIN(
    CASE dim.spider_dimension
      WHEN 'discovery'              THEN tg.discovery_score
      WHEN 'internal_prospecting'   THEN (tg.structure_score + tg.cotm_score) / 2.0
      WHEN 'stakeholder_navigation' THEN tg.meddicc_score
      WHEN 'messaging'              THEN tg.cotm_score
      WHEN 'deal_control'           THEN (tg.next_step_score + tg.meddicc_score) / 2.0
      WHEN 'objection_handling'     THEN tg.cotm_score
      WHEN 'expansion_strategy'     THEN tg.meddicc_score
      WHEN 'c_suite_engagement'     THEN tg.presence_score
      WHEN 'competitive'            THEN tg.cotm_score
      WHEN 'qualification'          THEN (tg.meddicc_score + tg.discovery_score) / 2.0
      ELSE NULL
    END * 20
  ), 1)::numeric AS min_score_100
FROM public.transcript_grades tg
CROSS JOIN (
  SELECT UNNEST(ARRAY[
    'discovery','internal_prospecting','stakeholder_navigation','messaging',
    'deal_control','objection_handling','expansion_strategy','c_suite_engagement',
    'competitive','qualification'
  ]) AS spider_dimension
) dim
WHERE tg.discovery_score IS NOT NULL
GROUP BY tg.user_id, dim.spider_dimension;

GRANT SELECT ON public.dimension_scores TO authenticated;
GRANT SELECT ON public.dimension_scores TO service_role;