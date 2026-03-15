
-- Add buyer_role and influence_level to contacts for stakeholder mapping
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS buyer_role text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS influence_level text DEFAULT 'medium';
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS reporting_to text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS ai_discovered boolean DEFAULT false;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS discovery_source text;

-- Create ICP sourced accounts table for prospecting suggestions
CREATE TABLE IF NOT EXISTS public.icp_sourced_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_name text NOT NULL,
  website text,
  industry text,
  employee_count text,
  hq_location text,
  icp_fit_reason text NOT NULL,
  trigger_signal text,
  signal_date text,
  suggested_contacts jsonb DEFAULT '[]'::jsonb,
  linkedin_url text,
  news_snippet text,
  fit_score integer DEFAULT 0,
  status text DEFAULT 'new',
  feedback text,
  promoted_account_id uuid REFERENCES public.accounts(id),
  batch_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.icp_sourced_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sourced accounts"
  ON public.icp_sourced_accounts FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
