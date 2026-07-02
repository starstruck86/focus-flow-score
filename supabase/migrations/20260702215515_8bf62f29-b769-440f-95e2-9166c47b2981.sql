UPDATE public.ki_curriculum
SET drill_rubric = '[
  {"c":"Explicitly rejects memorized/canned question lists as the operating model","must":true},
  {"c":"Anchors approach in problem-tree thinking — operational problems that chain to executive impact","must":true},
  {"c":"Provides one concrete worked example of the operational → executive chain","must":false},
  {"c":"Answer stays under 45 seconds and reads as a confident operator, not a rehearsed rep","must":false}
]'::jsonb
WHERE concept_id='QST01';