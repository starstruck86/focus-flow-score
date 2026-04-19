
-- Atomic: thread + artifacts + upload + 4 proposals
INSERT INTO public.strategy_threads (id, user_id, title, lane, thread_type, linked_account_id, linked_opportunity_id, status, trust_state)
VALUES ('ffd00001-0000-0000-0000-000000000001','9f11e308-4028-4527-b7ba-5ea365dc1441','FTD Q2 Account Plan (clean proof)','strategy','account_strategy','6f02951e-becd-4281-85ee-51a30ef24073',NULL,'active','safe');

INSERT INTO public.strategy_artifacts (id, user_id, thread_id, artifact_type, title, content_json, rendered_text, linked_account_id)
VALUES ('ffd00002-0000-0000-0000-000000000002','9f11e308-4028-4527-b7ba-5ea365dc1441','ffd00001-0000-0000-0000-000000000001','business_case','FTD Q2 Business Case','{"sections":["situation","ask","value"]}'::jsonb,
E'# FTD Q2 Business Case\n\n## Situation\nFTD is renewing in Q2.\n\n## Ask\n50→200 seats + Insights module.\n\n## Value\n$480K incremental ARR; 6mo payback.\n','6f02951e-becd-4281-85ee-51a30ef24073');

INSERT INTO public.strategy_artifacts (id, user_id, thread_id, artifact_type, title, content_json, rendered_text, linked_account_id, linked_opportunity_id)
VALUES ('ffd00003-0000-0000-0000-000000000003','9f11e308-4028-4527-b7ba-5ea365dc1441','ffd00001-0000-0000-0000-000000000001','next_steps','FTD Opp — Mutual Action Plan','{"steps":["tv","proc","legal"]}'::jsonb,
E'# FTD Opportunity — Mutual Action Plan\n\n1. Technical validation w/ Brian (May 1)\n2. Procurement intake (May 8)\n3. Legal redlines (May 15)\n4. Signature target (May 30)\n','6f02951e-becd-4281-85ee-51a30ef24073','ed9c0d22-5b18-474a-bdbb-30e192bf5de3');

INSERT INTO public.strategy_uploaded_resources (id, user_id, thread_id, file_name, file_type, storage_path, parsed_text, summary, metadata_json)
VALUES ('ffd00004-0000-0000-0000-000000000004','9f11e308-4028-4527-b7ba-5ea365dc1441','ffd00001-0000-0000-0000-000000000001','FTD-discovery-call-notes.txt','text/plain','9f11e308-4028-4527-b7ba-5ea365dc1441/ffd00001-0000-0000-0000-000000000001/ftd-discovery-call-notes.txt',
E'FTD Discovery Call - April 18\n\nAttendees: Brian (VP Operations, FTD), AE\n- Q3 contract expiry\n- Pain: exception visibility\n- Budget $300-500K\n- DM: Brian/CFO/Head of Procurement\n- Close end of June\n',
E'FTD discovery: Brian (VP Ops) confirmed Q3 contract expiry, $300-500K budget. Pain: exception visibility. DM: Brian/CFO/Head of Procurement.','{"parse_quality":"good","summarized_at":"2026-04-19T03:00:00Z"}'::jsonb);

INSERT INTO public.strategy_promotion_proposals (id, user_id, thread_id, source_artifact_id, proposal_type, target_table, target_scope, target_account_id, target_opportunity_id, payload_json, rationale, scope_rationale, dedupe_key, status, confirmed_class, confirmed_by, confirmed_at, detector_version)
VALUES ('ffd00005-0000-0000-0000-000000000005','9f11e308-4028-4527-b7ba-5ea365dc1441','ffd00001-0000-0000-0000-000000000001','ffd00002-0000-0000-0000-000000000002','artifact_promotion','resources','account','6f02951e-becd-4281-85ee-51a30ef24073',NULL,
jsonb_build_object('title','FTD Q2 Business Case','resource_type','business_case','content',E'# FTD Q2 Business Case\n\n## Situation\nFTD is renewing in Q2.\n\n## Ask\n50→200 seats + Insights module.\n\n## Value\n$480K incremental ARR; 6mo payback.\n','is_template',false,'promotion_scope','account'),
'Reusable account-level business case','Account scope','ffd-acct-bizcase-001','confirmed_shared_intelligence','shared_intelligence','9f11e308-4028-4527-b7ba-5ea365dc1441',now(),'manual_proof');

