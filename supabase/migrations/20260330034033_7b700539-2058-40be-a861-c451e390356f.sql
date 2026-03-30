
CREATE TABLE public.knowledge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_resource_id uuid,
  source_doctrine_id text,
  title text NOT NULL,
  knowledge_type text NOT NULL DEFAULT 'skill',
  chapter text NOT NULL,
  sub_chapter text,
  competitor_name text,
  product_area text,
  applies_to_contexts text[] NOT NULL DEFAULT '{}',
  tactic_summary text,
  why_it_matters text,
  when_to_use text,
  when_not_to_use text,
  example_usage text,
  confidence_score numeric NOT NULL DEFAULT 0.5,
  status text NOT NULL DEFAULT 'extracted',
  active boolean NOT NULL DEFAULT false,
  user_edited boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own knowledge_items" ON public.knowledge_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_knowledge_items_user ON public.knowledge_items(user_id);
CREATE INDEX idx_knowledge_items_chapter ON public.knowledge_items(chapter);
CREATE INDEX idx_knowledge_items_status ON public.knowledge_items(status);
CREATE INDEX idx_knowledge_items_active ON public.knowledge_items(active);
CREATE INDEX idx_knowledge_items_source ON public.knowledge_items(source_resource_id);
