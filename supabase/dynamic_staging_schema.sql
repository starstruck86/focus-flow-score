-- dynamic-staging schema export generated from Lovable project 2750cde7-6277-4433-9311-204bcc16e1d1 on 2026-07-09.
-- Schema only. The only copied table data is public.function_configs.
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;
SET search_path = public, extensions, pg_catalog;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Table: public._agent_staging
CREATE TABLE IF NOT EXISTS public._agent_staging (
  job text NOT NULL,
  row_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.account_contacts
CREATE TABLE IF NOT EXISTS public.account_contacts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid,
  renewal_id uuid,
  name text NOT NULL,
  title text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  source_proposal_id uuid,
  source text,
  source_strategy_thread_id uuid,
  promoted_by uuid,
  promoted_at timestamp with time zone
);

-- Table: public.account_dossiers
CREATE TABLE IF NOT EXISTS public.account_dossiers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  content_md text NOT NULL,
  rendered_by text DEFAULT 'operator:claude'::text NOT NULL,
  is_current boolean DEFAULT true NOT NULL,
  rendered_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.account_product_ownership
CREATE TABLE IF NOT EXISTS public.account_product_ownership (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  product_id uuid NOT NULL,
  owned boolean DEFAULT true NOT NULL,
  noted_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.account_project_settings
CREATE TABLE IF NOT EXISTS public.account_project_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_family text NOT NULL,
  custom_instructions text DEFAULT ''::text NOT NULL,
  pinned boolean DEFAULT false NOT NULL,
  order_index bigint,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.account_risks
CREATE TABLE IF NOT EXISTS public.account_risks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  risk_type text NOT NULL,
  surface text,
  competitor text,
  severity integer,
  likelihood integer,
  status text DEFAULT 'identified'::text NOT NULL,
  competitor_renewal_date date,
  rationale text,
  source_ref text,
  observed_at timestamp with time zone DEFAULT now() NOT NULL,
  bound_play_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.account_signals
CREATE TABLE IF NOT EXISTS public.account_signals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  raw_text text NOT NULL,
  signal_type text NOT NULL,
  intelligence_head text NOT NULL,
  linked_account_id uuid,
  linked_account_name text,
  source_url text,
  source_label text,
  implications text,
  created_at timestamp with time zone DEFAULT now(),
  observed_at date,
  signal_class text
);

-- Table: public.account_strategy_memory
CREATE TABLE IF NOT EXISTS public.account_strategy_memory (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  memory_type text DEFAULT 'fact'::text NOT NULL,
  content text NOT NULL,
  confidence numeric,
  source_thread_id uuid,
  source_message_id uuid,
  is_pinned boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  is_irrelevant boolean DEFAULT false NOT NULL,
  source_proposal_id uuid
);

-- Table: public.accounts
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  website text,
  industry text,
  priority text DEFAULT 'medium'::text,
  tier text DEFAULT 'B'::text,
  account_status text DEFAULT 'inactive'::text,
  motion text DEFAULT 'new-logo'::text,
  salesforce_link text,
  salesforce_id text,
  planhat_link text,
  current_agreement_link text,
  tech_stack text[] DEFAULT '{}'::text[],
  tech_stack_notes text,
  tech_fit_flag text DEFAULT 'good'::text,
  outreach_status text DEFAULT 'not-started'::text,
  cadence_name text,
  last_touch_date date,
  last_touch_type text,
  touches_this_week integer DEFAULT 0,
  next_step text,
  next_touch_due date,
  notes text,
  mar_tech text,
  ecommerce text,
  tags text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  contact_status text DEFAULT 'not-started'::text,
  direct_ecommerce boolean,
  email_sms_capture boolean,
  loyalty_membership boolean,
  category_complexity boolean,
  mobile_app boolean,
  marketing_platform_detected text,
  crm_lifecycle_team_size integer,
  trigger_events jsonb DEFAULT '[]'::jsonb,
  icp_fit_score numeric,
  timing_score numeric,
  priority_score numeric,
  lifecycle_tier text,
  high_probability_buyer boolean DEFAULT false,
  triggered_account boolean DEFAULT false,
  confidence_score numeric,
  last_enriched_at timestamp with time zone,
  enrichment_source_summary text,
  lifecycle_override boolean DEFAULT false,
  lifecycle_override_reason text,
  icp_score_override numeric,
  tier_override text,
  enrichment_evidence jsonb DEFAULT '{}'::jsonb,
  deleted_at timestamp with time zone,
  parent_account_id uuid,
  account_family text,
  last_reviewed_at timestamp with time zone,
  aliases text[] DEFAULT '{}'::text[],
  vertical_id uuid
);

-- Table: public.agent_configs
CREATE TABLE IF NOT EXISTS public.agent_configs (
  agent text NOT NULL,
  user_id uuid NOT NULL,
  caste text NOT NULL,
  home text NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  schedule text,
  model text,
  prompt text,
  budget_note text,
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.agent_events
CREATE TABLE IF NOT EXISTS public.agent_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  agent text NOT NULL,
  event_type text NOT NULL,
  account_id uuid,
  payload jsonb DEFAULT '{}'::jsonb,
  so_what text NOT NULL,
  signal_class text,
  confidence numeric,
  status text DEFAULT 'proposed'::text NOT NULL,
  lease_until timestamp with time zone,
  provenance jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone
);

-- Table: public.agent_trust
CREATE TABLE IF NOT EXISTS public.agent_trust (
  agent text NOT NULL,
  user_id uuid NOT NULL,
  ratified_count integer DEFAULT 0 NOT NULL,
  rejected_count integer DEFAULT 0 NOT NULL,
  trust_score numeric DEFAULT 0.5 NOT NULL,
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.ai_feedback
CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  feature text NOT NULL,
  context_date date,
  rating integer,
  feedback_text text,
  ai_suggestion_summary text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.approved_users
CREATE TABLE IF NOT EXISTS public.approved_users (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  user_id uuid,
  role text DEFAULT 'user'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  approved_at timestamp with time zone DEFAULT now() NOT NULL,
  approved_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.asset_provenance
CREATE TABLE IF NOT EXISTS public.asset_provenance (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  asset_type text NOT NULL,
  asset_id text NOT NULL,
  source_resource_id text NOT NULL,
  source_segment_index integer,
  source_char_range jsonb,
  source_heading text,
  transformed_content text,
  removed_lines jsonb DEFAULT '[]'::jsonb,
  high_risk_removals jsonb DEFAULT '[]'::jsonb,
  original_content text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.audio_jobs
CREATE TABLE IF NOT EXISTS public.audio_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  source_url text,
  resolved_audio_url text,
  audio_subtype text DEFAULT 'direct_audio_file'::text NOT NULL,
  stage text DEFAULT 'queued'::text NOT NULL,
  failure_code text,
  failure_reason text,
  retryable boolean DEFAULT true NOT NULL,
  recommended_action text,
  attempts_count integer DEFAULT 0 NOT NULL,
  last_attempted_stage text,
  transcript_text text,
  transcript_segments jsonb DEFAULT '[]'::jsonb,
  transcript_quality text,
  transcript_word_count integer,
  has_transcript boolean DEFAULT false NOT NULL,
  provider_job_ids jsonb DEFAULT '[]'::jsonb,
  chunk_metadata jsonb DEFAULT '[]'::jsonb,
  quality_result jsonb,
  last_successful_stage text,
  provider_used text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  platform_source_type text,
  source_episode_id text,
  source_show_id text,
  canonical_episode_url text,
  rss_feed_url text,
  transcript_source_url text,
  metadata_json jsonb DEFAULT '{}'::jsonb,
  resolver_attempts integer DEFAULT 0,
  last_resolution_stage text,
  transcript_mode text DEFAULT 'direct_transcription'::text,
  final_resolution_status text
);

-- Table: public.background_jobs
CREATE TABLE IF NOT EXISTS public.background_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,
  entity_id text,
  title text NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  substatus text,
  progress_mode text DEFAULT 'indeterminate'::text,
  progress_current integer DEFAULT 0,
  progress_total integer DEFAULT 0,
  progress_percent integer,
  step_label text,
  error text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  started_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);

-- Table: public.badges_earned
CREATE TABLE IF NOT EXISTS public.badges_earned (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  badge_type text NOT NULL,
  badge_name text NOT NULL,
  earned_at timestamp with time zone DEFAULT now() NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  user_id uuid
);

-- Table: public.batch_run_jobs
CREATE TABLE IF NOT EXISTS public.batch_run_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_run_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  resource_title text,
  source_type text DEFAULT 'unknown'::text,
  final_status text DEFAULT 'queued'::text NOT NULL,
  failure_reason text,
  attempts jsonb DEFAULT '[]'::jsonb,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  method_used text,
  content_length_extracted integer,
  quality_passed boolean
);

-- Table: public.batch_runs
CREATE TABLE IF NOT EXISTS public.batch_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  action_type text DEFAULT 'pipeline'::text NOT NULL,
  batch_size integer DEFAULT 15 NOT NULL,
  concurrency integer DEFAULT 3 NOT NULL,
  total_resources integer DEFAULT 0 NOT NULL,
  succeeded integer DEFAULT 0 NOT NULL,
  failed integer DEFAULT 0 NOT NULL,
  skipped integer DEFAULT 0 NOT NULL,
  cancelled boolean DEFAULT false NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.block_snapshots
CREATE TABLE IF NOT EXISTS public.block_snapshots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  block_id uuid NOT NULL,
  snapshot_type text NOT NULL,
  week_number integer NOT NULL,
  scores_by_anchor jsonb DEFAULT '{}'::jsonb NOT NULL,
  mistakes_active text[] DEFAULT '{}'::text[],
  mistakes_resolved text[] DEFAULT '{}'::text[],
  stage text DEFAULT 'foundation'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.branch_footprint
CREATE TABLE IF NOT EXISTS public.branch_footprint (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  deep_linking_status text DEFAULT 'unknown'::text,
  deep_linking_use_case text,
  universal_ads_status text DEFAULT 'unknown'::text,
  universal_ads_use_case text,
  email_to_app_status text DEFAULT 'unknown'::text,
  email_to_app_use_case text,
  sms_to_app_status text DEFAULT 'unknown'::text,
  sms_to_app_use_case text,
  web_to_app_status text DEFAULT 'unknown'::text,
  web_to_app_use_case text,
  qr_status text DEFAULT 'unknown'::text,
  qr_use_case text,
  aio_status text DEFAULT 'unknown'::text,
  aio_use_case text,
  advanced_privacy_status text DEFAULT 'unknown'::text,
  advanced_privacy_use_case text,
  estimated_arr numeric,
  relationship_owner text,
  contract_renewal_date date,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.branch_pov
CREATE TABLE IF NOT EXISTS public.branch_pov (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  surface text NOT NULL,
  target_status text NOT NULL,
  conviction integer NOT NULL,
  rationale text,
  evidence jsonb DEFAULT '[]'::jsonb,
  sequence_rank integer,
  version integer DEFAULT 1 NOT NULL,
  ratified boolean DEFAULT false NOT NULL,
  ratified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.calendar_events
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  external_id text NOT NULL,
  title text NOT NULL,
  description text,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone,
  location text,
  all_day boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid
);

-- Table: public.call_logs
CREATE TABLE IF NOT EXISTS public.call_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid,
  account_name text NOT NULL,
  call_date date DEFAULT CURRENT_DATE NOT NULL,
  summary text,
  expansion_signal_captured boolean DEFAULT false,
  expansion_signal_text text,
  next_step text,
  next_step_date date,
  branch_play_used boolean DEFAULT false,
  branch_ki_title text,
  branch_ki_id uuid,
  queue_transcript boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  contact_name text,
  nba_situation text,
  nba_text text,
  nba_ki_titles text[]
);

-- Table: public.call_transcripts
CREATE TABLE IF NOT EXISTS public.call_transcripts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  opportunity_id uuid,
  renewal_id uuid,
  account_id uuid,
  title text DEFAULT ''::text NOT NULL,
  content text NOT NULL,
  summary text,
  call_date date DEFAULT CURRENT_DATE NOT NULL,
  call_type text DEFAULT 'Discovery Call'::text,
  participants text,
  tags text[] DEFAULT '{}'::text[],
  notes text,
  file_url text,
  duration_minutes integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  call_goals text[],
  source text,
  source_strategy_thread_id uuid,
  source_proposal_id uuid,
  promoted_at timestamp with time zone,
  promoted_by uuid,
  archived_at timestamp with time zone
);

-- Table: public.canary_reviews
CREATE TABLE IF NOT EXISTS public.canary_reviews (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  raw_input text NOT NULL,
  parsed_json jsonb NOT NULL,
  evidence_summary jsonb NOT NULL,
  recommendation text NOT NULL,
  decision text NOT NULL,
  decision_notes text,
  flag_state jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.circle_credentials
CREATE TABLE IF NOT EXISTS public.circle_credentials (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  community_host text,
  session_cookie text NOT NULL,
  cookie_name text DEFAULT '_circle_session'::text NOT NULL,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.closed_loop_sessions
CREATE TABLE IF NOT EXISTS public.closed_loop_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  skill text NOT NULL,
  sub_skill text,
  focus_pattern text,
  taught_concept text NOT NULL,
  taught_at timestamp with time zone DEFAULT now() NOT NULL,
  attempts jsonb DEFAULT '[]'::jsonb NOT NULL,
  latest_verification jsonb,
  status text DEFAULT 'teaching'::text NOT NULL,
  next_step text,
  routed_to_review boolean DEFAULT false NOT NULL,
  routed_to_skill_builder boolean DEFAULT false NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.cluster_resolutions
CREATE TABLE IF NOT EXISTS public.cluster_resolutions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  cluster_id text NOT NULL,
  canonical_resource_id text,
  canonical_role text NOT NULL,
  reasoning text NOT NULL,
  demoted_members jsonb DEFAULT '[]'::jsonb NOT NULL,
  resolved_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_by uuid NOT NULL
);

-- Table: public.coaching_plans
CREATE TABLE IF NOT EXISTS public.coaching_plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  focus_category text NOT NULL,
  target_score numeric NOT NULL,
  start_date date DEFAULT CURRENT_DATE,
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.command_feedback
CREATE TABLE IF NOT EXISTS public.command_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  template_id text,
  template_name text,
  account_id uuid,
  signal_type text NOT NULL,
  section_heading text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.command_shortcuts
CREATE TABLE IF NOT EXISTS public.command_shortcuts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  label text NOT NULL,
  raw_command text NOT NULL,
  template_id text,
  template_name text,
  account_id uuid,
  account_name text,
  opportunity_id uuid,
  opportunity_name text,
  free_text text,
  is_pinned boolean DEFAULT false NOT NULL,
  times_used integer DEFAULT 0 NOT NULL,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.contacts
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid,
  name text NOT NULL,
  title text,
  department text,
  seniority text,
  email text,
  linkedin_url text,
  salesforce_link text,
  salesforce_id text,
  status text DEFAULT 'target'::text,
  last_touch_date date,
  preferred_channel text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  buyer_role text,
  influence_level text DEFAULT 'medium'::text,
  reporting_to text,
  ai_discovered boolean DEFAULT false,
  discovery_source text,
  source text,
  source_strategy_thread_id uuid,
  source_proposal_id uuid,
  promoted_at timestamp with time zone,
  promoted_by uuid,
  interview_role text,
  met_on date,
  impression text,
  key_concerns text
);

-- Table: public.conversion_benchmarks
CREATE TABLE IF NOT EXISTS public.conversion_benchmarks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  dials_to_connect_rate numeric DEFAULT 0.10 NOT NULL,
  connect_to_meeting_rate numeric DEFAULT 0.25 NOT NULL,
  meeting_to_opp_rate numeric DEFAULT 0.40 NOT NULL,
  opp_to_close_rate numeric DEFAULT 0.25 NOT NULL,
  avg_new_logo_arr numeric DEFAULT 50000 NOT NULL,
  avg_renewal_arr numeric DEFAULT 80000 NOT NULL,
  avg_sales_cycle_days integer DEFAULT 90 NOT NULL,
  source text DEFAULT 'manual'::text NOT NULL,
  data_points integer DEFAULT 0 NOT NULL,
  confidence_level text DEFAULT 'low'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.course_imports
CREATE TABLE IF NOT EXISTS public.course_imports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  course_name text NOT NULL,
  course_authors text,
  course_platform text,
  course_url text,
  course_category text,
  primary_use_case text,
  notes text,
  status text DEFAULT 'draft'::text NOT NULL,
  source_registry_id uuid,
  ready_at timestamp with time zone,
  processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.course_lesson_imports
CREATE TABLE IF NOT EXISTS public.course_lesson_imports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  resource_id uuid,
  original_course_url text NOT NULL,
  lesson_url text NOT NULL,
  course_title text,
  platform text,
  module_name text,
  lesson_index integer,
  lesson_type text,
  source_lesson_title text,
  import_status text DEFAULT 'queued'::text NOT NULL,
  import_substatus text,
  import_error text,
  provider_video_url text,
  provider_video_type text,
  transcript_status text,
  transcript_text text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  transcript_word_count integer,
  transcript_completed_at timestamp with time zone,
  transcript_source text
);

-- Table: public.course_lessons
CREATE TABLE IF NOT EXISTS public.course_lessons (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  course_import_id uuid NOT NULL,
  lesson_number integer,
  lesson_name text,
  section_name text,
  lesson_url text,
  transcript_text text,
  lesson_text text,
  resource_links jsonb DEFAULT '[]'::jsonb NOT NULL,
  attachment_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
  user_notes text,
  raw_source_text text,
  status text DEFAULT 'draft'::text NOT NULL,
  source_status text DEFAULT 'not_processed'::text NOT NULL,
  missing_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
  resource_id uuid,
  processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.curriculum_concepts
CREATE TABLE IF NOT EXISTS public.curriculum_concepts (
  concept_id text NOT NULL,
  spoke text NOT NULL,
  topic text NOT NULL,
  band smallint NOT NULL,
  sub_level text NOT NULL,
  order_in_sublevel smallint NOT NULL,
  title text NOT NULL,
  teach_kind text NOT NULL,
  exemplar_ki_id uuid,
  teach_beat_status text DEFAULT 'ready'::text NOT NULL,
  teach_beat_ref text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  teach_beat_md text,
  drill_prompt text,
  model_line_plain text,
  gate_elite text,
  lesson_md text,
  lesson_authored_at timestamp with time zone
);

-- Table: public.curriculum_gates
CREATE TABLE IF NOT EXISTS public.curriculum_gates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  spoke text NOT NULL,
  topic text NOT NULL,
  band smallint NOT NULL,
  gate_prompt text NOT NULL,
  pass_threshold numeric DEFAULT 85 NOT NULL,
  item_strategy text DEFAULT 'band_exemplars'::text NOT NULL,
  promotes_to smallint,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  gate_content_status text
);

-- Table: public.custom_prompts
CREATE TABLE IF NOT EXISTS public.custom_prompts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  prompt_text text NOT NULL,
  content_type text DEFAULT 'document'::text,
  variables text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.daily_assignments
CREATE TABLE IF NOT EXISTS public.daily_assignments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  assignment_date date NOT NULL,
  block_id uuid NOT NULL,
  block_week integer NOT NULL,
  block_phase text NOT NULL,
  day_anchor text NOT NULL,
  primary_skill text NOT NULL,
  focus_pattern text NOT NULL,
  kis jsonb DEFAULT '[]'::jsonb NOT NULL,
  scenarios jsonb DEFAULT '[]'::jsonb NOT NULL,
  difficulty text DEFAULT 'intermediate'::text NOT NULL,
  retry_strategy text DEFAULT 'weakest'::text NOT NULL,
  transcript_scenario_used boolean DEFAULT false NOT NULL,
  benchmark_tag boolean DEFAULT false NOT NULL,
  scenario_family_id text,
  reason text DEFAULT ''::text NOT NULL,
  source text DEFAULT 'weakness'::text NOT NULL,
  completed boolean DEFAULT false NOT NULL,
  session_ids uuid[] DEFAULT '{}'::uuid[],
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  simulation_arc_id text
);

-- Table: public.daily_digest_items
CREATE TABLE IF NOT EXISTS public.daily_digest_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid,
  account_name text NOT NULL,
  digest_date date DEFAULT CURRENT_DATE NOT NULL,
  category text DEFAULT 'news'::text NOT NULL,
  headline text NOT NULL,
  summary text,
  source_url text,
  relevance_score numeric DEFAULT 50,
  is_read boolean DEFAULT false,
  is_actionable boolean DEFAULT false,
  suggested_action text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.daily_journal_entries
CREATE TABLE IF NOT EXISTS public.daily_journal_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  date date NOT NULL,
  dials integer DEFAULT 0 NOT NULL,
  conversations integer DEFAULT 0 NOT NULL,
  prospects_added integer DEFAULT 0 NOT NULL,
  manager_plus_messages integer DEFAULT 0 NOT NULL,
  manual_emails integer DEFAULT 0 NOT NULL,
  automated_emails integer DEFAULT 0 NOT NULL,
  meetings_set integer DEFAULT 0 NOT NULL,
  customer_meetings_held integer DEFAULT 0 NOT NULL,
  opportunities_created integer DEFAULT 0 NOT NULL,
  personal_development boolean DEFAULT false NOT NULL,
  prospecting_block_minutes integer DEFAULT 0 NOT NULL,
  account_deep_work_minutes integer DEFAULT 0 NOT NULL,
  expansion_touchpoints integer DEFAULT 0 NOT NULL,
  focus_mode text DEFAULT 'balanced'::text NOT NULL,
  accounts_researched integer DEFAULT 0 NOT NULL,
  contacts_prepped integer DEFAULT 0 NOT NULL,
  prepped_for_all_calls_tomorrow boolean,
  calls_need_prep_count integer DEFAULT 0,
  calls_prep_note text,
  meeting_prep_done boolean,
  meetings_unprepared_for boolean,
  meetings_unprepared_note text,
  sleep_hours numeric(3,1) DEFAULT NULL::numeric,
  energy integer,
  focus_quality integer,
  stress integer,
  clarity integer,
  distractions text DEFAULT 'low'::text,
  context_switching text DEFAULT 'low'::text,
  admin_heavy_day boolean DEFAULT false NOT NULL,
  travel_day boolean DEFAULT false NOT NULL,
  what_drained_you text,
  what_worked_today text,
  daily_score integer,
  sales_strain numeric(4,1) DEFAULT NULL::numeric,
  sales_recovery integer,
  sales_productivity integer,
  goal_met boolean DEFAULT false NOT NULL,
  checked_in boolean DEFAULT false NOT NULL,
  check_in_timestamp timestamp with time zone,
  confirmed boolean DEFAULT false NOT NULL,
  confirmation_timestamp timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  workday_start_time timestamp with time zone,
  workday_end_time timestamp with time zone,
  workday_focus text,
  first_call_time timestamp with time zone,
  first_call_logged boolean DEFAULT false,
  pipeline_moved numeric DEFAULT 0,
  biggest_blocker text,
  tomorrow_priority text,
  daily_reflection text,
  sentiment_score numeric,
  sentiment_label text,
  yesterday_commitment_met boolean,
  distracted_minutes integer DEFAULT 0,
  phone_pickups integer DEFAULT 0,
  focus_score numeric,
  focus_label text,
  accountability_habits jsonb DEFAULT '{}'::jsonb
);

-- Table: public.daily_plan_preferences
CREATE TABLE IF NOT EXISTS public.daily_plan_preferences (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  work_start_time time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
  work_end_time time without time zone DEFAULT '17:00:00'::time without time zone NOT NULL,
  no_meetings_before time without time zone DEFAULT '09:00:00'::time without time zone,
  no_meetings_after time without time zone DEFAULT '17:00:00'::time without time zone,
  lunch_start time without time zone DEFAULT '12:00:00'::time without time zone,
  lunch_end time without time zone DEFAULT '13:00:00'::time without time zone,
  min_block_minutes integer DEFAULT 25 NOT NULL,
  prefer_new_logo_morning boolean DEFAULT true NOT NULL,
  max_back_to_back_meetings integer DEFAULT 3,
  personal_rules jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.daily_time_blocks
CREATE TABLE IF NOT EXISTS public.daily_time_blocks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  plan_date date NOT NULL,
  blocks jsonb DEFAULT '[]'::jsonb NOT NULL,
  meeting_load_hours numeric DEFAULT 0,
  focus_hours_available numeric DEFAULT 0,
  ai_reasoning text,
  feedback_rating integer,
  feedback_text text,
  feedback_submitted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  key_metric_targets jsonb DEFAULT '{}'::jsonb,
  completed_goals jsonb DEFAULT '[]'::jsonb,
  block_feedback jsonb DEFAULT '[]'::jsonb,
  recast_at timestamp with time zone,
  dismissed_block_indices jsonb DEFAULT '[]'::jsonb
);

-- Table: public.dave_transcripts
CREATE TABLE IF NOT EXISTS public.dave_transcripts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  messages jsonb DEFAULT '[]'::jsonb NOT NULL,
  duration_seconds integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.deal_patterns
CREATE TABLE IF NOT EXISTS public.deal_patterns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  opportunity_id uuid,
  outcome text NOT NULL,
  analysis jsonb DEFAULT '{}'::jsonb NOT NULL,
  patterns_identified text[],
  created_at timestamp with time zone DEFAULT now()
);

-- Table: public.dismissed_action_items
CREATE TABLE IF NOT EXISTS public.dismissed_action_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  record_type text NOT NULL,
  record_id uuid NOT NULL,
  dismissed_at timestamp with time zone DEFAULT now() NOT NULL,
  reason text
);

-- Table: public.dismissed_duplicates
CREATE TABLE IF NOT EXISTS public.dismissed_duplicates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  record_type text DEFAULT 'opportunity'::text NOT NULL,
  duplicate_key text NOT NULL,
  dismissed_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.dojo_session_turns
CREATE TABLE IF NOT EXISTS public.dojo_session_turns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  turn_index integer DEFAULT 0 NOT NULL,
  prompt_text text NOT NULL,
  user_response text,
  score integer,
  feedback text,
  top_mistake text,
  improved_version text,
  score_json jsonb,
  retry_of_turn_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.dojo_sessions
CREATE TABLE IF NOT EXISTS public.dojo_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  mode text DEFAULT 'autopilot'::text NOT NULL,
  session_type text DEFAULT 'drill'::text NOT NULL,
  skill_focus text DEFAULT 'objection_handling'::text NOT NULL,
  difficulty text DEFAULT 'standard'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  scenario_title text,
  scenario_context text,
  scenario_objection text,
  best_score integer,
  latest_score integer,
  retry_count integer DEFAULT 0 NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  audio_metrics jsonb,
  assignment_id uuid,
  benchmark_tag boolean DEFAULT false NOT NULL,
  scenario_family_id text,
  pressure_level text,
  pressure_dimensions text[],
  ki_source_id uuid,
  ki_chapter text,
  ki_spider_dimension text,
  ki_ideal_response text,
  ki_rubric text
);

-- Table: public.enrichment_attempts
CREATE TABLE IF NOT EXISTS public.enrichment_attempts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  attempt_type text NOT NULL,
  strategy text NOT NULL,
  platform text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  result text DEFAULT 'pending'::text NOT NULL,
  failure_category text,
  content_found boolean DEFAULT false,
  transcript_url_found boolean DEFAULT false,
  media_url_found boolean DEFAULT false,
  caption_url_found boolean DEFAULT false,
  shell_rejected boolean DEFAULT false,
  runtime_config_found boolean DEFAULT false,
  content_length_extracted integer DEFAULT 0,
  quality_score_after integer,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.error_logs
CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  trace_id text NOT NULL,
  category text NOT NULL,
  message text NOT NULL,
  raw_message text,
  code text,
  source text DEFAULT 'frontend'::text NOT NULL,
  function_name text,
  component_name text,
  route text,
  retryable boolean DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.execution_outputs
CREATE TABLE IF NOT EXISTS public.execution_outputs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  output_type text DEFAULT 'custom'::text NOT NULL,
  content text DEFAULT ''::text NOT NULL,
  subject_line text,
  account_id uuid,
  account_name text,
  opportunity_id uuid,
  stage text,
  persona text,
  competitor text,
  template_id_used uuid,
  reference_resource_ids uuid[] DEFAULT '{}'::uuid[],
  transcript_resource_ids uuid[] DEFAULT '{}'::uuid[],
  custom_instructions text,
  times_reused integer DEFAULT 0,
  is_promoted_to_template boolean DEFAULT false,
  is_strong_example boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.execution_templates
CREATE TABLE IF NOT EXISTS public.execution_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  template_type text DEFAULT 'email'::text NOT NULL,
  output_type text DEFAULT 'custom'::text NOT NULL,
  source_resource_id uuid,
  source_output_id uuid,
  body text DEFAULT ''::text NOT NULL,
  subject_line text,
  structure_json jsonb DEFAULT '{}'::jsonb,
  tags text[] DEFAULT '{}'::text[],
  tone text,
  persona text,
  stage text,
  competitor text,
  use_case text,
  is_favorite boolean DEFAULT false,
  is_pinned boolean DEFAULT false,
  times_used integer DEFAULT 0,
  times_selected integer DEFAULT 0,
  times_successful integer DEFAULT 0,
  last_used_at timestamp with time zone,
  created_by_user boolean DEFAULT true,
  quality_score numeric,
  confidence_score numeric,
  template_origin text DEFAULT 'uploaded'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.extraction_batches
CREATE TABLE IF NOT EXISTS public.extraction_batches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  extraction_run_id uuid,
  batch_index integer NOT NULL,
  batch_total integer NOT NULL,
  char_start integer NOT NULL,
  char_end integer NOT NULL,
  semantic_start_marker text,
  semantic_end_marker text,
  status text DEFAULT 'pending'::text NOT NULL,
  raw_count integer DEFAULT 0,
  validated_count integer DEFAULT 0,
  saved_count integer DEFAULT 0,
  duplicates_skipped integer DEFAULT 0,
  cumulative_resource_ki_count integer DEFAULT 0,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.extraction_pipeline_jobs
CREATE TABLE IF NOT EXISTS public.extraction_pipeline_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  job_type text DEFAULT 'batch_extract'::text NOT NULL,
  job_scope text DEFAULT 'all_ready'::text NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  total_resources integer DEFAULT 0 NOT NULL,
  processed_count integer DEFAULT 0 NOT NULL,
  success_count integer DEFAULT 0 NOT NULL,
  failed_count integer DEFAULT 0 NOT NULL,
  skipped_count integer DEFAULT 0 NOT NULL,
  filter_criteria jsonb DEFAULT '{}'::jsonb,
  progress_log jsonb DEFAULT '[]'::jsonb,
  error_summary jsonb DEFAULT '{}'::jsonb,
  cancelled_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.extraction_runs
