
CREATE TABLE public.knowledge_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  knowledge_item_id uuid NOT NULL,
  source_resource_id uuid,
  event_type text NOT NULL,
  context_type text,
  chapter text,
  competitor text,
  stage text,
  persona text,
  account_name text,
  session_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own usage logs"
  ON public.knowledge_usage_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own usage logs"
  ON public.knowledge_usage_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_knowledge_usage_item ON public.knowledge_usage_log (knowledge_item_id);
CREATE INDEX idx_knowledge_usage_event ON public.knowledge_usage_log (event_type);
CREATE INDEX idx_knowledge_usage_user ON public.knowledge_usage_log (user_id, created_at DESC);
