
-- Read-only correlation view. Training rows per (user, week, spoke) from ki_mastery→ki_curriculum→curriculum_concepts.
-- Field rows: weekly overall coach scores from transcript_grades (no spoke granularity today — repeated per spoke row, honestly labeled).
CREATE OR REPLACE VIEW public.training_field_efficacy
WITH (security_invoker = true)
AS
WITH training AS (
  SELECT
    km.user_id,
    date_trunc('week', km.updated_at)::date AS week_start,
    cc.spoke,
    COUNT(*)::int              AS drills_touched,
    ROUND(AVG(km.avg_score)::numeric, 1)  AS training_avg_score,
    ROUND(AVG(km.best_score)::numeric, 1) AS training_best_score,
    SUM(km.times_drilled)::int AS total_drills
  FROM public.ki_mastery km
  JOIN public.ki_curriculum kc ON kc.ki_id = km.ki_id
  JOIN public.curriculum_concepts cc ON cc.concept_id = kc.concept_id
  WHERE cc.spoke IS NOT NULL
  GROUP BY km.user_id, date_trunc('week', km.updated_at), cc.spoke
),
field AS (
  SELECT
    tg.user_id,
    date_trunc('week', COALESCE(ct.call_date::timestamptz, tg.created_at))::date AS week_start,
    COUNT(*)::int              AS calls_graded,
    ROUND(AVG(tg.overall_score)::numeric, 1)   AS field_overall_score,
    ROUND(AVG(tg.discovery_score)::numeric, 1) AS field_discovery_score,
    ROUND(AVG(tg.commercial_score)::numeric, 1) AS field_commercial_score,
    ROUND(AVG(tg.next_step_score)::numeric, 1) AS field_next_step_score,
    ROUND(AVG(tg.product_knowledge_score)::numeric, 1) AS field_product_knowledge_score
  FROM public.transcript_grades tg
  LEFT JOIN public.call_transcripts ct ON ct.id = tg.transcript_id
  GROUP BY tg.user_id, date_trunc('week', COALESCE(ct.call_date::timestamptz, tg.created_at))
)
SELECT
  COALESCE(t.user_id, f.user_id) AS user_id,
  COALESCE(t.week_start, f.week_start) AS week_start,
  t.spoke,
  COALESCE(t.drills_touched, 0)   AS drills_touched,
  t.training_avg_score,
  t.training_best_score,
  COALESCE(t.total_drills, 0)     AS total_drills,
  COALESCE(f.calls_graded, 0)     AS calls_graded,
  f.field_overall_score,
  f.field_discovery_score,
  f.field_commercial_score,
  f.field_next_step_score,
  f.field_product_knowledge_score,
  'weekly-overall'::text AS field_granularity
FROM training t
FULL OUTER JOIN field f
  ON f.user_id = t.user_id AND f.week_start = t.week_start;

GRANT SELECT ON public.training_field_efficacy TO authenticated, service_role;