CREATE TABLE IF NOT EXISTS public.extraction_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  duration_ms integer,
  status text DEFAULT 'queued'::text NOT NULL,
  extraction_method text,
  extraction_mode text,
  model text,
  passes_run text[],
  chunks_total integer DEFAULT 0,
  chunks_processed integer DEFAULT 0,
  chunks_failed integer DEFAULT 0,
  raw_candidate_counts jsonb,
  merged_candidate_count integer DEFAULT 0,
  validated_candidate_count integer DEFAULT 0,
  saved_candidate_count integer DEFAULT 0,
  kis_per_1k_chars numeric(6,2),
  extraction_depth_bucket text,
  under_extracted_flag boolean DEFAULT false,
  validation_rejection_counts jsonb,
  dedupe_merge_counts jsonb,
  error_message text,
  summary text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.flashcard_decks
CREATE TABLE IF NOT EXISTS public.flashcard_decks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  source_type text NOT NULL,
  source_ref text NOT NULL,
  spoke text,
  title text,
  description text,
  generation_status text DEFAULT 'empty'::text NOT NULL,
  card_count integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.flashcard_state
CREATE TABLE IF NOT EXISTS public.flashcard_state (
  user_id uuid NOT NULL,
  card_id uuid NOT NULL,
  confidence smallint,
  times_seen integer DEFAULT 0 NOT NULL,
  last_seen_at timestamp with time zone,
  due_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.flashcards
CREATE TABLE IF NOT EXISTS public.flashcards (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  deck_id uuid NOT NULL,
  ki_id uuid NOT NULL,
  concept_id text,
  card_type text NOT NULL,
  front text NOT NULL,
  back text NOT NULL,
  active boolean DEFAULT true NOT NULL,
  generation_model text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.function_configs
CREATE TABLE IF NOT EXISTS public.function_configs (
  function_name text NOT NULL,
  primary_model text NOT NULL,
  fallback_model text,
  notes text,
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.holidays
CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  date date NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid
);

-- Table: public.icp_sourced_accounts
CREATE TABLE IF NOT EXISTS public.icp_sourced_accounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  company_name text NOT NULL,
  website text,
  industry text,
  employee_count text,
  hq_location text,
  icp_fit_reason text NOT NULL,
  trigger_signal text,
  signal_date text,
  suggested_contacts jsonb DEFAULT '[]'::jsonb,
  linkedin_url text,
  news_snippet text,
  fit_score integer DEFAULT 0,
  status text DEFAULT 'new'::text,
  feedback text,
  promoted_account_id uuid,
  batch_id text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.import_account_aliases
CREATE TABLE IF NOT EXISTS public.import_account_aliases (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  alias_type text NOT NULL,
  alias_value text NOT NULL,
  account_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.import_header_mappings
CREATE TABLE IF NOT EXISTS public.import_header_mappings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  csv_header text NOT NULL,
  target_object text NOT NULL,
  target_field text,
  data_transform text DEFAULT 'text'::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.import_value_mappings
CREATE TABLE IF NOT EXISTS public.import_value_mappings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  field_name text NOT NULL,
  csv_value text NOT NULL,
  app_value text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.integration_runs
CREATE TABLE IF NOT EXISTS public.integration_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  source text NOT NULL,
  ran_at timestamp with time zone DEFAULT now() NOT NULL,
  status text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.intelligence_units
CREATE TABLE IF NOT EXISTS public.intelligence_units (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  chunk_id uuid,
  unit_type text DEFAULT 'strategy'::text NOT NULL,
  text text NOT NULL,
  category text,
  extraction_version text DEFAULT '1.0'::text NOT NULL,
  extracted_at timestamp with time zone DEFAULT now() NOT NULL,
  extraction_confidence numeric DEFAULT 0.8 NOT NULL,
  support_count integer DEFAULT 1 NOT NULL,
  source_diversity integer DEFAULT 1 NOT NULL,
  consistency_score numeric DEFAULT 0.5 NOT NULL,
  idea_maturity text DEFAULT 'experimental'::text NOT NULL,
  conflicts jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.ki_annotations
CREATE TABLE IF NOT EXISTS public.ki_annotations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  ki_id uuid NOT NULL,
  note text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.ki_curriculum
CREATE TABLE IF NOT EXISTS public.ki_curriculum (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  concept_id text NOT NULL,
  ki_id uuid NOT NULL,
  role text NOT NULL,
  is_exemplar boolean DEFAULT false NOT NULL,
  order_in_concept smallint DEFAULT 0 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  drill_scenario text,
  drill_spoken_task text,
  drill_response_shape text,
  drill_model_answer text,
  drill_rubric jsonb,
  drill_ready boolean DEFAULT false,
  drill_teach_script text
);

-- Table: public.ki_mastery
CREATE TABLE IF NOT EXISTS public.ki_mastery (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  ki_id uuid NOT NULL,
  spider_dimension text,
  chapter text,
  times_drilled integer DEFAULT 0,
  avg_score numeric(5,2),
  best_score numeric(5,2),
  last_drilled_at timestamp with time zone,
  first_drilled_at timestamp with time zone,
  execution_score numeric(5,2),
  recognition_score numeric(5,2),
  transcript_evidenced boolean DEFAULT false,
  decay_risk boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  awareness_score numeric,
  next_review_at timestamp with time zone
);

-- Table: public.knowledge_items
CREATE TABLE IF NOT EXISTS public.knowledge_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  source_resource_id uuid,
  source_doctrine_id text,
  title text NOT NULL,
  knowledge_type text DEFAULT 'skill'::text NOT NULL,
  chapter text NOT NULL,
  sub_chapter text,
  competitor_name text,
  product_area text,
  applies_to_contexts text[] DEFAULT '{}'::text[] NOT NULL,
  tactic_summary text,
  why_it_matters text,
  when_to_use text,
  when_not_to_use text,
  example_usage text,
  confidence_score numeric DEFAULT 0.5 NOT NULL,
  status text DEFAULT 'extracted'::text NOT NULL,
  active boolean DEFAULT false NOT NULL,
  user_edited boolean DEFAULT false NOT NULL,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  activation_metadata jsonb,
  source_segment_index integer,
  source_char_range jsonb,
  source_heading text,
  source_excerpt text,
  who text,
  framework text,
  macro_situation text,
  micro_strategy text,
  how_to_execute text,
  what_this_unlocks text,
  source_title text,
  source_location text,
  review_status text DEFAULT 'unreviewed'::text NOT NULL,
  challenger_type text,
  ki_fingerprint text,
  extraction_method text DEFAULT 'llm'::text,
  library_role text,
  is_core_ae boolean DEFAULT true,
  spider_dimension text,
  intelligence_type text,
  ki_type text
);

-- Table: public.knowledge_signals
CREATE TABLE IF NOT EXISTS public.knowledge_signals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  theme text NOT NULL,
  author_or_speaker text,
  signal_timestamp timestamp with time zone DEFAULT now() NOT NULL,
  confidence numeric DEFAULT 0.7 NOT NULL,
  relevance numeric DEFAULT 0.8 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.knowledge_usage_log
CREATE TABLE IF NOT EXISTS public.knowledge_usage_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  knowledge_item_id uuid NOT NULL,
  source_resource_id uuid,
  event_type text NOT NULL,
  context_type text,
  chapter text,
  competitor text,
  stage text,
  persona text,
  account_name text,
  session_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.learning_courses
CREATE TABLE IF NOT EXISTS public.learning_courses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  title text NOT NULL,
  description text,
  slug text NOT NULL,
  topic text NOT NULL,
  difficulty_level text DEFAULT 'beginner'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.learning_lessons
CREATE TABLE IF NOT EXISTS public.learning_lessons (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  module_id uuid NOT NULL,
  title text NOT NULL,
  topic text NOT NULL,
  difficulty_level text DEFAULT 'beginner'::text NOT NULL,
  order_index integer DEFAULT 0 NOT NULL,
  lesson_content jsonb,
  quiz_content jsonb,
  source_ki_ids uuid[] DEFAULT '{}'::uuid[],
  generation_status text DEFAULT 'not_started'::text NOT NULL,
  generated_at timestamp with time zone,
  generation_model text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  mastery_score integer,
  mastery_attempts integer DEFAULT 0,
  mastery_passed_at timestamp with time zone
);

-- Table: public.learning_modules
CREATE TABLE IF NOT EXISTS public.learning_modules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  course_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  order_index integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.learning_progress
CREATE TABLE IF NOT EXISTS public.learning_progress (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  status text DEFAULT 'not_started'::text NOT NULL,
  mastery_score double precision,
  last_attempt_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.learning_quiz_answers
CREATE TABLE IF NOT EXISTS public.learning_quiz_answers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  question_type text NOT NULL,
  question_id text NOT NULL,
  user_answer jsonb,
  is_correct boolean,
  ai_feedback text,
  score double precision,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.lesson_assets
CREATE TABLE IF NOT EXISTS public.lesson_assets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lesson_import_id uuid,
  parent_resource_id uuid,
  source_url text NOT NULL,
  filename text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  storage_path text,
  download_status text DEFAULT 'pending'::text NOT NULL,
  parse_status text DEFAULT 'pending'::text NOT NULL,
  parsed_text_length integer,
  page_count integer,
  child_resource_id uuid,
  error_detail text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.library_cards
CREATE TABLE IF NOT EXISTS public.library_cards (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  source_type text NOT NULL,
  source_ids uuid[] NOT NULL,
  library_role text NOT NULL,
  title text NOT NULL,
  when_to_use text,
  the_move text NOT NULL,
  why_it_works text,
  anti_patterns text[],
  example_snippet text,
  applies_to_contexts text[],
  confidence numeric,
  derived_at timestamp with time zone DEFAULT now() NOT NULL,
  derivation_version integer DEFAULT 1 NOT NULL
);

-- Table: public.library_reconciliation_items
CREATE TABLE IF NOT EXISTS public.library_reconciliation_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  bucket text NOT NULL,
  issues text[] DEFAULT '{}'::text[] NOT NULL,
  severity integer DEFAULT 0 NOT NULL,
  phase_outcomes jsonb DEFAULT '{}'::jsonb NOT NULL,
  qa_flagged boolean DEFAULT false NOT NULL,
  qa_reason text,
  processed boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.library_reconciliation_runs
CREATE TABLE IF NOT EXISTS public.library_reconciliation_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  mode text DEFAULT 'dry_run'::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  current_phase text,
  total_resources integer DEFAULT 0 NOT NULL,
  buckets jsonb DEFAULT '{}'::jsonb NOT NULL,
  phase_progress jsonb DEFAULT '{}'::jsonb NOT NULL,
  issue_breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
  final_report jsonb,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.lifecycle_audit_events
CREATE TABLE IF NOT EXISTS public.lifecycle_audit_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  resource_title text,
  violation_type text NOT NULL,
  before_blocked_reason text,
  after_blocked_reason text,
  before_canonical_state text,
  after_canonical_state text,
  ki_total integer DEFAULT 0 NOT NULL,
  ki_active integer DEFAULT 0 NOT NULL,
  ki_active_with_contexts integer DEFAULT 0 NOT NULL,
  content_length integer,
  auto_healed boolean DEFAULT false NOT NULL,
  details jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.mock_call_sessions
CREATE TABLE IF NOT EXISTS public.mock_call_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  call_type text DEFAULT 'Discovery'::text NOT NULL,
  industry text,
  persona text DEFAULT 'CMO'::text NOT NULL,
  difficulty integer DEFAULT 2 NOT NULL,
  scenario jsonb DEFAULT '{}'::jsonb NOT NULL,
  messages jsonb DEFAULT '[]'::jsonb NOT NULL,
  live_tracking jsonb DEFAULT '{}'::jsonb NOT NULL,
  grade_data jsonb,
  overall_grade text,
  overall_score integer,
  skill_mode text,
  parent_session_id uuid,
  retry_from_index integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone
);

-- Table: public.nav_events
CREATE TABLE IF NOT EXISTS public.nav_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  from_path text,
  to_path text NOT NULL,
  via text,
  at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.opportunities
CREATE TABLE IF NOT EXISTS public.opportunities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid,
  name text NOT NULL,
  salesforce_link text,
  salesforce_id text,
  status text DEFAULT 'active'::text,
  stage text DEFAULT ''::text,
  arr numeric,
  churn_risk text,
  close_date date,
  next_step text,
  next_step_date date,
  last_touch_date date,
  notes text,
  deal_type text,
  payment_terms text,
  term_months integer,
  prior_contract_arr numeric,
  renewal_arr numeric,
  one_time_amount numeric,
  is_new_logo boolean DEFAULT false,
  linked_renewal_id uuid,
  activity_log jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  role_title text,
  process_stage text,
  verdict text,
  work_model text,
  comp_json jsonb DEFAULT '{}'::jsonb,
  next_interview_json jsonb DEFAULT '{}'::jsonb,
  jd_url text,
  company_url text,
  recruiter_name text,
  hiring_manager_name text,
  open_questions text[] DEFAULT '{}'::text[],
  intelligence_notes text,
  logistics_notes text,
  office_location text,
  primary_strategy_thread_id uuid,
  archived_at timestamp with time zone
);

-- Table: public.opportunity_methodology
CREATE TABLE IF NOT EXISTS public.opportunity_methodology (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  metrics_confirmed boolean DEFAULT false NOT NULL,
  metrics_notes text DEFAULT ''::text,
  economic_buyer_confirmed boolean DEFAULT false NOT NULL,
  economic_buyer_notes text DEFAULT ''::text,
  decision_criteria_confirmed boolean DEFAULT false NOT NULL,
  decision_criteria_notes text DEFAULT ''::text,
  decision_process_confirmed boolean DEFAULT false NOT NULL,
  decision_process_notes text DEFAULT ''::text,
  identify_pain_confirmed boolean DEFAULT false NOT NULL,
  identify_pain_notes text DEFAULT ''::text,
  champion_confirmed boolean DEFAULT false NOT NULL,
  champion_notes text DEFAULT ''::text,
  competition_confirmed boolean DEFAULT false NOT NULL,
  competition_notes text DEFAULT ''::text,
  before_state_notes text DEFAULT ''::text,
  after_state_notes text DEFAULT ''::text,
  negative_consequences_notes text DEFAULT ''::text,
  positive_business_outcomes_notes text DEFAULT ''::text,
  required_capabilities_notes text DEFAULT ''::text,
  metrics_value_notes text DEFAULT ''::text,
  call_goals jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.opportunity_strategy_memory
CREATE TABLE IF NOT EXISTS public.opportunity_strategy_memory (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  memory_type text DEFAULT 'fact'::text NOT NULL,
  content text NOT NULL,
  confidence numeric,
  source_thread_id uuid,
  source_message_id uuid,
  is_pinned boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  is_irrelevant boolean DEFAULT false NOT NULL,
  source_proposal_id uuid
);

-- Table: public.pipeline_diagnoses
CREATE TABLE IF NOT EXISTS public.pipeline_diagnoses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  resource_id uuid NOT NULL,
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  terminal_state text DEFAULT 'needs_review'::text NOT NULL,
  failure_reasons text[] DEFAULT '{}'::text[] NOT NULL,
  trust_failures text[] DEFAULT '{}'::text[] NOT NULL,
  recommended_fix text,
  retryable boolean DEFAULT false NOT NULL,
  priority text DEFAULT 'medium'::text NOT NULL,
  human_review_required boolean DEFAULT false NOT NULL,
  most_similar_existing text,
  assets_created jsonb DEFAULT '{"examples": 0, "templates": 0, "knowledge_items": 0, "knowledge_activated": 0}'::jsonb NOT NULL,
  route text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  resolution_status text DEFAULT 'unresolved'::text,
  resolution_action text,
  resolution_notes text,
  resolved_at timestamp with time zone
);

-- Table: public.pipeline_hygiene_scans
CREATE TABLE IF NOT EXISTS public.pipeline_hygiene_scans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  scan_date date DEFAULT CURRENT_DATE NOT NULL,
  issues jsonb DEFAULT '[]'::jsonb NOT NULL,
  summary jsonb DEFAULT '{}'::jsonb NOT NULL,
  health_score integer DEFAULT 0 NOT NULL,
  total_issues integer DEFAULT 0 NOT NULL,
  critical_issues integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.pipeline_runs
CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  status text DEFAULT 'running'::text NOT NULL,
  mode text DEFAULT 'standard'::text NOT NULL,
  total_resources integer DEFAULT 0,
  total_processed integer DEFAULT 0,
  converged boolean DEFAULT false,
  iterations_run integer DEFAULT 0,
  stall_reason text,
  no_progress_iterations integer DEFAULT 0,
  stalled_resources integer DEFAULT 0,
  repeated_failure_resources integer DEFAULT 0,
  summary_json jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.playbook_feedback
CREATE TABLE IF NOT EXISTS public.playbook_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  stage_id text NOT NULL,
  feedback_type text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  framework text,
  section_heading text,
  ki_title text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.playbook_usage_events
CREATE TABLE IF NOT EXISTS public.playbook_usage_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  playbook_id uuid,
  playbook_title text NOT NULL,
  event_type text DEFAULT 'recommendation_shown'::text NOT NULL,
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
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.playbooks
CREATE TABLE IF NOT EXISTS public.playbooks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  problem_type text DEFAULT ''::text NOT NULL,
  when_to_use text DEFAULT ''::text NOT NULL,
  why_it_matters text DEFAULT ''::text NOT NULL,
  stage_fit text[] DEFAULT '{}'::text[] NOT NULL,
  persona_fit text[] DEFAULT '{}'::text[] NOT NULL,
  tactic_steps text[] DEFAULT '{}'::text[] NOT NULL,
  talk_tracks text[] DEFAULT '{}'::text[] NOT NULL,
  key_questions text[] DEFAULT '{}'::text[] NOT NULL,
  traps text[] DEFAULT '{}'::text[] NOT NULL,
  anti_patterns text[] DEFAULT '{}'::text[] NOT NULL,
  confidence_score numeric DEFAULT 0 NOT NULL,
  source_resource_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  success_criteria text DEFAULT ''::text NOT NULL,
  deal_impact text DEFAULT ''::text NOT NULL,
  pressure_tactics text[] DEFAULT '{}'::text[] NOT NULL,
  failure_consequences text[] DEFAULT '{}'::text[] NOT NULL,
  minimum_effective_version text DEFAULT ''::text NOT NULL,
  what_great_looks_like text[] DEFAULT '{}'::text[] NOT NULL,
  common_mistakes text[] DEFAULT '{}'::text[] NOT NULL,
  library_role text
);

-- Table: public.podcast_import_queue
CREATE TABLE IF NOT EXISTS public.podcast_import_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  source_registry_id uuid,
  episode_url text NOT NULL,
  episode_title text NOT NULL,
  episode_guest text,
  episode_published timestamp with time zone,
  episode_duration text,
  show_author text,
  status text DEFAULT 'queued'::text NOT NULL,
  error_message text,
  resource_id uuid,
  attempts integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  platform text,
  transcript_status text DEFAULT 'pending'::text,
  failure_type text,
  content_validation jsonb,
  ki_status text DEFAULT 'pending'::text,
  ki_count integer DEFAULT 0,
  transcript_preview text,
  transcript_length integer DEFAULT 0,
  transcript_section_count integer DEFAULT 0,
  raw_transcript text,
  structured_transcript text,
  review_reason text,
  original_episode_url text,
  resolved_url text,
  audio_url text,
  host_platform text,
  episode_description text,
  artwork_url text,
  show_title text,
  resolution_method text,
  metadata_status text DEFAULT 'pending'::text,
  batch_id uuid,
  pipeline_stage text DEFAULT 'queued'::text
);

-- Table: public.power_hour_sessions
CREATE TABLE IF NOT EXISTS public.power_hour_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  duration_minutes integer DEFAULT 60 NOT NULL,
  focus text DEFAULT 'new-logo'::text NOT NULL,
  dials integer DEFAULT 0 NOT NULL,
  connects integer DEFAULT 0 NOT NULL,
  meetings_set integer DEFAULT 0 NOT NULL,
  notes text,
  status text DEFAULT 'completed'::text NOT NULL,
  synced_to_journal boolean DEFAULT false NOT NULL,
  journal_date date,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.products
CREATE TABLE IF NOT EXISTS public.products (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  list_price numeric,
  sort_order integer DEFAULT 0 NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.pto_days
CREATE TABLE IF NOT EXISTS public.pto_days (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  date date NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid
);

-- Table: public.quota_targets
CREATE TABLE IF NOT EXISTS public.quota_targets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  fiscal_year_start date NOT NULL,
  fiscal_year_end date NOT NULL,
  new_arr_quota numeric DEFAULT 500000 NOT NULL,
  renewal_arr_quota numeric DEFAULT 822542 NOT NULL,
  new_arr_acr numeric DEFAULT 0.0773 NOT NULL,
  renewal_arr_acr numeric DEFAULT 0.0157 NOT NULL,
  target_dials_per_day numeric DEFAULT 60,
  target_connects_per_day numeric DEFAULT 6,
  target_meetings_set_per_week numeric DEFAULT 3,
  target_opps_created_per_week numeric DEFAULT 1,
  target_customer_meetings_per_week numeric DEFAULT 8,
  target_accounts_researched_per_day numeric DEFAULT 3,
  target_contacts_prepped_per_day numeric DEFAULT 5,
  qpi_new_logo_weight numeric DEFAULT 0.60,
  qpi_renewal_weight numeric DEFAULT 0.40,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.renewals
CREATE TABLE IF NOT EXISTS public.renewals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid,
  account_name text NOT NULL,
  csm text,
  arr numeric DEFAULT 0 NOT NULL,
  renewal_due date NOT NULL,
  renewal_quarter text,
  entitlements text,
  usage text,
  term text,
  planhat_link text,
  current_agreement_link text,
  auto_renew boolean DEFAULT false,
  product text,
  cs_notes text,
  next_step text,
  health_status text DEFAULT 'green'::text,
  churn_risk text DEFAULT 'low'::text,
  linked_opportunity_id uuid,
  risk_reason text,
  renewal_stage text,
  owner text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.research_queue_events
CREATE TABLE IF NOT EXISTS public.research_queue_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  account_name text NOT NULL,
  week_start date NOT NULL,
  assigned_day text NOT NULL,
  event_type text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.resource_chunks
CREATE TABLE IF NOT EXISTS public.resource_chunks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  resource_id uuid NOT NULL,
  job_id uuid,
  user_id uuid NOT NULL,
  chunk_index integer DEFAULT 0 NOT NULL,
  content text NOT NULL,
  summary text,
  actions jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'pending'::text NOT NULL,
  token_count integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.resource_collection_members
CREATE TABLE IF NOT EXISTS public.resource_collection_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  collection_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.resource_collections
CREATE TABLE IF NOT EXISTS public.resource_collections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  collection_type text DEFAULT 'manual'::text NOT NULL,
  description text,
  parent_resource_id uuid,
  resource_count integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.resource_digests
CREATE TABLE IF NOT EXISTS public.resource_digests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  takeaways text[] DEFAULT '{}'::text[] NOT NULL,
  summary text DEFAULT ''::text NOT NULL,
  use_cases text[] DEFAULT '{}'::text[] NOT NULL,
  grading_criteria jsonb,
  content_hash text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.resource_extraction_attempts
CREATE TABLE IF NOT EXISTS public.resource_extraction_attempts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  strategy text NOT NULL,
  ki_count integer DEFAULT 0 NOT NULL,
  raw_item_count integer DEFAULT 0 NOT NULL,
  validated_count integer DEFAULT 0 NOT NULL,
  deduped_count integer DEFAULT 0 NOT NULL,
  min_ki_floor integer DEFAULT 0 NOT NULL,
  floor_met boolean DEFAULT false NOT NULL,
  failure_type text,
  status text NOT NULL,
  duration_ms integer DEFAULT 0 NOT NULL,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  confidence_score numeric
);

-- Table: public.resource_folders
CREATE TABLE IF NOT EXISTS public.resource_folders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  parent_id uuid,
  icon text DEFAULT 'folder'::text,
  color text,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.resource_job_steps
