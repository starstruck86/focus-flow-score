
-- 1. Extracted intelligence units table
CREATE TABLE public.intelligence_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  chunk_id uuid,
  unit_type text NOT NULL DEFAULT 'strategy',
  text text NOT NULL,
  category text,
  extraction_version text NOT NULL DEFAULT '1.0',
  extracted_at timestamptz NOT NULL DEFAULT now(),
  extraction_confidence numeric NOT NULL DEFAULT 0.8,
  support_count integer NOT NULL DEFAULT 1,
  source_diversity integer NOT NULL DEFAULT 1,
  consistency_score numeric NOT NULL DEFAULT 0.5,
  idea_maturity text NOT NULL DEFAULT 'experimental',
  conflicts jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.intelligence_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own intelligence_units"
  ON public.intelligence_units FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_intelligence_units_user ON public.intelligence_units(user_id);
CREATE INDEX idx_intelligence_units_resource ON public.intelligence_units(resource_id);
CREATE INDEX idx_intelligence_units_maturity ON public.intelligence_units(idea_maturity);
CREATE INDEX idx_intelligence_units_type ON public.intelligence_units(unit_type);

-- 2. Knowledge signals table for trend detection
CREATE TABLE public.knowledge_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  theme text NOT NULL,
  author_or_speaker text,
  signal_timestamp timestamptz NOT NULL DEFAULT now(),
  confidence numeric NOT NULL DEFAULT 0.7,
  relevance numeric NOT NULL DEFAULT 0.8,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own knowledge_signals"
  ON public.knowledge_signals FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_knowledge_signals_user ON public.knowledge_signals(user_id);
CREATE INDEX idx_knowledge_signals_theme ON public.knowledge_signals(theme);

-- 3. Add metadata columns to resources table
ALTER TABLE public.resources
  ADD COLUMN IF NOT EXISTS source_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS author_or_speaker text,
  ADD COLUMN IF NOT EXISTS date_confidence text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS date_source text;
