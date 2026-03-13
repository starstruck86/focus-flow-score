
-- WHOOP connections table (stores OAuth tokens securely)
CREATE TABLE public.whoop_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  whoop_user_id text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamp with time zone NOT NULL,
  scopes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique constraint: one connection per user
ALTER TABLE public.whoop_connections ADD CONSTRAINT whoop_connections_user_id_key UNIQUE (user_id);

-- WHOOP daily metrics table
CREATE TABLE public.whoop_daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL,
  recovery_score numeric,
  sleep_score numeric,
  strain_score numeric,
  raw_payload jsonb DEFAULT '{}'::jsonb,
  imported_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique constraint: one record per user per date
ALTER TABLE public.whoop_daily_metrics ADD CONSTRAINT whoop_daily_metrics_user_date_key UNIQUE (user_id, date);

-- Enable RLS
ALTER TABLE public.whoop_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whoop_daily_metrics ENABLE ROW LEVEL SECURITY;

-- RLS policies for whoop_connections
CREATE POLICY "Users can view own whoop_connections" ON public.whoop_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own whoop_connections" ON public.whoop_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own whoop_connections" ON public.whoop_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own whoop_connections" ON public.whoop_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- RLS policies for whoop_daily_metrics
CREATE POLICY "Users can view own whoop_daily_metrics" ON public.whoop_daily_metrics FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own whoop_daily_metrics" ON public.whoop_daily_metrics FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own whoop_daily_metrics" ON public.whoop_daily_metrics FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own whoop_daily_metrics" ON public.whoop_daily_metrics FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Service role policy for edge functions to manage connections
CREATE POLICY "Service role can manage whoop_connections" ON public.whoop_connections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage whoop_daily_metrics" ON public.whoop_daily_metrics FOR ALL USING (true) WITH CHECK (true);