CREATE TABLE IF NOT EXISTS public.resource_job_steps (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  job_id uuid NOT NULL,
  step_name text NOT NULL,
  sequence integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  error_category text,
  error_message text,
  payload_size integer,
  retry_count integer DEFAULT 0 NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.resource_jobs
CREATE TABLE IF NOT EXISTS public.resource_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  job_type text DEFAULT 'full_pipeline'::text NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  trace_id text NOT NULL,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  error_category text,
  error_message text,
  retry_count integer DEFAULT 0 NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.resource_links
CREATE TABLE IF NOT EXISTS public.resource_links (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid,
  opportunity_id uuid,
  renewal_id uuid,
  url text NOT NULL,
  label text DEFAULT ''::text NOT NULL,
  category text DEFAULT 'template'::text NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.resource_usage_events
CREATE TABLE IF NOT EXISTS public.resource_usage_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  event_type text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: public.resource_versions
CREATE TABLE IF NOT EXISTS public.resource_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  resource_id uuid NOT NULL,
  user_id uuid NOT NULL,
  version_number integer NOT NULL,
  title text NOT NULL,
  content text DEFAULT ''::text,
  change_summary text,
  file_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.resources
CREATE TABLE IF NOT EXISTS public.resources (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  folder_id uuid,
  title text NOT NULL,
  description text,
  resource_type text DEFAULT 'document'::text NOT NULL,
  content text DEFAULT ''::text,
  is_template boolean DEFAULT false,
  template_category text,
  account_id uuid,
  opportunity_id uuid,
  file_url text,
  tags text[] DEFAULT '{}'::text[],
  current_version integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  source_resource_id uuid,
  content_status text DEFAULT 'file'::text NOT NULL,
  is_screenshot_template boolean DEFAULT false,
  screenshot_structure text,
  enriched_at timestamp with time zone,
  content_length integer,
  source_created_at timestamp with time zone,
  source_published_at timestamp with time zone,
  author_or_speaker text,
  date_confidence text DEFAULT 'unknown'::text,
  date_source text,
  enrichment_status text DEFAULT 'not_enriched'::text NOT NULL,
  last_enrichment_attempt_at timestamp with time zone,
  last_status_change_at timestamp with time zone DEFAULT now(),
  enrichment_version integer DEFAULT 0 NOT NULL,
  failure_reason text,
  enrichment_audit_log jsonb DEFAULT '[]'::jsonb NOT NULL,
  validation_version integer DEFAULT 0 NOT NULL,
  failure_count integer DEFAULT 0 NOT NULL,
  last_quality_score numeric,
  last_quality_tier text,
  last_reconciled_at timestamp with time zone,
  source_registry_id uuid,
  external_id text,
  brain_status text DEFAULT 'pending'::text NOT NULL,
  dedupe_hash text,
  discovered_at timestamp with time zone DEFAULT now(),
  recovery_status text,
  recovery_reason text,
  next_best_action text,
  manual_input_required boolean DEFAULT false,
  recovery_queue_bucket text,
  recovery_attempt_count integer DEFAULT 0,
  last_recovery_error text,
  access_type text DEFAULT 'unknown'::text,
  content_classification text,
  extraction_method text,
  manual_content_present boolean DEFAULT false,
  advanced_extraction_status text,
  advanced_extraction_attempts integer DEFAULT 0,
  last_advanced_extraction_at timestamp with time zone,
  resolution_method text,
  platform_status text,
  block_reason text,
  block_auto_fixable boolean DEFAULT false,
  block_next_action text,
  block_terminal boolean DEFAULT false,
  block_retry_count integer DEFAULT 0,
  block_last_attempt_at timestamp with time zone,
  extraction_priority_score numeric DEFAULT 0,
  extraction_priority_factors jsonb DEFAULT '{}'::jsonb,
  lightweight_extraction jsonb,
  pipeline_queue text DEFAULT 'unscored'::text,
  original_url text,
  audio_url text,
  host_platform text,
  show_title text,
  episode_description text,
  artwork_url text,
  transcript_status text,
  metadata_status text,
  re_extract_status text DEFAULT 'idle'::text NOT NULL,
  re_extract_at timestamp with time zone,
  active_job_type text,
  active_job_status text DEFAULT 'idle'::text,
  active_job_started_at timestamp with time zone,
  active_job_updated_at timestamp with time zone,
  active_job_finished_at timestamp with time zone,
  active_job_result_summary text,
  active_job_error text,
  extraction_attempt_count integer DEFAULT 0 NOT NULL,
  max_extraction_attempts integer DEFAULT 4 NOT NULL,
  extraction_failure_type text,
  extractor_strategy text,
  extraction_retry_eligible boolean DEFAULT false NOT NULL,
  extraction_audit_summary jsonb,
  extraction_attempt_history jsonb DEFAULT '[]'::jsonb,
  next_retry_at timestamp with time zone,
  retry_scheduled_at timestamp with time zone,
  downstream_eligibility jsonb DEFAULT '{"search": false, "coaching": false, "dave_grounding": false, "playbook_generation": false}'::jsonb,
  extraction_mode text DEFAULT 'standard'::text,
  extraction_passes_run jsonb DEFAULT '[]'::jsonb,
  raw_candidate_counts jsonb DEFAULT '{}'::jsonb,
  merged_candidate_count integer DEFAULT 0,
  kis_per_1k_chars numeric(6,2) DEFAULT 0,
  extraction_depth_bucket text DEFAULT 'none'::text,
  under_extracted_flag boolean DEFAULT false,
  last_extraction_summary text,
  last_extraction_run_id uuid,
  last_extraction_run_status text,
  last_extraction_returned_ki_count integer,
  last_extraction_deduped_ki_count integer,
  last_extraction_validated_ki_count integer,
  last_extraction_saved_ki_count integer,
  last_extraction_error text,
  last_extraction_started_at timestamp with time zone,
  last_extraction_completed_at timestamp with time zone,
  last_extraction_duration_ms integer,
  last_extraction_model text,
  current_resource_ki_count integer DEFAULT 0,
  current_resource_kis_per_1k numeric DEFAULT 0,
  extraction_batch_total integer DEFAULT 0,
  extraction_batches_completed integer DEFAULT 0,
  extraction_batch_status text,
  extraction_is_resumable boolean DEFAULT false,
  active_job_step_label text,
  active_job_progress_current integer,
  active_job_progress_total integer,
  active_job_progress_pct integer,
  last_remediation_at timestamp with time zone,
  source text,
  source_strategy_thread_id uuid,
  source_proposal_id uuid,
  source_strategy_artifact_id uuid,
  promoted_at timestamp with time zone,
  promoted_by uuid,
  promotion_scope text,
  quarantined_at timestamp with time zone,
  quarantine_reason text
);

-- Table: public.routing_decisions
CREATE TABLE IF NOT EXISTS public.routing_decisions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  thread_id uuid,
  lane text NOT NULL,
  signals jsonb NOT NULL,
  override_used text,
  auto_promoted boolean DEFAULT false NOT NULL,
  downgrade_warning boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.sales_age_snapshots
CREATE TABLE IF NOT EXISTS public.sales_age_snapshots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  snapshot_date date NOT NULL,
  week_ending date NOT NULL,
  qpi_new_logo numeric DEFAULT 0 NOT NULL,
  qpi_renewal numeric DEFAULT 0 NOT NULL,
  qpi_combined numeric DEFAULT 0 NOT NULL,
  sales_age numeric DEFAULT 45 NOT NULL,
  pace_of_aging numeric DEFAULT 0,
  status text DEFAULT 'stable'::text NOT NULL,
  benchmark_30d_qpi numeric,
  benchmark_6m_qpi numeric,
  driver_dials_avg numeric DEFAULT 0,
  driver_connects_avg numeric DEFAULT 0,
  driver_meetings_set_avg numeric DEFAULT 0,
  driver_opps_created_avg numeric DEFAULT 0,
  driver_customer_meetings_avg numeric DEFAULT 0,
  driver_accounts_researched_avg numeric DEFAULT 0,
  driver_contacts_prepped_avg numeric DEFAULT 0,
  new_arr_closed numeric DEFAULT 0,
  new_arr_quota numeric DEFAULT 0,
  renewal_arr_closed numeric DEFAULT 0,
  renewal_arr_quota numeric DEFAULT 0,
  projected_finish_30d numeric,
  projected_finish_6m numeric,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.skill_benchmarks
CREATE TABLE IF NOT EXISTS public.skill_benchmarks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  run_at timestamp with time zone DEFAULT now() NOT NULL,
  scores jsonb DEFAULT '{}'::jsonb NOT NULL,
  overall_avg integer,
  dimension_count integer,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: public.skill_builder_sessions
CREATE TABLE IF NOT EXISTS public.skill_builder_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  skill text NOT NULL,
  duration_minutes integer DEFAULT 30 NOT NULL,
  level integer DEFAULT 1 NOT NULL,
  blocks jsonb DEFAULT '[]'::jsonb NOT NULL,
  ki_ids_used text[] DEFAULT '{}'::text[] NOT NULL,
  focus_patterns_used text[] DEFAULT '{}'::text[] NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  completed_at timestamp with time zone,
  avg_score numeric,
  weakest_pattern text,
  strongest_pattern text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.smoke_test_results
CREATE TABLE IF NOT EXISTS public.smoke_test_results (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  status text DEFAULT 'unknown'::text NOT NULL,
  total_ms integer,
  provider_health jsonb DEFAULT '{}'::jsonb,
  infra_passed integer DEFAULT 0,
  infra_failed integer DEFAULT 0,
  e2e_passed integer DEFAULT 0,
  e2e_failed integer DEFAULT 0,
  failed_tests jsonb DEFAULT '[]'::jsonb,
  full_result jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.source_registry
CREATE TABLE IF NOT EXISTS public.source_registry (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  source_type text DEFAULT 'web_article'::text NOT NULL,
  url text,
  external_id text,
  polling_enabled boolean DEFAULT false NOT NULL,
  poll_interval_hours integer DEFAULT 24 NOT NULL,
  last_checked_at timestamp with time zone,
  last_successful_sync_at timestamp with time zone,
  trust_weight numeric DEFAULT 1.0 NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.stage_playbooks
CREATE TABLE IF NOT EXISTS public.stage_playbooks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  stage_id text NOT NULL,
  content jsonb DEFAULT '{}'::jsonb NOT NULL,
  resource_ids text[] DEFAULT '{}'::text[] NOT NULL,
  keystone_resource_ids text[] DEFAULT '{}'::text[] NOT NULL,
  knowledge_item_count integer DEFAULT 0 NOT NULL,
  generated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.stage_resources
CREATE TABLE IF NOT EXISTS public.stage_resources (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  stage_id text NOT NULL,
  resource_id uuid NOT NULL,
  is_keystone boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.strategy_artifact_feedback
CREATE TABLE IF NOT EXISTS public.strategy_artifact_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  artifact_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating integer NOT NULL,
  feedback_text text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.strategy_artifacts
CREATE TABLE IF NOT EXISTS public.strategy_artifacts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  thread_id uuid,
  source_output_id uuid,
  artifact_type text DEFAULT 'custom'::text NOT NULL,
  title text NOT NULL,
  content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  rendered_text text,
  version integer DEFAULT 1 NOT NULL,
  parent_artifact_id uuid,
  linked_account_id uuid,
  linked_opportunity_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  usage_count integer DEFAULT 0 NOT NULL,
  last_used_at timestamp with time zone,
  source_chain text[] DEFAULT '{}'::text[],
  provider_used text,
  model_used text,
  fallback_used boolean DEFAULT false,
  latency_ms integer
);

-- Table: public.strategy_benchmark_audit_logs
CREATE TABLE IF NOT EXISTS public.strategy_benchmark_audit_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL,
  ask_index integer,
  event_type text NOT NULL,
  event_level text DEFAULT 'info'::text NOT NULL,
  system text,
  provider text,
  model text,
  message text DEFAULT ''::text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.strategy_benchmark_runs
CREATE TABLE IF NOT EXISTS public.strategy_benchmark_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  account_name text,
  baseline_mode text NOT NULL,
  judge_mode text NOT NULL,
  ask_count integer NOT NULL,
  summary jsonb DEFAULT '{}'::jsonb NOT NULL,
  failures jsonb DEFAULT '{}'::jsonb NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  markdown text DEFAULT ''::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'completed'::text NOT NULL,
  current_step text,
  completed_asks integer DEFAULT 0 NOT NULL,
  error text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  replayed_from_run_id uuid,
  replay_reason text,
  config_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL
);

-- Table: public.strategy_custom_pills
CREATE TABLE IF NOT EXISTS public.strategy_custom_pills (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  surface text NOT NULL,
  name text NOT NULL,
  description text DEFAULT ''::text,
  instruction text DEFAULT ''::text,
  fields jsonb DEFAULT '[]'::jsonb,
  prompt_template text DEFAULT ''::text,
  output_type text DEFAULT 'chat'::text,
  run_mode text DEFAULT 'insert'::text,
  ask_clarifying boolean DEFAULT false,
  is_active boolean DEFAULT true,
  order_index bigint,
  attachments jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.strategy_messages
CREATE TABLE IF NOT EXISTS public.strategy_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  thread_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'user'::text NOT NULL,
  message_type text DEFAULT 'chat'::text NOT NULL,
  content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  citations_json jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  provider_used text,
  model_used text,
  fallback_used boolean DEFAULT false,
  latency_ms integer,
  manifest_id text,
  linked_account_id uuid,
  linked_opportunity_id uuid
);

-- Table: public.strategy_outcomes
CREATE TABLE IF NOT EXISTS public.strategy_outcomes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  insight_id text NOT NULL,
  insight_text text NOT NULL,
  insight_maturity text DEFAULT 'experimental'::text NOT NULL,
  event_type text DEFAULT 'shown'::text NOT NULL,
  deal_stage text,
  execution_state text,
  account_type text,
  outcome text,
  user_feedback text,
  score_at_recommendation numeric,
  context_metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.strategy_outputs
CREATE TABLE IF NOT EXISTS public.strategy_outputs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  thread_id uuid,
  workflow_run_id uuid,
  output_type text DEFAULT 'memo'::text NOT NULL,
  title text DEFAULT 'Untitled Output'::text NOT NULL,
  content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  rendered_text text,
  linked_account_id uuid,
  linked_opportunity_id uuid,
  linked_territory_id text,
  is_pinned boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  provider_used text,
  model_used text,
  fallback_used boolean DEFAULT false,
  latency_ms integer,
  manifest_id text
);

-- Table: public.strategy_promotion_proposals
CREATE TABLE IF NOT EXISTS public.strategy_promotion_proposals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  source_message_id uuid,
  source_artifact_id uuid,
  proposal_type text NOT NULL,
  target_table text NOT NULL,
  target_scope text NOT NULL,
  target_account_id uuid,
  target_opportunity_id uuid,
  payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  rationale text,
  scope_rationale text,
  dedupe_key text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  confirmed_by uuid,
  confirmed_at timestamp with time zone,
  rejected_reason text,
  promoted_record_id uuid,
  promoted_at timestamp with time zone,
  promotion_error text,
  detector_version text DEFAULT 'v1'::text NOT NULL,
  detector_confidence numeric(3,2),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  confirmed_class text
);

-- Table: public.strategy_rollups
CREATE TABLE IF NOT EXISTS public.strategy_rollups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  rollup_type text DEFAULT 'summary'::text NOT NULL,
  content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  generated_from_thread_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.strategy_run_telemetry
CREATE TABLE IF NOT EXISTS public.strategy_run_telemetry (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  task_type text NOT NULL,
  stage text NOT NULL,
  provider text,
  model text,
  started_at timestamp with time zone NOT NULL,
  completed_at timestamp with time zone,
  duration_ms integer,
  success boolean DEFAULT true NOT NULL,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  error text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.strategy_stress_runs
CREATE TABLE IF NOT EXISTS public.strategy_stress_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  label text NOT NULL,
  notes text,
  total_prompts integer DEFAULT 0 NOT NULL,
  succeeded integer DEFAULT 0 NOT NULL,
  failed integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.strategy_stress_turns
CREATE TABLE IF NOT EXISTS public.strategy_stress_turns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  turn_index integer NOT NULL,
  prompt text NOT NULL,
  output text,
  output_chars integer,
  intended_provider text,
  intended_model text,
  actual_provider text,
  actual_model text,
  fallback_used boolean,
  latency_ms integer,
  status_code integer,
  intent text,
  violations jsonb DEFAULT '[]'::jsonb,
  appendix_present boolean,
  appendix_audience text,
  appendix_situation text,
  appendix_industry text,
  citation_audit jsonb,
  assistant_message_id uuid,
  error text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  routing_decision jsonb,
  retrieval_debug jsonb
);

-- Table: public.strategy_synthesis_cache
CREATE TABLE IF NOT EXISTS public.strategy_synthesis_cache (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  task_type text NOT NULL,
  cache_key text NOT NULL,
  result jsonb DEFAULT '{}'::jsonb NOT NULL,
  input_hash text NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '00:30:00'::interval) NOT NULL,
  hit_count integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.strategy_thread_conflicts
CREATE TABLE IF NOT EXISTS public.strategy_thread_conflicts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  thread_id uuid NOT NULL,
  user_id uuid NOT NULL,
  conflict_kind text NOT NULL,
  severity text NOT NULL,
  reason text NOT NULL,
  evidence_json jsonb DEFAULT '{}'::jsonb NOT NULL,
  detected_account_name text,
  linked_account_id uuid,
  linked_account_name text,
  resolved_at timestamp with time zone,
  resolved_by uuid,
  resolution_action text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.strategy_thread_resources
CREATE TABLE IF NOT EXISTS public.strategy_thread_resources (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  thread_id uuid NOT NULL,
  user_id uuid NOT NULL,
  resource_id uuid,
  source_type text DEFAULT 'upload'::text NOT NULL,
  relevance_score numeric,
  is_pinned boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.strategy_threads
CREATE TABLE IF NOT EXISTS public.strategy_threads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text DEFAULT 'Untitled Thread'::text NOT NULL,
  lane text DEFAULT 'research'::text NOT NULL,
  thread_type text DEFAULT 'freeform'::text NOT NULL,
  linked_account_id uuid,
  linked_opportunity_id uuid,
  linked_territory_id text,
  linked_artifact_id uuid,
  status text DEFAULT 'active'::text NOT NULL,
  summary text,
  latest_rollup jsonb,
  is_pinned boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  trust_state text DEFAULT 'safe'::text NOT NULL,
  trust_state_reason text,
  entity_signals jsonb,
  trust_checked_at timestamp with time zone,
  cloned_from_thread_id uuid
);

-- Table: public.strategy_uploaded_resources
CREATE TABLE IF NOT EXISTS public.strategy_uploaded_resources (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  thread_id uuid,
  file_name text NOT NULL,
  file_type text,
  storage_path text NOT NULL,
  parsed_text text,
  summary text,
  suggested_object_type text,
  suggested_object_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  metadata_json jsonb
);

-- Table: public.strategy_workflow_runs
CREATE TABLE IF NOT EXISTS public.strategy_workflow_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  workflow_type text NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  input_json jsonb,
  result_json jsonb,
  error_json jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.streak_events
CREATE TABLE IF NOT EXISTS public.streak_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  date date NOT NULL,
  is_eligible_day boolean DEFAULT false NOT NULL,
  checked_in boolean DEFAULT false NOT NULL,
  check_in_method text,
  check_in_time timestamp with time zone,
  goal_met boolean DEFAULT false NOT NULL,
  daily_score integer,
  productivity_score integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid
);

-- Table: public.streak_summary
CREATE TABLE IF NOT EXISTS public.streak_summary (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  current_checkin_streak integer DEFAULT 0 NOT NULL,
  current_performance_streak integer DEFAULT 0 NOT NULL,
  longest_checkin_streak integer DEFAULT 0 NOT NULL,
  longest_performance_streak integer DEFAULT 0 NOT NULL,
  total_eligible_days integer DEFAULT 0 NOT NULL,
  total_checkins integer DEFAULT 0 NOT NULL,
  total_goals_met integer DEFAULT 0 NOT NULL,
  checkin_level integer DEFAULT 0 NOT NULL,
  performance_level integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid
);

-- Table: public.task_run_sections
CREATE TABLE IF NOT EXISTS public.task_run_sections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL,
  user_id uuid NOT NULL,
  batch_index integer NOT NULL,
  section_ids text[] NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  primary_status text,
  fallback_status text,
  sections jsonb DEFAULT '[]'::jsonb NOT NULL,
  error text,
  attempts integer DEFAULT 0 NOT NULL,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  model_used text
);

-- Table: public.task_runs
CREATE TABLE IF NOT EXISTS public.task_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  task_type text DEFAULT 'discovery_prep'::text NOT NULL,
  template_id uuid,
  thread_id uuid,
  inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
  draft_output jsonb,
  review_output jsonb,
  status text DEFAULT 'pending'::text NOT NULL,
  account_id uuid,
  opportunity_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  progress_step text,
  error text,
  completed_at timestamp with time zone,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL
);

-- Table: public.task_templates
CREATE TABLE IF NOT EXISTS public.task_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  use_case text NOT NULL,
  sections jsonb DEFAULT '[]'::jsonb NOT NULL,
  formatting_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_system boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.tasks
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  workstream text DEFAULT 'pg'::text NOT NULL,
  status text DEFAULT 'next'::text NOT NULL,
  priority text DEFAULT 'P1'::text NOT NULL,
  due_date date,
  linked_account_id uuid,
  linked_opportunity_id uuid,
  notes text,
  completed_at timestamp with time zone,
  motion text,
  linked_record_type text,
  linked_record_id uuid,
  linked_contact_id uuid,
  category text,
  estimated_minutes integer,
  subtasks jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  reminder_at timestamp with time zone
);

-- Table: public.template_suggestions
CREATE TABLE IF NOT EXISTS public.template_suggestions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  source_resource_id uuid,
  title text NOT NULL,
  description text NOT NULL,
  template_category text NOT NULL,
  suggested_content text,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.territory_profile
