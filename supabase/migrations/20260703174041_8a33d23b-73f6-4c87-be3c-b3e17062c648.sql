-- Follow-up: Postgres grants EXECUTE to PUBLIC by default on functions.
-- Anon inherits from PUBLIC, so the prior REVOKE FROM anon was a no-op.
-- Revoke from PUBLIC, then re-grant explicitly to authenticated + service_role.

REVOKE EXECUTE ON FUNCTION public.get_resource_content_prefixes(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_resource_lifecycle_summary(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_next_ki_for_dimension(uuid, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.compute_thread_trust_state(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_podcast_queue_items(integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_resource_content_prefixes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_resource_lifecycle_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_ki_for_dimension(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_thread_trust_state(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_podcast_queue_items(integer, integer) TO service_role;