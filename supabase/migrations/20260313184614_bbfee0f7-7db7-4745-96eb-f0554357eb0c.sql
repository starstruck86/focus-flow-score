
CREATE TABLE public.weekly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  -- Auto-populated metrics
  total_dials integer DEFAULT 0,
  total_conversations integer DEFAULT 0,
  total_meetings_set integer DEFAULT 0,
  total_meetings_held integer DEFAULT 0,
  total_opps_created integer DEFAULT 0,
  total_prospects_added integer DEFAULT 0,
  total_pipeline_moved numeric DEFAULT 0,
  days_logged integer DEFAULT 0,
  days_goal_met integer DEFAULT 0,
  avg_daily_score numeric DEFAULT 0,
  avg_sentiment numeric DEFAULT NULL,
  -- User inputs
  biggest_win text DEFAULT '',
  biggest_failure text DEFAULT '',
  failure_change_plan text DEFAULT '',
  commitment_for_week text DEFAULT '',
  key_goals jsonb DEFAULT '[]'::jsonb,
  key_client_meetings text DEFAULT '',
  skill_development text DEFAULT '',
  north_star_goals jsonb DEFAULT '[]'::jsonb,
  -- Timestamps
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, week_start)
);

ALTER TABLE public.weekly_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own weekly_reviews" ON public.weekly_reviews FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own weekly_reviews" ON public.weekly_reviews FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own weekly_reviews" ON public.weekly_reviews FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Dismissed action plan items
CREATE TABLE public.dismissed_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  record_type text NOT NULL,
  record_id uuid NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  reason text DEFAULT NULL,
  UNIQUE(user_id, record_id)
);

ALTER TABLE public.dismissed_action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dismissed items" ON public.dismissed_action_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own dismissed items" ON public.dismissed_action_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own dismissed items" ON public.dismissed_action_items FOR DELETE TO authenticated USING (auth.uid() = user_id);