CREATE TABLE IF NOT EXISTS public.territory_profile (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text,
  role text,
  company text,
  start_date date,
  quota_amount bigint,
  quota_currency text DEFAULT 'USD'::text,
  quota_type text,
  fiscal_year_start date,
  fiscal_year_end date,
  motion text,
  territory_description text,
  company_context text,
  ki_library_summary text,
  se_name text,
  csm_name text,
  manager_name text,
  custom_notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.territory_strategy_memory
CREATE TABLE IF NOT EXISTS public.territory_strategy_memory (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  territory_id text NOT NULL,
  memory_type text DEFAULT 'fact'::text NOT NULL,
  content text NOT NULL,
  confidence numeric,
  source_thread_id uuid,
  source_message_id uuid,
  is_pinned boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  is_irrelevant boolean DEFAULT false NOT NULL
);

-- Table: public.training_blocks
CREATE TABLE IF NOT EXISTS public.training_blocks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  block_number integer DEFAULT 1 NOT NULL,
  start_date date DEFAULT CURRENT_DATE NOT NULL,
  current_week integer DEFAULT 1 NOT NULL,
  phase text DEFAULT 'benchmark'::text NOT NULL,
  stage text DEFAULT 'foundation'::text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  completed_sessions_this_week integer DEFAULT 0 NOT NULL,
  benchmark_snapshot jsonb,
  retest_snapshot jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.transcript_grades
CREATE TABLE IF NOT EXISTS public.transcript_grades (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  transcript_id uuid NOT NULL,
  overall_grade text DEFAULT 'C'::text NOT NULL,
  overall_score integer DEFAULT 50 NOT NULL,
  style_score integer DEFAULT 50 NOT NULL,
  acumen_score integer DEFAULT 50 NOT NULL,
  cadence_score integer DEFAULT 50 NOT NULL,
  style_notes text,
  acumen_notes text,
  cadence_notes text,
  strengths text[] DEFAULT '{}'::text[],
  improvements text[] DEFAULT '{}'::text[],
  actionable_feedback text DEFAULT ''::text NOT NULL,
  feedback_focus text DEFAULT 'style'::text NOT NULL,
  summary text,
  methodology_alignment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  structure_score integer DEFAULT 0,
  cotm_score integer DEFAULT 0,
  meddicc_score integer DEFAULT 0,
  discovery_score integer DEFAULT 0,
  presence_score integer DEFAULT 0,
  commercial_score integer DEFAULT 0,
  next_step_score integer DEFAULT 0,
  call_segments jsonb DEFAULT '[]'::jsonb,
  cotm_signals jsonb DEFAULT '{}'::jsonb,
  meddicc_signals jsonb DEFAULT '{}'::jsonb,
  discovery_stats jsonb DEFAULT '{}'::jsonb,
  presence_stats jsonb DEFAULT '{}'::jsonb,
  evidence jsonb DEFAULT '[]'::jsonb,
  missed_opportunities jsonb DEFAULT '[]'::jsonb,
  suggested_questions jsonb DEFAULT '[]'::jsonb,
  behavioral_flags jsonb DEFAULT '[]'::jsonb,
  replacement_behavior text,
  coaching_issue text,
  coaching_why text,
  transcript_moment text,
  call_type text,
  custom_scorecard_results jsonb,
  call_goals_inferred text[],
  goals_achieved jsonb,
  deal_progressed boolean,
  progression_evidence text,
  likelihood_impact text,
  competitors_mentioned text[],
  aar_responses jsonb,
  regraded_at timestamp with time zone,
  product_knowledge_score integer,
  branch_expansion_hypothesis_score integer,
  branch_product_fit_score integer,
  branch_value_prop_score integer,
  branch_objection_handling_score integer,
  branch_coaching_note text
);

-- Table: public.user_band_gate
CREATE TABLE IF NOT EXISTS public.user_band_gate (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  spoke text NOT NULL,
  topic text NOT NULL,
  band smallint NOT NULL,
  status text DEFAULT 'locked'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  best_score numeric,
  passed_at timestamp with time zone,
  last_attempt_at timestamp with time zone,
  next_retest_due timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.user_competency
CREATE TABLE IF NOT EXISTS public.user_competency (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  spoke text NOT NULL,
  topic text NOT NULL,
  band smallint NOT NULL,
  sub_level text NOT NULL,
  progress numeric DEFAULT 0 NOT NULL,
  reps integer DEFAULT 0 NOT NULL,
  gate_passed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.user_lesson_progress
CREATE TABLE IF NOT EXISTS public.user_lesson_progress (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  status text DEFAULT 'not_started'::text NOT NULL,
  mastery_score integer,
  attempts integer DEFAULT 0,
  best_score integer,
  passed_at timestamp with time zone,
  last_attempt_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: public.user_settings
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid NOT NULL,
  deal_control_intensive boolean DEFAULT false NOT NULL,
  intensive_start_date timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  last_surface_path text,
  last_surface_at timestamp with time zone,
  shown_hints jsonb DEFAULT '[]'::jsonb NOT NULL
);

-- Table: public.user_train_prefs
CREATE TABLE IF NOT EXISTS public.user_train_prefs (
  user_id uuid NOT NULL,
  focus_spokes text[] DEFAULT '{}'::text[] NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.verification_runs
CREATE TABLE IF NOT EXISTS public.verification_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  run_at timestamp with time zone DEFAULT now() NOT NULL,
  total_resources integer DEFAULT 0 NOT NULL,
  total_in_scope integer DEFAULT 0 NOT NULL,
  total_broken integer DEFAULT 0 NOT NULL,
  total_contradictions integer DEFAULT 0 NOT NULL,
  by_fixability jsonb DEFAULT '{}'::jsonb NOT NULL,
  by_failure_bucket jsonb DEFAULT '{}'::jsonb NOT NULL,
  by_processing_state jsonb DEFAULT '{}'::jsonb NOT NULL,
  by_subtype jsonb DEFAULT '{}'::jsonb NOT NULL,
  by_score_band jsonb DEFAULT '{}'::jsonb NOT NULL,
  fix_recommendations jsonb DEFAULT '[]'::jsonb NOT NULL,
  repeated_patterns jsonb DEFAULT '[]'::jsonb NOT NULL,
  summary_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.vertical_briefs
CREATE TABLE IF NOT EXISTS public.vertical_briefs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  vertical_id uuid NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  content_md text,
  pov_deck_md text,
  rendered_by text DEFAULT 'agent:cowork_sweep'::text NOT NULL,
  is_current boolean DEFAULT true NOT NULL,
  rendered_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.verticals
CREATE TABLE IF NOT EXISTS public.verticals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  thesis text,
  structural_forces jsonb DEFAULT '[]'::jsonb,
  branch_relevance_map text,
  vocabulary jsonb DEFAULT '[]'::jsonb,
  teaching_narrative text,
  refreshed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: public.voice_reminders
CREATE TABLE IF NOT EXISTS public.voice_reminders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  message text NOT NULL,
  remind_at timestamp with time zone NOT NULL,
  delivered boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: public.weekly_battle_plans
CREATE TABLE IF NOT EXISTS public.weekly_battle_plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  moves jsonb DEFAULT '[]'::jsonb NOT NULL,
  strategy_summary text,
  quota_gap numeric,
  days_remaining integer,
  moves_completed jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.weekly_research_queue
CREATE TABLE IF NOT EXISTS public.weekly_research_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  assignments jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.weekly_reviews
CREATE TABLE IF NOT EXISTS public.weekly_reviews (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
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
  avg_sentiment numeric,
  biggest_win text DEFAULT ''::text,
  biggest_failure text DEFAULT ''::text,
  failure_change_plan text DEFAULT ''::text,
  commitment_for_week text DEFAULT ''::text,
  key_goals jsonb DEFAULT '[]'::jsonb,
  key_client_meetings text DEFAULT ''::text,
  skill_development text DEFAULT ''::text,
  north_star_goals jsonb DEFAULT '[]'::jsonb,
  completed boolean DEFAULT false NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Table: public.work_schedule_config
CREATE TABLE IF NOT EXISTS public.work_schedule_config (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  working_days integer[] DEFAULT ARRAY[1, 2, 3, 4, 5] NOT NULL,
  reminder_enabled boolean DEFAULT true NOT NULL,
  reminder_time time without time zone DEFAULT '16:30:00'::time without time zone NOT NULL,
  grace_window_hours integer DEFAULT 2 NOT NULL,
  goal_daily_score_threshold integer DEFAULT 8 NOT NULL,
  goal_productivity_threshold integer DEFAULT 75 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid,
  eod_checkin_time time without time zone DEFAULT '16:30:00'::time without time zone NOT NULL,
  eod_reminder_time time without time zone DEFAULT '18:30:00'::time without time zone NOT NULL,
  morning_confirm_time time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
  grace_window_end_time time without time zone DEFAULT '02:00:00'::time without time zone NOT NULL
);

-- Table: public.workday_overrides
CREATE TABLE IF NOT EXISTS public.workday_overrides (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  date date NOT NULL,
  is_workday boolean NOT NULL,
  reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid
);

ALTER TABLE ONLY public._agent_staging ADD CONSTRAINT _agent_staging_pkey PRIMARY KEY (job, row_id);

ALTER TABLE ONLY public.account_contacts ADD CONSTRAINT account_contacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_dossiers ADD CONSTRAINT account_dossiers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_product_ownership ADD CONSTRAINT account_product_ownership_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_project_settings ADD CONSTRAINT account_project_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_risks ADD CONSTRAINT account_risks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_signals ADD CONSTRAINT account_signals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_strategy_memory ADD CONSTRAINT account_strategy_memory_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_configs ADD CONSTRAINT agent_configs_pkey PRIMARY KEY (agent);

ALTER TABLE ONLY public.agent_events ADD CONSTRAINT agent_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_trust ADD CONSTRAINT agent_trust_pkey PRIMARY KEY (agent);

ALTER TABLE ONLY public.ai_feedback ADD CONSTRAINT ai_feedback_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.approved_users ADD CONSTRAINT approved_users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.asset_provenance ADD CONSTRAINT asset_provenance_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audio_jobs ADD CONSTRAINT audio_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.background_jobs ADD CONSTRAINT background_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.badges_earned ADD CONSTRAINT badges_earned_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.batch_run_jobs ADD CONSTRAINT batch_run_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.batch_runs ADD CONSTRAINT batch_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.block_snapshots ADD CONSTRAINT block_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.branch_footprint ADD CONSTRAINT branch_footprint_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.branch_pov ADD CONSTRAINT branch_pov_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_events ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.call_logs ADD CONSTRAINT call_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.call_transcripts ADD CONSTRAINT call_transcripts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.canary_reviews ADD CONSTRAINT canary_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.circle_credentials ADD CONSTRAINT circle_credentials_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.closed_loop_sessions ADD CONSTRAINT closed_loop_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cluster_resolutions ADD CONSTRAINT cluster_resolutions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.coaching_plans ADD CONSTRAINT coaching_plans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.command_feedback ADD CONSTRAINT command_feedback_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.command_shortcuts ADD CONSTRAINT command_shortcuts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.contacts ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.conversion_benchmarks ADD CONSTRAINT conversion_benchmarks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_imports ADD CONSTRAINT course_imports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_lesson_imports ADD CONSTRAINT course_lesson_imports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_lessons ADD CONSTRAINT course_lessons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.curriculum_concepts ADD CONSTRAINT curriculum_concepts_pkey PRIMARY KEY (concept_id);

ALTER TABLE ONLY public.curriculum_gates ADD CONSTRAINT curriculum_gates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.custom_prompts ADD CONSTRAINT custom_prompts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.daily_assignments ADD CONSTRAINT daily_assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.daily_digest_items ADD CONSTRAINT daily_digest_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.daily_journal_entries ADD CONSTRAINT daily_journal_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.daily_plan_preferences ADD CONSTRAINT daily_plan_preferences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.daily_time_blocks ADD CONSTRAINT daily_time_blocks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dave_transcripts ADD CONSTRAINT dave_transcripts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.deal_patterns ADD CONSTRAINT deal_patterns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dismissed_action_items ADD CONSTRAINT dismissed_action_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dismissed_duplicates ADD CONSTRAINT dismissed_duplicates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dojo_session_turns ADD CONSTRAINT dojo_session_turns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.dojo_sessions ADD CONSTRAINT dojo_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.enrichment_attempts ADD CONSTRAINT enrichment_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.error_logs ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.execution_outputs ADD CONSTRAINT execution_outputs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.execution_templates ADD CONSTRAINT execution_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.extraction_batches ADD CONSTRAINT extraction_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.extraction_pipeline_jobs ADD CONSTRAINT extraction_pipeline_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.extraction_runs ADD CONSTRAINT extraction_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.flashcard_decks ADD CONSTRAINT flashcard_decks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.flashcard_state ADD CONSTRAINT flashcard_state_pkey PRIMARY KEY (user_id, card_id);

ALTER TABLE ONLY public.flashcards ADD CONSTRAINT flashcards_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.function_configs ADD CONSTRAINT function_configs_pkey PRIMARY KEY (function_name);

ALTER TABLE ONLY public.holidays ADD CONSTRAINT holidays_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.icp_sourced_accounts ADD CONSTRAINT icp_sourced_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.import_account_aliases ADD CONSTRAINT import_account_aliases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.import_header_mappings ADD CONSTRAINT import_header_mappings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.import_value_mappings ADD CONSTRAINT import_value_mappings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_runs ADD CONSTRAINT integration_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.intelligence_units ADD CONSTRAINT intelligence_units_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ki_annotations ADD CONSTRAINT ki_annotations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ki_curriculum ADD CONSTRAINT ki_curriculum_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ki_mastery ADD CONSTRAINT ki_mastery_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.knowledge_items ADD CONSTRAINT knowledge_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.knowledge_signals ADD CONSTRAINT knowledge_signals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.knowledge_usage_log ADD CONSTRAINT knowledge_usage_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_courses ADD CONSTRAINT learning_courses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_lessons ADD CONSTRAINT learning_lessons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_modules ADD CONSTRAINT learning_modules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_progress ADD CONSTRAINT learning_progress_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_quiz_answers ADD CONSTRAINT learning_quiz_answers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lesson_assets ADD CONSTRAINT lesson_assets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.library_cards ADD CONSTRAINT library_cards_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.library_reconciliation_items ADD CONSTRAINT library_reconciliation_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.library_reconciliation_runs ADD CONSTRAINT library_reconciliation_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lifecycle_audit_events ADD CONSTRAINT lifecycle_audit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mock_call_sessions ADD CONSTRAINT mock_call_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.nav_events ADD CONSTRAINT nav_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.opportunities ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.opportunity_methodology ADD CONSTRAINT opportunity_methodology_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.opportunity_strategy_memory ADD CONSTRAINT opportunity_strategy_memory_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pipeline_diagnoses ADD CONSTRAINT pipeline_diagnoses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pipeline_hygiene_scans ADD CONSTRAINT pipeline_hygiene_scans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pipeline_runs ADD CONSTRAINT pipeline_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.playbook_feedback ADD CONSTRAINT playbook_feedback_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.playbook_usage_events ADD CONSTRAINT playbook_usage_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.playbooks ADD CONSTRAINT playbooks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.podcast_import_queue ADD CONSTRAINT podcast_import_queue_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.power_hour_sessions ADD CONSTRAINT power_hour_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pto_days ADD CONSTRAINT pto_days_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.quota_targets ADD CONSTRAINT quota_targets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.renewals ADD CONSTRAINT renewals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.research_queue_events ADD CONSTRAINT research_queue_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_chunks ADD CONSTRAINT resource_chunks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_collection_members ADD CONSTRAINT resource_collection_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_collections ADD CONSTRAINT resource_collections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_digests ADD CONSTRAINT resource_digests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_extraction_attempts ADD CONSTRAINT resource_extraction_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_folders ADD CONSTRAINT resource_folders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_job_steps ADD CONSTRAINT resource_job_steps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_jobs ADD CONSTRAINT resource_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_links ADD CONSTRAINT resource_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_usage_events ADD CONSTRAINT resource_usage_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resource_versions ADD CONSTRAINT resource_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.resources ADD CONSTRAINT resources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routing_decisions ADD CONSTRAINT routing_decisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sales_age_snapshots ADD CONSTRAINT sales_age_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.skill_benchmarks ADD CONSTRAINT skill_benchmarks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.skill_builder_sessions ADD CONSTRAINT skill_builder_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.smoke_test_results ADD CONSTRAINT smoke_test_results_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.source_registry ADD CONSTRAINT source_registry_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stage_playbooks ADD CONSTRAINT stage_playbooks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stage_resources ADD CONSTRAINT stage_resources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_artifact_feedback ADD CONSTRAINT strategy_artifact_feedback_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_artifacts ADD CONSTRAINT strategy_artifacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_benchmark_audit_logs ADD CONSTRAINT strategy_benchmark_audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_benchmark_runs ADD CONSTRAINT strategy_benchmark_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_custom_pills ADD CONSTRAINT strategy_custom_pills_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_messages ADD CONSTRAINT strategy_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_outcomes ADD CONSTRAINT strategy_outcomes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_outputs ADD CONSTRAINT strategy_outputs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_rollups ADD CONSTRAINT strategy_rollups_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_run_telemetry ADD CONSTRAINT strategy_run_telemetry_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_stress_runs ADD CONSTRAINT strategy_stress_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_stress_turns ADD CONSTRAINT strategy_stress_turns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_synthesis_cache ADD CONSTRAINT strategy_synthesis_cache_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_thread_conflicts ADD CONSTRAINT strategy_thread_conflicts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_thread_resources ADD CONSTRAINT strategy_thread_resources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_threads ADD CONSTRAINT strategy_threads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_uploaded_resources ADD CONSTRAINT strategy_uploaded_resources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strategy_workflow_runs ADD CONSTRAINT strategy_workflow_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.streak_events ADD CONSTRAINT streak_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.streak_summary ADD CONSTRAINT streak_summary_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_run_sections ADD CONSTRAINT task_run_sections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_runs ADD CONSTRAINT task_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.task_templates ADD CONSTRAINT task_templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.template_suggestions ADD CONSTRAINT template_suggestions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.territory_profile ADD CONSTRAINT territory_profile_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.territory_strategy_memory ADD CONSTRAINT territory_strategy_memory_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.training_blocks ADD CONSTRAINT training_blocks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transcript_grades ADD CONSTRAINT transcript_grades_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_band_gate ADD CONSTRAINT user_band_gate_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_competency ADD CONSTRAINT user_competency_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_lesson_progress ADD CONSTRAINT user_lesson_progress_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_settings ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.user_train_prefs ADD CONSTRAINT user_train_prefs_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.verification_runs ADD CONSTRAINT verification_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.vertical_briefs ADD CONSTRAINT vertical_briefs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.verticals ADD CONSTRAINT verticals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.voice_reminders ADD CONSTRAINT voice_reminders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.weekly_battle_plans ADD CONSTRAINT weekly_battle_plans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.weekly_research_queue ADD CONSTRAINT weekly_research_queue_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.weekly_reviews ADD CONSTRAINT weekly_reviews_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.work_schedule_config ADD CONSTRAINT work_schedule_config_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workday_overrides ADD CONSTRAINT workday_overrides_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_dossiers ADD CONSTRAINT account_dossiers_account_id_version_key UNIQUE (account_id, version);

ALTER TABLE ONLY public.account_product_ownership ADD CONSTRAINT account_product_ownership_account_id_product_id_key UNIQUE (account_id, product_id);

ALTER TABLE ONLY public.account_project_settings ADD CONSTRAINT account_project_settings_user_id_account_family_key UNIQUE (user_id, account_family);

ALTER TABLE ONLY public.approved_users ADD CONSTRAINT approved_users_email_key UNIQUE (email);

ALTER TABLE ONLY public.branch_footprint ADD CONSTRAINT branch_footprint_account_id_user_id_key UNIQUE (account_id, user_id);

ALTER TABLE ONLY public.branch_pov ADD CONSTRAINT branch_pov_account_id_surface_version_key UNIQUE (account_id, surface, version);

ALTER TABLE ONLY public.calendar_events ADD CONSTRAINT calendar_events_external_id_key UNIQUE (external_id);

ALTER TABLE ONLY public.circle_credentials ADD CONSTRAINT circle_credentials_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.conversion_benchmarks ADD CONSTRAINT conversion_benchmarks_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.course_lesson_imports ADD CONSTRAINT course_lesson_imports_user_lesson_course_unique UNIQUE (user_id, lesson_url, original_course_url);

ALTER TABLE ONLY public.curriculum_concepts ADD CONSTRAINT curriculum_concepts_spoke_topic_sub_level_order_in_sublevel_key UNIQUE (spoke, topic, sub_level, order_in_sublevel);

ALTER TABLE ONLY public.curriculum_gates ADD CONSTRAINT curriculum_gates_spoke_topic_band_key UNIQUE (spoke, topic, band);

ALTER TABLE ONLY public.daily_assignments ADD CONSTRAINT daily_assignments_user_id_assignment_date_key UNIQUE (user_id, assignment_date);

ALTER TABLE ONLY public.daily_journal_entries ADD CONSTRAINT daily_journal_entries_user_date_unique UNIQUE (user_id, date);

ALTER TABLE ONLY public.daily_journal_entries ADD CONSTRAINT daily_journal_entries_user_id_date_key UNIQUE (user_id, date);

ALTER TABLE ONLY public.daily_plan_preferences ADD CONSTRAINT daily_plan_preferences_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.daily_time_blocks ADD CONSTRAINT daily_time_blocks_user_id_plan_date_key UNIQUE (user_id, plan_date);

ALTER TABLE ONLY public.dismissed_action_items ADD CONSTRAINT dismissed_action_items_user_id_record_id_key UNIQUE (user_id, record_id);

ALTER TABLE ONLY public.dismissed_duplicates ADD CONSTRAINT dismissed_duplicates_user_type_key_unique UNIQUE (user_id, record_type, duplicate_key);

ALTER TABLE ONLY public.extraction_batches ADD CONSTRAINT extraction_batches_resource_id_batch_index_key UNIQUE (resource_id, batch_index);

ALTER TABLE ONLY public.flashcard_decks ADD CONSTRAINT flashcard_decks_source_type_source_ref_key UNIQUE (source_type, source_ref);

ALTER TABLE ONLY public.flashcards ADD CONSTRAINT flashcards_deck_id_ki_id_card_type_key UNIQUE (deck_id, ki_id, card_type);

ALTER TABLE ONLY public.holidays ADD CONSTRAINT holidays_date_key UNIQUE (date);

ALTER TABLE ONLY public.import_account_aliases ADD CONSTRAINT import_account_aliases_user_id_alias_type_alias_value_key UNIQUE (user_id, alias_type, alias_value);

ALTER TABLE ONLY public.import_header_mappings ADD CONSTRAINT import_header_mappings_user_id_csv_header_key UNIQUE (user_id, csv_header);

ALTER TABLE ONLY public.import_value_mappings ADD CONSTRAINT import_value_mappings_user_id_field_name_csv_value_key UNIQUE (user_id, field_name, csv_value);

ALTER TABLE ONLY public.ki_annotations ADD CONSTRAINT ki_annotations_user_id_ki_id_key UNIQUE (user_id, ki_id);

ALTER TABLE ONLY public.ki_curriculum ADD CONSTRAINT ki_curriculum_concept_id_ki_id_key UNIQUE (concept_id, ki_id);

ALTER TABLE ONLY public.ki_mastery ADD CONSTRAINT ki_mastery_user_id_ki_id_key UNIQUE (user_id, ki_id);

ALTER TABLE ONLY public.learning_courses ADD CONSTRAINT learning_courses_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.learning_progress ADD CONSTRAINT learning_progress_user_id_lesson_id_key UNIQUE (user_id, lesson_id);

ALTER TABLE ONLY public.opportunity_methodology ADD CONSTRAINT opportunity_methodology_user_id_opportunity_id_key UNIQUE (user_id, opportunity_id);

ALTER TABLE ONLY public.pipeline_hygiene_scans ADD CONSTRAINT pipeline_hygiene_scans_user_id_scan_date_key UNIQUE (user_id, scan_date);

ALTER TABLE ONLY public.products ADD CONSTRAINT products_user_id_name_key UNIQUE (user_id, name);

ALTER TABLE ONLY public.pto_days ADD CONSTRAINT pto_days_date_key UNIQUE (date);

ALTER TABLE ONLY public.quota_targets ADD CONSTRAINT quota_targets_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.research_queue_events ADD CONSTRAINT research_queue_events_user_id_account_id_week_start_event_t_key UNIQUE (user_id, account_id, week_start, event_type);

ALTER TABLE ONLY public.resource_collection_members ADD CONSTRAINT resource_collection_members_collection_id_resource_id_key UNIQUE (collection_id, resource_id);

ALTER TABLE ONLY public.resource_digests ADD CONSTRAINT resource_digests_resource_id_key UNIQUE (resource_id);

ALTER TABLE ONLY public.sales_age_snapshots ADD CONSTRAINT sales_age_snapshots_user_id_week_ending_key UNIQUE (user_id, week_ending);

ALTER TABLE ONLY public.stage_playbooks ADD CONSTRAINT stage_playbooks_user_id_stage_id_key UNIQUE (user_id, stage_id);

ALTER TABLE ONLY public.stage_resources ADD CONSTRAINT stage_resources_user_id_stage_id_resource_id_key UNIQUE (user_id, stage_id, resource_id);

ALTER TABLE ONLY public.strategy_synthesis_cache ADD CONSTRAINT strategy_synthesis_cache_user_id_cache_key_key UNIQUE (user_id, cache_key);

ALTER TABLE ONLY public.streak_events ADD CONSTRAINT streak_events_date_key UNIQUE (date);

ALTER TABLE ONLY public.streak_events ADD CONSTRAINT streak_events_user_date_unique UNIQUE (user_id, date);

ALTER TABLE ONLY public.task_run_sections ADD CONSTRAINT task_run_sections_run_id_batch_index_key UNIQUE (run_id, batch_index);

ALTER TABLE ONLY public.territory_profile ADD CONSTRAINT territory_profile_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.training_blocks ADD CONSTRAINT training_blocks_user_id_block_number_key UNIQUE (user_id, block_number);

ALTER TABLE ONLY public.transcript_grades ADD CONSTRAINT transcript_grades_transcript_id_key UNIQUE (transcript_id);

ALTER TABLE ONLY public.user_band_gate ADD CONSTRAINT user_band_gate_user_id_spoke_topic_band_key UNIQUE (user_id, spoke, topic, band);

ALTER TABLE ONLY public.user_competency ADD CONSTRAINT user_competency_user_id_spoke_topic_sub_level_key UNIQUE (user_id, spoke, topic, sub_level);

ALTER TABLE ONLY public.user_lesson_progress ADD CONSTRAINT user_lesson_progress_user_id_lesson_id_key UNIQUE (user_id, lesson_id);

ALTER TABLE ONLY public.vertical_briefs ADD CONSTRAINT vertical_briefs_vertical_id_version_key UNIQUE (vertical_id, version);

ALTER TABLE ONLY public.verticals ADD CONSTRAINT verticals_name_key UNIQUE (name);

ALTER TABLE ONLY public.weekly_battle_plans ADD CONSTRAINT weekly_battle_plans_user_id_week_start_key UNIQUE (user_id, week_start);

ALTER TABLE ONLY public.weekly_research_queue ADD CONSTRAINT weekly_research_queue_user_id_week_start_key UNIQUE (user_id, week_start);

ALTER TABLE ONLY public.weekly_reviews ADD CONSTRAINT weekly_reviews_user_id_week_start_key UNIQUE (user_id, week_start);

ALTER TABLE ONLY public.workday_overrides ADD CONSTRAINT workday_overrides_date_key UNIQUE (date);

ALTER TABLE ONLY public.account_risks ADD CONSTRAINT account_risks_likelihood_check CHECK (likelihood >= 1 AND likelihood <= 5);

ALTER TABLE ONLY public.account_risks ADD CONSTRAINT account_risks_risk_type_check CHECK (risk_type = ANY (ARRAY['competitor_presence'::text, 'champion_departure'::text, 'renewal_exposure'::text, 'budget_freeze'::text, 'org_change'::text, 'sentiment_shift'::text]));

ALTER TABLE ONLY public.account_risks ADD CONSTRAINT account_risks_severity_check CHECK (severity >= 1 AND severity <= 5);

ALTER TABLE ONLY public.account_risks ADD CONSTRAINT account_risks_status_check CHECK (status = ANY (ARRAY['identified'::text, 'monitoring'::text, 'mitigating'::text, 'realized'::text, 'retired'::text]));

ALTER TABLE ONLY public.account_signals ADD CONSTRAINT account_signals_intelligence_head_check CHECK (intelligence_head = ANY (ARRAY['sales'::text, 'product'::text, 'competitive'::text, 'market'::text]));

ALTER TABLE ONLY public.account_signals ADD CONSTRAINT account_signals_signal_class_check CHECK (signal_class = ANY (ARRAY['window'::text, 'specimen'::text, 'evergreen'::text]));

ALTER TABLE ONLY public.account_signals ADD CONSTRAINT account_signals_signal_type_check CHECK (signal_type = ANY (ARRAY['account'::text, 'competitive'::text, 'product'::text, 'market'::text, 'strategic'::text]));

ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_account_status_check CHECK (account_status = ANY (ARRAY['inactive'::text, 'researched'::text, 'active'::text, 'meeting-booked'::text, 'disqualified'::text]));

ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_motion_check CHECK (motion = ANY (ARRAY['new-logo'::text, 'renewal'::text, 'general'::text, 'both'::text]));

ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_outreach_status_check CHECK (outreach_status = ANY (ARRAY['not-started'::text, 'in-progress'::text, 'working'::text, 'nurture'::text, 'meeting-set'::text, 'opp-open'::text, 'closed-won'::text, 'closed-lost'::text]));

ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_priority_check CHECK (priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]));

ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_tech_fit_flag_check CHECK (tech_fit_flag = ANY (ARRAY['good'::text, 'watch'::text, 'disqualify'::text]));

ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_tier_check CHECK (tier = ANY (ARRAY['A'::text, 'B'::text, 'C'::text]));

ALTER TABLE ONLY public.agent_configs ADD CONSTRAINT agent_configs_caste_check CHECK (caste = ANY (ARRAY['scout'::text, 'analyst'::text, 'synthesizer'::text, 'coach'::text, 'custodian'::text, 'adversary'::text, 'historian'::text, 'cartographer'::text, 'professor'::text, 'governor'::text, 'steward'::text, 'council'::text]));

ALTER TABLE ONLY public.agent_configs ADD CONSTRAINT agent_configs_home_check CHECK (home = ANY (ARRAY['pg_cron'::text, 'n8n'::text, 'edge_function'::text, 'claude_api'::text, 'claude_steward'::text]));

ALTER TABLE ONLY public.agent_events ADD CONSTRAINT agent_events_confidence_check CHECK (confidence >= 0::numeric AND confidence <= 1::numeric);

ALTER TABLE ONLY public.agent_events ADD CONSTRAINT agent_events_signal_class_check CHECK (signal_class = ANY (ARRAY['window'::text, 'specimen'::text, 'evergreen'::text]));

ALTER TABLE ONLY public.agent_events ADD CONSTRAINT agent_events_status_check CHECK (status = ANY (ARRAY['proposed'::text, 'processing'::text, 'ratified'::text, 'rejected'::text, 'consumed'::text, 'expired'::text]));

ALTER TABLE ONLY public.asset_provenance ADD CONSTRAINT asset_provenance_asset_type_check CHECK (asset_type = ANY (ARRAY['template'::text, 'example'::text, 'tactic'::text, 'knowledge'::text]));

ALTER TABLE ONLY public.block_snapshots ADD CONSTRAINT block_snapshots_snapshot_type_check CHECK (snapshot_type = ANY (ARRAY['benchmark'::text, 'retest'::text, 'weekly'::text]));

ALTER TABLE ONLY public.branch_pov ADD CONSTRAINT branch_pov_conviction_check CHECK (conviction >= 1 AND conviction <= 5);

ALTER TABLE ONLY public.branch_pov ADD CONSTRAINT branch_pov_target_status_check CHECK (target_status = ANY (ARRAY['should_own'::text, 'should_expand'::text, 'not_fit'::text, 'unknown'::text]));

ALTER TABLE ONLY public.canary_reviews ADD CONSTRAINT canary_reviews_decision_check CHECK (decision = ANY (ARRAY['continue'::text, 'fix'::text, 'rollback'::text]));

ALTER TABLE ONLY public.canary_reviews ADD CONSTRAINT canary_reviews_recommendation_check CHECK (recommendation = ANY (ARRAY['continue'::text, 'fix'::text, 'rollback'::text]));

ALTER TABLE ONLY public.contacts ADD CONSTRAINT contacts_status_check CHECK (status = ANY (ARRAY['target'::text, 'engaged'::text, 'unresponsive'::text, 'not-fit'::text]));

ALTER TABLE ONLY public.curriculum_concepts ADD CONSTRAINT curriculum_concepts_band_check CHECK (band >= 1 AND band <= 5);

ALTER TABLE ONLY public.curriculum_concepts ADD CONSTRAINT curriculum_concepts_teach_beat_status_check CHECK (teach_beat_status = ANY (ARRAY['ready'::text, 'pending'::text]));

ALTER TABLE ONLY public.curriculum_concepts ADD CONSTRAINT curriculum_concepts_teach_kind_check CHECK (teach_kind = ANY (ARRAY['ki_exemplar'::text, 'authored'::text]));

ALTER TABLE ONLY public.curriculum_gates ADD CONSTRAINT curriculum_gates_band_check CHECK (band >= 1 AND band <= 5);

ALTER TABLE ONLY public.curriculum_gates ADD CONSTRAINT curriculum_gates_item_strategy_check CHECK (item_strategy = ANY (ARRAY['band_exemplars'::text, 'authored'::text]));

ALTER TABLE ONLY public.daily_assignments ADD CONSTRAINT daily_assignments_day_anchor_check CHECK (day_anchor = ANY (ARRAY['opening_cold_call'::text, 'discovery_qualification'::text, 'objection_pricing'::text, 'deal_control_negotiation'::text, 'executive_roi_mixed'::text]));

ALTER TABLE ONLY public.daily_assignments ADD CONSTRAINT daily_assignments_difficulty_check CHECK (difficulty = ANY (ARRAY['foundational'::text, 'intermediate'::text, 'advanced'::text]));

ALTER TABLE ONLY public.daily_assignments ADD CONSTRAINT daily_assignments_retry_strategy_check CHECK (retry_strategy = ANY (ARRAY['weakest'::text, 'variation'::text, 'skip'::text]));

ALTER TABLE ONLY public.daily_assignments ADD CONSTRAINT daily_assignments_source_check CHECK (source = ANY (ARRAY['weakness'::text, 'coverage'::text, 'transcript'::text, 'progression'::text, 'benchmark'::text]));

ALTER TABLE ONLY public.daily_journal_entries ADD CONSTRAINT daily_journal_entries_clarity_check CHECK (clarity >= 1 AND clarity <= 5);

ALTER TABLE ONLY public.daily_journal_entries ADD CONSTRAINT daily_journal_entries_energy_check CHECK (energy >= 1 AND energy <= 5);

ALTER TABLE ONLY public.daily_journal_entries ADD CONSTRAINT daily_journal_entries_focus_quality_check CHECK (focus_quality >= 1 AND focus_quality <= 5);

ALTER TABLE ONLY public.daily_journal_entries ADD CONSTRAINT daily_journal_entries_stress_check CHECK (stress >= 1 AND stress <= 5);

ALTER TABLE ONLY public.dojo_sessions ADD CONSTRAINT dojo_sessions_mode_check CHECK (mode = ANY (ARRAY['autopilot'::text, 'custom'::text]));

ALTER TABLE ONLY public.dojo_sessions ADD CONSTRAINT dojo_sessions_session_type_check CHECK (session_type = ANY (ARRAY['drill'::text, 'quiz'::text, 'spar'::text, 'review'::text]));

ALTER TABLE ONLY public.dojo_sessions ADD CONSTRAINT dojo_sessions_status_check CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'abandoned'::text]));

ALTER TABLE ONLY public.flashcard_decks ADD CONSTRAINT flashcard_decks_generation_status_check CHECK (generation_status = ANY (ARRAY['empty'::text, 'generating'::text, 'complete'::text, 'failed'::text]));

ALTER TABLE ONLY public.flashcard_decks ADD CONSTRAINT flashcard_decks_source_type_check CHECK (source_type = ANY (ARRAY['curriculum_topic'::text, 'resource'::text, 'chapter'::text]));

ALTER TABLE ONLY public.flashcard_state ADD CONSTRAINT flashcard_state_confidence_check CHECK (confidence >= 1 AND confidence <= 5);

ALTER TABLE ONLY public.flashcards ADD CONSTRAINT flashcards_card_type_check CHECK (card_type = ANY (ARRAY['trigger'::text, 'definition'::text, 'talk_track'::text]));

ALTER TABLE ONLY public.ki_curriculum ADD CONSTRAINT ki_curriculum_role_check CHECK (role = ANY (ARRAY['teach'::text, 'drill'::text, 'gate'::text]));

ALTER TABLE ONLY public.knowledge_items ADD CONSTRAINT knowledge_items_intelligence_type_check CHECK (intelligence_type = ANY (ARRAY['sales'::text, 'product'::text, 'competitive'::text, 'market'::text]));

ALTER TABLE ONLY public.knowledge_items ADD CONSTRAINT knowledge_items_library_role_check CHECK (library_role = ANY (ARRAY['standard'::text, 'tactic'::text, 'pattern'::text, 'exemplar'::text]));

ALTER TABLE ONLY public.library_cards ADD CONSTRAINT library_cards_library_role_check CHECK (library_role = ANY (ARRAY['standard'::text, 'tactic'::text, 'pattern'::text, 'exemplar'::text]));

ALTER TABLE ONLY public.library_cards ADD CONSTRAINT library_cards_source_type_check CHECK (source_type = ANY (ARRAY['knowledge_item'::text, 'playbook'::text, 'transcript'::text]));

ALTER TABLE ONLY public.opportunities ADD CONSTRAINT opportunities_churn_risk_check CHECK (churn_risk = ANY (ARRAY['certain'::text, 'high'::text, 'medium'::text, 'low'::text]));

ALTER TABLE ONLY public.opportunities ADD CONSTRAINT opportunities_deal_type_check CHECK (deal_type = ANY (ARRAY['new-logo'::text, 'expansion'::text, 'renewal'::text, 'one-time'::text]));

ALTER TABLE ONLY public.opportunities ADD CONSTRAINT opportunities_payment_terms_check CHECK (payment_terms = ANY (ARRAY['annual'::text, 'prepaid'::text, 'other'::text]));

ALTER TABLE ONLY public.opportunities ADD CONSTRAINT opportunities_status_check CHECK (status = ANY (ARRAY['active'::text, 'stalled'::text, 'closed-lost'::text, 'closed-won'::text]));

ALTER TABLE ONLY public.playbook_feedback ADD CONSTRAINT playbook_feedback_feedback_type_check CHECK (feedback_type = ANY (ARRAY['section_useful'::text, 'section_not_useful'::text, 'wrong_section'::text, 'too_generic'::text]));

ALTER TABLE ONLY public.playbook_feedback ADD CONSTRAINT playbook_feedback_target_type_check CHECK (target_type = ANY (ARRAY['section'::text, 'ki_placement'::text, 'playbook_item'::text]));

ALTER TABLE ONLY public.playbooks ADD CONSTRAINT playbooks_library_role_check CHECK (library_role = ANY (ARRAY['standard'::text, 'tactic'::text, 'pattern'::text, 'exemplar'::text]));

ALTER TABLE ONLY public.renewals ADD CONSTRAINT renewals_churn_risk_check CHECK (churn_risk = ANY (ARRAY['certain'::text, 'high'::text, 'medium'::text, 'low'::text]));

ALTER TABLE ONLY public.renewals ADD CONSTRAINT renewals_health_status_check CHECK (health_status = ANY (ARRAY['green'::text, 'yellow'::text, 'red'::text]));

ALTER TABLE ONLY public.routing_decisions ADD CONSTRAINT routing_decisions_lane_check CHECK (lane = ANY (ARRAY['direct'::text, 'assisted'::text, 'deep_work'::text]));

ALTER TABLE ONLY public.routing_decisions ADD CONSTRAINT routing_decisions_override_used_check CHECK (override_used = ANY (ARRAY['quick'::text, 'deep'::text, 'auto'::text]));

ALTER TABLE ONLY public.strategy_benchmark_audit_logs ADD CONSTRAINT strategy_benchmark_audit_logs_event_level_check CHECK (event_level = ANY (ARRAY['info'::text, 'warn'::text, 'error'::text]));

ALTER TABLE ONLY public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_confirmed_class_check CHECK (confirmed_class IS NULL OR (confirmed_class = ANY (ARRAY['research_only'::text, 'shared_intelligence'::text, 'crm_contact'::text])));

ALTER TABLE ONLY public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_proposal_type_check CHECK (proposal_type = ANY (ARRAY['contact'::text, 'account_note'::text, 'account_intelligence'::text, 'opportunity_note'::text, 'opportunity_intelligence'::text, 'transcript'::text, 'resource_promotion'::text, 'artifact_promotion'::text, 'stakeholder'::text, 'risk'::text, 'blocker'::text, 'champion'::text]));

ALTER TABLE ONLY public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_status_check CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'confirmed_research_only'::text, 'confirmed_shared_intelligence'::text, 'confirmed_crm_contact'::text, 'promoted'::text, 'rejected'::text, 'failed'::text, 'superseded'::text]));

ALTER TABLE ONLY public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_target_scope_check CHECK (target_scope = ANY (ARRAY['account'::text, 'opportunity'::text, 'both'::text]));

ALTER TABLE ONLY public.strategy_thread_conflicts ADD CONSTRAINT strategy_thread_conflicts_severity_check CHECK (severity = ANY (ARRAY['warning'::text, 'blocking'::text]));

ALTER TABLE ONLY public.strategy_threads ADD CONSTRAINT strategy_threads_trust_state_check CHECK (trust_state = ANY (ARRAY['safe'::text, 'warning'::text, 'blocked'::text]));

ALTER TABLE ONLY public.training_blocks ADD CONSTRAINT training_blocks_current_week_check CHECK (current_week >= 1 AND current_week <= 8);

ALTER TABLE ONLY public.training_blocks ADD CONSTRAINT training_blocks_phase_check CHECK (phase = ANY (ARRAY['benchmark'::text, 'foundation'::text, 'build'::text, 'peak'::text, 'retest'::text]));

ALTER TABLE ONLY public.training_blocks ADD CONSTRAINT training_blocks_stage_check CHECK (stage = ANY (ARRAY['foundation'::text, 'integration'::text, 'enterprise'::text]));

ALTER TABLE ONLY public.training_blocks ADD CONSTRAINT training_blocks_status_check CHECK (status = ANY (ARRAY['active'::text, 'completed'::text]));

ALTER TABLE ONLY public.transcript_grades ADD CONSTRAINT transcript_grades_product_knowledge_score_check CHECK (product_knowledge_score >= 1 AND product_knowledge_score <= 5);

ALTER TABLE ONLY public.user_band_gate ADD CONSTRAINT user_band_gate_band_check CHECK (band >= 1 AND band <= 5);

ALTER TABLE ONLY public.user_band_gate ADD CONSTRAINT user_band_gate_status_check CHECK (status = ANY (ARRAY['locked'::text, 'available'::text, 'passed'::text, 'failed'::text]));

ALTER TABLE ONLY public.user_competency ADD CONSTRAINT user_competency_band_check CHECK (band >= 1 AND band <= 5);

ALTER TABLE ONLY public.user_competency ADD CONSTRAINT user_competency_progress_check CHECK (progress >= 0::numeric AND progress <= 1::numeric);

