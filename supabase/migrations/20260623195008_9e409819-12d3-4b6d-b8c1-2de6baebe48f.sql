CREATE TABLE IF NOT EXISTS public.branch_footprint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL,

  deep_linking_status text DEFAULT 'unknown',
  deep_linking_use_case text,

  universal_ads_status text DEFAULT 'unknown',
  universal_ads_use_case text,

  email_to_app_status text DEFAULT 'unknown',
  email_to_app_use_case text,

  sms_to_app_status text DEFAULT 'unknown',
  sms_to_app_use_case text,

  web_to_app_status text DEFAULT 'unknown',
  web_to_app_use_case text,

  qr_status text DEFAULT 'unknown',
  qr_use_case text,

  aio_status text DEFAULT 'unknown',
  aio_use_case text,

  advanced_privacy_status text DEFAULT 'unknown',
  advanced_privacy_use_case text,

  estimated_arr numeric,
  relationship_owner text,
  contract_renewal_date date,
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(account_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_footprint TO authenticated;
GRANT ALL ON public.branch_footprint TO service_role;

ALTER TABLE public.branch_footprint ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own footprint" ON public.branch_footprint
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_branch_footprint_updated_at
  BEFORE UPDATE ON public.branch_footprint
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();