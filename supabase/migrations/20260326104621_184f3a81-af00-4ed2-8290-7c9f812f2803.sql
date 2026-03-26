ALTER TABLE public.playbooks
  ADD COLUMN IF NOT EXISTS deal_impact text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pressure_tactics text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS failure_consequences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS minimum_effective_version text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS what_great_looks_like text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS common_mistakes text[] NOT NULL DEFAULT '{}';