INSERT INTO public.strategy_promotion_proposals (id, user_id, thread_id, source_artifact_id, proposal_type, target_table, target_scope, target_account_id, target_opportunity_id, payload_json, rationale, scope_rationale, dedupe_key, status, confirmed_class, confirmed_by, confirmed_at, detector_version)
VALUES ('ffd00006-0000-0000-0000-000000000006','9f11e308-4028-4527-b7ba-5ea365dc1441','ffd00001-0000-0000-0000-000000000001','ffd00003-0000-0000-0000-000000000003','opportunity_intelligence','opportunity_strategy_memory','opportunity','6f02951e-becd-4281-85ee-51a30ef24073','ed9c0d22-5b18-474a-bdbb-30e192bf5de3',
jsonb_build_object('memory_type','next_steps','content','MAP: 1) Tech validation w/ Brian May 1; 2) Procurement May 8; 3) Legal May 15; 4) Signature May 30','confidence',0.9),
'Opp-specific MAP','Opportunity scope','ffd-opp-map-001','confirmed_shared_intelligence','shared_intelligence','9f11e308-4028-4527-b7ba-5ea365dc1441',now(),'manual_proof');

INSERT INTO public.strategy_promotion_proposals (id, user_id, thread_id, proposal_type, target_table, target_scope, target_account_id, target_opportunity_id, payload_json, rationale, scope_rationale, dedupe_key, status, confirmed_class, confirmed_by, confirmed_at, detector_version)
VALUES ('ffd00007-0000-0000-0000-000000000007','9f11e308-4028-4527-b7ba-5ea365dc1441','ffd00001-0000-0000-0000-000000000001','resource_promotion','resources','account','6f02951e-becd-4281-85ee-51a30ef24073',NULL,
jsonb_build_object('title','FTD Discovery Call Notes (April 18)','resource_type','call_notes','content',E'FTD Discovery Call - April 18\nAttendees: Brian (VP Operations, FTD), AE\n- Q3 contract expiry\n- Pain: exception visibility\n- Budget $300-500K\n- DM: Brian/CFO/Head of Procurement\n- Close end of June\n','is_template',false,'promotion_scope','account','source_upload_id','ffd00004-0000-0000-0000-000000000004'),
'Promote real upload to account-level reference','Account scope discovery notes','ffd-acct-upload-001','confirmed_shared_intelligence','shared_intelligence','9f11e308-4028-4527-b7ba-5ea365dc1441',now(),'manual_proof');

INSERT INTO public.strategy_promotion_proposals (id, user_id, thread_id, proposal_type, target_table, target_scope, target_account_id, target_opportunity_id, payload_json, rationale, scope_rationale, dedupe_key, status, confirmed_class, confirmed_by, confirmed_at, detector_version)
SELECT 'ffd00008-0000-0000-0000-000000000008','9f11e308-4028-4527-b7ba-5ea365dc1441','ffd00001-0000-0000-0000-000000000001','opportunity_intelligence','opportunity_strategy_memory','opportunity','6f02951e-becd-4281-85ee-51a30ef24073',o.id,
jsonb_build_object('memory_type','next_steps','content','MISMATCH TEST'),'Cross-account mismatch test','Intentional mismatch','ffd-mismatch-001','confirmed_shared_intelligence','shared_intelligence','9f11e308-4028-4527-b7ba-5ea365dc1441',now(),'manual_proof'
FROM opportunities o WHERE o.account_id <> '6f02951e-becd-4281-85ee-51a30ef24073' AND o.account_id IS NOT NULL LIMIT 1;
