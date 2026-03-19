ALTER TABLE public.resources ADD COLUMN source_resource_id uuid REFERENCES public.resources(id) ON DELETE SET NULL;

CREATE TABLE public.template_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_resource_id uuid REFERENCES public.resources(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  template_category text NOT NULL,
  suggested_content text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.template_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own suggestions" ON public.template_suggestions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);