
CREATE TABLE public.playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  problem_type text NOT NULL DEFAULT '',
  when_to_use text NOT NULL DEFAULT '',
  why_it_matters text NOT NULL DEFAULT '',
  stage_fit text[] NOT NULL DEFAULT '{}',
  persona_fit text[] NOT NULL DEFAULT '{}',
  tactic_steps text[] NOT NULL DEFAULT '{}',
  talk_tracks text[] NOT NULL DEFAULT '{}',
  key_questions text[] NOT NULL DEFAULT '{}',
  traps text[] NOT NULL DEFAULT '{}',
  anti_patterns text[] NOT NULL DEFAULT '{}',
  confidence_score numeric NOT NULL DEFAULT 0,
  source_resource_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own playbooks"
  ON public.playbooks FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
