
CREATE TABLE public.daily_digest_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  account_name text NOT NULL,
  digest_date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL DEFAULT 'news',
  headline text NOT NULL,
  summary text,
  source_url text,
  relevance_score numeric DEFAULT 50,
  is_read boolean DEFAULT false,
  is_actionable boolean DEFAULT false,
  suggested_action text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_digest_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own digest items" ON public.daily_digest_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own digest items" ON public.daily_digest_items FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own digest items" ON public.daily_digest_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own digest items" ON public.daily_digest_items FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_digest_items_user_date ON public.daily_digest_items(user_id, digest_date DESC);
CREATE INDEX idx_digest_items_account ON public.daily_digest_items(account_id);
