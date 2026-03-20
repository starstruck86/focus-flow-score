CREATE TABLE custom_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  prompt_text text NOT NULL,
  content_type text DEFAULT 'document',
  variables text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE custom_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own prompts" ON custom_prompts
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS is_screenshot_template boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS screenshot_structure text;