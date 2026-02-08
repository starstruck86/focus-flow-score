-- Create accounts table
CREATE TABLE public.accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  website TEXT,
  industry TEXT,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  tier TEXT DEFAULT 'B' CHECK (tier IN ('A', 'B', 'C')),
  account_status TEXT DEFAULT 'inactive' CHECK (account_status IN ('inactive', 'researched', 'active', 'meeting-booked', 'disqualified')),
  motion TEXT DEFAULT 'new-logo' CHECK (motion IN ('new-logo', 'renewal', 'general', 'both')),
  salesforce_link TEXT,
  salesforce_id TEXT,
  planhat_link TEXT,
  current_agreement_link TEXT,
  tech_stack TEXT[] DEFAULT '{}',
  tech_stack_notes TEXT,
  tech_fit_flag TEXT DEFAULT 'good' CHECK (tech_fit_flag IN ('good', 'watch', 'disqualify')),
  outreach_status TEXT DEFAULT 'not-started' CHECK (outreach_status IN ('not-started', 'in-progress', 'working', 'nurture', 'meeting-set', 'opp-open', 'closed-won', 'closed-lost')),
  cadence_name TEXT,
  last_touch_date DATE,
  last_touch_type TEXT,
  touches_this_week INTEGER DEFAULT 0,
  next_step TEXT,
  next_touch_due DATE,
  notes TEXT,
  mar_tech TEXT,
  ecommerce TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create contacts table
CREATE TABLE public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  department TEXT,
  seniority TEXT,
  email TEXT,
  linkedin_url TEXT,
  salesforce_link TEXT,
  salesforce_id TEXT,
  status TEXT DEFAULT 'target' CHECK (status IN ('target', 'engaged', 'unresponsive', 'not-fit')),
  last_touch_date DATE,
  preferred_channel TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create opportunities table
CREATE TABLE public.opportunities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  salesforce_link TEXT,
  salesforce_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stalled', 'closed-lost', 'closed-won')),
  stage TEXT DEFAULT '',
  arr NUMERIC,
  churn_risk TEXT CHECK (churn_risk IN ('certain', 'high', 'medium', 'low')),
  close_date DATE,
  next_step TEXT,
  next_step_date DATE,
  last_touch_date DATE,
  notes TEXT,
  deal_type TEXT CHECK (deal_type IN ('new-logo', 'expansion', 'renewal', 'one-time')),
  payment_terms TEXT CHECK (payment_terms IN ('annual', 'prepaid', 'other')),
  term_months INTEGER,
  prior_contract_arr NUMERIC,
  renewal_arr NUMERIC,
  one_time_amount NUMERIC,
  is_new_logo BOOLEAN DEFAULT false,
  linked_renewal_id UUID,
  activity_log JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create renewals table
CREATE TABLE public.renewals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  account_name TEXT NOT NULL,
  csm TEXT,
  arr NUMERIC NOT NULL DEFAULT 0,
  renewal_due DATE NOT NULL,
  renewal_quarter TEXT,
  entitlements TEXT,
  usage TEXT,
  term TEXT,
  planhat_link TEXT,
  current_agreement_link TEXT,
  auto_renew BOOLEAN DEFAULT false,
  product TEXT,
  cs_notes TEXT,
  next_step TEXT,
  health_status TEXT DEFAULT 'green' CHECK (health_status IN ('green', 'yellow', 'red')),
  churn_risk TEXT DEFAULT 'low' CHECK (churn_risk IN ('certain', 'high', 'medium', 'low')),
  linked_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL,
  risk_reason TEXT,
  renewal_stage TEXT,
  owner TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create account_contacts table (for nested contacts in accounts)
CREATE TABLE public.account_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  renewal_id UUID REFERENCES public.renewals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_contacts ENABLE ROW LEVEL SECURITY;

-- Accounts policies
CREATE POLICY "Users can view own accounts" ON public.accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own accounts" ON public.accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own accounts" ON public.accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own accounts" ON public.accounts FOR DELETE USING (auth.uid() = user_id);

-- Contacts policies
CREATE POLICY "Users can view own contacts" ON public.contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contacts" ON public.contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contacts" ON public.contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contacts" ON public.contacts FOR DELETE USING (auth.uid() = user_id);

-- Opportunities policies
CREATE POLICY "Users can view own opportunities" ON public.opportunities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own opportunities" ON public.opportunities FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own opportunities" ON public.opportunities FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own opportunities" ON public.opportunities FOR DELETE USING (auth.uid() = user_id);

-- Renewals policies
CREATE POLICY "Users can view own renewals" ON public.renewals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own renewals" ON public.renewals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own renewals" ON public.renewals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own renewals" ON public.renewals FOR DELETE USING (auth.uid() = user_id);

-- Account contacts policies
CREATE POLICY "Users can view own account_contacts" ON public.account_contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own account_contacts" ON public.account_contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own account_contacts" ON public.account_contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own account_contacts" ON public.account_contacts FOR DELETE USING (auth.uid() = user_id);

-- Create triggers for updated_at
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_opportunities_updated_at BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_renewals_updated_at BEFORE UPDATE ON public.renewals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for common lookups
CREATE INDEX idx_accounts_user_id ON public.accounts(user_id);
CREATE INDEX idx_accounts_salesforce_id ON public.accounts(salesforce_id);
CREATE INDEX idx_accounts_name ON public.accounts(name);
CREATE INDEX idx_contacts_user_id ON public.contacts(user_id);
CREATE INDEX idx_contacts_account_id ON public.contacts(account_id);
CREATE INDEX idx_opportunities_user_id ON public.opportunities(user_id);
CREATE INDEX idx_opportunities_account_id ON public.opportunities(account_id);
CREATE INDEX idx_renewals_user_id ON public.renewals(user_id);
CREATE INDEX idx_renewals_account_id ON public.renewals(account_id);