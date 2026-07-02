
UPDATE public.ki_curriculum SET drill_rubric = $j$[
  {"c":"Names BranchUniversalObject and explicitly ties Branch events to it","must":true},
  {"c":"Names contentItems as the linkage field between BranchEvent and the BUO","must":false},
  {"c":"States outcome in merchandising-team terms — per-content / per-SKU attribution, not aggregate installs","must":false},
  {"c":"Ties the data to downstream analytics warehouse and/or ad-platform postbacks","must":false}
]$j$::jsonb
WHERE concept_id='AN03' AND is_exemplar=true;

UPDATE public.ki_curriculum SET drill_rubric = $j$[
  {"c":"Diagnoses view-through window mismatch specifically as the likely cause","must":true},
  {"c":"Points to Branch dashboard → Attribution Windows (per network partner) as where to check","must":false},
  {"c":"Frames aligning windows as step 1 of a longer reconciliation, not the whole answer","must":false}
]$j$::jsonb
WHERE concept_id='AT05' AND is_exemplar=true;

UPDATE public.ki_curriculum SET drill_rubric = $j$[
  {"c":"Explicitly refuses / defers the expansion conversation until the original deployment is closed","must":true},
  {"c":"Commits to a specific fix window (roughly 30 days) with a named return trigger","must":false},
  {"c":"Delivered to the exec in exec register — not routed through the champion, not defensive","must":false}
]$j$::jsonb
WHERE concept_id='ERX02' AND is_exemplar=true;

UPDATE public.ki_curriculum SET drill_rubric = $j$[
  {"c":"Names getLatestReferringParams and getFirstReferringParams and distinguishes their scopes","must":true},
  {"c":"Identifies reading params outside the init callback as the likely cold-start bug","must":false},
  {"c":"Ties getFirstReferringParams to the 90-day install-attribution / LTV question","must":false}
]$j$::jsonb
WHERE concept_id='ID02' AND is_exemplar=true;

UPDATE public.ki_curriculum SET drill_rubric = $j$[
  {"c":"Explicitly refuses to respond ask-by-ask, out loud","must":true},
  {"c":"Requests the full list — terms, price, timeline, paper edits — before reacting","must":false},
  {"c":"Frames the pause as solving the whole picture / trading across asks, not stalling","must":false}
]$j$::jsonb
WHERE concept_id='NEG01' AND is_exemplar=true;

UPDATE public.ki_curriculum SET drill_rubric = $j$[
  {"c":"Names all four levels — Full, Privacy, Analytics Only, No Attribution — with the right behavior for each","must":true},
  {"c":"Diagnoses that Analytics Only (or similar) was set globally last month, making all traffic appear organic","must":false},
  {"c":"Prescribes the per-user pattern: Full for opted-in, Privacy/Analytics Only for GDPR opt-outs, No Attribution for deletion requests","must":false}
]$j$::jsonb
WHERE concept_id='PS02' AND is_exemplar=true;

UPDATE public.ki_curriculum SET drill_rubric = $j$[
  {"c":"Names Deepview and describes it as the branded preview page shown before the App Store redirect","must":true},
  {"c":"Points to Link Settings in the Branch dashboard (title, description, image, CTA) as the configuration location","must":false},
  {"c":"Closes the loop on deferred deep linking — user lands on the exact shared product after install","must":false}
]$j$::jsonb
WHERE concept_id='PU02' AND is_exemplar=true;

UPDATE public.ki_curriculum SET drill_rubric = $j$[
  {"c":"Splits the QBR roughly 50/50 between validation of the original business case and next-problem extraction","must":true},
  {"c":"Frames the first half as: here's what you said you wanted, here's what happened, did we get there","must":false},
  {"c":"Ends on a forward-looking problem-extraction question (what's next / what's keeping you up at night)","must":false}
]$j$::jsonb
WHERE concept_id='QBX01' AND is_exemplar=true;
