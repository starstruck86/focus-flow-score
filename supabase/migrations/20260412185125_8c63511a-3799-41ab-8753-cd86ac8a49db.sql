-- Add simulation arc ID to daily assignments
ALTER TABLE public.daily_assignments
ADD COLUMN IF NOT EXISTS simulation_arc_id text;

-- Add a comment for clarity
COMMENT ON COLUMN public.daily_assignments.simulation_arc_id IS 'V5: Links Friday assignments to curated multi-turn simulation arcs';