-- Weekly Sales Age snapshots table for trend history
CREATE TABLE public.sales_age_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  week_ending DATE NOT NULL,
  
  -- QPI Components
  qpi_new_logo NUMERIC NOT NULL DEFAULT 0,
  qpi_renewal NUMERIC NOT NULL DEFAULT 0,
  qpi_combined NUMERIC NOT NULL DEFAULT 0,
  
  -- Sales Age derived metrics
  sales_age NUMERIC NOT NULL DEFAULT 45,
  pace_of_aging NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'stable', -- 'improving', 'stable', 'declining'
  
  -- Benchmark data (30D and 6M)
  benchmark_30d_qpi NUMERIC,
  benchmark_6m_qpi NUMERIC,
  
  -- Driver values at time of snapshot
  driver_dials_avg NUMERIC DEFAULT 0,
  driver_connects_avg NUMERIC DEFAULT 0,
  driver_meetings_set_avg NUMERIC DEFAULT 0,
  driver_opps_created_avg NUMERIC DEFAULT 0,
  driver_customer_meetings_avg NUMERIC DEFAULT 0,
  driver_accounts_researched_avg NUMERIC DEFAULT 0,
  driver_contacts_prepped_avg NUMERIC DEFAULT 0,
  
  -- Quota tracking at snapshot time
  new_arr_closed NUMERIC DEFAULT 0,
  new_arr_quota NUMERIC DEFAULT 0,
  renewal_arr_closed NUMERIC DEFAULT 0,
  renewal_arr_quota NUMERIC DEFAULT 0,
  
  -- Projections
  projected_finish_30d NUMERIC,
  projected_finish_6m NUMERIC,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(user_id, week_ending)
);

-- Enable RLS
ALTER TABLE public.sales_age_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own sales_age_snapshots" 
ON public.sales_age_snapshots 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sales_age_snapshots" 
ON public.sales_age_snapshots 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sales_age_snapshots" 
ON public.sales_age_snapshots 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX idx_sales_age_snapshots_user_date ON public.sales_age_snapshots(user_id, week_ending DESC);

-- Quota targets table (persisted quota config)
CREATE TABLE public.quota_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Fiscal period
  fiscal_year_start DATE NOT NULL,
  fiscal_year_end DATE NOT NULL,
  
  -- Quotas
  new_arr_quota NUMERIC NOT NULL DEFAULT 500000,
  renewal_arr_quota NUMERIC NOT NULL DEFAULT 822542,
  
  -- Commission rates
  new_arr_acr NUMERIC NOT NULL DEFAULT 0.0773,
  renewal_arr_acr NUMERIC NOT NULL DEFAULT 0.0157,
  
  -- Activity targets (daily "good day" targets)
  target_dials_per_day NUMERIC DEFAULT 60,
  target_connects_per_day NUMERIC DEFAULT 6,
  target_meetings_set_per_week NUMERIC DEFAULT 3,
  target_opps_created_per_week NUMERIC DEFAULT 1,
  target_customer_meetings_per_week NUMERIC DEFAULT 8,
  target_accounts_researched_per_day NUMERIC DEFAULT 3,
  target_contacts_prepped_per_day NUMERIC DEFAULT 5,
  
  -- QPI weighting (adjustable)
  qpi_new_logo_weight NUMERIC DEFAULT 0.60,
  qpi_renewal_weight NUMERIC DEFAULT 0.40,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.quota_targets ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own quota_targets" 
ON public.quota_targets 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quota_targets" 
ON public.quota_targets 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own quota_targets" 
ON public.quota_targets 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_sales_age_snapshots_updated_at
BEFORE UPDATE ON public.sales_age_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_quota_targets_updated_at
BEFORE UPDATE ON public.quota_targets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();