
CREATE TABLE public.call_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  renewal_id uuid REFERENCES public.renewals(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  content text NOT NULL,
  summary text,
  call_date date NOT NULL DEFAULT CURRENT_DATE,
  call_type text DEFAULT 'Discovery Call',
  participants text,
  tags text[] DEFAULT '{}',
  notes text,
  file_url text,
  duration_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.call_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transcripts" ON public.call_transcripts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transcripts" ON public.call_transcripts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transcripts" ON public.call_transcripts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transcripts" ON public.call_transcripts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_call_transcripts_updated_at
  BEFORE UPDATE ON public.call_transcripts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_call_transcripts_content_search ON public.call_transcripts 
  USING gin(to_tsvector('english', content));

CREATE INDEX idx_call_transcripts_user_id ON public.call_transcripts(user_id);
CREATE INDEX idx_call_transcripts_account_id ON public.call_transcripts(account_id);
CREATE INDEX idx_call_transcripts_opportunity_id ON public.call_transcripts(opportunity_id);
CREATE INDEX idx_call_transcripts_call_date ON public.call_transcripts(call_date DESC);
