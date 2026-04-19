
INSERT INTO public.strategy_promotion_proposals (
  id, user_id, thread_id, proposal_type, target_table, target_scope,
  target_account_id, target_opportunity_id, payload_json, dedupe_key, status,
  confirmed_class, confirmed_by, confirmed_at,
  detector_version, detector_confidence, rationale
)
SELECT gen_random_uuid(),
  '9f11e308-4028-4527-b7ba-5ea365dc1441',
  '22222222-aaaa-bbbb-cccc-200000000001',
  'opportunity_intelligence', 'opportunity_strategy_memory', 'opportunity',
  '6f02951e-becd-4281-85ee-51a30ef24073',
  o.id,
  jsonb_build_object('content','Mismatch test: should be blocked.','memory_type','fact'),
  'mismatch-test-' || extract(epoch from now())::text,
  'confirmed_shared_intelligence', 'shared_intelligence',
  '9f11e308-4028-4527-b7ba-5ea365dc1441', now(),
  'mismatch_test_v1', 1.0, 'Cross-account mismatch test'
FROM opportunities o
WHERE o.user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441'
  AND o.account_id != '6f02951e-becd-4281-85ee-51a30ef24073'
LIMIT 1
RETURNING id, target_account_id, target_opportunity_id;
