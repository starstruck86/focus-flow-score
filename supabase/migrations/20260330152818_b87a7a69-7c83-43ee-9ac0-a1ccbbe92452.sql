
-- execution_templates table
CREATE TABLE public.execution_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'email',
  output_type TEXT NOT NULL DEFAULT 'custom',
  source_resource_id UUID,
  source_output_id UUID,
  body TEXT NOT NULL DEFAULT '',
  subject_line TEXT,
  structure_json JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  tone TEXT,
  persona TEXT,
  stage TEXT,
  competitor TEXT,
  use_case TEXT,
  is_favorite BOOLEAN DEFAULT false,
  is_pinned BOOLEAN DEFAULT false,
  times_used INTEGER DEFAULT 0,
  times_selected INTEGER DEFAULT 0,
  times_successful INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_by_user BOOLEAN DEFAULT true,
  quality_score NUMERIC,
  confidence_score NUMERIC,
  template_origin TEXT NOT NULL DEFAULT 'uploaded',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.execution_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own execution_templates"
  ON public.execution_templates FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- execution_outputs table
CREATE TABLE public.execution_outputs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  output_type TEXT NOT NULL DEFAULT 'custom',
  content TEXT NOT NULL DEFAULT '',
  subject_line TEXT,
  account_id UUID,
  account_name TEXT,
  opportunity_id UUID,
  stage TEXT,
  persona TEXT,
  competitor TEXT,
  template_id_used UUID REFERENCES public.execution_templates(id),
  reference_resource_ids UUID[] DEFAULT '{}',
  transcript_resource_ids UUID[] DEFAULT '{}',
  custom_instructions TEXT,
  times_reused INTEGER DEFAULT 0,
  is_promoted_to_template BOOLEAN DEFAULT false,
  is_strong_example BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.execution_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own execution_outputs"
  ON public.execution_outputs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_execution_templates_user_output ON public.execution_templates(user_id, output_type);
CREATE INDEX idx_execution_templates_status ON public.execution_templates(user_id, status);
CREATE INDEX idx_execution_outputs_user ON public.execution_outputs(user_id);
CREATE INDEX idx_execution_outputs_type ON public.execution_outputs(user_id, output_type);