ALTER TABLE ONLY public.account_contacts ADD CONSTRAINT account_contacts_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_contacts ADD CONSTRAINT account_contacts_renewal_id_fkey FOREIGN KEY (renewal_id) REFERENCES renewals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_contacts ADD CONSTRAINT account_contacts_source_proposal_id_fkey FOREIGN KEY (source_proposal_id) REFERENCES strategy_promotion_proposals(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.account_contacts ADD CONSTRAINT account_contacts_source_strategy_thread_id_fkey FOREIGN KEY (source_strategy_thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.account_dossiers ADD CONSTRAINT account_dossiers_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_product_ownership ADD CONSTRAINT account_product_ownership_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_product_ownership ADD CONSTRAINT account_product_ownership_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_product_ownership ADD CONSTRAINT account_product_ownership_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_project_settings ADD CONSTRAINT account_project_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_risks ADD CONSTRAINT account_risks_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_signals ADD CONSTRAINT account_signals_linked_account_id_fkey FOREIGN KEY (linked_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.account_signals ADD CONSTRAINT account_signals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.account_strategy_memory ADD CONSTRAINT account_strategy_memory_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.account_strategy_memory ADD CONSTRAINT account_strategy_memory_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES strategy_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.account_strategy_memory ADD CONSTRAINT account_strategy_memory_source_proposal_id_fkey FOREIGN KEY (source_proposal_id) REFERENCES strategy_promotion_proposals(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.account_strategy_memory ADD CONSTRAINT account_strategy_memory_source_thread_id_fkey FOREIGN KEY (source_thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_parent_account_id_fkey FOREIGN KEY (parent_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_vertical_id_fkey FOREIGN KEY (vertical_id) REFERENCES verticals(id);

ALTER TABLE ONLY public.agent_events ADD CONSTRAINT agent_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.approved_users ADD CONSTRAINT approved_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.badges_earned ADD CONSTRAINT badges_earned_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.batch_run_jobs ADD CONSTRAINT batch_run_jobs_batch_run_id_fkey FOREIGN KEY (batch_run_id) REFERENCES batch_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.batch_runs ADD CONSTRAINT batch_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.block_snapshots ADD CONSTRAINT block_snapshots_block_id_fkey FOREIGN KEY (block_id) REFERENCES training_blocks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.branch_footprint ADD CONSTRAINT branch_footprint_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.branch_footprint ADD CONSTRAINT branch_footprint_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.branch_pov ADD CONSTRAINT branch_pov_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.calendar_events ADD CONSTRAINT calendar_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.call_logs ADD CONSTRAINT call_logs_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_logs ADD CONSTRAINT call_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.call_transcripts ADD CONSTRAINT call_transcripts_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_transcripts ADD CONSTRAINT call_transcripts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_transcripts ADD CONSTRAINT call_transcripts_renewal_id_fkey FOREIGN KEY (renewal_id) REFERENCES renewals(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_transcripts ADD CONSTRAINT call_transcripts_source_proposal_id_fkey FOREIGN KEY (source_proposal_id) REFERENCES strategy_promotion_proposals(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_transcripts ADD CONSTRAINT call_transcripts_source_strategy_thread_id_fkey FOREIGN KEY (source_strategy_thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.command_feedback ADD CONSTRAINT command_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.command_shortcuts ADD CONSTRAINT command_shortcuts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.contacts ADD CONSTRAINT contacts_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.contacts ADD CONSTRAINT contacts_source_proposal_id_fkey FOREIGN KEY (source_proposal_id) REFERENCES strategy_promotion_proposals(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.contacts ADD CONSTRAINT contacts_source_strategy_thread_id_fkey FOREIGN KEY (source_strategy_thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.course_imports ADD CONSTRAINT course_imports_source_registry_id_fkey FOREIGN KEY (source_registry_id) REFERENCES source_registry(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.course_lesson_imports ADD CONSTRAINT course_lesson_imports_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.course_lessons ADD CONSTRAINT course_lessons_course_import_id_fkey FOREIGN KEY (course_import_id) REFERENCES course_imports(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.course_lessons ADD CONSTRAINT course_lessons_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.curriculum_concepts ADD CONSTRAINT curriculum_concepts_exemplar_ki_id_fkey FOREIGN KEY (exemplar_ki_id) REFERENCES knowledge_items(id);

ALTER TABLE ONLY public.daily_assignments ADD CONSTRAINT daily_assignments_block_id_fkey FOREIGN KEY (block_id) REFERENCES training_blocks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.daily_digest_items ADD CONSTRAINT daily_digest_items_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.daily_journal_entries ADD CONSTRAINT daily_journal_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.daily_plan_preferences ADD CONSTRAINT daily_plan_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.deal_patterns ADD CONSTRAINT deal_patterns_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.dojo_session_turns ADD CONSTRAINT dojo_session_turns_retry_of_turn_id_fkey FOREIGN KEY (retry_of_turn_id) REFERENCES dojo_session_turns(id);

ALTER TABLE ONLY public.dojo_session_turns ADD CONSTRAINT dojo_session_turns_session_id_fkey FOREIGN KEY (session_id) REFERENCES dojo_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dojo_sessions ADD CONSTRAINT dojo_sessions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES daily_assignments(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.dojo_sessions ADD CONSTRAINT dojo_sessions_ki_source_id_fkey FOREIGN KEY (ki_source_id) REFERENCES knowledge_items(id);

ALTER TABLE ONLY public.error_logs ADD CONSTRAINT error_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_outputs ADD CONSTRAINT execution_outputs_template_id_used_fkey FOREIGN KEY (template_id_used) REFERENCES execution_templates(id);

ALTER TABLE ONLY public.flashcard_state ADD CONSTRAINT flashcard_state_card_id_fkey FOREIGN KEY (card_id) REFERENCES flashcards(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.flashcards ADD CONSTRAINT flashcards_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES flashcard_decks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.holidays ADD CONSTRAINT holidays_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.icp_sourced_accounts ADD CONSTRAINT icp_sourced_accounts_promoted_account_id_fkey FOREIGN KEY (promoted_account_id) REFERENCES accounts(id);

ALTER TABLE ONLY public.import_account_aliases ADD CONSTRAINT import_account_aliases_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_runs ADD CONSTRAINT integration_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ki_annotations ADD CONSTRAINT ki_annotations_ki_id_fkey FOREIGN KEY (ki_id) REFERENCES knowledge_items(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ki_annotations ADD CONSTRAINT ki_annotations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ki_curriculum ADD CONSTRAINT ki_curriculum_concept_id_fkey FOREIGN KEY (concept_id) REFERENCES curriculum_concepts(concept_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ki_curriculum ADD CONSTRAINT ki_curriculum_ki_id_fkey FOREIGN KEY (ki_id) REFERENCES knowledge_items(id);

ALTER TABLE ONLY public.ki_mastery ADD CONSTRAINT ki_mastery_ki_id_fkey FOREIGN KEY (ki_id) REFERENCES knowledge_items(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ki_mastery ADD CONSTRAINT ki_mastery_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.learning_lessons ADD CONSTRAINT learning_lessons_module_id_fkey FOREIGN KEY (module_id) REFERENCES learning_modules(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_modules ADD CONSTRAINT learning_modules_course_id_fkey FOREIGN KEY (course_id) REFERENCES learning_courses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_progress ADD CONSTRAINT learning_progress_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES learning_lessons(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_quiz_answers ADD CONSTRAINT learning_quiz_answers_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES learning_lessons(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lesson_assets ADD CONSTRAINT lesson_assets_lesson_import_id_fkey FOREIGN KEY (lesson_import_id) REFERENCES course_lesson_imports(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.library_reconciliation_items ADD CONSTRAINT library_reconciliation_items_run_id_fkey FOREIGN KEY (run_id) REFERENCES library_reconciliation_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mock_call_sessions ADD CONSTRAINT mock_call_sessions_parent_session_id_fkey FOREIGN KEY (parent_session_id) REFERENCES mock_call_sessions(id);

ALTER TABLE ONLY public.nav_events ADD CONSTRAINT nav_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunities ADD CONSTRAINT opportunities_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunities ADD CONSTRAINT opportunities_primary_strategy_thread_id_fkey FOREIGN KEY (primary_strategy_thread_id) REFERENCES strategy_threads(id);

ALTER TABLE ONLY public.opportunity_strategy_memory ADD CONSTRAINT opportunity_strategy_memory_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunity_strategy_memory ADD CONSTRAINT opportunity_strategy_memory_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES strategy_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunity_strategy_memory ADD CONSTRAINT opportunity_strategy_memory_source_proposal_id_fkey FOREIGN KEY (source_proposal_id) REFERENCES strategy_promotion_proposals(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunity_strategy_memory ADD CONSTRAINT opportunity_strategy_memory_source_thread_id_fkey FOREIGN KEY (source_thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.pipeline_diagnoses ADD CONSTRAINT pipeline_diagnoses_run_id_fkey FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.playbook_feedback ADD CONSTRAINT playbook_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.podcast_import_queue ADD CONSTRAINT podcast_import_queue_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES batch_runs(id);

ALTER TABLE ONLY public.podcast_import_queue ADD CONSTRAINT podcast_import_queue_source_registry_id_fkey FOREIGN KEY (source_registry_id) REFERENCES source_registry(id);

ALTER TABLE ONLY public.podcast_import_queue ADD CONSTRAINT podcast_import_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.products ADD CONSTRAINT products_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pto_days ADD CONSTRAINT pto_days_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.quota_targets ADD CONSTRAINT quota_targets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.renewals ADD CONSTRAINT renewals_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.renewals ADD CONSTRAINT renewals_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resource_chunks ADD CONSTRAINT resource_chunks_job_id_fkey FOREIGN KEY (job_id) REFERENCES resource_jobs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resource_chunks ADD CONSTRAINT resource_chunks_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_collection_members ADD CONSTRAINT resource_collection_members_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES resource_collections(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_collection_members ADD CONSTRAINT resource_collection_members_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_collections ADD CONSTRAINT resource_collections_parent_resource_id_fkey FOREIGN KEY (parent_resource_id) REFERENCES resources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resource_digests ADD CONSTRAINT resource_digests_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_folders ADD CONSTRAINT resource_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES resource_folders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_folders ADD CONSTRAINT resource_folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_job_steps ADD CONSTRAINT resource_job_steps_job_id_fkey FOREIGN KEY (job_id) REFERENCES resource_jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_jobs ADD CONSTRAINT resource_jobs_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_links ADD CONSTRAINT resource_links_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resource_links ADD CONSTRAINT resource_links_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resource_links ADD CONSTRAINT resource_links_renewal_id_fkey FOREIGN KEY (renewal_id) REFERENCES renewals(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resource_versions ADD CONSTRAINT resource_versions_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_versions ADD CONSTRAINT resource_versions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resources ADD CONSTRAINT resources_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resources ADD CONSTRAINT resources_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES resource_folders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resources ADD CONSTRAINT resources_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resources ADD CONSTRAINT resources_source_proposal_id_fkey FOREIGN KEY (source_proposal_id) REFERENCES strategy_promotion_proposals(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resources ADD CONSTRAINT resources_source_registry_id_fkey FOREIGN KEY (source_registry_id) REFERENCES source_registry(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resources ADD CONSTRAINT resources_source_resource_id_fkey FOREIGN KEY (source_resource_id) REFERENCES resources(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resources ADD CONSTRAINT resources_source_strategy_artifact_id_fkey FOREIGN KEY (source_strategy_artifact_id) REFERENCES strategy_artifacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resources ADD CONSTRAINT resources_source_strategy_thread_id_fkey FOREIGN KEY (source_strategy_thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.resources ADD CONSTRAINT resources_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sales_age_snapshots ADD CONSTRAINT sales_age_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.skill_benchmarks ADD CONSTRAINT skill_benchmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.smoke_test_results ADD CONSTRAINT smoke_test_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.stage_playbooks ADD CONSTRAINT stage_playbooks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.stage_resources ADD CONSTRAINT stage_resources_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_artifact_feedback ADD CONSTRAINT strategy_artifact_feedback_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES strategy_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_artifacts ADD CONSTRAINT strategy_artifacts_linked_account_id_fkey FOREIGN KEY (linked_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_artifacts ADD CONSTRAINT strategy_artifacts_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_artifacts ADD CONSTRAINT strategy_artifacts_parent_artifact_id_fkey FOREIGN KEY (parent_artifact_id) REFERENCES strategy_artifacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_artifacts ADD CONSTRAINT strategy_artifacts_source_output_id_fkey FOREIGN KEY (source_output_id) REFERENCES strategy_outputs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_artifacts ADD CONSTRAINT strategy_artifacts_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_benchmark_audit_logs ADD CONSTRAINT strategy_benchmark_audit_logs_run_id_fkey FOREIGN KEY (run_id) REFERENCES strategy_benchmark_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_benchmark_runs ADD CONSTRAINT strategy_benchmark_runs_replayed_from_run_id_fkey FOREIGN KEY (replayed_from_run_id) REFERENCES strategy_benchmark_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_custom_pills ADD CONSTRAINT strategy_custom_pills_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_messages ADD CONSTRAINT strategy_messages_linked_account_id_fkey FOREIGN KEY (linked_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_messages ADD CONSTRAINT strategy_messages_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_messages ADD CONSTRAINT strategy_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES strategy_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_outputs ADD CONSTRAINT strategy_outputs_linked_account_id_fkey FOREIGN KEY (linked_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_outputs ADD CONSTRAINT strategy_outputs_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_outputs ADD CONSTRAINT strategy_outputs_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_outputs ADD CONSTRAINT strategy_outputs_workflow_run_fk FOREIGN KEY (workflow_run_id) REFERENCES strategy_workflow_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES strategy_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_target_account_id_fkey FOREIGN KEY (target_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_target_opportunity_id_fkey FOREIGN KEY (target_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES strategy_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_run_telemetry ADD CONSTRAINT strategy_run_telemetry_run_id_fkey FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_stress_runs ADD CONSTRAINT strategy_stress_runs_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES strategy_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_stress_turns ADD CONSTRAINT strategy_stress_turns_run_id_fkey FOREIGN KEY (run_id) REFERENCES strategy_stress_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_thread_conflicts ADD CONSTRAINT strategy_thread_conflicts_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES strategy_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_thread_resources ADD CONSTRAINT strategy_thread_resources_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES strategy_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.strategy_threads ADD CONSTRAINT strategy_threads_cloned_from_thread_id_fkey FOREIGN KEY (cloned_from_thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_threads ADD CONSTRAINT strategy_threads_linked_account_id_fkey FOREIGN KEY (linked_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_threads ADD CONSTRAINT strategy_threads_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_uploaded_resources ADD CONSTRAINT strategy_uploaded_resources_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.strategy_workflow_runs ADD CONSTRAINT strategy_workflow_runs_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES strategy_threads(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.streak_events ADD CONSTRAINT streak_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.streak_summary ADD CONSTRAINT streak_summary_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.task_run_sections ADD CONSTRAINT task_run_sections_run_id_fkey FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.task_runs ADD CONSTRAINT task_runs_template_id_fkey FOREIGN KEY (template_id) REFERENCES task_templates(id);

ALTER TABLE ONLY public.task_runs ADD CONSTRAINT task_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.task_templates ADD CONSTRAINT task_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.tasks ADD CONSTRAINT tasks_linked_account_id_fkey FOREIGN KEY (linked_account_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.tasks ADD CONSTRAINT tasks_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.template_suggestions ADD CONSTRAINT template_suggestions_source_resource_id_fkey FOREIGN KEY (source_resource_id) REFERENCES resources(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.territory_profile ADD CONSTRAINT territory_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.territory_strategy_memory ADD CONSTRAINT territory_strategy_memory_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES strategy_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.territory_strategy_memory ADD CONSTRAINT territory_strategy_memory_source_thread_id_fkey FOREIGN KEY (source_thread_id) REFERENCES strategy_threads(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.transcript_grades ADD CONSTRAINT transcript_grades_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES call_transcripts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_band_gate ADD CONSTRAINT user_band_gate_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_competency ADD CONSTRAINT user_competency_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_lesson_progress ADD CONSTRAINT user_lesson_progress_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES learning_lessons(id);

ALTER TABLE ONLY public.user_lesson_progress ADD CONSTRAINT user_lesson_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE ONLY public.user_settings ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.vertical_briefs ADD CONSTRAINT vertical_briefs_vertical_id_fkey FOREIGN KEY (vertical_id) REFERENCES verticals(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.voice_reminders ADD CONSTRAINT voice_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.work_schedule_config ADD CONSTRAINT work_schedule_config_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workday_overrides ADD CONSTRAINT workday_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.claim_podcast_queue_items(p_max_items integer DEFAULT 3, p_max_processing integer DEFAULT 3)
 RETURNS SETOF podcast_import_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_currently_processing INT;
  v_slots_available INT;
  v_to_claim INT;
  v_unstalled INT;
BEGIN
  -- Stale-lock watchdog: reset items stuck in processing for > 5 minutes
  UPDATE podcast_import_queue
  SET status = 'queued',
      pipeline_stage = 'queued',
      updated_at = now()
  WHERE status = 'processing'
    AND updated_at < now() - interval '5 minutes';

  GET DIAGNOSTICS v_unstalled = ROW_COUNT;
  IF v_unstalled > 0 THEN
    RAISE LOG 'podcast queue: unstalled % items', v_unstalled;
  END IF;

  SELECT COUNT(*) INTO v_currently_processing
  FROM podcast_import_queue
  WHERE status = 'processing';

  v_slots_available := GREATEST(p_max_processing - v_currently_processing, 0);
  v_to_claim := LEAST(p_max_items, v_slots_available);

  IF v_to_claim <= 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH claimed AS (
    UPDATE podcast_import_queue
    SET status = 'processing',
        pipeline_stage = CASE
          WHEN transcript_status = 'transcript_ready' AND raw_transcript IS NOT NULL THEN 'preprocessing'
          ELSE 'resolving'
        END,
        updated_at = now()
    WHERE id IN (
      SELECT id FROM podcast_import_queue
      WHERE status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT v_to_claim
    )
    RETURNING *
  )
  SELECT * FROM claimed;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_thread_trust_state(p_thread_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.strategy_thread_conflicts
      WHERE thread_id = p_thread_id AND resolved_at IS NULL AND severity = 'blocking'
    ) THEN 'blocked'
    WHEN EXISTS (
      SELECT 1 FROM public.strategy_thread_conflicts
      WHERE thread_id = p_thread_id AND resolved_at IS NULL AND severity = 'warning'
    ) THEN 'warning'
    ELSE 'safe'
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_next_ki_for_dimension(p_user_id uuid, p_spider_dimension text, p_limit integer DEFAULT 1)
 RETURNS TABLE(id uuid, title text, tactic_summary text, why_it_matters text, when_to_use text, when_not_to_use text, example_usage text, framework text, chapter text, sub_chapter text, spider_dimension text, confidence_score numeric, active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolling_avg numeric;
  v_conf_min numeric := 0;
  v_conf_max numeric := 1.0;
BEGIN
  SELECT ROUND(AVG(avg_score)::numeric, 1)
  INTO v_rolling_avg
  FROM (
    SELECT km2.avg_score
    FROM ki_mastery km2
    WHERE km2.user_id = p_user_id
      AND km2.spider_dimension = p_spider_dimension
    ORDER BY km2.updated_at DESC
    LIMIT 10
  ) recent;

  IF v_rolling_avg IS NOT NULL THEN
    IF v_rolling_avg > 70 THEN
      v_conf_min := 0.70;
    ELSIF v_rolling_avg < 50 THEN
      v_conf_max := 0.75;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    ki.id, ki.title, ki.tactic_summary, ki.why_it_matters,
    ki.when_to_use, ki.when_not_to_use, ki.example_usage,
    ki.framework, ki.chapter, ki.sub_chapter, ki.spider_dimension,
    ki.confidence_score, ki.active
  FROM knowledge_items ki
  LEFT JOIN ki_mastery km ON km.ki_id = ki.id AND km.user_id = p_user_id
  WHERE ki.spider_dimension = p_spider_dimension
    AND ki.is_core_ae = true
    AND ki.active = true
    AND ki.confidence_score BETWEEN v_conf_min AND v_conf_max
    AND char_length(ki.tactic_summary) > 80  -- QUALITY GATE: exclude fragment KIs
  ORDER BY
    CASE WHEN km.decay_risk = true THEN 0 ELSE 1 END ASC,
    CASE WHEN km.next_review_at IS NOT NULL AND km.next_review_at <= now() THEN 0 ELSE 1 END ASC,
    CASE WHEN km.id IS NULL THEN 0 ELSE 1 END ASC,
    COALESCE(km.avg_score, 0) ASC,
    ki.confidence_score DESC,
    RANDOM()
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_resource_content_prefixes(p_user_id uuid)
 RETURNS TABLE(id uuid, content_prefix text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.id, left(r.content, 300) as content_prefix
  FROM resources r
  WHERE r.user_id = p_user_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_resource_lifecycle_summary(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH r AS (
    SELECT
      enrichment_status,
      active_job_status,
      recovery_queue_bucket,
      manual_input_required,
      content_length,
      manual_content_present,
      failure_reason
    FROM public.resources
    WHERE user_id = p_user_id
  ),
  counts AS (
    SELECT
      count(*)::int AS total,
      -- Only truly in-flight jobs count as 'processing'.
      -- 'succeeded' is a terminal state but historically wasn't excluded,
      -- which inflated the count by 1000+ on mature libraries.
      count(*) FILTER (WHERE active_job_status IS NOT NULL
                        AND active_job_status NOT IN
                            ('completed','failed','cancelled','succeeded'))::int AS processing,
      count(*) FILTER (WHERE enrichment_status IN ('queued','pending'))::int AS queued,
      count(*) FILTER (WHERE enrichment_status IN ('enriched','deep_enriched','verified'))::int AS completed,
      count(*) FILTER (WHERE enrichment_status = 'failed'
                        OR manual_input_required = true
                        OR recovery_queue_bucket IN ('manual_input','blocked'))::int AS failed,
      count(*) FILTER (WHERE enrichment_status NOT IN ('enriched','deep_enriched','verified','failed')
                        OR enrichment_status IS NULL)::int AS importing,
      count(*) FILTER (WHERE coalesce(content_length,0) >= 200
                        OR manual_content_present = true)::int AS content_ready
    FROM r
  )
  SELECT jsonb_build_object(
    'total', total,
    'importing', importing,
    'completed', completed,
    'failed', failed,
    'processing', processing,
    'queued', queued,
    'content_ready', content_ready,
    'computed_at', now()
  )
  FROM counts;
$function$
;

CREATE OR REPLACE FUNCTION public.is_approved_user(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.approved_users
    WHERE (user_id = _user_id OR email = (SELECT email FROM auth.users WHERE id = _user_id))
      AND is_active = true
  )
$function$
;

CREATE OR REPLACE FUNCTION public.monitor_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT jsonb_build_object(
 'ready', (SELECT count(*) FROM ki_curriculum WHERE drill_ready),
 'decks', (SELECT count(*) FROM flashcard_decks),
 'cards', (SELECT count(*) FROM flashcards WHERE active),
 'null_dims', (SELECT count(*) FROM knowledge_items WHERE active AND spider_dimension IS NULL),
 'gate_useit', (SELECT count(*) FROM ki_curriculum WHERE drill_ready AND drill_teach_script NOT LIKE '% Use it%'),
 'gate_brackets', (SELECT count(*) FROM ki_curriculum WHERE drill_ready AND (drill_model_answer ~ '\[[A-Za-z][^\]]{0,60}\]' OR drill_teach_script ~ '\[[A-Za-z][^\]]{0,60}\]')),
 'gate_formula', (SELECT count(*) FROM ki_curriculum WHERE drill_ready AND drill_model_answer ILIKE 'When a customer asks%cleanest way%')
);
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_non_branch_accounts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441'
     AND NEW.motion IS NOT NULL
     AND NEW.motion != 'both' THEN
    RAISE WARNING 'accounts insert rejected by prevent_non_branch_accounts: name=%, motion=% (guard requires motion=both)', NEW.name, NEW.motion;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.signal_dimension_weakness(p_user_id uuid, p_spider_dimension text, p_signal_score numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_ki_id uuid;
BEGIN
  FOR v_ki_id IN (
    SELECT ki.id
    FROM knowledge_items ki
    LEFT JOIN ki_mastery km ON km.ki_id = ki.id AND km.user_id = p_user_id
    WHERE ki.spider_dimension = p_spider_dimension
      AND ki.is_core_ae = true
      AND ki.active = true
    ORDER BY
      COALESCE(km.last_drilled_at, '1970-01-01'::timestamptz) ASC,
      RANDOM()
    LIMIT 3
  ) LOOP
    INSERT INTO ki_mastery (
      user_id, ki_id, spider_dimension,
      times_drilled, avg_score, best_score,
      decay_risk, next_review_at, created_at, updated_at
    )
    VALUES (
      p_user_id, v_ki_id, p_spider_dimension,
      0, p_signal_score, p_signal_score,
      true, now(), now(), now()
    )
    ON CONFLICT (user_id, ki_id) DO UPDATE SET
      decay_risk = true,
      next_review_at = now(),
      updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE VIEW public.active_accounts WITH (security_invoker=true) AS
SELECT id,
    user_id,
    name,
    website,
    industry,
    priority,
    tier,
    account_status,
    motion,
    salesforce_link,
    salesforce_id,
    planhat_link,
    current_agreement_link,
    tech_stack,
    tech_stack_notes,
    tech_fit_flag,
    outreach_status,
    cadence_name,
    last_touch_date,
    last_touch_type,
    touches_this_week,
    next_step,
    next_touch_due,
    next_touch_due AS next_step_date,
    notes,
    mar_tech,
    ecommerce,
    tags,
    created_at,
    updated_at,
    contact_status,
    direct_ecommerce,
    email_sms_capture,
    loyalty_membership,
    category_complexity,
    mobile_app,
    marketing_platform_detected,
    crm_lifecycle_team_size,
    trigger_events,
    icp_fit_score,
    timing_score,
    priority_score,
    lifecycle_tier,
    high_probability_buyer,
    triggered_account,
    confidence_score,
    last_enriched_at,
    enrichment_source_summary,
    lifecycle_override,
    lifecycle_override_reason,
    icp_score_override,
    tier_override,
    enrichment_evidence,
    deleted_at
   FROM accounts
  WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW public.branch_readiness WITH (security_invoker=true) AS
SELECT u.id AS user_id,
    count(DISTINCT ki.id)::integer AS total_branch_kis,
    count(DISTINCT km.ki_id)::integer AS drilled_branch_kis,
    round(
        CASE
            WHEN count(DISTINCT ki.id) > 0 THEN count(DISTINCT km.ki_id)::numeric / count(DISTINCT ki.id)::numeric * 100::numeric
            ELSE 0::numeric
        END, 1) AS coverage_pct,
    round(COALESCE(avg(km.avg_score), 0::numeric), 1) AS avg_drill_score
   FROM auth.users u
     LEFT JOIN knowledge_items ki ON ki.chapter ~~ 'branch_%'::text AND ki.active = true
     LEFT JOIN ki_mastery km ON km.ki_id = ki.id AND km.user_id = u.id
  GROUP BY u.id;

CREATE OR REPLACE VIEW public.dimension_scores WITH (security_invoker=true) AS
SELECT tg.user_id,
    dim.spider_dimension,
    count(tg.id)::integer AS call_count,
    round(avg(
        CASE dim.spider_dimension
            WHEN 'discovery'::text THEN tg.discovery_score::numeric
            WHEN 'internal_prospecting'::text THEN (tg.structure_score + tg.cotm_score)::numeric / 2.0
            WHEN 'stakeholder_navigation'::text THEN tg.meddicc_score::numeric
            WHEN 'messaging'::text THEN tg.cotm_score::numeric
            WHEN 'deal_control'::text THEN (tg.next_step_score + tg.meddicc_score)::numeric / 2.0
            WHEN 'objection_handling'::text THEN tg.cotm_score::numeric
            WHEN 'expansion_strategy'::text THEN tg.meddicc_score::numeric
            WHEN 'c_suite_engagement'::text THEN tg.presence_score::numeric
            WHEN 'competitive'::text THEN tg.cotm_score::numeric
            WHEN 'qualification'::text THEN (tg.meddicc_score + tg.discovery_score)::numeric / 2.0
            WHEN 'product_knowledge'::text THEN tg.product_knowledge_score::numeric
            ELSE NULL::numeric
        END * 20::numeric), 1) AS avg_score_100,
    round(min(
        CASE dim.spider_dimension
            WHEN 'discovery'::text THEN tg.discovery_score::numeric
            WHEN 'internal_prospecting'::text THEN (tg.structure_score + tg.cotm_score)::numeric / 2.0
            WHEN 'stakeholder_navigation'::text THEN tg.meddicc_score::numeric
            WHEN 'messaging'::text THEN tg.cotm_score::numeric
            WHEN 'deal_control'::text THEN (tg.next_step_score + tg.meddicc_score)::numeric / 2.0
            WHEN 'objection_handling'::text THEN tg.cotm_score::numeric
            WHEN 'expansion_strategy'::text THEN tg.meddicc_score::numeric
            WHEN 'c_suite_engagement'::text THEN tg.presence_score::numeric
            WHEN 'competitive'::text THEN tg.cotm_score::numeric
            WHEN 'qualification'::text THEN (tg.meddicc_score + tg.discovery_score)::numeric / 2.0
            WHEN 'product_knowledge'::text THEN tg.product_knowledge_score::numeric
            ELSE NULL::numeric
        END * 20::numeric), 1) AS min_score_100
   FROM transcript_grades tg
     CROSS JOIN ( SELECT unnest(ARRAY['discovery'::text, 'internal_prospecting'::text, 'stakeholder_navigation'::text, 'messaging'::text, 'deal_control'::text, 'objection_handling'::text, 'expansion_strategy'::text, 'c_suite_engagement'::text, 'competitive'::text, 'qualification'::text, 'product_knowledge'::text]) AS spider_dimension) dim
  WHERE tg.discovery_score IS NOT NULL
  GROUP BY tg.user_id, dim.spider_dimension;

CREATE OR REPLACE VIEW public.ki_curriculum_full WITH (security_invoker=true) AS
SELECT c.spoke,
    c.topic,
    c.band,
    c.sub_level,
    k.ki_id,
    row_number() OVER (PARTITION BY c.spoke, c.topic, c.sub_level ORDER BY c.order_in_sublevel, k.order_in_concept) AS order_in_sublevel,
    k.role,
    k.is_exemplar,
    c.concept_id,
    k.order_in_concept,
    k.drill_scenario,
    k.active
   FROM ki_curriculum k
     JOIN curriculum_concepts c ON c.concept_id = k.concept_id
  WHERE k.active;

CREATE OR REPLACE VIEW public.ki_mastery_weekly WITH (security_invoker=true) AS
SELECT user_id,
    spider_dimension,
    date_trunc('week'::text, updated_at)::date AS week_start,
    round(avg(avg_score), 1) AS weekly_avg,
    count(*)::integer AS ki_count
   FROM ki_mastery
  WHERE spider_dimension IS NOT NULL
  GROUP BY user_id, spider_dimension, (date_trunc('week'::text, updated_at)::date)
  ORDER BY user_id, spider_dimension, (date_trunc('week'::text, updated_at)::date);

CREATE OR REPLACE VIEW public.resource_truth_drift WITH (security_invoker=true) AS
SELECT r.id,
    r.user_id,
    r.title,
    r.resource_type,
    r.enrichment_status,
    r.content_length,
    r.extraction_attempt_count,
    r.extraction_failure_type,
    r.updated_at,
    COALESCE(k.active_ki, 0::bigint) AS active_ki_count,
        CASE
            WHEN COALESCE(k.active_ki, 0::bigint) = 0 AND r.content_length >= 500 AND (r.enrichment_status = ANY (ARRAY['enriched'::text, 'deep_enriched'::text, 'verified'::text])) THEN 'phantom_enriched'::text
            WHEN COALESCE(k.active_ki, 0::bigint) >= 1 AND COALESCE(k.active_ki, 0::bigint) <= 4 AND r.content_length >= 5000 THEN 'under_extracted'::text
            WHEN r.enrichment_status = 'extraction_retrying'::text AND r.next_retry_at IS NULL THEN 'orphaned_retry'::text
            WHEN (r.enrichment_status = ANY (ARRAY['enriched'::text, 'deep_enriched'::text, 'verified'::text])) AND COALESCE(r.content_length, 0) < 500 THEN 'enriched_but_empty'::text
            ELSE NULL::text
        END AS drift_reason
   FROM resources r
     LEFT JOIN ( SELECT knowledge_items.source_resource_id,
            count(*) FILTER (WHERE knowledge_items.active) AS active_ki
           FROM knowledge_items
          WHERE knowledge_items.source_resource_id IS NOT NULL
          GROUP BY knowledge_items.source_resource_id) k ON k.source_resource_id = r.id;

CREATE OR REPLACE VIEW public.training_field_efficacy WITH (security_invoker=true) AS
WITH training AS (
         SELECT km.user_id,
            date_trunc('week'::text, km.updated_at)::date AS week_start,
            cc.spoke,
            count(*)::integer AS drills_touched,
            round(avg(km.avg_score), 1) AS training_avg_score,
            round(avg(km.best_score), 1) AS training_best_score,
            sum(km.times_drilled)::integer AS total_drills
           FROM ki_mastery km
             JOIN ki_curriculum kc ON kc.ki_id = km.ki_id
             JOIN curriculum_concepts cc ON cc.concept_id = kc.concept_id
          WHERE cc.spoke IS NOT NULL
          GROUP BY km.user_id, (date_trunc('week'::text, km.updated_at)), cc.spoke
        ), field AS (
         SELECT tg.user_id,
            date_trunc('week'::text, COALESCE(ct.call_date::timestamp with time zone, tg.created_at))::date AS week_start,
            count(*)::integer AS calls_graded,
            round(avg(tg.overall_score), 1) AS field_overall_score,
            round(avg(tg.discovery_score), 1) AS field_discovery_score,
            round(avg(tg.commercial_score), 1) AS field_commercial_score,
            round(avg(tg.next_step_score), 1) AS field_next_step_score,
            round(avg(tg.product_knowledge_score), 1) AS field_product_knowledge_score
           FROM transcript_grades tg
             LEFT JOIN call_transcripts ct ON ct.id = tg.transcript_id
          GROUP BY tg.user_id, (date_trunc('week'::text, COALESCE(ct.call_date::timestamp with time zone, tg.created_at)))
        )
 SELECT COALESCE(t.user_id, f.user_id) AS user_id,
    COALESCE(t.week_start, f.week_start) AS week_start,
    t.spoke,
    COALESCE(t.drills_touched, 0) AS drills_touched,
    t.training_avg_score,
    t.training_best_score,
    COALESCE(t.total_drills, 0) AS total_drills,
    COALESCE(f.calls_graded, 0) AS calls_graded,
    f.field_overall_score,
    f.field_discovery_score,
    f.field_commercial_score,
    f.field_next_step_score,
    f.field_product_knowledge_score,
    'weekly-overall'::text AS field_granularity
   FROM training t
     FULL JOIN field f ON f.user_id = t.user_id AND f.week_start = t.week_start;

CREATE INDEX IF NOT EXISTS idx_account_contacts_source_proposal ON public.account_contacts USING btree (source_proposal_id) WHERE (source_proposal_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_account_contacts_source_thread ON public.account_contacts USING btree (source_strategy_thread_id) WHERE (source_strategy_thread_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_dossiers_account_current ON public.account_dossiers USING btree (account_id) WHERE is_current;

CREATE INDEX IF NOT EXISTS apo_account_idx ON public.account_product_ownership USING btree (account_id);

CREATE INDEX IF NOT EXISTS apo_product_idx ON public.account_product_ownership USING btree (product_id);

CREATE INDEX IF NOT EXISTS apo_user_idx ON public.account_product_ownership USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_aps_user_family ON public.account_project_settings USING btree (user_id, account_family);

CREATE INDEX IF NOT EXISTS idx_account_risks_account ON public.account_risks USING btree (account_id);

CREATE INDEX IF NOT EXISTS account_signals_account_idx ON public.account_signals USING btree (linked_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS account_signals_user_idx ON public.account_signals USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_acct_strat_mem_account ON public.account_strategy_memory USING btree (account_id);

CREATE INDEX IF NOT EXISTS idx_memory_last_used_account ON public.account_strategy_memory USING btree (last_used_at);

CREATE INDEX IF NOT EXISTS idx_accounts_family_user ON public.accounts USING btree (user_id, account_family) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_accounts_name ON public.accounts USING btree (name);

CREATE INDEX IF NOT EXISTS idx_accounts_salesforce_id ON public.accounts USING btree (salesforce_id);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.accounts USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_agent_events_account ON public.agent_events USING btree (account_id);

CREATE INDEX IF NOT EXISTS idx_agent_events_status_type ON public.agent_events USING btree (status, event_type);

CREATE INDEX IF NOT EXISTS idx_asset_provenance_asset ON public.asset_provenance USING btree (asset_type, asset_id);

CREATE INDEX IF NOT EXISTS idx_asset_provenance_resource ON public.asset_provenance USING btree (source_resource_id);

CREATE INDEX IF NOT EXISTS idx_audio_jobs_resource ON public.audio_jobs USING btree (resource_id);

CREATE INDEX IF NOT EXISTS idx_audio_jobs_user_stage ON public.audio_jobs USING btree (user_id, stage);

CREATE INDEX IF NOT EXISTS idx_background_jobs_entity ON public.background_jobs USING btree (entity_id);

CREATE INDEX IF NOT EXISTS idx_background_jobs_user_status ON public.background_jobs USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_batch_run_jobs_batch ON public.batch_run_jobs USING btree (batch_run_id);

CREATE INDEX IF NOT EXISTS idx_batch_run_jobs_resource ON public.batch_run_jobs USING btree (resource_id);

CREATE INDEX IF NOT EXISTS idx_batch_runs_user ON public.batch_runs USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_block_snapshots_block ON public.block_snapshots USING btree (block_id, snapshot_type);

CREATE INDEX IF NOT EXISTS idx_branch_pov_account ON public.branch_pov USING btree (account_id);

CREATE INDEX IF NOT EXISTS call_logs_user_account_idx ON public.call_logs USING btree (user_id, account_id, call_date DESC);

CREATE INDEX IF NOT EXISTS idx_call_transcripts_account_id ON public.call_transcripts USING btree (account_id);

CREATE INDEX IF NOT EXISTS idx_call_transcripts_archived_at ON public.call_transcripts USING btree (archived_at) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_call_transcripts_call_date ON public.call_transcripts USING btree (call_date DESC);

CREATE INDEX IF NOT EXISTS idx_call_transcripts_content_search ON public.call_transcripts USING gin (to_tsvector('english'::regconfig, content));

CREATE INDEX IF NOT EXISTS idx_call_transcripts_opportunity_id ON public.call_transcripts USING btree (opportunity_id);

CREATE INDEX IF NOT EXISTS idx_call_transcripts_source_proposal ON public.call_transcripts USING btree (source_proposal_id);

CREATE INDEX IF NOT EXISTS idx_call_transcripts_user_id ON public.call_transcripts USING btree (user_id);

CREATE INDEX IF NOT EXISTS canary_reviews_user_created_idx ON public.canary_reviews USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_closed_loop_sessions_user_skill ON public.closed_loop_sessions USING btree (user_id, skill);

CREATE INDEX IF NOT EXISTS idx_closed_loop_sessions_user_status ON public.closed_loop_sessions USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_cluster_resolutions_canonical ON public.cluster_resolutions USING btree (canonical_resource_id);

CREATE INDEX IF NOT EXISTS idx_contacts_account_id ON public.contacts USING btree (account_id);

CREATE INDEX IF NOT EXISTS idx_contacts_source_proposal ON public.contacts USING btree (source_proposal_id);

CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON public.contacts USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_email_per_user ON public.contacts USING btree (user_id, lower(email)) WHERE ((email IS NOT NULL) AND (email <> ''::text));

CREATE INDEX IF NOT EXISTS idx_course_lesson_imports_resource_id ON public.course_lesson_imports USING btree (resource_id);

CREATE INDEX IF NOT EXISTS idx_course_lesson_imports_user_status ON public.course_lesson_imports USING btree (user_id, import_status);

CREATE INDEX IF NOT EXISTS course_lessons_course_idx ON public.course_lessons USING btree (course_import_id, lesson_number);

CREATE INDEX IF NOT EXISTS idx_daily_assignments_user_date ON public.daily_assignments USING btree (user_id, assignment_date);

CREATE INDEX IF NOT EXISTS idx_digest_items_account ON public.daily_digest_items USING btree (account_id);

CREATE INDEX IF NOT EXISTS idx_digest_items_user_date ON public.daily_digest_items USING btree (user_id, digest_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_journal_entries_user_date ON public.daily_journal_entries USING btree (user_id, date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dismissed_duplicates_unique ON public.dismissed_duplicates USING btree (user_id, record_type, duplicate_key);

CREATE INDEX IF NOT EXISTS idx_dojo_session_turns_session ON public.dojo_session_turns USING btree (session_id);

CREATE INDEX IF NOT EXISTS idx_dojo_sessions_assignment ON public.dojo_sessions USING btree (assignment_id);

CREATE INDEX IF NOT EXISTS idx_dojo_sessions_status ON public.dojo_sessions USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_dojo_sessions_user_id ON public.dojo_sessions USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_enrichment_attempts_resource ON public.enrichment_attempts USING btree (resource_id);

CREATE INDEX IF NOT EXISTS idx_enrichment_attempts_user ON public.enrichment_attempts USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_error_logs_category ON public.error_logs USING btree (category);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON public.error_logs USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_user_id ON public.error_logs USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_execution_outputs_type ON public.execution_outputs USING btree (user_id, output_type);

CREATE INDEX IF NOT EXISTS idx_execution_outputs_user ON public.execution_outputs USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_execution_templates_status ON public.execution_templates USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_execution_templates_user_output ON public.execution_templates USING btree (user_id, output_type);

CREATE INDEX IF NOT EXISTS idx_extraction_batches_resource ON public.extraction_batches USING btree (resource_id, batch_index);

CREATE INDEX IF NOT EXISTS idx_extraction_pipeline_jobs_user_status ON public.extraction_pipeline_jobs USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_resource ON public.extraction_runs USING btree (resource_id);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_user ON public.extraction_runs USING btree (user_id);

CREATE INDEX IF NOT EXISTS flashcard_state_due_idx ON public.flashcard_state USING btree (user_id, due_at);

CREATE INDEX IF NOT EXISTS flashcards_deck_idx ON public.flashcards USING btree (deck_id);

CREATE INDEX IF NOT EXISTS idx_integration_runs_user_source_ran ON public.integration_runs USING btree (user_id, source, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_units_maturity ON public.intelligence_units USING btree (idea_maturity);

CREATE INDEX IF NOT EXISTS idx_intelligence_units_resource ON public.intelligence_units USING btree (resource_id);

CREATE INDEX IF NOT EXISTS idx_intelligence_units_type ON public.intelligence_units USING btree (unit_type);

CREATE INDEX IF NOT EXISTS idx_intelligence_units_user ON public.intelligence_units USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_ki_annotations_user_ki ON public.ki_annotations USING btree (user_id, ki_id);

CREATE INDEX IF NOT EXISTS ki_curriculum_concept_idx ON public.ki_curriculum USING btree (concept_id);

CREATE INDEX IF NOT EXISTS ki_curriculum_ki_idx ON public.ki_curriculum USING btree (ki_id);

CREATE UNIQUE INDEX IF NOT EXISTS ki_curriculum_one_exemplar ON public.ki_curriculum USING btree (concept_id) WHERE is_exemplar;

CREATE INDEX IF NOT EXISTS ki_mastery_decay ON public.ki_mastery USING btree (user_id, decay_risk, last_drilled_at);

CREATE INDEX IF NOT EXISTS ki_mastery_user_dimension ON public.ki_mastery USING btree (user_id, spider_dimension);

CREATE INDEX IF NOT EXISTS idx_ki_role ON public.knowledge_items USING btree (user_id, library_role) WHERE (active = true);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_active ON public.knowledge_items USING btree (active);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_chapter ON public.knowledge_items USING btree (chapter);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_extraction_method ON public.knowledge_items USING btree (extraction_method);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_items_fingerprint_unique ON public.knowledge_items USING btree (user_id, ki_fingerprint) WHERE (ki_fingerprint IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_review_status ON public.knowledge_items USING btree (review_status);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_source ON public.knowledge_items USING btree (source_resource_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_status ON public.knowledge_items USING btree (status);

CREATE INDEX IF NOT EXISTS idx_knowledge_items_user ON public.knowledge_items USING btree (user_id);

CREATE INDEX IF NOT EXISTS knowledge_items_intelligence_type_idx ON public.knowledge_items USING btree (user_id, intelligence_type, active);

CREATE INDEX IF NOT EXISTS idx_knowledge_signals_theme ON public.knowledge_signals USING btree (theme);

CREATE INDEX IF NOT EXISTS idx_knowledge_signals_user ON public.knowledge_signals USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_usage_event ON public.knowledge_usage_log USING btree (event_type);

CREATE INDEX IF NOT EXISTS idx_knowledge_usage_item ON public.knowledge_usage_log USING btree (knowledge_item_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_usage_user ON public.knowledge_usage_log USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_lessons_module_id ON public.learning_lessons USING btree (module_id);

CREATE INDEX IF NOT EXISTS idx_learning_modules_course_id ON public.learning_modules USING btree (course_id);

CREATE INDEX IF NOT EXISTS idx_learning_progress_lesson_id ON public.learning_progress USING btree (lesson_id);

CREATE INDEX IF NOT EXISTS idx_learning_progress_user_id ON public.learning_progress USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_learning_quiz_answers_lesson_id ON public.learning_quiz_answers USING btree (lesson_id);

CREATE INDEX IF NOT EXISTS idx_learning_quiz_answers_user_id ON public.learning_quiz_answers USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_cards_contexts ON public.library_cards USING gin (applies_to_contexts);

CREATE INDEX IF NOT EXISTS idx_cards_source_ids ON public.library_cards USING gin (source_ids);

CREATE INDEX IF NOT EXISTS idx_cards_user_role ON public.library_cards USING btree (user_id, library_role);

CREATE INDEX IF NOT EXISTS idx_recon_items_bucket ON public.library_reconciliation_items USING btree (bucket);

CREATE INDEX IF NOT EXISTS idx_recon_items_resource_id ON public.library_reconciliation_items USING btree (resource_id);

CREATE INDEX IF NOT EXISTS idx_recon_items_run_id ON public.library_reconciliation_items USING btree (run_id);

CREATE INDEX IF NOT EXISTS idx_lifecycle_audit_resource ON public.lifecycle_audit_events USING btree (resource_id);

CREATE INDEX IF NOT EXISTS idx_lifecycle_audit_user_created ON public.lifecycle_audit_events USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lifecycle_audit_violation ON public.lifecycle_audit_events USING btree (violation_type);

CREATE INDEX IF NOT EXISTS nav_events_user_at_idx ON public.nav_events USING btree (user_id, at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunities_account_id ON public.opportunities USING btree (account_id);

CREATE INDEX IF NOT EXISTS idx_opportunities_archived_at ON public.opportunities USING btree (archived_at) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_opportunities_user_id ON public.opportunities USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_memory_last_used_opportunity ON public.opportunity_strategy_memory USING btree (last_used_at);

CREATE INDEX IF NOT EXISTS idx_opp_strat_mem_opp ON public.opportunity_strategy_memory USING btree (opportunity_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_diagnoses_resolution ON public.pipeline_diagnoses USING btree (resolution_status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_diagnoses_resource_run ON public.pipeline_diagnoses USING btree (resource_id, run_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_diagnoses_run ON public.pipeline_diagnoses USING btree (run_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_diagnoses_user_state ON public.pipeline_diagnoses USING btree (user_id, terminal_state);

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_hygiene_scans_user_date_idx ON public.pipeline_hygiene_scans USING btree (user_id, scan_date);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user_status ON public.pipeline_runs USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_playbook_feedback_user_stage ON public.playbook_feedback USING btree (user_id, stage_id);

CREATE INDEX IF NOT EXISTS idx_playbook_usage_user_date ON public.playbook_usage_events USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pb_role ON public.playbooks USING btree (user_id, library_role);

CREATE INDEX IF NOT EXISTS idx_piq_status ON public.podcast_import_queue USING btree (status) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));

CREATE INDEX IF NOT EXISTS idx_piq_user_status ON public.podcast_import_queue USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_podcast_import_queue_batch_id ON public.podcast_import_queue USING btree (batch_id);

CREATE INDEX IF NOT EXISTS idx_podcast_import_queue_pipeline_stage ON public.podcast_import_queue USING btree (pipeline_stage);

CREATE INDEX IF NOT EXISTS idx_renewals_account_id ON public.renewals USING btree (account_id);

CREATE INDEX IF NOT EXISTS idx_renewals_user_id ON public.renewals USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_extraction_attempts_completed_at ON public.resource_extraction_attempts USING btree (completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_extraction_attempts_failure_type ON public.resource_extraction_attempts USING btree (failure_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_extraction_attempts_resource_attempt ON public.resource_extraction_attempts USING btree (resource_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_extraction_attempts_resource_id ON public.resource_extraction_attempts USING btree (resource_id);

CREATE INDEX IF NOT EXISTS idx_extraction_attempts_status ON public.resource_extraction_attempts USING btree (status);

CREATE INDEX IF NOT EXISTS idx_resources_active_job ON public.resources USING btree (user_id, active_job_status) WHERE ((active_job_status IS NOT NULL) AND (active_job_status <> ALL (ARRAY['idle'::text, 'succeeded'::text, 'failed'::text])));

CREATE INDEX IF NOT EXISTS idx_resources_enrichment_status ON public.resources USING btree (enrichment_status);

CREATE INDEX IF NOT EXISTS idx_resources_extraction_priority ON public.resources USING btree (extraction_priority_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_resources_pipeline_queue ON public.resources USING btree (pipeline_queue);

CREATE INDEX IF NOT EXISTS idx_resources_quarantined_at ON public.resources USING btree (quarantined_at) WHERE (quarantined_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_resources_re_extract_status ON public.resources USING btree (re_extract_status) WHERE (re_extract_status <> 'idle'::text);

CREATE INDEX IF NOT EXISTS idx_resources_recovery_queue_bucket ON public.resources USING btree (recovery_queue_bucket) WHERE (recovery_queue_bucket IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_resources_recovery_status ON public.resources USING btree (recovery_status) WHERE (recovery_status IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_resources_source_artifact ON public.resources USING btree (source_strategy_artifact_id);

CREATE INDEX IF NOT EXISTS idx_resources_source_proposal ON public.resources USING btree (source_proposal_id);

CREATE INDEX IF NOT EXISTS idx_routing_user_time ON public.routing_decisions USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_age_snapshots_user_date ON public.sales_age_snapshots USING btree (user_id, week_ending DESC);

CREATE INDEX IF NOT EXISTS idx_smoke_test_results_user_created ON public.smoke_test_results USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stage_playbooks_user_stage ON public.stage_playbooks USING btree (user_id, stage_id);

CREATE INDEX IF NOT EXISTS idx_stage_resources_resource ON public.stage_resources USING btree (resource_id);

CREATE INDEX IF NOT EXISTS idx_stage_resources_user_stage ON public.stage_resources USING btree (user_id, stage_id);

CREATE INDEX IF NOT EXISTS idx_artifact_feedback_artifact ON public.strategy_artifact_feedback USING btree (artifact_id);

CREATE INDEX IF NOT EXISTS idx_strategy_artifacts_source_output_id ON public.strategy_artifacts USING btree (source_output_id);

CREATE INDEX IF NOT EXISTS idx_strategy_artifacts_thread_id ON public.strategy_artifacts USING btree (thread_id);

CREATE INDEX IF NOT EXISTS idx_strategy_artifacts_user_id ON public.strategy_artifacts USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_sbal_created_at ON public.strategy_benchmark_audit_logs USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sbal_run_ask ON public.strategy_benchmark_audit_logs USING btree (run_id, ask_index);

CREATE INDEX IF NOT EXISTS idx_sbal_run_id ON public.strategy_benchmark_audit_logs USING btree (run_id);

CREATE INDEX IF NOT EXISTS idx_sbr_account_created ON public.strategy_benchmark_runs USING btree (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sbr_replayed_from ON public.strategy_benchmark_runs USING btree (replayed_from_run_id);

CREATE INDEX IF NOT EXISTS idx_sbr_status ON public.strategy_benchmark_runs USING btree (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sbr_user_created ON public.strategy_benchmark_runs USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_pills_user_surface ON public.strategy_custom_pills USING btree (user_id, surface);

CREATE INDEX IF NOT EXISTS idx_strategy_messages_linked_account ON public.strategy_messages USING btree (linked_account_id) WHERE (linked_account_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_strategy_messages_linked_opp ON public.strategy_messages USING btree (linked_opportunity_id) WHERE (linked_opportunity_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_strategy_messages_manifest_id ON public.strategy_messages USING btree (manifest_id) WHERE (manifest_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_strategy_messages_thread ON public.strategy_messages USING btree (thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_strategy_outcomes_event ON public.strategy_outcomes USING btree (event_type);

CREATE INDEX IF NOT EXISTS idx_strategy_outcomes_insight ON public.strategy_outcomes USING btree (insight_id);

CREATE INDEX IF NOT EXISTS idx_strategy_outcomes_user ON public.strategy_outcomes USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_strategy_outputs_manifest_id ON public.strategy_outputs USING btree (manifest_id) WHERE (manifest_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_strategy_outputs_thread ON public.strategy_outputs USING btree (thread_id) WHERE (thread_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_strategy_proposals_class ON public.strategy_promotion_proposals USING btree (thread_id, confirmed_class) WHERE (confirmed_class IS NOT NULL);

CREATE INDEX IF NOT EXISTS strategy_promotion_proposals_account_idx ON public.strategy_promotion_proposals USING btree (target_account_id) WHERE (target_account_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS strategy_promotion_proposals_dedupe_uq ON public.strategy_promotion_proposals USING btree (thread_id, proposal_type, dedupe_key) WHERE (status = ANY (ARRAY['pending'::text, 'confirmed'::text]));

CREATE INDEX IF NOT EXISTS strategy_promotion_proposals_opp_idx ON public.strategy_promotion_proposals USING btree (target_opportunity_id) WHERE (target_opportunity_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS strategy_promotion_proposals_thread_idx ON public.strategy_promotion_proposals USING btree (thread_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS strategy_promotion_proposals_user_status_idx ON public.strategy_promotion_proposals USING btree (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_rollups_object ON public.strategy_rollups USING btree (object_type, object_id);

CREATE INDEX IF NOT EXISTS idx_srt_created ON public.strategy_run_telemetry USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_srt_provider ON public.strategy_run_telemetry USING btree (provider);

CREATE INDEX IF NOT EXISTS idx_srt_run ON public.strategy_run_telemetry USING btree (run_id);

CREATE INDEX IF NOT EXISTS idx_srt_stage ON public.strategy_run_telemetry USING btree (stage);

CREATE INDEX IF NOT EXISTS idx_srt_task_type ON public.strategy_run_telemetry USING btree (task_type);

CREATE INDEX IF NOT EXISTS idx_srt_user_task ON public.strategy_run_telemetry USING btree (user_id, task_type);

CREATE INDEX IF NOT EXISTS idx_stress_runs_user_started ON public.strategy_stress_runs USING btree (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_stress_turns_run ON public.strategy_stress_turns USING btree (run_id, turn_index);

CREATE INDEX IF NOT EXISTS idx_stress_turns_user ON public.strategy_stress_turns USING btree (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_synthesis_cache_expires ON public.strategy_synthesis_cache USING btree (expires_at);

CREATE INDEX IF NOT EXISTS idx_synthesis_cache_lookup ON public.strategy_synthesis_cache USING btree (user_id, cache_key);

CREATE INDEX IF NOT EXISTS strategy_thread_conflicts_thread_idx ON public.strategy_thread_conflicts USING btree (thread_id) WHERE (resolved_at IS NULL);

CREATE INDEX IF NOT EXISTS strategy_thread_conflicts_user_idx ON public.strategy_thread_conflicts USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_strategy_threads_account ON public.strategy_threads USING btree (linked_account_id) WHERE (linked_account_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_strategy_threads_opp ON public.strategy_threads USING btree (linked_opportunity_id) WHERE (linked_opportunity_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_strategy_threads_user ON public.strategy_threads USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_task_run_sections_run ON public.task_run_sections USING btree (run_id, batch_index);

CREATE INDEX IF NOT EXISTS idx_task_run_sections_status ON public.task_run_sections USING btree (run_id, status);

CREATE INDEX IF NOT EXISTS task_run_sections_model_used_idx ON public.task_run_sections USING btree (model_used);

CREATE INDEX IF NOT EXISTS idx_task_runs_id_user ON public.task_runs USING btree (id, user_id);

CREATE INDEX IF NOT EXISTS idx_task_runs_user_status ON public.task_runs USING btree (user_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS task_runs_one_active_per_thread_task ON public.task_runs USING btree (thread_id, task_type) WHERE ((thread_id IS NOT NULL) AND (status = ANY (ARRAY['pending'::text, 'running'::text])));

CREATE INDEX IF NOT EXISTS idx_memory_last_used_territory ON public.territory_strategy_memory USING btree (last_used_at);

CREATE INDEX IF NOT EXISTS idx_training_blocks_user_active ON public.training_blocks USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_vertical_briefs_current ON public.vertical_briefs USING btree (vertical_id) WHERE is_current;

CREATE UNIQUE INDEX IF NOT EXISTS weekly_battle_plans_user_week_idx ON public.weekly_battle_plans USING btree (user_id, week_start);

DROP TRIGGER IF EXISTS apo_updated_at ON public.account_product_ownership;
CREATE TRIGGER apo_updated_at BEFORE UPDATE ON public.account_product_ownership FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_aps_updated_at ON public.account_project_settings;
CREATE TRIGGER trg_aps_updated_at BEFORE UPDATE ON public.account_project_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_account_strategy_memory_updated_at ON public.account_strategy_memory;
CREATE TRIGGER update_account_strategy_memory_updated_at BEFORE UPDATE ON public.account_strategy_memory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS block_non_branch_accounts ON public.accounts;
CREATE TRIGGER block_non_branch_accounts BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION prevent_non_branch_accounts();

DROP TRIGGER IF EXISTS update_accounts_updated_at ON public.accounts;
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_background_jobs_updated_at ON public.background_jobs;
CREATE TRIGGER update_background_jobs_updated_at BEFORE UPDATE ON public.background_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_branch_footprint_updated_at ON public.branch_footprint;
CREATE TRIGGER update_branch_footprint_updated_at BEFORE UPDATE ON public.branch_footprint FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_calendar_events_updated_at ON public.calendar_events;
CREATE TRIGGER update_calendar_events_updated_at BEFORE UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_call_logs_updated_at ON public.call_logs;
CREATE TRIGGER update_call_logs_updated_at BEFORE UPDATE ON public.call_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_call_transcripts_updated_at ON public.call_transcripts;
CREATE TRIGGER update_call_transcripts_updated_at BEFORE UPDATE ON public.call_transcripts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_circle_credentials_updated_at ON public.circle_credentials;
CREATE TRIGGER update_circle_credentials_updated_at BEFORE UPDATE ON public.circle_credentials FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_closed_loop_sessions_updated_at ON public.closed_loop_sessions;
CREATE TRIGGER update_closed_loop_sessions_updated_at BEFORE UPDATE ON public.closed_loop_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_command_shortcuts_updated_at ON public.command_shortcuts;
CREATE TRIGGER update_command_shortcuts_updated_at BEFORE UPDATE ON public.command_shortcuts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contacts_updated_at ON public.contacts;
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS course_imports_updated_at ON public.course_imports;
CREATE TRIGGER course_imports_updated_at BEFORE UPDATE ON public.course_imports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_course_lesson_imports_updated_at ON public.course_lesson_imports;
CREATE TRIGGER update_course_lesson_imports_updated_at BEFORE UPDATE ON public.course_lesson_imports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS course_lessons_updated_at ON public.course_lessons;
CREATE TRIGGER course_lessons_updated_at BEFORE UPDATE ON public.course_lessons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_daily_journal_entries_updated_at ON public.daily_journal_entries;
CREATE TRIGGER update_daily_journal_entries_updated_at BEFORE UPDATE ON public.daily_journal_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_daily_plan_preferences_updated_at ON public.daily_plan_preferences;
CREATE TRIGGER update_daily_plan_preferences_updated_at BEFORE UPDATE ON public.daily_plan_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_dojo_sessions_updated_at ON public.dojo_sessions;
CREATE TRIGGER update_dojo_sessions_updated_at BEFORE UPDATE ON public.dojo_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_import_header_mappings_updated_at ON public.import_header_mappings;
CREATE TRIGGER update_import_header_mappings_updated_at BEFORE UPDATE ON public.import_header_mappings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_import_value_mappings_updated_at ON public.import_value_mappings;
CREATE TRIGGER update_import_value_mappings_updated_at BEFORE UPDATE ON public.import_value_mappings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ki_mastery_updated_at ON public.ki_mastery;
CREATE TRIGGER update_ki_mastery_updated_at BEFORE UPDATE ON public.ki_mastery FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_lesson_assets_updated_at ON public.lesson_assets;
CREATE TRIGGER update_lesson_assets_updated_at BEFORE UPDATE ON public.lesson_assets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_library_reconciliation_items_updated_at ON public.library_reconciliation_items;
CREATE TRIGGER update_library_reconciliation_items_updated_at BEFORE UPDATE ON public.library_reconciliation_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_library_reconciliation_runs_updated_at ON public.library_reconciliation_runs;
CREATE TRIGGER update_library_reconciliation_runs_updated_at BEFORE UPDATE ON public.library_reconciliation_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_opportunities_updated_at ON public.opportunities;
CREATE TRIGGER update_opportunities_updated_at BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_opportunity_strategy_memory_updated_at ON public.opportunity_strategy_memory;
CREATE TRIGGER update_opportunity_strategy_memory_updated_at BEFORE UPDATE ON public.opportunity_strategy_memory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pipeline_diagnoses_updated_at ON public.pipeline_diagnoses;
CREATE TRIGGER update_pipeline_diagnoses_updated_at BEFORE UPDATE ON public.pipeline_diagnoses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pipeline_runs_updated_at ON public.pipeline_runs;
CREATE TRIGGER update_pipeline_runs_updated_at BEFORE UPDATE ON public.pipeline_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_podcast_import_queue_updated_at ON public.podcast_import_queue;
CREATE TRIGGER update_podcast_import_queue_updated_at BEFORE UPDATE ON public.podcast_import_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS products_updated_at ON public.products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_quota_targets_updated_at ON public.quota_targets;
CREATE TRIGGER update_quota_targets_updated_at BEFORE UPDATE ON public.quota_targets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_renewals_updated_at ON public.renewals;
CREATE TRIGGER update_renewals_updated_at BEFORE UPDATE ON public.renewals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_resource_collections_updated_at ON public.resource_collections;
CREATE TRIGGER update_resource_collections_updated_at BEFORE UPDATE ON public.resource_collections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_resource_folders_updated_at ON public.resource_folders;
CREATE TRIGGER update_resource_folders_updated_at BEFORE UPDATE ON public.resource_folders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_resources_updated_at ON public.resources;
CREATE TRIGGER update_resources_updated_at BEFORE UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sales_age_snapshots_updated_at ON public.sales_age_snapshots;
CREATE TRIGGER update_sales_age_snapshots_updated_at BEFORE UPDATE ON public.sales_age_snapshots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_skill_builder_sessions_updated_at ON public.skill_builder_sessions;
CREATE TRIGGER update_skill_builder_sessions_updated_at BEFORE UPDATE ON public.skill_builder_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_strategy_artifacts_updated_at ON public.strategy_artifacts;
CREATE TRIGGER update_strategy_artifacts_updated_at BEFORE UPDATE ON public.strategy_artifacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sbr_updated_at ON public.strategy_benchmark_runs;
CREATE TRIGGER trg_sbr_updated_at BEFORE UPDATE ON public.strategy_benchmark_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS strategy_custom_pills_updated_at ON public.strategy_custom_pills;
CREATE TRIGGER strategy_custom_pills_updated_at BEFORE UPDATE ON public.strategy_custom_pills FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_strategy_outputs_updated_at ON public.strategy_outputs;
CREATE TRIGGER update_strategy_outputs_updated_at BEFORE UPDATE ON public.strategy_outputs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_strategy_promotion_proposals_updated_at ON public.strategy_promotion_proposals;
CREATE TRIGGER set_strategy_promotion_proposals_updated_at BEFORE UPDATE ON public.strategy_promotion_proposals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_synthesis_cache_updated_at ON public.strategy_synthesis_cache;
CREATE TRIGGER update_synthesis_cache_updated_at BEFORE UPDATE ON public.strategy_synthesis_cache FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS strategy_thread_conflicts_updated_at ON public.strategy_thread_conflicts;
CREATE TRIGGER strategy_thread_conflicts_updated_at BEFORE UPDATE ON public.strategy_thread_conflicts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_strategy_threads_updated_at ON public.strategy_threads;
CREATE TRIGGER update_strategy_threads_updated_at BEFORE UPDATE ON public.strategy_threads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_strategy_workflow_runs_updated_at ON public.strategy_workflow_runs;
CREATE TRIGGER update_strategy_workflow_runs_updated_at BEFORE UPDATE ON public.strategy_workflow_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_streak_events_updated_at ON public.streak_events;
CREATE TRIGGER update_streak_events_updated_at BEFORE UPDATE ON public.streak_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_streak_summary_updated_at ON public.streak_summary;
CREATE TRIGGER update_streak_summary_updated_at BEFORE UPDATE ON public.streak_summary FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_task_run_sections_updated_at ON public.task_run_sections;
CREATE TRIGGER trg_task_run_sections_updated_at BEFORE UPDATE ON public.task_run_sections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_tasks_updated_at ON public.tasks;
CREATE TRIGGER set_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_territory_profile_updated_at ON public.territory_profile;
CREATE TRIGGER update_territory_profile_updated_at BEFORE UPDATE ON public.territory_profile FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_territory_strategy_memory_updated_at ON public.territory_strategy_memory;
CREATE TRIGGER update_territory_strategy_memory_updated_at BEFORE UPDATE ON public.territory_strategy_memory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_training_blocks_updated_at ON public.training_blocks;
CREATE TRIGGER update_training_blocks_updated_at BEFORE UPDATE ON public.training_blocks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_lesson_progress_updated_at ON public.user_lesson_progress;
CREATE TRIGGER update_user_lesson_progress_updated_at BEFORE UPDATE ON public.user_lesson_progress FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS user_train_prefs_updated_at ON public.user_train_prefs;
CREATE TRIGGER user_train_prefs_updated_at BEFORE UPDATE ON public.user_train_prefs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_weekly_research_queue_updated_at ON public.weekly_research_queue;
CREATE TRIGGER update_weekly_research_queue_updated_at BEFORE UPDATE ON public.weekly_research_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_work_schedule_config_updated_at ON public.work_schedule_config;
CREATE TRIGGER update_work_schedule_config_updated_at BEFORE UPDATE ON public.work_schedule_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON COLUMN public.daily_assignments.simulation_arc_id IS 'V5: Links Friday assignments to curated multi-turn simulation arcs';

COMMENT ON VIEW public.resource_truth_drift IS 'Single source of truth for resource/KI drift. Any row with non-null drift_reason is a real anomaly that should be surfaced in audit panels.';

ALTER TABLE public._agent_staging ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_contacts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_dossiers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_product_ownership ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_project_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_risks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_signals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_strategy_memory ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_trust ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.asset_provenance ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audio_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.badges_earned ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.batch_run_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.batch_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.block_snapshots ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.branch_footprint ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.branch_pov ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.call_transcripts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.canary_reviews ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.circle_credentials ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.closed_loop_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cluster_resolutions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.coaching_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.command_feedback ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.command_shortcuts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversion_benchmarks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.course_imports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.course_lesson_imports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.course_lessons ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.curriculum_concepts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.curriculum_gates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.custom_prompts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.daily_assignments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.daily_digest_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.daily_journal_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.daily_plan_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.daily_time_blocks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dave_transcripts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.deal_patterns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dismissed_action_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dismissed_duplicates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dojo_session_turns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dojo_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.enrichment_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.execution_outputs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.execution_templates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extraction_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extraction_pipeline_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.extraction_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.flashcard_decks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.flashcard_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.function_configs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.icp_sourced_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.import_account_aliases ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.import_header_mappings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.import_value_mappings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.integration_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.intelligence_units ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ki_annotations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ki_curriculum ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ki_mastery ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.knowledge_signals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.knowledge_usage_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.learning_courses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.learning_lessons ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.learning_modules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.learning_progress ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.learning_quiz_answers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lesson_assets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_cards ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_reconciliation_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.library_reconciliation_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lifecycle_audit_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mock_call_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.nav_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.opportunity_methodology ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.opportunity_strategy_memory ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pipeline_diagnoses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pipeline_hygiene_scans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.playbook_feedback ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.playbook_usage_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.podcast_import_queue ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.power_hour_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pto_days ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quota_targets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.renewals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.research_queue_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_chunks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_collection_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_collections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_digests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_extraction_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_folders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_job_steps ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_usage_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resource_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.routing_decisions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sales_age_snapshots ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.skill_benchmarks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.skill_builder_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.smoke_test_results ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.source_registry ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stage_playbooks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stage_resources ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_artifact_feedback ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_artifacts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_benchmark_audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_benchmark_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_custom_pills ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_outcomes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_outputs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_promotion_proposals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_rollups ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_run_telemetry ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_stress_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_stress_turns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_synthesis_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_thread_conflicts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_thread_resources ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_threads ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_uploaded_resources ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.strategy_workflow_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.streak_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.streak_summary ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.task_run_sections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.task_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.template_suggestions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.territory_profile ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.territory_strategy_memory ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.training_blocks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transcript_grades ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_band_gate ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_competency ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_lesson_progress ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_train_prefs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.verification_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vertical_briefs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.verticals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.voice_reminders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.weekly_battle_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.weekly_research_queue ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.weekly_reviews ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.work_schedule_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.workday_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can delete own account_contacts" ON public.account_contacts;
CREATE POLICY "Users can delete own account_contacts" ON public.account_contacts AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own account_contacts" ON public.account_contacts;
CREATE POLICY "Users can insert own account_contacts" ON public.account_contacts AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own account_contacts" ON public.account_contacts;
CREATE POLICY "Users can update own account_contacts" ON public.account_contacts AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own account_contacts" ON public.account_contacts;
CREATE POLICY "Users can view own account_contacts" ON public.account_contacts AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS dossiers_owner ON public.account_dossiers;
CREATE POLICY dossiers_owner ON public.account_dossiers AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "apo owner all" ON public.account_product_ownership;
CREATE POLICY "apo owner all" ON public.account_product_ownership AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "users manage their own project settings" ON public.account_project_settings;
CREATE POLICY "users manage their own project settings" ON public.account_project_settings AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS account_risks_owner ON public.account_risks;
CREATE POLICY account_risks_owner ON public.account_risks AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage their own signals" ON public.account_signals;
CREATE POLICY "Users manage their own signals" ON public.account_signals AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own account memory" ON public.account_strategy_memory;
CREATE POLICY "Users manage own account memory" ON public.account_strategy_memory AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own accounts" ON public.accounts;
CREATE POLICY "Users can delete own accounts" ON public.accounts AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own accounts" ON public.accounts;
CREATE POLICY "Users can insert own accounts" ON public.accounts AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own accounts" ON public.accounts;
CREATE POLICY "Users can update own accounts" ON public.accounts AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own accounts" ON public.accounts;
CREATE POLICY "Users can view own accounts" ON public.accounts AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS agent_configs_owner ON public.agent_configs;
CREATE POLICY agent_configs_owner ON public.agent_configs AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS agent_events_owner ON public.agent_events;
CREATE POLICY agent_events_owner ON public.agent_events AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS agent_trust_owner ON public.agent_trust;
CREATE POLICY agent_trust_owner ON public.agent_trust AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own feedback" ON public.ai_feedback;
CREATE POLICY "Users can insert own feedback" ON public.ai_feedback AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own feedback" ON public.ai_feedback;
CREATE POLICY "Users can view own feedback" ON public.ai_feedback AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own active approval row" ON public.approved_users;
CREATE POLICY "Users can read own active approval row" ON public.approved_users AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id IS NOT NULL) AND (auth.uid() = user_id) AND (is_active = true)));

DROP POLICY IF EXISTS "Users delete own provenance" ON public.asset_provenance;
CREATE POLICY "Users delete own provenance" ON public.asset_provenance AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users insert own provenance" ON public.asset_provenance;
CREATE POLICY "Users insert own provenance" ON public.asset_provenance AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users see own provenance" ON public.asset_provenance;
CREATE POLICY "Users see own provenance" ON public.asset_provenance AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own audio_jobs" ON public.audio_jobs;
CREATE POLICY "Users manage own audio_jobs" ON public.audio_jobs AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create their own jobs" ON public.background_jobs;
CREATE POLICY "Users can create their own jobs" ON public.background_jobs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own jobs" ON public.background_jobs;
CREATE POLICY "Users can delete their own jobs" ON public.background_jobs AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own jobs" ON public.background_jobs;
CREATE POLICY "Users can update their own jobs" ON public.background_jobs AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own jobs" ON public.background_jobs;
CREATE POLICY "Users can view their own jobs" ON public.background_jobs AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own badges" ON public.badges_earned;
CREATE POLICY "Users can insert own badges" ON public.badges_earned AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own badges" ON public.badges_earned;
CREATE POLICY "Users can view own badges" ON public.badges_earned AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own batch run jobs" ON public.batch_run_jobs;
CREATE POLICY "Users can view own batch run jobs" ON public.batch_run_jobs AS PERMISSIVE FOR ALL TO authenticated USING ((batch_run_id IN ( SELECT batch_runs.id
   FROM batch_runs
  WHERE (batch_runs.user_id = auth.uid())))) WITH CHECK ((batch_run_id IN ( SELECT batch_runs.id
   FROM batch_runs
  WHERE (batch_runs.user_id = auth.uid()))));

DROP POLICY IF EXISTS "Users can manage own batch runs" ON public.batch_runs;
CREATE POLICY "Users can manage own batch runs" ON public.batch_runs AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create their own snapshots" ON public.block_snapshots;
CREATE POLICY "Users can create their own snapshots" ON public.block_snapshots AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own snapshots" ON public.block_snapshots;
CREATE POLICY "Users can view their own snapshots" ON public.block_snapshots AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage their own footprint" ON public.branch_footprint;
CREATE POLICY "Users manage their own footprint" ON public.branch_footprint AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS branch_pov_owner ON public.branch_pov;
CREATE POLICY branch_pov_owner ON public.branch_pov AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own calendar events" ON public.calendar_events;
CREATE POLICY "Users can delete own calendar events" ON public.calendar_events AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own calendar events" ON public.calendar_events;
CREATE POLICY "Users can insert own calendar events" ON public.calendar_events AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own calendar events" ON public.calendar_events;
CREATE POLICY "Users can update own calendar events" ON public.calendar_events AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own calendar events" ON public.calendar_events;
CREATE POLICY "Users can view own calendar events" ON public.calendar_events AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage their own call logs" ON public.call_logs;
CREATE POLICY "Users manage their own call logs" ON public.call_logs AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own transcripts" ON public.call_transcripts;
CREATE POLICY "Users can delete own transcripts" ON public.call_transcripts AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own transcripts" ON public.call_transcripts;
CREATE POLICY "Users can insert own transcripts" ON public.call_transcripts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own transcripts" ON public.call_transcripts;
CREATE POLICY "Users can update own transcripts" ON public.call_transcripts AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own transcripts" ON public.call_transcripts;
CREATE POLICY "Users can view own transcripts" ON public.call_transcripts AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert their own canary reviews" ON public.canary_reviews;
CREATE POLICY "Users can insert their own canary reviews" ON public.canary_reviews AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own canary reviews" ON public.canary_reviews;
CREATE POLICY "Users can view their own canary reviews" ON public.canary_reviews AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create their own closed loop sessions" ON public.closed_loop_sessions;
CREATE POLICY "Users can create their own closed loop sessions" ON public.closed_loop_sessions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own closed loop sessions" ON public.closed_loop_sessions;
CREATE POLICY "Users can update their own closed loop sessions" ON public.closed_loop_sessions AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own closed loop sessions" ON public.closed_loop_sessions;
CREATE POLICY "Users can view their own closed loop sessions" ON public.closed_loop_sessions AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users insert own resolutions" ON public.cluster_resolutions;
CREATE POLICY "Users insert own resolutions" ON public.cluster_resolutions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users see own resolutions" ON public.cluster_resolutions;
CREATE POLICY "Users see own resolutions" ON public.cluster_resolutions AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own plans" ON public.coaching_plans;
CREATE POLICY "Users manage own plans" ON public.coaching_plans AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own feedback" ON public.command_feedback;
CREATE POLICY "Users manage own feedback" ON public.command_feedback AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own shortcuts" ON public.command_shortcuts;
CREATE POLICY "Users manage own shortcuts" ON public.command_shortcuts AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own contacts" ON public.contacts;
CREATE POLICY "Users can delete own contacts" ON public.contacts AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own contacts" ON public.contacts;
CREATE POLICY "Users can insert own contacts" ON public.contacts AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own contacts" ON public.contacts;
CREATE POLICY "Users can update own contacts" ON public.contacts AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own contacts" ON public.contacts;
CREATE POLICY "Users can view own contacts" ON public.contacts AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own benchmarks" ON public.conversion_benchmarks;
CREATE POLICY "Users can insert own benchmarks" ON public.conversion_benchmarks AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own benchmarks" ON public.conversion_benchmarks;
CREATE POLICY "Users can update own benchmarks" ON public.conversion_benchmarks AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own benchmarks" ON public.conversion_benchmarks;
CREATE POLICY "Users can view own benchmarks" ON public.conversion_benchmarks AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own course_imports" ON public.course_imports;
CREATE POLICY "Users manage own course_imports" ON public.course_imports AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create their own course lesson imports" ON public.course_lesson_imports;
CREATE POLICY "Users can create their own course lesson imports" ON public.course_lesson_imports AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own course lesson imports" ON public.course_lesson_imports;
CREATE POLICY "Users can delete their own course lesson imports" ON public.course_lesson_imports AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own course lesson imports" ON public.course_lesson_imports;
CREATE POLICY "Users can update their own course lesson imports" ON public.course_lesson_imports AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own course lesson imports" ON public.course_lesson_imports;
CREATE POLICY "Users can view their own course lesson imports" ON public.course_lesson_imports AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own course_lessons" ON public.course_lessons;
CREATE POLICY "Users manage own course_lessons" ON public.course_lessons AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "read curriculum_concepts" ON public.curriculum_concepts;
CREATE POLICY "read curriculum_concepts" ON public.curriculum_concepts AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "read curriculum_gates" ON public.curriculum_gates;
CREATE POLICY "read curriculum_gates" ON public.curriculum_gates AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users manage own prompts" ON public.custom_prompts;
CREATE POLICY "Users manage own prompts" ON public.custom_prompts AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create their own assignments" ON public.daily_assignments;
CREATE POLICY "Users can create their own assignments" ON public.daily_assignments AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own assignments" ON public.daily_assignments;
CREATE POLICY "Users can update their own assignments" ON public.daily_assignments AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own assignments" ON public.daily_assignments;
CREATE POLICY "Users can view their own assignments" ON public.daily_assignments AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own digest items" ON public.daily_digest_items;
CREATE POLICY "Users can delete own digest items" ON public.daily_digest_items AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own digest items" ON public.daily_digest_items;
CREATE POLICY "Users can insert own digest items" ON public.daily_digest_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own digest items" ON public.daily_digest_items;
CREATE POLICY "Users can update own digest items" ON public.daily_digest_items AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own digest items" ON public.daily_digest_items;
CREATE POLICY "Users can view own digest items" ON public.daily_digest_items AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own journal entries" ON public.daily_journal_entries;
CREATE POLICY "Users can delete own journal entries" ON public.daily_journal_entries AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own journal entries" ON public.daily_journal_entries;
CREATE POLICY "Users can insert own journal entries" ON public.daily_journal_entries AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own journal entries" ON public.daily_journal_entries;
CREATE POLICY "Users can update own journal entries" ON public.daily_journal_entries AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own journal entries" ON public.daily_journal_entries;
CREATE POLICY "Users can view own journal entries" ON public.daily_journal_entries AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own preferences" ON public.daily_plan_preferences;
CREATE POLICY "Users can insert own preferences" ON public.daily_plan_preferences AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own preferences" ON public.daily_plan_preferences;
CREATE POLICY "Users can update own preferences" ON public.daily_plan_preferences AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own preferences" ON public.daily_plan_preferences;
CREATE POLICY "Users can view own preferences" ON public.daily_plan_preferences AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own time blocks" ON public.daily_time_blocks;
CREATE POLICY "Users can delete own time blocks" ON public.daily_time_blocks AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own time blocks" ON public.daily_time_blocks;
CREATE POLICY "Users can insert own time blocks" ON public.daily_time_blocks AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own time blocks" ON public.daily_time_blocks;
CREATE POLICY "Users can update own time blocks" ON public.daily_time_blocks AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own time blocks" ON public.daily_time_blocks;
CREATE POLICY "Users can view own time blocks" ON public.daily_time_blocks AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own dave_transcripts" ON public.dave_transcripts;
CREATE POLICY "Users can delete own dave_transcripts" ON public.dave_transcripts AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own dave_transcripts" ON public.dave_transcripts;
CREATE POLICY "Users can insert own dave_transcripts" ON public.dave_transcripts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own dave_transcripts" ON public.dave_transcripts;
CREATE POLICY "Users can view own dave_transcripts" ON public.dave_transcripts AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own patterns" ON public.deal_patterns;
CREATE POLICY "Users manage own patterns" ON public.deal_patterns AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own dismissed items" ON public.dismissed_action_items;
CREATE POLICY "Users can delete own dismissed items" ON public.dismissed_action_items AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own dismissed items" ON public.dismissed_action_items;
CREATE POLICY "Users can insert own dismissed items" ON public.dismissed_action_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own dismissed items" ON public.dismissed_action_items;
CREATE POLICY "Users can view own dismissed items" ON public.dismissed_action_items AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own dismissed_duplicates" ON public.dismissed_duplicates;
CREATE POLICY "Users manage own dismissed_duplicates" ON public.dismissed_duplicates AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create own dojo turns" ON public.dojo_session_turns;
CREATE POLICY "Users can create own dojo turns" ON public.dojo_session_turns AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own dojo turns" ON public.dojo_session_turns;
CREATE POLICY "Users can update own dojo turns" ON public.dojo_session_turns AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own dojo turns" ON public.dojo_session_turns;
CREATE POLICY "Users can view own dojo turns" ON public.dojo_session_turns AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create own dojo sessions" ON public.dojo_sessions;
CREATE POLICY "Users can create own dojo sessions" ON public.dojo_sessions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own dojo sessions" ON public.dojo_sessions;
CREATE POLICY "Users can update own dojo sessions" ON public.dojo_sessions AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own dojo sessions" ON public.dojo_sessions;
CREATE POLICY "Users can view own dojo sessions" ON public.dojo_sessions AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own enrichment attempts" ON public.enrichment_attempts;
CREATE POLICY "Users can delete own enrichment attempts" ON public.enrichment_attempts AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own enrichment attempts" ON public.enrichment_attempts;
CREATE POLICY "Users can insert own enrichment attempts" ON public.enrichment_attempts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own enrichment attempts" ON public.enrichment_attempts;
CREATE POLICY "Users can view own enrichment attempts" ON public.enrichment_attempts AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert their own error logs" ON public.error_logs;
CREATE POLICY "Users can insert their own error logs" ON public.error_logs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read their own error logs" ON public.error_logs;
CREATE POLICY "Users can read their own error logs" ON public.error_logs AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own execution_outputs" ON public.execution_outputs;
CREATE POLICY "Users manage own execution_outputs" ON public.execution_outputs AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own execution_templates" ON public.execution_templates;
CREATE POLICY "Users manage own execution_templates" ON public.execution_templates AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert their own batch records" ON public.extraction_batches;
CREATE POLICY "Users can insert their own batch records" ON public.extraction_batches AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own batch records" ON public.extraction_batches;
CREATE POLICY "Users can view their own batch records" ON public.extraction_batches AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own pipeline jobs" ON public.extraction_pipeline_jobs;
CREATE POLICY "Users manage own pipeline jobs" ON public.extraction_pipeline_jobs AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own extraction runs" ON public.extraction_runs;
CREATE POLICY "Users can delete their own extraction runs" ON public.extraction_runs AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert their own extraction runs" ON public.extraction_runs;
CREATE POLICY "Users can insert their own extraction runs" ON public.extraction_runs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own extraction runs" ON public.extraction_runs;
CREATE POLICY "Users can update their own extraction runs" ON public.extraction_runs AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own extraction runs" ON public.extraction_runs;
CREATE POLICY "Users can view their own extraction runs" ON public.extraction_runs AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "decks readable by authenticated" ON public.flashcard_decks;
CREATE POLICY "decks readable by authenticated" ON public.flashcard_decks AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "decks writable by service role" ON public.flashcard_decks;
CREATE POLICY "decks writable by service role" ON public.flashcard_decks AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS n8n_monitor_read ON public.flashcard_decks;
CREATE POLICY n8n_monitor_read ON public.flashcard_decks AS PERMISSIVE FOR SELECT TO n8n_monitor USING (true);

DROP POLICY IF EXISTS "state delete own" ON public.flashcard_state;
CREATE POLICY "state delete own" ON public.flashcard_state AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "state insert own" ON public.flashcard_state;
CREATE POLICY "state insert own" ON public.flashcard_state AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "state select own" ON public.flashcard_state;
CREATE POLICY "state select own" ON public.flashcard_state AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "state update own" ON public.flashcard_state;
CREATE POLICY "state update own" ON public.flashcard_state AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "cards readable by authenticated" ON public.flashcards;
CREATE POLICY "cards readable by authenticated" ON public.flashcards AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "cards writable by service role" ON public.flashcards;
CREATE POLICY "cards writable by service role" ON public.flashcards AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS n8n_monitor_read ON public.flashcards;
CREATE POLICY n8n_monitor_read ON public.flashcards AS PERMISSIVE FOR SELECT TO n8n_monitor USING (true);

DROP POLICY IF EXISTS function_configs_service_only ON public.function_configs;
CREATE POLICY function_configs_service_only ON public.function_configs AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "Users can delete own holidays" ON public.holidays;
CREATE POLICY "Users can delete own holidays" ON public.holidays AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own holidays" ON public.holidays;
CREATE POLICY "Users can insert own holidays" ON public.holidays AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own holidays" ON public.holidays;
CREATE POLICY "Users can update own holidays" ON public.holidays AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own holidays" ON public.holidays;
CREATE POLICY "Users can view own holidays" ON public.holidays AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can manage own sourced accounts" ON public.icp_sourced_accounts;
CREATE POLICY "Users can manage own sourced accounts" ON public.icp_sourced_accounts AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create their own account aliases" ON public.import_account_aliases;
CREATE POLICY "Users can create their own account aliases" ON public.import_account_aliases AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own account aliases" ON public.import_account_aliases;
CREATE POLICY "Users can delete their own account aliases" ON public.import_account_aliases AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own account aliases" ON public.import_account_aliases;
CREATE POLICY "Users can update their own account aliases" ON public.import_account_aliases AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own account aliases" ON public.import_account_aliases;
CREATE POLICY "Users can view their own account aliases" ON public.import_account_aliases AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create their own header mappings" ON public.import_header_mappings;
CREATE POLICY "Users can create their own header mappings" ON public.import_header_mappings AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own header mappings" ON public.import_header_mappings;
CREATE POLICY "Users can delete their own header mappings" ON public.import_header_mappings AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own header mappings" ON public.import_header_mappings;
CREATE POLICY "Users can update their own header mappings" ON public.import_header_mappings AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own header mappings" ON public.import_header_mappings;
CREATE POLICY "Users can view their own header mappings" ON public.import_header_mappings AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create their own value mappings" ON public.import_value_mappings;
CREATE POLICY "Users can create their own value mappings" ON public.import_value_mappings AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own value mappings" ON public.import_value_mappings;
CREATE POLICY "Users can delete their own value mappings" ON public.import_value_mappings AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own value mappings" ON public.import_value_mappings;
CREATE POLICY "Users can update their own value mappings" ON public.import_value_mappings AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own value mappings" ON public.import_value_mappings;
CREATE POLICY "Users can view their own value mappings" ON public.import_value_mappings AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "own integration runs insert" ON public.integration_runs;
CREATE POLICY "own integration runs insert" ON public.integration_runs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "own integration runs read" ON public.integration_runs;
CREATE POLICY "own integration runs read" ON public.integration_runs AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own intelligence_units" ON public.intelligence_units;
CREATE POLICY "Users manage own intelligence_units" ON public.intelligence_units AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own KI annotations" ON public.ki_annotations;
CREATE POLICY "Users manage own KI annotations" ON public.ki_annotations AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS n8n_monitor_read ON public.ki_curriculum;
CREATE POLICY n8n_monitor_read ON public.ki_curriculum AS PERMISSIVE FOR SELECT TO n8n_monitor USING (true);

DROP POLICY IF EXISTS "read ki_curriculum" ON public.ki_curriculum;
CREATE POLICY "read ki_curriculum" ON public.ki_curriculum AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users manage own ki_mastery" ON public.ki_mastery;
CREATE POLICY "Users manage own ki_mastery" ON public.ki_mastery AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own knowledge_items" ON public.knowledge_items;
CREATE POLICY "Users manage own knowledge_items" ON public.knowledge_items AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS n8n_monitor_read ON public.knowledge_items;
CREATE POLICY n8n_monitor_read ON public.knowledge_items AS PERMISSIVE FOR SELECT TO n8n_monitor USING (true);

DROP POLICY IF EXISTS "Users manage own knowledge_signals" ON public.knowledge_signals;
CREATE POLICY "Users manage own knowledge_signals" ON public.knowledge_signals AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own usage logs" ON public.knowledge_usage_log;
CREATE POLICY "Users can delete own usage logs" ON public.knowledge_usage_log AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own usage logs" ON public.knowledge_usage_log;
CREATE POLICY "Users can insert own usage logs" ON public.knowledge_usage_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own usage logs" ON public.knowledge_usage_log;
CREATE POLICY "Users can view own usage logs" ON public.knowledge_usage_log AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Authenticated users can read courses" ON public.learning_courses;
CREATE POLICY "Authenticated users can read courses" ON public.learning_courses AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can read lessons" ON public.learning_lessons;
CREATE POLICY "Authenticated users can read lessons" ON public.learning_lessons AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can read modules" ON public.learning_modules;
CREATE POLICY "Authenticated users can read modules" ON public.learning_modules AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can insert own progress" ON public.learning_progress;
CREATE POLICY "Users can insert own progress" ON public.learning_progress AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own progress" ON public.learning_progress;
CREATE POLICY "Users can read own progress" ON public.learning_progress AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own progress" ON public.learning_progress;
CREATE POLICY "Users can update own progress" ON public.learning_progress AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own quiz answers" ON public.learning_quiz_answers;
CREATE POLICY "Users can insert own quiz answers" ON public.learning_quiz_answers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own quiz answers" ON public.learning_quiz_answers;
CREATE POLICY "Users can read own quiz answers" ON public.learning_quiz_answers AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create their own lesson assets" ON public.lesson_assets;
CREATE POLICY "Users can create their own lesson assets" ON public.lesson_assets AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own lesson assets" ON public.lesson_assets;
CREATE POLICY "Users can delete their own lesson assets" ON public.lesson_assets AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own lesson assets" ON public.lesson_assets;
CREATE POLICY "Users can update their own lesson assets" ON public.lesson_assets AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own lesson assets" ON public.lesson_assets;
CREATE POLICY "Users can view their own lesson assets" ON public.lesson_assets AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "users read own cards" ON public.library_cards;
CREATE POLICY "users read own cards" ON public.library_cards AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "users write own cards" ON public.library_cards;
CREATE POLICY "users write own cards" ON public.library_cards AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create own items" ON public.library_reconciliation_items;
CREATE POLICY "Users can create own items" ON public.library_reconciliation_items AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own items" ON public.library_reconciliation_items;
CREATE POLICY "Users can update own items" ON public.library_reconciliation_items AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own items" ON public.library_reconciliation_items;
CREATE POLICY "Users can view own items" ON public.library_reconciliation_items AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create own runs" ON public.library_reconciliation_runs;
CREATE POLICY "Users can create own runs" ON public.library_reconciliation_runs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own runs" ON public.library_reconciliation_runs;
CREATE POLICY "Users can update own runs" ON public.library_reconciliation_runs AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own runs" ON public.library_reconciliation_runs;
CREATE POLICY "Users can view own runs" ON public.library_reconciliation_runs AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert their own lifecycle audit events" ON public.lifecycle_audit_events;
CREATE POLICY "Users can insert their own lifecycle audit events" ON public.lifecycle_audit_events AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own lifecycle audit events" ON public.lifecycle_audit_events;
CREATE POLICY "Users can view their own lifecycle audit events" ON public.lifecycle_audit_events AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own mock sessions" ON public.mock_call_sessions;
CREATE POLICY "Users can delete own mock sessions" ON public.mock_call_sessions AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own mock sessions" ON public.mock_call_sessions;
CREATE POLICY "Users can insert own mock sessions" ON public.mock_call_sessions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own mock sessions" ON public.mock_call_sessions;
CREATE POLICY "Users can update own mock sessions" ON public.mock_call_sessions AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own mock sessions" ON public.mock_call_sessions;
CREATE POLICY "Users can view own mock sessions" ON public.mock_call_sessions AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own nav_events" ON public.nav_events;
CREATE POLICY "Users manage own nav_events" ON public.nav_events AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own opportunities" ON public.opportunities;
CREATE POLICY "Users can delete own opportunities" ON public.opportunities AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own opportunities" ON public.opportunities;
CREATE POLICY "Users can insert own opportunities" ON public.opportunities AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own opportunities" ON public.opportunities;
CREATE POLICY "Users can update own opportunities" ON public.opportunities AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own opportunities" ON public.opportunities;
CREATE POLICY "Users can view own opportunities" ON public.opportunities AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own methodology" ON public.opportunity_methodology;
CREATE POLICY "Users can delete own methodology" ON public.opportunity_methodology AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own methodology" ON public.opportunity_methodology;
CREATE POLICY "Users can insert own methodology" ON public.opportunity_methodology AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own methodology" ON public.opportunity_methodology;
CREATE POLICY "Users can update own methodology" ON public.opportunity_methodology AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own methodology" ON public.opportunity_methodology;
CREATE POLICY "Users can view own methodology" ON public.opportunity_methodology AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own opp memory" ON public.opportunity_strategy_memory;
CREATE POLICY "Users manage own opp memory" ON public.opportunity_strategy_memory AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own diagnoses" ON public.pipeline_diagnoses;
CREATE POLICY "Users can delete own diagnoses" ON public.pipeline_diagnoses AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own diagnoses" ON public.pipeline_diagnoses;
CREATE POLICY "Users can insert own diagnoses" ON public.pipeline_diagnoses AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own diagnoses" ON public.pipeline_diagnoses;
CREATE POLICY "Users can update own diagnoses" ON public.pipeline_diagnoses AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own diagnoses" ON public.pipeline_diagnoses;
CREATE POLICY "Users can view own diagnoses" ON public.pipeline_diagnoses AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own scans" ON public.pipeline_hygiene_scans;
CREATE POLICY "Users can delete own scans" ON public.pipeline_hygiene_scans AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own scans" ON public.pipeline_hygiene_scans;
CREATE POLICY "Users can insert own scans" ON public.pipeline_hygiene_scans AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own scans" ON public.pipeline_hygiene_scans;
CREATE POLICY "Users can update own scans" ON public.pipeline_hygiene_scans AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own scans" ON public.pipeline_hygiene_scans;
CREATE POLICY "Users can view own scans" ON public.pipeline_hygiene_scans AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own pipeline runs" ON public.pipeline_runs;
CREATE POLICY "Users can insert own pipeline runs" ON public.pipeline_runs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can read own pipeline runs" ON public.pipeline_runs;
CREATE POLICY "Users can read own pipeline runs" ON public.pipeline_runs AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own pipeline runs" ON public.pipeline_runs;
CREATE POLICY "Users can update own pipeline runs" ON public.pipeline_runs AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own feedback" ON public.playbook_feedback;
CREATE POLICY "Users can insert own feedback" ON public.playbook_feedback AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can read own feedback" ON public.playbook_feedback;
CREATE POLICY "Users can read own feedback" ON public.playbook_feedback AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own playbook_usage_events" ON public.playbook_usage_events;
CREATE POLICY "Users manage own playbook_usage_events" ON public.playbook_usage_events AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own playbooks" ON public.playbooks;
CREATE POLICY "Users manage own playbooks" ON public.playbooks AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own queue items" ON public.podcast_import_queue;
CREATE POLICY "Users manage own queue items" ON public.podcast_import_queue AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own power_hour_sessions" ON public.power_hour_sessions;
CREATE POLICY "Users can delete own power_hour_sessions" ON public.power_hour_sessions AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own power_hour_sessions" ON public.power_hour_sessions;
CREATE POLICY "Users can insert own power_hour_sessions" ON public.power_hour_sessions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own power_hour_sessions" ON public.power_hour_sessions;
CREATE POLICY "Users can update own power_hour_sessions" ON public.power_hour_sessions AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own power_hour_sessions" ON public.power_hour_sessions;
CREATE POLICY "Users can view own power_hour_sessions" ON public.power_hour_sessions AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "products owner all" ON public.products;
CREATE POLICY "products owner all" ON public.products AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own pto_days" ON public.pto_days;
CREATE POLICY "Users can delete own pto_days" ON public.pto_days AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own pto_days" ON public.pto_days;
CREATE POLICY "Users can insert own pto_days" ON public.pto_days AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own pto_days" ON public.pto_days;
CREATE POLICY "Users can update own pto_days" ON public.pto_days AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own pto_days" ON public.pto_days;
CREATE POLICY "Users can view own pto_days" ON public.pto_days AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own quota_targets" ON public.quota_targets;
CREATE POLICY "Users can insert own quota_targets" ON public.quota_targets AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own quota_targets" ON public.quota_targets;
CREATE POLICY "Users can update own quota_targets" ON public.quota_targets AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own quota_targets" ON public.quota_targets;
CREATE POLICY "Users can view own quota_targets" ON public.quota_targets AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own renewals" ON public.renewals;
CREATE POLICY "Users can delete own renewals" ON public.renewals AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own renewals" ON public.renewals;
CREATE POLICY "Users can insert own renewals" ON public.renewals AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own renewals" ON public.renewals;
CREATE POLICY "Users can update own renewals" ON public.renewals AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own renewals" ON public.renewals;
CREATE POLICY "Users can view own renewals" ON public.renewals AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own research events" ON public.research_queue_events;
CREATE POLICY "Users manage own research events" ON public.research_queue_events AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own resource_chunks" ON public.resource_chunks;
CREATE POLICY "Users manage own resource_chunks" ON public.resource_chunks AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can add to their own collections" ON public.resource_collection_members;
CREATE POLICY "Users can add to their own collections" ON public.resource_collection_members AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can remove from their own collections" ON public.resource_collection_members;
CREATE POLICY "Users can remove from their own collections" ON public.resource_collection_members AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own collection members" ON public.resource_collection_members;
CREATE POLICY "Users can update their own collection members" ON public.resource_collection_members AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own collection members" ON public.resource_collection_members;
CREATE POLICY "Users can view their own collection members" ON public.resource_collection_members AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create their own collections" ON public.resource_collections;
CREATE POLICY "Users can create their own collections" ON public.resource_collections AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own collections" ON public.resource_collections;
CREATE POLICY "Users can delete their own collections" ON public.resource_collections AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own collections" ON public.resource_collections;
CREATE POLICY "Users can update their own collections" ON public.resource_collections AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own collections" ON public.resource_collections;
CREATE POLICY "Users can view their own collections" ON public.resource_collections AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own resource_digests" ON public.resource_digests;
CREATE POLICY "Users manage own resource_digests" ON public.resource_digests AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Service role can manage extraction attempts" ON public.resource_extraction_attempts;
CREATE POLICY "Service role can manage extraction attempts" ON public.resource_extraction_attempts AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their own extraction attempts" ON public.resource_extraction_attempts;
CREATE POLICY "Users can view their own extraction attempts" ON public.resource_extraction_attempts AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own folders" ON public.resource_folders;
CREATE POLICY "Users manage own folders" ON public.resource_folders AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own resource_job_steps" ON public.resource_job_steps;
CREATE POLICY "Users manage own resource_job_steps" ON public.resource_job_steps AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM resource_jobs rj
  WHERE ((rj.id = resource_job_steps.job_id) AND (rj.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM resource_jobs rj
  WHERE ((rj.id = resource_job_steps.job_id) AND (rj.user_id = auth.uid())))));

DROP POLICY IF EXISTS "Users manage own resource_jobs" ON public.resource_jobs;
CREATE POLICY "Users manage own resource_jobs" ON public.resource_jobs AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own resource_links" ON public.resource_links;
CREATE POLICY "Users can delete own resource_links" ON public.resource_links AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own resource_links" ON public.resource_links;
CREATE POLICY "Users can insert own resource_links" ON public.resource_links AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own resource_links" ON public.resource_links;
CREATE POLICY "Users can update own resource_links" ON public.resource_links AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own resource_links" ON public.resource_links;
CREATE POLICY "Users can view own resource_links" ON public.resource_links AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own events" ON public.resource_usage_events;
CREATE POLICY "Users manage own events" ON public.resource_usage_events AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own versions" ON public.resource_versions;
CREATE POLICY "Users manage own versions" ON public.resource_versions AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own resources" ON public.resources;
CREATE POLICY "Users manage own resources" ON public.resources AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "users insert own decisions" ON public.routing_decisions;
CREATE POLICY "users insert own decisions" ON public.routing_decisions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "users read own decisions" ON public.routing_decisions;
CREATE POLICY "users read own decisions" ON public.routing_decisions AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own sales_age_snapshots" ON public.sales_age_snapshots;
CREATE POLICY "Users can insert own sales_age_snapshots" ON public.sales_age_snapshots AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own sales_age_snapshots" ON public.sales_age_snapshots;
CREATE POLICY "Users can update own sales_age_snapshots" ON public.sales_age_snapshots AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own sales_age_snapshots" ON public.sales_age_snapshots;
CREATE POLICY "Users can view own sales_age_snapshots" ON public.sales_age_snapshots AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own benchmarks" ON public.skill_benchmarks;
CREATE POLICY "Users manage own benchmarks" ON public.skill_benchmarks AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create their own skill builder sessions" ON public.skill_builder_sessions;
CREATE POLICY "Users can create their own skill builder sessions" ON public.skill_builder_sessions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own skill builder sessions" ON public.skill_builder_sessions;
CREATE POLICY "Users can delete their own skill builder sessions" ON public.skill_builder_sessions AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own skill builder sessions" ON public.skill_builder_sessions;
CREATE POLICY "Users can update their own skill builder sessions" ON public.skill_builder_sessions AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own skill builder sessions" ON public.skill_builder_sessions;
CREATE POLICY "Users can view their own skill builder sessions" ON public.skill_builder_sessions AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own smoke test results" ON public.smoke_test_results;
CREATE POLICY "Users can insert own smoke test results" ON public.smoke_test_results AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can read own smoke test results" ON public.smoke_test_results;
CREATE POLICY "Users can read own smoke test results" ON public.smoke_test_results AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users manage own source_registry" ON public.source_registry;
CREATE POLICY "Users manage own source_registry" ON public.source_registry AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own stage playbooks" ON public.stage_playbooks;
CREATE POLICY "Users manage own stage playbooks" ON public.stage_playbooks AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can manage their own stage resources" ON public.stage_resources;
CREATE POLICY "Users can manage their own stage resources" ON public.stage_resources AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own artifact feedback" ON public.strategy_artifact_feedback;
CREATE POLICY "Users manage own artifact feedback" ON public.strategy_artifact_feedback AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create their own artifacts" ON public.strategy_artifacts;
CREATE POLICY "Users can create their own artifacts" ON public.strategy_artifacts AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete their own artifacts" ON public.strategy_artifacts;
CREATE POLICY "Users can delete their own artifacts" ON public.strategy_artifacts AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own artifacts" ON public.strategy_artifacts;
CREATE POLICY "Users can update their own artifacts" ON public.strategy_artifacts AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own artifacts" ON public.strategy_artifacts;
CREATE POLICY "Users can view their own artifacts" ON public.strategy_artifacts AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Service role can insert audit logs" ON public.strategy_benchmark_audit_logs;
CREATE POLICY "Service role can insert audit logs" ON public.strategy_benchmark_audit_logs AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view audit logs for their own runs" ON public.strategy_benchmark_audit_logs;
CREATE POLICY "Users can view audit logs for their own runs" ON public.strategy_benchmark_audit_logs AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM strategy_benchmark_runs r
  WHERE ((r.id = strategy_benchmark_audit_logs.run_id) AND (r.user_id = auth.uid())))));

DROP POLICY IF EXISTS "Users can delete their own benchmark runs" ON public.strategy_benchmark_runs;
CREATE POLICY "Users can delete their own benchmark runs" ON public.strategy_benchmark_runs AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert their own benchmark runs" ON public.strategy_benchmark_runs;
CREATE POLICY "Users can insert their own benchmark runs" ON public.strategy_benchmark_runs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own benchmark runs" ON public.strategy_benchmark_runs;
CREATE POLICY "Users can update their own benchmark runs" ON public.strategy_benchmark_runs AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own benchmark runs" ON public.strategy_benchmark_runs;
CREATE POLICY "Users can view their own benchmark runs" ON public.strategy_benchmark_runs AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own custom pills" ON public.strategy_custom_pills;
CREATE POLICY "Users manage own custom pills" ON public.strategy_custom_pills AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own messages" ON public.strategy_messages;
CREATE POLICY "Users manage own messages" ON public.strategy_messages AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own strategy_outcomes" ON public.strategy_outcomes;
CREATE POLICY "Users manage own strategy_outcomes" ON public.strategy_outcomes AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own outputs" ON public.strategy_outputs;
CREATE POLICY "Users manage own outputs" ON public.strategy_outputs AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Service role full access" ON public.strategy_promotion_proposals;
CREATE POLICY "Service role full access" ON public.strategy_promotion_proposals AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users delete own proposals" ON public.strategy_promotion_proposals;
CREATE POLICY "Users delete own proposals" ON public.strategy_promotion_proposals AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users insert own proposals" ON public.strategy_promotion_proposals;
CREATE POLICY "Users insert own proposals" ON public.strategy_promotion_proposals AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users update own proposals" ON public.strategy_promotion_proposals;
CREATE POLICY "Users update own proposals" ON public.strategy_promotion_proposals AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users view own proposals" ON public.strategy_promotion_proposals;
CREATE POLICY "Users view own proposals" ON public.strategy_promotion_proposals AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own rollups" ON public.strategy_rollups;
CREATE POLICY "Users manage own rollups" ON public.strategy_rollups AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert their own telemetry" ON public.strategy_run_telemetry;
CREATE POLICY "Users can insert their own telemetry" ON public.strategy_run_telemetry AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own telemetry" ON public.strategy_run_telemetry;
CREATE POLICY "Users can view their own telemetry" ON public.strategy_run_telemetry AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own stress runs" ON public.strategy_stress_runs;
CREATE POLICY "Users manage own stress runs" ON public.strategy_stress_runs AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own stress turns" ON public.strategy_stress_turns;
CREATE POLICY "Users manage own stress turns" ON public.strategy_stress_turns AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own cache" ON public.strategy_synthesis_cache;
CREATE POLICY "Users can delete own cache" ON public.strategy_synthesis_cache AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own cache" ON public.strategy_synthesis_cache;
CREATE POLICY "Users can insert own cache" ON public.strategy_synthesis_cache AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can read own cache" ON public.strategy_synthesis_cache;
CREATE POLICY "Users can read own cache" ON public.strategy_synthesis_cache AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own cache" ON public.strategy_synthesis_cache;
CREATE POLICY "Users can update own cache" ON public.strategy_synthesis_cache AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Owners delete their conflicts" ON public.strategy_thread_conflicts;
CREATE POLICY "Owners delete their conflicts" ON public.strategy_thread_conflicts AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Owners insert their conflicts" ON public.strategy_thread_conflicts;
CREATE POLICY "Owners insert their conflicts" ON public.strategy_thread_conflicts AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Owners select their conflicts" ON public.strategy_thread_conflicts;
CREATE POLICY "Owners select their conflicts" ON public.strategy_thread_conflicts AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Owners update their conflicts" ON public.strategy_thread_conflicts;
CREATE POLICY "Owners update their conflicts" ON public.strategy_thread_conflicts AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own thread resources" ON public.strategy_thread_resources;
CREATE POLICY "Users manage own thread resources" ON public.strategy_thread_resources AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own threads" ON public.strategy_threads;
CREATE POLICY "Users manage own threads" ON public.strategy_threads AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own uploads" ON public.strategy_uploaded_resources;
CREATE POLICY "Users manage own uploads" ON public.strategy_uploaded_resources AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own workflow runs" ON public.strategy_workflow_runs;
CREATE POLICY "Users manage own workflow runs" ON public.strategy_workflow_runs AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own streak_events" ON public.streak_events;
CREATE POLICY "Users can insert own streak_events" ON public.streak_events AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own streak_events" ON public.streak_events;
CREATE POLICY "Users can update own streak_events" ON public.streak_events AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own streak_events" ON public.streak_events;
CREATE POLICY "Users can view own streak_events" ON public.streak_events AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own streak_summary" ON public.streak_summary;
CREATE POLICY "Users can insert own streak_summary" ON public.streak_summary AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own streak_summary" ON public.streak_summary;
CREATE POLICY "Users can update own streak_summary" ON public.streak_summary AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own streak_summary" ON public.streak_summary;
CREATE POLICY "Users can view own streak_summary" ON public.streak_summary AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own task_run_sections" ON public.task_run_sections;
CREATE POLICY "Users can insert own task_run_sections" ON public.task_run_sections AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own task_run_sections" ON public.task_run_sections;
CREATE POLICY "Users can update own task_run_sections" ON public.task_run_sections AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own task_run_sections" ON public.task_run_sections;
CREATE POLICY "Users can view own task_run_sections" ON public.task_run_sections AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own runs" ON public.task_runs;
CREATE POLICY "Users can insert own runs" ON public.task_runs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own runs" ON public.task_runs;
CREATE POLICY "Users can update own runs" ON public.task_runs AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own runs" ON public.task_runs;
CREATE POLICY "Users can view own runs" ON public.task_runs AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own templates" ON public.task_templates;
CREATE POLICY "Users can insert own templates" ON public.task_templates AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own templates" ON public.task_templates;
CREATE POLICY "Users can update own templates" ON public.task_templates AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own templates" ON public.task_templates;
CREATE POLICY "Users can view own templates" ON public.task_templates AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (is_system = true)));

DROP POLICY IF EXISTS "Users can delete own tasks" ON public.tasks;
CREATE POLICY "Users can delete own tasks" ON public.tasks AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own tasks" ON public.tasks;
CREATE POLICY "Users can insert own tasks" ON public.tasks AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own tasks" ON public.tasks;
CREATE POLICY "Users can update own tasks" ON public.tasks AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own tasks" ON public.tasks;
CREATE POLICY "Users can view own tasks" ON public.tasks AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own suggestions" ON public.template_suggestions;
CREATE POLICY "Users manage own suggestions" ON public.template_suggestions AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can manage their own profile" ON public.territory_profile;
CREATE POLICY "Users can manage their own profile" ON public.territory_profile AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own territory memory" ON public.territory_strategy_memory;
CREATE POLICY "Users manage own territory memory" ON public.territory_strategy_memory AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can create their own blocks" ON public.training_blocks;
CREATE POLICY "Users can create their own blocks" ON public.training_blocks AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update their own blocks" ON public.training_blocks;
CREATE POLICY "Users can update their own blocks" ON public.training_blocks AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view their own blocks" ON public.training_blocks;
CREATE POLICY "Users can view their own blocks" ON public.training_blocks AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own transcript grades" ON public.transcript_grades;
CREATE POLICY "Users can delete own transcript grades" ON public.transcript_grades AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own transcript grades" ON public.transcript_grades;
CREATE POLICY "Users can insert own transcript grades" ON public.transcript_grades AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own transcript grades" ON public.transcript_grades;
CREATE POLICY "Users can update own transcript grades" ON public.transcript_grades AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own transcript grades" ON public.transcript_grades;
CREATE POLICY "Users can view own transcript grades" ON public.transcript_grades AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "manage own user_band_gate" ON public.user_band_gate;
CREATE POLICY "manage own user_band_gate" ON public.user_band_gate AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "manage own user_competency" ON public.user_competency;
CREATE POLICY "manage own user_competency" ON public.user_competency AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own progress" ON public.user_lesson_progress;
CREATE POLICY "Users manage own progress" ON public.user_lesson_progress AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings" ON public.user_settings AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "own train prefs delete" ON public.user_train_prefs;
CREATE POLICY "own train prefs delete" ON public.user_train_prefs AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "own train prefs insert" ON public.user_train_prefs;
CREATE POLICY "own train prefs insert" ON public.user_train_prefs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "own train prefs select" ON public.user_train_prefs;
CREATE POLICY "own train prefs select" ON public.user_train_prefs AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "own train prefs update" ON public.user_train_prefs;
CREATE POLICY "own train prefs update" ON public.user_train_prefs AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own verification_runs" ON public.verification_runs;
CREATE POLICY "Users manage own verification_runs" ON public.verification_runs AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS vertical_briefs_owner ON public.vertical_briefs;
CREATE POLICY vertical_briefs_owner ON public.vertical_briefs AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS verticals_owner ON public.verticals;
CREATE POLICY verticals_owner ON public.verticals AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users own their reminders" ON public.voice_reminders;
CREATE POLICY "Users own their reminders" ON public.voice_reminders AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own battle plans" ON public.weekly_battle_plans;
CREATE POLICY "Users can insert own battle plans" ON public.weekly_battle_plans AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own battle plans" ON public.weekly_battle_plans;
CREATE POLICY "Users can update own battle plans" ON public.weekly_battle_plans AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own battle plans" ON public.weekly_battle_plans;
CREATE POLICY "Users can view own battle plans" ON public.weekly_battle_plans AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users manage own research queue" ON public.weekly_research_queue;
CREATE POLICY "Users manage own research queue" ON public.weekly_research_queue AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own weekly_reviews" ON public.weekly_reviews;
CREATE POLICY "Users can insert own weekly_reviews" ON public.weekly_reviews AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own weekly_reviews" ON public.weekly_reviews;
CREATE POLICY "Users can update own weekly_reviews" ON public.weekly_reviews AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own weekly_reviews" ON public.weekly_reviews;
CREATE POLICY "Users can view own weekly_reviews" ON public.weekly_reviews AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own work_schedule_config" ON public.work_schedule_config;
CREATE POLICY "Users can insert own work_schedule_config" ON public.work_schedule_config AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own work_schedule_config" ON public.work_schedule_config;
CREATE POLICY "Users can update own work_schedule_config" ON public.work_schedule_config AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own work_schedule_config" ON public.work_schedule_config;
CREATE POLICY "Users can view own work_schedule_config" ON public.work_schedule_config AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can delete own workday_overrides" ON public.workday_overrides;
CREATE POLICY "Users can delete own workday_overrides" ON public.workday_overrides AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can insert own workday_overrides" ON public.workday_overrides;
CREATE POLICY "Users can insert own workday_overrides" ON public.workday_overrides AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can update own workday_overrides" ON public.workday_overrides;
CREATE POLICY "Users can update own workday_overrides" ON public.workday_overrides AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own workday_overrides" ON public.workday_overrides;
CREATE POLICY "Users can view own workday_overrides" ON public.workday_overrides AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.background_jobs; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_diagnoses; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.podcast_import_queue; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_job_steps; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_jobs; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.resources; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- pg_cron jobs
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sync-calendar-hourly';
SELECT cron.schedule('sync-calendar-hourly', '0 * * * *', '
  SELECT net.http_post(
    url := ''https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/sync-calendar'',
    headers := ''{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1amttY2JxYXZzbXpobmJxdm1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTQ3NzcsImV4cCI6MjA5OTE5MDc3N30.19WUtFlglG7_Slm4PIs7Eb3MMbvbwQd15oR6hc3yyGo"}''::jsonb,
    body := ''{}''::jsonb
  ) AS request_id;
  ');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'process-podcast-queue-every-minute';
SELECT cron.schedule('process-podcast-queue-every-minute', '* * * * *', '
  SELECT net.http_post(
    url := ''https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/process-podcast-queue'',
    headers := ''{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1amttY2JxYXZzbXpobmJxdm1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTQ3NzcsImV4cCI6MjA5OTE5MDc3N30.19WUtFlglG7_Slm4PIs7Eb3MMbvbwQd15oR6hc3yyGo"}''::jsonb,
    body := ''{}''::jsonb
  ) AS request_id;
  ');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'daily-digest-6am';
SELECT cron.schedule('daily-digest-6am', '0 6 * * *', '
  SELECT net.http_post(
    url:=''https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/daily-digest'',
    headers:=''{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1amttY2JxYXZzbXpobmJxdm1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTQ3NzcsImV4cCI6MjA5OTE5MDc3N30.19WUtFlglG7_Slm4PIs7Eb3MMbvbwQd15oR6hc3yyGo", "x-cron-secret": "86Ge1BivMfeBKy6i22x1SBNC2TXSHTAjCOcjnPFPqT5mq5xz2LNmGzpsKKye06Xo"}''::jsonb,
    body:=''{}''::jsonb
  ) AS request_id;
  ');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'run-strategy-task-reaper-every-minute';
SELECT cron.schedule('run-strategy-task-reaper-every-minute', '* * * * *', '
  SELECT net.http_post(
    url := ''https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/run-strategy-task-reaper'',
    headers := ''{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1amttY2JxYXZzbXpobmJxdm1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTQ3NzcsImV4cCI6MjA5OTE5MDc3N30.19WUtFlglG7_Slm4PIs7Eb3MMbvbwQd15oR6hc3yyGo","x-cron-secret":"86Ge1BivMfeBKy6i22x1SBNC2TXSHTAjCOcjnPFPqT5mq5xz2LNmGzpsKKye06Xo"}''::jsonb,
    body := ''{}''::jsonb
  ) as request_id;
  ');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ops_sentinel_v1';
SELECT cron.schedule('ops_sentinel_v1', '0 3 * * *', '
INSERT INTO agent_events (user_id, agent, event_type, so_what, signal_class, confidence, status, provenance, payload)
SELECT (SELECT user_id FROM accounts LIMIT 1), ''ops_sentinel'', ''nightly_invariants'',
 CASE WHEN violations = 0 THEN ''All invariants passed — the app told the truth today'' ELSE violations || '' invariant(s) FAILED — see payload; the app may be contradicting itself'' END,
 ''evergreen'', 1.0, CASE WHEN violations = 0 THEN ''consumed'' ELSE ''proposed'' END,
 ''{"source_label":"agent:ops_sentinel"}''::jsonb,
 jsonb_build_object(''orphan_pov'', (SELECT count(*) FROM branch_pov p WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id=p.account_id)),
                    ''unclassified_signals'', (SELECT count(*) FROM account_signals WHERE signal_class IS NULL),
                    ''expired_unreaped'', (SELECT count(*) FROM agent_events WHERE expires_at < now() AND status=''proposed''))
FROM (SELECT (SELECT count(*) FROM branch_pov p WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id=p.account_id))
           + (SELECT count(*) FROM account_signals WHERE signal_class IS NULL) AS violations) v;
');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'lease_reaper_v1';
SELECT cron.schedule('lease_reaper_v1', '*/15 * * * *', 'UPDATE agent_events SET status=''proposed'', lease_until=NULL WHERE status=''processing'' AND lease_until < now();');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'decay_evaporator_v1';
SELECT cron.schedule('decay_evaporator_v1', '0 2 * * *', 'UPDATE agent_events SET status=''expired'' WHERE status=''proposed'' AND expires_at IS NOT NULL AND expires_at < now();');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'freshness_warden_v1';
SELECT cron.schedule('freshness_warden_v1', '0 4 * * *', 'INSERT INTO agent_events (user_id, agent, event_type, account_id, so_what, signal_class, confidence, status, provenance, expires_at) SELECT s.user_id, ''freshness_warden'', ''signal_aging'', s.linked_account_id, ''Window signal for '' || s.linked_account_name || '' is '' || (now()::date - s.observed_at) || '' days old - verify still true or archive'', ''evergreen'', 0.7, ''proposed'', ''{"source_label":"agent:freshness_warden"}''::jsonb, now() + interval ''14 days'' FROM account_signals s WHERE s.signal_class = ''window'' AND s.observed_at < now() - interval ''60 days'' AND NOT EXISTS (SELECT 1 FROM agent_events e WHERE e.agent = ''freshness_warden'' AND e.account_id = s.linked_account_id AND e.created_at > now() - interval ''30 days'');');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'generate-daily-plan-5am-et';
SELECT cron.schedule('generate-daily-plan-5am-et', '0 10 * * 1-5', '
  SELECT net.http_post(
    url:=''https://uujkmcbqavsmzhnbqvmm.supabase.co/functions/v1/schedule-daily-plan'',
    headers:=''{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1amttY2JxYXZzbXpobmJxdm1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTQ3NzcsImV4cCI6MjA5OTE5MDc3N30.19WUtFlglG7_Slm4PIs7Eb3MMbvbwQd15oR6hc3yyGo", "x-cron-secret": "86Ge1BivMfeBKy6i22x1SBNC2TXSHTAjCOcjnPFPqT5mq5xz2LNmGzpsKKye06Xo"}''::jsonb,
    body:=concat(''{"time": "'', now(), ''"}'')::jsonb,
    timeout_milliseconds:=25000
  ) AS request_id;
');


INSERT INTO public.function_configs (function_name, primary_model, fallback_model, notes, updated_at) VALUES
  ('analyze-call', 'claude-haiku-4-5-20251001', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('analyze-deal-outcome', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('analyze-sentiment', 'google/gemini-2.5-flash-lite', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('batch-extract-kis', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('batch-regrade-now', 'claude-sonnet-4-6', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('build-resource', 'google/gemini-3-flash-preview', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('car-mode-audio-score', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('car-mode-score', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('classify-resource', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('classify-signal', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('clean-baseline', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('derive-library-cards', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('detect-knowledge-gaps', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('discover-contacts', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('discover-resources', 'google/gemini-2.5-pro', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('dojo-review-score', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('dojo-roleplay-score', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('dojo-score', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('elevenlabs-tts-stream', 'eleven_turbo_v2_5', NULL, 'not an LLM — audio model', '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('enrich-account', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('expand-prompt', 'claude-haiku-4-5-20251001', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('explain-score', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('extract-scenarios', 'google/gemini-3-flash-preview', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('extract-strategy-memory', 'claude-haiku-4-5-20251001', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('extract-tactics', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('extract-tasks', 'google/gemini-3-flash-preview', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('generate-call-goals', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('generate-execution-draft', 'google/gemini-3-flash-preview', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('generate-flashcards', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('generate-lesson-content', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('generate-playbooks', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('generate-stage-playbook', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('grade-lesson-response', 'claude-sonnet-4-6', NULL, 'legacy gateway URL — needs gateway elimination pass', '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('grade-mock-call', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('grade-objection-drill', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('grade-transcript', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('mock-call', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('operationalize-resource', 'google/gemini-3-flash-preview', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('parse-account-screenshot', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('parse-account-synopsis', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('parse-calendar-screenshot', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('parse-claude-import', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('parse-opp-synopsis', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('parse-screenshot', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('parse-uploaded-file', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('pdf-ocr', 'google/gemini-2.5-flash', NULL, 'vision', '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('playbook-roleplay', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('preprocess-transcript', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('prioritize-accounts', 'google/gemini-3-flash-preview', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('run-strategy-eval-synthesis', 'gpt-5', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('score-micro-drill', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('score-original-response', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('source-icp-accounts', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('strategy-chat', 'gpt-4o', 'claude-sonnet-4-6', NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('strategy-detect-proposals', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('strategy-summarize-upload', 'google/gemini-2.5-flash-lite', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('strategy-transform-output', 'gpt-5-mini', 'gpt-4o', NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('suggest-resource-uses', 'google/gemini-3-flash-preview', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('suggest-templates', 'google/gemini-3-flash-preview', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('territory-copilot', 'google/gemini-2.5-pro', 'google/gemini-2.5-flash', NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('voice-command', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone),
  ('weekly-battle-plan', 'google/gemini-2.5-flash', NULL, NULL, '2026-07-09 18:41:16.610079+00'::timestamp with time zone)
ON CONFLICT (function_name) DO UPDATE SET primary_model = EXCLUDED.primary_model, fallback_model = EXCLUDED.fallback_model, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at;

NOTIFY pgrst, 'reload schema';
RESET check_function_bodies;
RESET row_security;
RESET search_path;
