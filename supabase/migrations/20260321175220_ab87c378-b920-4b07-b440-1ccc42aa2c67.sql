CREATE TABLE coaching_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  focus_category text NOT NULL,
  target_score numeric NOT NULL,
  start_date date DEFAULT CURRENT_DATE,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE coaching_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own plans" ON coaching_plans
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE resource_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  event_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE resource_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own events" ON resource_usage_events
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());