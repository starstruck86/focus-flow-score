CREATE TABLE IF NOT EXISTS public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  account_name text NOT NULL,
  call_date date NOT NULL DEFAULT current_date,
  summary text,
  expansion_signal_captured boolean DEFAULT false,
  expansion_signal_text text,
  next_step text,
  next_step_date date,
  branch_play_used boolean DEFAULT false,
  branch_ki_title text,
  branch_ki_id uuid,
  queue_transcript boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_logs TO authenticated;
GRANT ALL ON public.call_logs TO service_role;

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own call logs" ON public.call_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_call_logs_updated_at
  BEFORE UPDATE ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS call_logs_user_account_idx ON public.call_logs(user_id, account_id, call_date DESC);