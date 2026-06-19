CREATE OR REPLACE VIEW public.ki_mastery_weekly AS
SELECT
  user_id,
  spider_dimension,
  DATE_TRUNC('week', updated_at)::date AS week_start,
  ROUND(AVG(avg_score)::numeric, 1) AS weekly_avg,
  COUNT(*)::integer AS ki_count
FROM ki_mastery
WHERE spider_dimension IS NOT NULL
GROUP BY user_id, spider_dimension, DATE_TRUNC('week', updated_at)::date
ORDER BY user_id, spider_dimension, week_start;

GRANT SELECT ON public.ki_mastery_weekly TO authenticated;
ALTER VIEW public.ki_mastery_weekly SET (security_invoker = true);