-- ════════════════════════════════════════════════════════════════
-- Cycle 1 — Strategy OS router + library cards
--   1. library_role on knowledge_items + playbooks
--   2. library_cards (derived tactical layer)
--   3. routing_decisions (router telemetry)
-- ════════════════════════════════════════════════════════════════

-- 1. library_role columns ------------------------------------------------
ALTER TABLE public.knowledge_items
  ADD COLUMN IF NOT EXISTS library_role text
  CHECK (library_role IN ('standard','tactic','pattern','exemplar'));

ALTER TABLE public.playbooks
  ADD COLUMN IF NOT EXISTS library_role text
  CHECK (library_role IN ('standard','tactic','pattern','exemplar'));

CREATE INDEX IF NOT EXISTS idx_ki_role
  ON public.knowledge_items(user_id, library_role)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_pb_role
  ON public.playbooks(user_id, library_role);

-- 2. library_cards -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.library_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('knowledge_item','playbook','transcript')),
  source_ids uuid[] NOT NULL,
  library_role text NOT NULL CHECK (library_role IN ('standard','tactic','pattern','exemplar')),
  title text NOT NULL,
  when_to_use text,
  the_move text NOT NULL,
  why_it_works text,
  anti_patterns text[],
  example_snippet text,
  applies_to_contexts text[],
  confidence numeric,
  derived_at timestamptz NOT NULL DEFAULT now(),
  derivation_version int NOT NULL DEFAULT 1
);

ALTER TABLE public.library_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own cards" ON public.library_cards;
CREATE POLICY "users read own cards"
  ON public.library_cards FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users write own cards" ON public.library_cards;
CREATE POLICY "users write own cards"
  ON public.library_cards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cards_user_role
  ON public.library_cards(user_id, library_role);

CREATE INDEX IF NOT EXISTS idx_cards_contexts
  ON public.library_cards USING gin(applies_to_contexts);

CREATE INDEX IF NOT EXISTS idx_cards_source_ids
  ON public.library_cards USING gin(source_ids);

-- 3. routing_decisions ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.routing_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  thread_id uuid,
  lane text NOT NULL CHECK (lane IN ('direct','assisted','deep_work')),
  signals jsonb NOT NULL,
  override_used text CHECK (override_used IN ('quick','deep','auto')),
  auto_promoted boolean NOT NULL DEFAULT false,
  downgrade_warning boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.routing_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own decisions" ON public.routing_decisions;
CREATE POLICY "users read own decisions"
  ON public.routing_decisions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users insert own decisions" ON public.routing_decisions;
CREATE POLICY "users insert own decisions"
  ON public.routing_decisions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_routing_user_time
  ON public.routing_decisions(user_id, created_at DESC);