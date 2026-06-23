CREATE TABLE IF NOT EXISTS public.territory_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  name text,
  role text,
  company text,
  start_date date,
  quota_amount bigint,
  quota_currency text DEFAULT 'USD',
  quota_type text,
  fiscal_year_start date,
  fiscal_year_end date,
  motion text,
  territory_description text,
  company_context text,
  ki_library_summary text,
  se_name text,
  csm_name text,
  manager_name text,
  custom_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.territory_profile TO authenticated;
GRANT ALL ON public.territory_profile TO service_role;

ALTER TABLE public.territory_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own profile" ON public.territory_profile
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_territory_profile_updated_at
  BEFORE UPDATE ON public.territory_profile
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.territory_profile (
  user_id, name, role, company, start_date,
  quota_amount, quota_currency, quota_type,
  fiscal_year_start, fiscal_year_end,
  motion, territory_description, company_context, ki_library_summary, custom_notes
) VALUES (
  '9f11e308-4028-4527-b7ba-5ea365dc1441',
  'Corey Hartin', 'Strategic Account Executive', 'Branch.io', '2026-07-13',
  1400000, 'USD', 'Expansion',
  '2026-07-13', '2027-07-12',
  'Defend and grow — expand existing Branch.io customers. No new logo quota. Every account is an existing Branch customer.',
  '14 enterprise accounts across media/entertainment (A&E Networks, NBC Universal, NBC News, Peacock, Comcast), travel/hospitality (Hilton, Walt Disney Parks), retail (Bath & Body Works, Abercrombie & Fitch, CVS Health, Disney Store), and financial services (Capital One, Discover, Aetna). All Tier A or B accounts. Expansion motion: identify whitespace (sub-entities, new BUs, new products), open expansion conversations, close incremental ARR.',
  'Branch.io is the mobile measurement, deep linking, and attribution platform. Key products: Universal Ads (cross-channel mobile attribution), Deep Linking (app-to-app and web-to-app), Email-to-App, SMS-to-App, Web-to-App, QR Code attribution, AIO (AI-originated discovery attribution), Advanced Privacy & Compliance. Key competitors: Adjust, AppsFlyer, Kochava, Singular. Primary differentiation: the only platform that handles both measurement AND deep linking in one SDK. Branch is the infrastructure layer that connects every digital touchpoint to app engagement.',
  '586 Branch-specific knowledge items across 6 dimensions: product knowledge (335), expansion strategy (77), discovery (57), deal control (40), competitive positioning (37), stakeholder navigation (4). These are structured sales plays designed for Branch expansion selling.',
  'SE and CSM names TBD after Day 1 (July 13, 2026). Update this profile once onboarded.'
) ON CONFLICT (user_id) DO NOTHING;