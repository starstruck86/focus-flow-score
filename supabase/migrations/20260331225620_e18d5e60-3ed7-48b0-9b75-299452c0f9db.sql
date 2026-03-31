
CREATE TABLE public.stage_resources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  stage_id TEXT NOT NULL,
  resource_id UUID NOT NULL,
  is_keystone BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, stage_id, resource_id)
);

ALTER TABLE public.stage_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own stage resources"
  ON public.stage_resources
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_stage_resources_user_stage ON public.stage_resources(user_id, stage_id);
CREATE INDEX idx_stage_resources_resource ON public.stage_resources(resource_id);
