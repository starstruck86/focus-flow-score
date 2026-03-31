
CREATE TABLE public.stage_playbooks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  resource_ids TEXT[] NOT NULL DEFAULT '{}',
  keystone_resource_ids TEXT[] NOT NULL DEFAULT '{}',
  knowledge_item_count INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, stage_id)
);

ALTER TABLE public.stage_playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own stage playbooks"
  ON public.stage_playbooks
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_stage_playbooks_user_stage ON public.stage_playbooks(user_id, stage_id);
