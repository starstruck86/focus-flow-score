CREATE TABLE public.playbook_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  playbook_id uuid,
  playbook_title text NOT NULL,
  event_type text NOT NULL DEFAULT 'recommendation_shown',
  context_block_type text,
  context_deal_stage text,
  context_account_id uuid,
  context_opportunity_id uuid,
  feedback_used_approach boolean,
  feedback_what_worked text,
  feedback_what_didnt text,
  feedback_rating smallint,
  roleplay_duration_seconds integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.playbook_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own playbook_usage_events"
  ON public.playbook_usage_events
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_playbook_usage_user_date
  ON public.playbook_usage_events (user_id, created_at DESC);