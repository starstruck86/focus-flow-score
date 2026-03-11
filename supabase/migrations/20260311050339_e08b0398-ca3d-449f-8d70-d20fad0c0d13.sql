
-- Add lifecycle marketing intelligence fields to accounts table
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS direct_ecommerce boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_sms_capture boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS loyalty_membership boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS category_complexity boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mobile_app boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS marketing_platform_detected text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS crm_lifecycle_team_size integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trigger_events jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS icp_fit_score numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS timing_score numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS priority_score numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_tier text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS high_probability_buyer boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS triggered_account boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence_score numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_enriched_at timestamp with time zone DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS enrichment_source_summary text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_override boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lifecycle_override_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS icp_score_override numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tier_override text DEFAULT NULL;
