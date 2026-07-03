-- Security wave: revoke anon EXECUTE on SECURITY DEFINER functions confirmed
-- to have zero unauthenticated callers. Authenticated + service_role retain access.
-- Rollback: GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO anon;
-- Skipped: is_approved_user (used by allowlist auth path — do not touch).

REVOKE EXECUTE ON FUNCTION public.get_resource_content_prefixes(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_resource_lifecycle_summary(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_next_ki_for_dimension(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.compute_thread_trust_state(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_podcast_queue_items(integer, integer) FROM anon;

-- Ensure authenticated + service_role still have execute (idempotent safety net).
GRANT EXECUTE ON FUNCTION public.get_resource_content_prefixes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_resource_lifecycle_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_ki_for_dimension(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_thread_trust_state(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_podcast_queue_items(integer, integer) TO service_role;