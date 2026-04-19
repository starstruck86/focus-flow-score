
-- Create real strategy artifact + upload source rows on the clean FTD thread
-- (these represent normal Strategy "thinking" outputs — not shared truth).
-- We will then drive the FULL real edge chain: stage-proposal → class-confirm → promote-proposal.

INSERT INTO public.strategy_artifacts (
  id, user_id, thread_id, artifact_type, title, content_json, rendered_text,
  linked_account_id, version
) VALUES (
  '77777777-aaaa-bbbb-cccc-100000000001',
  '9f11e308-4028-4527-b7ba-5ea365dc1441',
  '22222222-aaaa-bbbb-cccc-200000000001',
  'business_case',
  'FTD Renewal — Real Live-Edge Business Case',
  '{"sections":["Executive Summary","Renewal Risk","Expansion Levers"]}'::jsonb,
  E'# FTD Renewal — Business Case\n\nFTD, Inc. is in renewal cycle. This document is a real strategy artifact created through the normal artifact path on a clean, account-linked thread. It will be staged and promoted via the live edge functions to prove the positive workflow end-to-end.\n\n## Executive Summary\nFTD has used the platform for 18 months with strong adoption in the floral-marketing motion. Renewal target: $X. Risks: economic softness in retail floral. Expansion levers: SMS attach, loyalty.\n\n## Recommendation\nLock multi-year with expansion attach in Q3.',
  '6f02951e-becd-4281-85ee-51a30ef24073',
  1
);

INSERT INTO public.strategy_uploaded_resources (
  id, user_id, thread_id, file_name, file_type, storage_path, parsed_text, summary,
  metadata_json
) VALUES (
  '88888888-aaaa-bbbb-cccc-100000000001',
  '9f11e308-4028-4527-b7ba-5ea365dc1441',
  '22222222-aaaa-bbbb-cccc-200000000001',
  'FTD-stakeholder-map-real.txt',
  'text/plain',
  '9f11e308-4028-4527-b7ba-5ea365dc1441/22222222-aaaa-bbbb-cccc-200000000001/real-upload.txt',
  E'FTD STAKEHOLDER MAP (real upload for live-edge proof)\n\nEconomic Buyer: VP Marketing\nChampion: Director of CRM\nTechnical Buyer: Head of MarTech\nProcurement: Sourcing Lead\n\nNext steps: confirm exec sponsor, schedule renewal-readout.',
  E'Stakeholder map for FTD renewal cycle. Identifies four key personas across the buying committee.',
  '{"parse_quality":"good"}'::jsonb
);
