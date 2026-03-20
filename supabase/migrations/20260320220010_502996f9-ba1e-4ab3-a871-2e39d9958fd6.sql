
ALTER TABLE transcript_grades
  ADD COLUMN IF NOT EXISTS call_goals_inferred text[],
  ADD COLUMN IF NOT EXISTS goals_achieved jsonb,
  ADD COLUMN IF NOT EXISTS deal_progressed boolean,
  ADD COLUMN IF NOT EXISTS progression_evidence text,
  ADD COLUMN IF NOT EXISTS likelihood_impact text,
  ADD COLUMN IF NOT EXISTS competitors_mentioned text[];

ALTER TABLE call_transcripts
  ADD COLUMN IF NOT EXISTS call_goals text[];
