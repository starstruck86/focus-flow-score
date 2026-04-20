ALTER TABLE public.strategy_stress_turns
  ADD COLUMN IF NOT EXISTS routing_decision jsonb,
  ADD COLUMN IF NOT EXISTS retrieval_debug jsonb;