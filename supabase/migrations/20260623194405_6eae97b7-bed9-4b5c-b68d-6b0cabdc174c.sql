CREATE TABLE IF NOT EXISTS public.account_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  raw_text text NOT NULL,
  signal_type text NOT NULL CHECK (signal_type IN ('account','competitive','product','market','strategic')),
  intelligence_head text NOT NULL CHECK (intelligence_head IN ('sales','product','competitive','market')),
  linked_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  linked_account_name text,
  source_url text,
  source_label text,
  implications text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_signals TO authenticated;
GRANT ALL ON public.account_signals TO service_role;
ALTER TABLE public.account_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own signals" ON public.account_signals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS account_signals_user_idx ON public.account_signals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_signals_account_idx ON public.account_signals(linked_account_id, created_at DESC);