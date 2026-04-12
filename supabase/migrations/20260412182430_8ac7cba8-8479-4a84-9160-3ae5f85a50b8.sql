ALTER TABLE public.dojo_sessions
  ADD COLUMN IF NOT EXISTS pressure_level text,
  ADD COLUMN IF NOT EXISTS pressure_dimensions text[];