
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  trace_id text NOT NULL,
  category text NOT NULL,
  message text NOT NULL,
  raw_message text,
  code text,
  source text NOT NULL DEFAULT 'frontend',
  function_name text,
  component_name text,
  route text,
  retryable boolean DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_error_logs_user_id ON public.error_logs(user_id);
CREATE INDEX idx_error_logs_created_at ON public.error_logs(created_at DESC);
CREATE INDEX idx_error_logs_category ON public.error_logs(category);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own error logs"
  ON public.error_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own error logs"
  ON public.error_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
