
CREATE OR REPLACE VIEW public.branch_readiness AS
SELECT
  u.id AS user_id,
  COUNT(DISTINCT ki.id)::integer AS total_branch_kis,
  COUNT(DISTINCT km.ki_id)::integer AS drilled_branch_kis,
  ROUND(
    CASE WHEN COUNT(DISTINCT ki.id) > 0
      THEN COUNT(DISTINCT km.ki_id)::numeric / COUNT(DISTINCT ki.id) * 100
      ELSE 0
    END, 1
  )::numeric AS coverage_pct,
  ROUND(
    COALESCE(AVG(km.avg_score), 0), 1
  )::numeric AS avg_drill_score
FROM auth.users u
LEFT JOIN public.knowledge_items ki ON ki.chapter LIKE 'branch_%' AND ki.active = true
LEFT JOIN public.ki_mastery km ON km.ki_id = ki.id AND km.user_id = u.id
GROUP BY u.id;

ALTER VIEW public.branch_readiness SET (security_invoker = true);
GRANT SELECT ON public.branch_readiness TO authenticated;
