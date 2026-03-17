
-- Add rich framework analysis fields to transcript_grades
ALTER TABLE public.transcript_grades
  ADD COLUMN IF NOT EXISTS structure_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cotm_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meddicc_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discovery_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS presence_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commercial_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_step_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS call_segments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cotm_signals jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS meddicc_signals jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS discovery_stats jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS presence_stats jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS missed_opportunities jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suggested_questions jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS behavioral_flags jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS replacement_behavior text,
  ADD COLUMN IF NOT EXISTS coaching_issue text,
  ADD COLUMN IF NOT EXISTS coaching_why text,
  ADD COLUMN IF NOT EXISTS transcript_moment text,
  ADD COLUMN IF NOT EXISTS call_type text;
