
CREATE OR REPLACE FUNCTION public.get_resource_lifecycle_summary(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH r AS (
    SELECT
      enrichment_status,
      active_job_status,
      recovery_queue_bucket,
      manual_input_required,
      content_length,
      manual_content_present,
      failure_reason
    FROM public.resources
    WHERE user_id = p_user_id
  ),
  counts AS (
    SELECT
      count(*)::int AS total,
      -- Only truly in-flight jobs count as 'processing'.
      -- 'succeeded' is a terminal state but historically wasn't excluded,
      -- which inflated the count by 1000+ on mature libraries.
      count(*) FILTER (WHERE active_job_status IS NOT NULL
                        AND active_job_status NOT IN
                            ('completed','failed','cancelled','succeeded'))::int AS processing,
      count(*) FILTER (WHERE enrichment_status IN ('queued','pending'))::int AS queued,
      count(*) FILTER (WHERE enrichment_status IN ('enriched','deep_enriched','verified'))::int AS completed,
      count(*) FILTER (WHERE enrichment_status = 'failed'
                        OR manual_input_required = true
                        OR recovery_queue_bucket IN ('manual_input','blocked'))::int AS failed,
      count(*) FILTER (WHERE enrichment_status NOT IN ('enriched','deep_enriched','verified','failed')
                        OR enrichment_status IS NULL)::int AS importing,
      count(*) FILTER (WHERE coalesce(content_length,0) >= 200
                        OR manual_content_present = true)::int AS content_ready
    FROM r
  )
  SELECT jsonb_build_object(
    'total', total,
    'importing', importing,
    'completed', completed,
    'failed', failed,
    'processing', processing,
    'queued', queued,
    'content_ready', content_ready,
    'computed_at', now()
  )
  FROM counts;
$function$;
