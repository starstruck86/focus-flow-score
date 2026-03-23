
-- Weekly research queue: one row per user per week
CREATE TABLE public.weekly_research_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  assignments jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

ALTER TABLE public.weekly_research_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own research queue"
  ON public.weekly_research_queue FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Research queue events: one event per state transition
CREATE TABLE public.research_queue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  account_name text NOT NULL,
  week_start date NOT NULL,
  assigned_day text NOT NULL,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_id, week_start, event_type)
);

ALTER TABLE public.research_queue_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own research events"
  ON public.research_queue_events FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add updated_at trigger
CREATE TRIGGER update_weekly_research_queue_updated_at
  BEFORE UPDATE ON public.weekly_research_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
