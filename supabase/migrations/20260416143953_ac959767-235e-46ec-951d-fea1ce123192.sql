
-- Task templates table (locked templates)
CREATE TABLE public.task_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  use_case TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]',
  formatting_rules JSONB NOT NULL DEFAULT '{}',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own templates"
  ON public.task_templates FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR is_system = true);

CREATE POLICY "Users can insert own templates"
  ON public.task_templates FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own templates"
  ON public.task_templates FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Task runs table (execution instances)
CREATE TABLE public.task_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'discovery_prep',
  template_id UUID REFERENCES public.task_templates(id),
  thread_id UUID,
  inputs JSONB NOT NULL DEFAULT '{}',
  draft_output JSONB,
  review_output JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  account_id UUID,
  opportunity_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.task_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own runs"
  ON public.task_runs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own runs"
  ON public.task_runs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own runs"
  ON public.task_runs FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());
