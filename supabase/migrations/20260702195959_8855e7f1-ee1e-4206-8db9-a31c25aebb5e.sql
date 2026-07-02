
ALTER TABLE public.curriculum_gates
  ADD COLUMN IF NOT EXISTS gate_content_status text;

-- ============================================================
-- REWRITES (11) — replace generic/trivia prompts with scenario
-- prompts grounded in each band's drill_ready concept content.
-- ============================================================

-- discovery/agenda_control-1 (AGD01 — Purpose-Plan-Outcome)
UPDATE public.curriculum_gates
SET gate_prompt = 'Mike Chen, VP Product at PixelForge Studios (mobile gaming publisher, three live titles, 22M MAU across the portfolio), joins a 30-minute first discovery call. Camera on, coffee in hand: "Okay — you''ve got 30 minutes. What are we doing?" Open the call and set the agenda so he knows the purpose, the plan for the time, and the outcome you''re driving to — before he starts driving it himself.',
    gate_content_status = 'authored_v1'
WHERE id = 'ab927849-6ba0-4d64-a889-49ad6a2668b4';

-- discovery/problem_identification-1 (PRB01 — Map Problem Trees)
UPDATE public.curriculum_gates
SET gate_prompt = 'Maya Okoro, Ops Lead at TripHive (travel booking app, 8M MAU), thirteen minutes into a discovery call: "Honestly the thing that''s been killing us is our attribution reconciliation — my analyst is manually keying campaign performance numbers from three ad networks into a spreadsheet every Monday, and half of them don''t tie out." Peel that back. Don''t solution — map the problem tree: what''s underneath the symptom, and what does it actually cost her.',
    gate_content_status = 'authored_v1'
WHERE id = 'f10508f1-959b-4abe-9d5d-73c327e6105d';

-- discovery/questioning_fundamentals-1 (QST01 — Problem Mapping Over Perfect Questions)
UPDATE public.curriculum_gates
SET gate_prompt = 'Your manager grabs you five minutes before a first discovery call with the VP Product at LumaWatch (subscription streaming media app, 15M MAU). She says: "I don''t want to see you pull out a canned question list. Walk me through how you''re actually going to drive this discovery." Talk through the operational problems you expect for a mobile streaming app that size, how you''ll connect them up to what her exec team cares about, and the first two questions you''ll actually ask.',
    gate_content_status = 'authored_v1'
WHERE id = '75fff2c6-eecf-447d-aa3b-b92480a11582';

-- discovery/rapport_credibility-1 (RAP01 — Business-Centric Trust Over BS Rapport)
UPDATE public.curriculum_gates
SET gate_prompt = 'Diego Ramos, VP User Acquisition at StayScout (hotel-booking app, 5M MAU), joins your first discovery call. Two days ago he posted on LinkedIn about SKAdNetwork 4.0 gaps and how his team is rethinking iOS measurement. Open the call. No weather, no "did you catch the game." Earn credibility in the first sixty seconds by leading with a business-relevant hook and a question that shows you actually understand what he''s dealing with.',
    gate_content_status = 'authored_v1'
WHERE id = '85b23892-4e3b-4054-8c55-5345ecef3961';

-- discovery/research_intel-1 (RES01 — Account-Based Research Fundamentals)
UPDATE public.curriculum_gates
SET gate_prompt = 'You''re prospecting NovaBank Mobile (a top-25 US retail bank''s consumer mobile app, 9M MAU). Three contacts to work: a Mobile Engineering IC, a Growth PM, and the VP Mobile. Total prep budget: forty-five minutes. Talk through exactly what you''d look at (job posts, LinkedIn, app store, press, competitors on their MMP stack), the hypothesis you''d form about their top priority, and how that hypothesis changes the first line of your outreach to each of the three.',
    gate_content_status = 'authored_v1'
WHERE id = 'c5f167d3-8e17-477e-885c-6d030753d30f';

-- product/deep_linking-1 (C2 — BranchUniversalObject and the deep-link value story)
UPDATE public.curriculum_gates
SET gate_prompt = 'Devansh Patel, Solutions Architect at StreamRise (OTT streaming media app, 12M MAU), is on a technical deep-dive. He pushes back: "Why do I need this BranchUniversalObject thing? We already fire click events on our URLs — can''t we just track those?" Tell the deep-linking value story: what a Branch link actually carries (content + behavior + data), how that data flows from tap through install to attribution, and why representing his content as a BranchUniversalObject unlocks something raw URL clicks never will.',
    gate_content_status = 'authored_v1'
WHERE id = 'cc2789cd-409b-4bfc-9250-09e018f820e6';

-- product/identity-1 (ID01 — setIdentity & User Linking)
UPDATE public.curriculum_gates
SET gate_prompt = 'Anil Rao, iOS Tech Lead at PeakPay (consumer fintech app, 6M MAU), reviews your integration doc and pushes back: "We already log our internal user ID to our own analytics on login. Why would we also call Branch setIdentity? Feels redundant." Explain what setIdentity actually does — how Branch ties its anonymous device/session to his authenticated user — and why that matters for cross-device attribution, LTV rollups by user, and any audience he ever wants to push to a paid channel.',
    gate_content_status = 'authored_v1'
WHERE id = 'b4982fc8-2d3b-4d07-8977-2adc4017491a';

