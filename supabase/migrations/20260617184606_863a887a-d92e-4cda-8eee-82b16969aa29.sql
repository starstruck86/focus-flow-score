
-- 1a. Normalize chapters
UPDATE knowledge_items SET chapter = LOWER(chapter) WHERE chapter != LOWER(chapter);

UPDATE knowledge_items SET chapter = 'cold_calling' WHERE chapter IN ('outbound', 'outbound_strategy', 'cold_emailing', 'prospecting', 'pipeline_generation', 'outbound_culture', 'lead_generation', 'demand_generation', 'creating_demand');
UPDATE knowledge_items SET chapter = 'stakeholder_navigation' WHERE chapter IN ('champion_building', 'champion_enablement', 'multi_threading', 'account_mapping', 'team_selling');
UPDATE knowledge_items SET chapter = 'messaging' WHERE chapter IN ('value_proposition', 'call_opening', 'meeting_strategy', 'meeting_strategies', 'sales_meetings', 'meeting_facilitation', 'meeting_management', 'on_site_meetings', 'in_person_meetings', 'rfp_strategy', 'proposals');
UPDATE knowledge_items SET chapter = 'closing' WHERE chapter IN ('next_steps', 'deal_strategy', 'deal_management', 'deal_inspection', 'deal_reviews', 'pipeline_management', 'pipeline', 'pipeline_patterns', 'pipeline_diagnosis', 'forecasting', 'forecast');
UPDATE knowledge_items SET chapter = 'expansion' WHERE chapter IN ('account_strategy', 'account_planning', 'account_management', 'territory_planning', 'territory_management', 'retention', 'customer_success');

ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS is_core_ae boolean DEFAULT true;
UPDATE knowledge_items SET is_core_ae = false WHERE chapter IN (
  'hiring', 'hiring_top_talent', 'management', 'team_management', 'sdr_management',
  'sales_management', 'sales_leadership', 'leadership', 'recruiting', 'recruitment',
  'compensation', 'marketing', 'developing_people', 'performance_management',
  'career_pathing', 'career_development', 'career_growth', 'sales_career',
  'personal_branding', 'networking', 'sales_enablement', 'enablement',
  'sales_and_marketing_alignment', 'sales_operations', 'strategic_company_partnerships',
  'training', 'onboarding', 'product', 'product_feedback', 'strategy',
  'ai_enablement', 'data_driven_sales', 'people', 'motivation', 'mindset',
  'self_improvement', 'self_development', 'continuous_self_development',
  'personal_development', 'skill_development', 'ongoing_improvement',
  'time_management', 'productivity', 'running_sales_day', 'running_your_sales_day',
  'planning', 'strategic_planning', 'internal_communication', 'process',
  'event_strategy', 'sequencing', 'general', 'sales_process'
);

-- 1b. Spider dimension
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS spider_dimension text;
UPDATE knowledge_items SET spider_dimension = CASE
  WHEN chapter = 'discovery' THEN 'discovery'
  WHEN chapter IN ('cold_calling', 'social_selling') THEN 'cold_outreach'
  WHEN chapter IN ('stakeholder_navigation', 'personas') THEN 'stakeholder_navigation'
  WHEN chapter IN ('messaging', 'demo') THEN 'messaging'
  WHEN chapter IN ('closing', 'negotiation', 'follow_up', 'pipeline_management') THEN 'deal_control'
  WHEN chapter = 'objection_handling' THEN 'objection_handling'
  WHEN chapter IN ('expansion', 'account_strategy') THEN 'account_strategy'
  WHEN chapter IN ('coaching', 'call_coaching') THEN 'coaching'
  ELSE NULL
END
WHERE is_core_ae = true;

-- 1c. ki_mastery
CREATE TABLE IF NOT EXISTS public.ki_mastery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  ki_id uuid REFERENCES public.knowledge_items(id) ON DELETE CASCADE NOT NULL,
  spider_dimension text,
  chapter text,
  times_drilled integer DEFAULT 0,
  avg_score numeric(5,2),
  best_score numeric(5,2),
  last_drilled_at timestamptz,
  first_drilled_at timestamptz,
  execution_score numeric(5,2),
  recognition_score numeric(5,2),
  transcript_evidenced boolean DEFAULT false,
  decay_risk boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, ki_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ki_mastery TO authenticated;
GRANT ALL ON public.ki_mastery TO service_role;

ALTER TABLE public.ki_mastery ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own ki_mastery" ON public.ki_mastery FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS ki_mastery_user_dimension ON public.ki_mastery(user_id, spider_dimension);
CREATE INDEX IF NOT EXISTS ki_mastery_decay ON public.ki_mastery(user_id, decay_risk, last_drilled_at);

CREATE TRIGGER update_ki_mastery_updated_at BEFORE UPDATE ON public.ki_mastery
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 1d. dojo_sessions KI fields
ALTER TABLE public.dojo_sessions ADD COLUMN IF NOT EXISTS ki_source_id uuid REFERENCES public.knowledge_items(id);
ALTER TABLE public.dojo_sessions ADD COLUMN IF NOT EXISTS ki_chapter text;
ALTER TABLE public.dojo_sessions ADD COLUMN IF NOT EXISTS ki_spider_dimension text;
ALTER TABLE public.dojo_sessions ADD COLUMN IF NOT EXISTS ki_ideal_response text;
ALTER TABLE public.dojo_sessions ADD COLUMN IF NOT EXISTS ki_rubric text;
