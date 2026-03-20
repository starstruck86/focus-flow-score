CREATE TABLE deal_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  outcome text NOT NULL,
  analysis jsonb NOT NULL DEFAULT '{}',
  patterns_identified text[],
  created_at timestamptz DEFAULT now()
);
ALTER TABLE deal_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own patterns" ON deal_patterns
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());