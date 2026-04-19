
-- (B) Real opportunity-scoped proposal — represents an "opportunity_intelligence" detection
-- normally produced by the detector. We insert a fresh pending row pointing at FTD opp.
INSERT INTO public.strategy_promotion_proposals (
  id, user_id, thread_id, proposal_type, target_table, target_scope,
  target_account_id, target_opportunity_id, payload_json, dedupe_key, status,
  detector_version, detector_confidence, rationale
) VALUES (
  '99999999-aaaa-bbbb-cccc-100000000001',
  '9f11e308-4028-4527-b7ba-5ea365dc1441',
  '22222222-aaaa-bbbb-cccc-200000000001',
  'opportunity_intelligence',
  'opportunity_strategy_memory',
  'opportunity',
  '6f02951e-becd-4281-85ee-51a30ef24073',
  'ed9c0d22-5b18-474a-bdbb-30e192bf5de3',
  jsonb_build_object(
    'content','FTD renewal opportunity is at Proposal stage. Next concrete step: lock multi-year terms with SMS expansion attach in Q3 readout. Champion to align procurement before final readout.',
    'memory_type','next_step',
    'confidence', 0.85
  ),
  'ftd-opp-next-step-real-' || extract(epoch from now())::text,
  'pending',
  'manual_real_proof_v1',
  1.0,
  'Real opportunity-scoped next-step intelligence captured for FTD renewal opp.'
);

-- Class-confirm all three to shared_intelligence (mimicking the UI ProposalReviewPanel decision)
UPDATE public.strategy_promotion_proposals
SET status = 'confirmed_shared_intelligence',
    confirmed_class = 'shared_intelligence',
    confirmed_by = '9f11e308-4028-4527-b7ba-5ea365dc1441',
    confirmed_at = now()
WHERE id IN (
  '987b106d-a504-4cd0-81ff-02a8b0a9a026',
  'f192f2a4-2627-4eb2-94ad-b2ca6a3d02a2',
  '99999999-aaaa-bbbb-cccc-100000000001'
);
