
-- Source Registry table
CREATE TABLE public.source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  source_type text NOT NULL DEFAULT 'web_article',
  url text,
  external_id text,
  polling_enabled boolean NOT NULL DEFAULT false,
  poll_interval_hours integer NOT NULL DEFAULT 24,
  last_checked_at timestamptz,
  last_successful_sync_at timestamptz,
  trust_weight numeric NOT NULL DEFAULT 1.0,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.source_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own source_registry"
  ON public.source_registry FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Extend resources table for Sales Brain
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS source_registry_id uuid REFERENCES public.source_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS brain_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS dedupe_hash text,
  ADD COLUMN IF NOT EXISTS discovered_at timestamptz DEFAULT now();