-- product/privacy_security-1 (PS01 — SDK Privacy Controls GDPR/CCPA)
UPDATE public.curriculum_gates
SET gate_prompt = 'Priya Menon, Senior Mobile Engineer at HealthPath (EU-headquartered health & wellness app operating across France and Germany), scoping her Branch rollout: "Our legal team is very clear — we need explicit user consent before any tracking under GDPR. How do we actually configure Branch for that?" Walk her through Branch SDK Privacy Controls: opt-in vs opt-out behavior, which mode fits her situation, exactly which call flips it, and what data stops flowing versus what still works when a user hasn''t consented.',
    gate_content_status = 'authored_v1'
WHERE id = 'abc21382-ae9a-4900-925b-f8bef87b62b6';

-- product/analytics-2 (AN03 — Content Analytics & BUO Events)
UPDATE public.curriculum_gates
SET gate_prompt = 'You''re on a technical eval call with Maya Chen, Director of Growth Engineering at CartLoop (home-goods marketplace app, 2.1M MAU). Her marketing team runs Meta and TikTok campaigns for individual SKUs but can only see aggregate install counts in Branch — not which shared product drove which install or purchase. She asks: "Can Branch actually tell me, per SKU, which shared product drove revenue?" Explain content analytics via BranchUniversalObject events end-to-end: how a BUO is created per product, how you tie standard Branch events (view, purchase) to it, and how that unlocks the per-SKU rollup she''s asking for.',
    gate_content_status = 'authored_v1'
WHERE id = 'd255712a-a1ee-4210-b1f5-792153b0d14e';

-- product/attribution-2 (AT05 — Attribution Windows)
UPDATE public.curriculum_gates
SET gate_prompt = 'You''re on a discrepancy call with Devansh Rao, MMP lead at StreamRise (subscription video app, $2.3M/quarter on Meta). Devansh: "Facebook is claiming installs that happened three weeks after the ad ran. Branch says 8,400 installs from Meta last month, Meta''s dashboard says 14,100. My CFO thinks one of you is lying." Explain what attribution windows are, how click-through vs view-through windows differ, why 30-day click windows and 24-hour view windows are the norm, and how the two dashboards can honestly report different numbers on the same activity. Then tell him exactly where in the Branch dashboard to align windows with Meta''s.',
    gate_content_status = 'authored_v1'
WHERE id = '355a7925-06bd-4561-83f8-d1b6cfbcda16';

-- product/identity-2 (ID02 — Session Lifecycle Management)
UPDATE public.curriculum_gates
SET gate_prompt = 'Solutions call with Priya Kaul, Staff Android engineer at PulseFit (fitness app). Priya: "Our team is seeing intermittent bugs where deep-link params come back empty on cold start. Sometimes we get the right screen, sometimes we drop the user on the home tab. We''re also trying to attribute LTV back to the original install campaign months later and can''t figure out which call to use." Walk her through the Branch session lifecycle end-to-end: when a session starts and ends, what''s in the init callback, and the difference between getLatestReferringParams and getFirstReferringParams — then diagnose which one she should be using for each of her two problems.',
    gate_content_status = 'authored_v1'
WHERE id = '802c2f56-c81e-4f55-b860-f34ae514c422';

-- ============================================================
-- KEPT (14) — already elite, Branch-grounded, matches concept.
-- Stamped 'reviewed_v1' to distinguish from unaudited gates.
-- ============================================================

UPDATE public.curriculum_gates
SET gate_content_status = 'reviewed_v1'
WHERE id IN (
  -- band-1
  '55e1c03e-7d7a-4ef1-8824-b24afdfda873', -- competitive/proactive_positioning-1  (CPP01)
  '0790362b-72d4-4fdb-9a11-1aa1cb5346ee', -- deal_control/business_case-1        (BIZ01)
  'ab10538c-68e9-4e07-9810-7d74159d9495', -- deal_control/deal_qualification-1   (DQL01)
  'fed86562-69cb-4d25-8c52-5ef1939573fb', -- deal_control/next_steps-1           (NXT01/NXT02)
  '14bbd5fd-5f5f-46d6-b2b7-13f5d925d039', -- deal_control/recap_followup-1       (RCP01/RCP02)
  'dd1f113f-4548-4e85-b82c-598d85346d47', -- expansion/earn_the_right-1          (ERX01)
  '620294b7-9a7a-45af-bf22-65bdfcf18491', -- messaging/value_proposition-1       (VPR01)
  'd0e51428-702b-4f64-94bf-562da2cd7f6a', -- objection_handling/objection_frameworks-1 (OBF01)
  '7b68d318-ad35-4812-83af-88a01f21028a', -- qualification/qual_frameworks-1     (QFW01)
  '221c50b6-9d1b-4fea-8e64-d3e33174dcde', -- stakeholder_navigation/champion_identification-1 (CHI01)
  -- band-2 focus
  'bb60181d-a80f-40f1-9d5b-02d06f393a8a', -- deal_control/negotiation-2          (NEG01)
  'bb99c701-3eaf-46ec-a84a-a543b8e753c4', -- deal_control/pricing_anchoring-2    (PRC02)
  '04524a8c-f6ff-421c-af30-27a06dcf8d9e', -- expansion/earn_the_right-2          (ERX02)
  'd1d96fe2-b375-4685-ad87-a03bc33fe199'  -- expansion/qbr_expansion-2           (QBX01)
);
