
-- Conversion funnel benchmarks for P-Club math engine
CREATE TABLE public.conversion_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dials_to_connect_rate numeric NOT NULL DEFAULT 0.10,
  connect_to_meeting_rate numeric NOT NULL DEFAULT 0.25,
  meeting_to_opp_rate numeric NOT NULL DEFAULT 0.40,
  opp_to_close_rate numeric NOT NULL DEFAULT 0.25,
  avg_new_logo_arr numeric NOT NULL DEFAULT 50000,
  avg_renewal_arr numeric NOT NULL DEFAULT 80000,
  avg_sales_cycle_days integer NOT NULL DEFAULT 90,
  source text NOT NULL DEFAULT 'manual',
  data_points integer NOT NULL DEFAULT 0,
  confidence_level text NOT NULL DEFAULT 'low',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.conversion_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own benchmarks" ON public.conversion_benchmarks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own benchmarks" ON public.conversion_benchmarks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own benchmarks" ON public.conversion_benchmarks
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Pipeline hygiene scan results
CREATE TABLE public.pipeline_hygiene_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scan_date date NOT NULL DEFAULT CURRENT_DATE,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_score integer NOT NULL DEFAULT 0,
  total_issues integer NOT NULL DEFAULT 0,
  critical_issues integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, scan_date)
);

ALTER TABLE public.pipeline_hygiene_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scans" ON public.pipeline_hygiene_scans
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own scans" ON public.pipeline_hygiene_scans
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own scans" ON public.pipeline_hygiene_scans
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Weekly battle plans
CREATE TABLE public.weekly_battle_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  moves jsonb NOT NULL DEFAULT '[]'::jsonb,
  strategy_summary text,
  quota_gap numeric,
  days_remaining integer,
  moves_completed jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, week_start)
);

ALTER TABLE public.weekly_battle_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own battle plans" ON public.weekly_battle_plans
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own battle plans" ON public.weekly_battle_plans
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own battle plans" ON public.weekly_battle_plans
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
