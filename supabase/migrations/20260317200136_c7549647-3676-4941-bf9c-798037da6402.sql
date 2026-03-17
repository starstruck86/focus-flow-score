
CREATE TABLE public.opportunity_methodology (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  
  -- MEDDICC fields (boolean + notes)
  metrics_confirmed boolean NOT NULL DEFAULT false,
  metrics_notes text DEFAULT '',
  economic_buyer_confirmed boolean NOT NULL DEFAULT false,
  economic_buyer_notes text DEFAULT '',
  decision_criteria_confirmed boolean NOT NULL DEFAULT false,
  decision_criteria_notes text DEFAULT '',
  decision_process_confirmed boolean NOT NULL DEFAULT false,
  decision_process_notes text DEFAULT '',
  identify_pain_confirmed boolean NOT NULL DEFAULT false,
  identify_pain_notes text DEFAULT '',
  champion_confirmed boolean NOT NULL DEFAULT false,
  champion_notes text DEFAULT '',
  competition_confirmed boolean NOT NULL DEFAULT false,
  competition_notes text DEFAULT '',
  
  -- Command of the Message fields
  before_state_notes text DEFAULT '',
  after_state_notes text DEFAULT '',
  negative_consequences_notes text DEFAULT '',
  positive_business_outcomes_notes text DEFAULT '',
  required_capabilities_notes text DEFAULT '',
  metrics_value_notes text DEFAULT '',
  
  -- Pre-call goals
  call_goals jsonb DEFAULT '[]'::jsonb,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(user_id, opportunity_id)
);

ALTER TABLE public.opportunity_methodology ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own methodology" ON public.opportunity_methodology FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own methodology" ON public.opportunity_methodology FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own methodology" ON public.opportunity_methodology FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own methodology" ON public.opportunity_methodology FOR DELETE TO authenticated USING (auth.uid() = user_id);
