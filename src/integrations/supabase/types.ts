export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      account_contacts: {
        Row: {
          account_id: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          renewal_id: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          renewal_id?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          renewal_id?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_contacts_renewal_id_fkey"
            columns: ["renewal_id"]
            isOneToOne: false
            referencedRelation: "renewals"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_status: string | null
          cadence_name: string | null
          category_complexity: boolean | null
          confidence_score: number | null
          contact_status: string | null
          created_at: string
          crm_lifecycle_team_size: number | null
          current_agreement_link: string | null
          direct_ecommerce: boolean | null
          ecommerce: string | null
          email_sms_capture: boolean | null
          enrichment_evidence: Json | null
          enrichment_source_summary: string | null
          high_probability_buyer: boolean | null
          icp_fit_score: number | null
          icp_score_override: number | null
          id: string
          industry: string | null
          last_enriched_at: string | null
          last_touch_date: string | null
          last_touch_type: string | null
          lifecycle_override: boolean | null
          lifecycle_override_reason: string | null
          lifecycle_tier: string | null
          loyalty_membership: boolean | null
          mar_tech: string | null
          marketing_platform_detected: string | null
          mobile_app: boolean | null
          motion: string | null
          name: string
          next_step: string | null
          next_touch_due: string | null
          notes: string | null
          outreach_status: string | null
          planhat_link: string | null
          priority: string | null
          priority_score: number | null
          salesforce_id: string | null
          salesforce_link: string | null
          tags: string[] | null
          tech_fit_flag: string | null
          tech_stack: string[] | null
          tech_stack_notes: string | null
          tier: string | null
          tier_override: string | null
          timing_score: number | null
          touches_this_week: number | null
          trigger_events: Json | null
          triggered_account: boolean | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          account_status?: string | null
          cadence_name?: string | null
          category_complexity?: boolean | null
          confidence_score?: number | null
          contact_status?: string | null
          created_at?: string
          crm_lifecycle_team_size?: number | null
          current_agreement_link?: string | null
          direct_ecommerce?: boolean | null
          ecommerce?: string | null
          email_sms_capture?: boolean | null
          enrichment_evidence?: Json | null
          enrichment_source_summary?: string | null
          high_probability_buyer?: boolean | null
          icp_fit_score?: number | null
          icp_score_override?: number | null
          id?: string
          industry?: string | null
          last_enriched_at?: string | null
          last_touch_date?: string | null
          last_touch_type?: string | null
          lifecycle_override?: boolean | null
          lifecycle_override_reason?: string | null
          lifecycle_tier?: string | null
          loyalty_membership?: boolean | null
          mar_tech?: string | null
          marketing_platform_detected?: string | null
          mobile_app?: boolean | null
          motion?: string | null
          name: string
          next_step?: string | null
          next_touch_due?: string | null
          notes?: string | null
          outreach_status?: string | null
          planhat_link?: string | null
          priority?: string | null
          priority_score?: number | null
          salesforce_id?: string | null
          salesforce_link?: string | null
          tags?: string[] | null
          tech_fit_flag?: string | null
          tech_stack?: string[] | null
          tech_stack_notes?: string | null
          tier?: string | null
          tier_override?: string | null
          timing_score?: number | null
          touches_this_week?: number | null
          trigger_events?: Json | null
          triggered_account?: boolean | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          account_status?: string | null
          cadence_name?: string | null
          category_complexity?: boolean | null
          confidence_score?: number | null
          contact_status?: string | null
          created_at?: string
          crm_lifecycle_team_size?: number | null
          current_agreement_link?: string | null
          direct_ecommerce?: boolean | null
          ecommerce?: string | null
          email_sms_capture?: boolean | null
          enrichment_evidence?: Json | null
          enrichment_source_summary?: string | null
          high_probability_buyer?: boolean | null
          icp_fit_score?: number | null
          icp_score_override?: number | null
          id?: string
          industry?: string | null
          last_enriched_at?: string | null
          last_touch_date?: string | null
          last_touch_type?: string | null
          lifecycle_override?: boolean | null
          lifecycle_override_reason?: string | null
          lifecycle_tier?: string | null
          loyalty_membership?: boolean | null
          mar_tech?: string | null
          marketing_platform_detected?: string | null
          mobile_app?: boolean | null
          motion?: string | null
          name?: string
          next_step?: string | null
          next_touch_due?: string | null
          notes?: string | null
          outreach_status?: string | null
          planhat_link?: string | null
          priority?: string | null
          priority_score?: number | null
          salesforce_id?: string | null
          salesforce_link?: string | null
          tags?: string[] | null
          tech_fit_flag?: string | null
          tech_stack?: string[] | null
          tech_stack_notes?: string | null
          tier?: string | null
          tier_override?: string | null
          timing_score?: number | null
          touches_this_week?: number | null
          trigger_events?: Json | null
          triggered_account?: boolean | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      ai_feedback: {
        Row: {
          ai_suggestion_summary: string | null
          context_date: string | null
          created_at: string
          feature: string
          feedback_text: string | null
          id: string
          rating: number | null
          user_id: string
        }
        Insert: {
          ai_suggestion_summary?: string | null
          context_date?: string | null
          created_at?: string
          feature: string
          feedback_text?: string | null
          id?: string
          rating?: number | null
          user_id: string
        }
        Update: {
          ai_suggestion_summary?: string | null
          context_date?: string | null
          created_at?: string
          feature?: string
          feedback_text?: string | null
          id?: string
          rating?: number | null
          user_id?: string
        }
        Relationships: []
      }
      badges_earned: {
        Row: {
          badge_name: string
          badge_type: string
          earned_at: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          badge_name: string
          badge_type: string
          earned_at?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          badge_name?: string
          badge_type?: string
          earned_at?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      calendar_events: {
        Row: {
          all_day: boolean
          created_at: string
          description: string | null
          end_time: string | null
          external_id: string
          id: string
          location: string | null
          start_time: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          all_day?: boolean
          created_at?: string
          description?: string | null
          end_time?: string | null
          external_id: string
          id?: string
          location?: string | null
          start_time: string
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          all_day?: boolean
          created_at?: string
          description?: string | null
          end_time?: string | null
          external_id?: string
          id?: string
          location?: string | null
          start_time?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      call_transcripts: {
        Row: {
          account_id: string | null
          call_date: string
          call_goals: string[] | null
          call_type: string | null
          content: string
          created_at: string
          duration_minutes: number | null
          file_url: string | null
          id: string
          notes: string | null
          opportunity_id: string | null
          participants: string | null
          renewal_id: string | null
          summary: string | null
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          call_date?: string
          call_goals?: string[] | null
          call_type?: string | null
          content: string
          created_at?: string
          duration_minutes?: number | null
          file_url?: string | null
          id?: string
          notes?: string | null
          opportunity_id?: string | null
          participants?: string | null
          renewal_id?: string | null
          summary?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          call_date?: string
          call_goals?: string[] | null
          call_type?: string | null
          content?: string
          created_at?: string
          duration_minutes?: number | null
          file_url?: string | null
          id?: string
          notes?: string | null
          opportunity_id?: string | null
          participants?: string | null
          renewal_id?: string | null
          summary?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_transcripts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_transcripts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_transcripts_renewal_id_fkey"
            columns: ["renewal_id"]
            isOneToOne: false
            referencedRelation: "renewals"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_plans: {
        Row: {
          created_at: string | null
          focus_category: string
          id: string
          start_date: string | null
          status: string | null
          target_score: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          focus_category: string
          id?: string
          start_date?: string | null
          status?: string | null
          target_score: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          focus_category?: string
          id?: string
          start_date?: string | null
          status?: string | null
          target_score?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          account_id: string | null
          ai_discovered: boolean | null
          buyer_role: string | null
          created_at: string
          department: string | null
          discovery_source: string | null
          email: string | null
          id: string
          influence_level: string | null
          last_touch_date: string | null
          linkedin_url: string | null
          name: string
          notes: string | null
          preferred_channel: string | null
          reporting_to: string | null
          salesforce_id: string | null
          salesforce_link: string | null
          seniority: string | null
          status: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          ai_discovered?: boolean | null
          buyer_role?: string | null
          created_at?: string
          department?: string | null
          discovery_source?: string | null
          email?: string | null
          id?: string
          influence_level?: string | null
          last_touch_date?: string | null
          linkedin_url?: string | null
          name: string
          notes?: string | null
          preferred_channel?: string | null
          reporting_to?: string | null
          salesforce_id?: string | null
          salesforce_link?: string | null
          seniority?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          ai_discovered?: boolean | null
          buyer_role?: string | null
          created_at?: string
          department?: string | null
          discovery_source?: string | null
          email?: string | null
          id?: string
          influence_level?: string | null
          last_touch_date?: string | null
          linkedin_url?: string | null
          name?: string
          notes?: string | null
          preferred_channel?: string | null
          reporting_to?: string | null
          salesforce_id?: string | null
          salesforce_link?: string | null
          seniority?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_benchmarks: {
        Row: {
          avg_new_logo_arr: number
          avg_renewal_arr: number
          avg_sales_cycle_days: number
          confidence_level: string
          connect_to_meeting_rate: number
          created_at: string
          data_points: number
          dials_to_connect_rate: number
          id: string
          meeting_to_opp_rate: number
          opp_to_close_rate: number
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_new_logo_arr?: number
          avg_renewal_arr?: number
          avg_sales_cycle_days?: number
          confidence_level?: string
          connect_to_meeting_rate?: number
          created_at?: string
          data_points?: number
          dials_to_connect_rate?: number
          id?: string
          meeting_to_opp_rate?: number
          opp_to_close_rate?: number
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_new_logo_arr?: number
          avg_renewal_arr?: number
          avg_sales_cycle_days?: number
          confidence_level?: string
          connect_to_meeting_rate?: number
          created_at?: string
          data_points?: number
          dials_to_connect_rate?: number
          id?: string
          meeting_to_opp_rate?: number
          opp_to_close_rate?: number
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      custom_prompts: {
        Row: {
          content_type: string | null
          created_at: string | null
          id: string
          prompt_text: string
          title: string
          updated_at: string | null
          user_id: string
          variables: string[] | null
        }
        Insert: {
          content_type?: string | null
          created_at?: string | null
          id?: string
          prompt_text: string
          title: string
          updated_at?: string | null
          user_id: string
          variables?: string[] | null
        }
        Update: {
          content_type?: string | null
          created_at?: string | null
          id?: string
          prompt_text?: string
          title?: string
          updated_at?: string | null
          user_id?: string
          variables?: string[] | null
        }
        Relationships: []
      }
      daily_digest_items: {
        Row: {
          account_id: string | null
          account_name: string
          category: string
          created_at: string
          digest_date: string
          headline: string
          id: string
          is_actionable: boolean | null
          is_read: boolean | null
          raw_data: Json | null
          relevance_score: number | null
          source_url: string | null
          suggested_action: string | null
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          account_name: string
          category?: string
          created_at?: string
          digest_date?: string
          headline: string
          id?: string
          is_actionable?: boolean | null
          is_read?: boolean | null
          raw_data?: Json | null
          relevance_score?: number | null
          source_url?: string | null
          suggested_action?: string | null
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          account_name?: string
          category?: string
          created_at?: string
          digest_date?: string
          headline?: string
          id?: string
          is_actionable?: boolean | null
          is_read?: boolean | null
          raw_data?: Json | null
          relevance_score?: number | null
          source_url?: string | null
          suggested_action?: string | null
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_digest_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_journal_entries: {
        Row: {
          account_deep_work_minutes: number
          accountability_habits: Json | null
          accounts_researched: number
          admin_heavy_day: boolean
          automated_emails: number
          biggest_blocker: string | null
          calls_need_prep_count: number | null
          calls_prep_note: string | null
          check_in_timestamp: string | null
          checked_in: boolean
          clarity: number | null
          confirmation_timestamp: string | null
          confirmed: boolean
          contacts_prepped: number
          context_switching: string | null
          conversations: number
          created_at: string
          customer_meetings_held: number
          daily_reflection: string | null
          daily_score: number | null
          date: string
          dials: number
          distracted_minutes: number | null
          distractions: string | null
          energy: number | null
          expansion_touchpoints: number
          first_call_logged: boolean | null
          first_call_time: string | null
          focus_label: string | null
          focus_mode: string
          focus_quality: number | null
          focus_score: number | null
          goal_met: boolean
          id: string
          manager_plus_messages: number
          manual_emails: number
          meeting_prep_done: boolean | null
          meetings_set: number
          meetings_unprepared_for: boolean | null
          meetings_unprepared_note: string | null
          opportunities_created: number
          personal_development: boolean
          phone_pickups: number | null
          pipeline_moved: number | null
          prepped_for_all_calls_tomorrow: boolean | null
          prospecting_block_minutes: number
          prospects_added: number
          sales_productivity: number | null
          sales_recovery: number | null
          sales_strain: number | null
          sentiment_label: string | null
          sentiment_score: number | null
          sleep_hours: number | null
          stress: number | null
          tomorrow_priority: string | null
          travel_day: boolean
          updated_at: string
          user_id: string | null
          what_drained_you: string | null
          what_worked_today: string | null
          workday_end_time: string | null
          workday_focus: string | null
          workday_start_time: string | null
          yesterday_commitment_met: boolean | null
        }
        Insert: {
          account_deep_work_minutes?: number
          accountability_habits?: Json | null
          accounts_researched?: number
          admin_heavy_day?: boolean
          automated_emails?: number
          biggest_blocker?: string | null
          calls_need_prep_count?: number | null
          calls_prep_note?: string | null
          check_in_timestamp?: string | null
          checked_in?: boolean
          clarity?: number | null
          confirmation_timestamp?: string | null
          confirmed?: boolean
          contacts_prepped?: number
          context_switching?: string | null
          conversations?: number
          created_at?: string
          customer_meetings_held?: number
          daily_reflection?: string | null
          daily_score?: number | null
          date: string
          dials?: number
          distracted_minutes?: number | null
          distractions?: string | null
          energy?: number | null
          expansion_touchpoints?: number
          first_call_logged?: boolean | null
          first_call_time?: string | null
          focus_label?: string | null
          focus_mode?: string
          focus_quality?: number | null
          focus_score?: number | null
          goal_met?: boolean
          id?: string
          manager_plus_messages?: number
          manual_emails?: number
          meeting_prep_done?: boolean | null
          meetings_set?: number
          meetings_unprepared_for?: boolean | null
          meetings_unprepared_note?: string | null
          opportunities_created?: number
          personal_development?: boolean
          phone_pickups?: number | null
          pipeline_moved?: number | null
          prepped_for_all_calls_tomorrow?: boolean | null
          prospecting_block_minutes?: number
          prospects_added?: number
          sales_productivity?: number | null
          sales_recovery?: number | null
          sales_strain?: number | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          sleep_hours?: number | null
          stress?: number | null
          tomorrow_priority?: string | null
          travel_day?: boolean
          updated_at?: string
          user_id?: string | null
          what_drained_you?: string | null
          what_worked_today?: string | null
          workday_end_time?: string | null
          workday_focus?: string | null
          workday_start_time?: string | null
          yesterday_commitment_met?: boolean | null
        }
        Update: {
          account_deep_work_minutes?: number
          accountability_habits?: Json | null
          accounts_researched?: number
          admin_heavy_day?: boolean
          automated_emails?: number
          biggest_blocker?: string | null
          calls_need_prep_count?: number | null
          calls_prep_note?: string | null
          check_in_timestamp?: string | null
          checked_in?: boolean
          clarity?: number | null
          confirmation_timestamp?: string | null
          confirmed?: boolean
          contacts_prepped?: number
          context_switching?: string | null
          conversations?: number
          created_at?: string
          customer_meetings_held?: number
          daily_reflection?: string | null
          daily_score?: number | null
          date?: string
          dials?: number
          distracted_minutes?: number | null
          distractions?: string | null
          energy?: number | null
          expansion_touchpoints?: number
          first_call_logged?: boolean | null
          first_call_time?: string | null
          focus_label?: string | null
          focus_mode?: string
          focus_quality?: number | null
          focus_score?: number | null
          goal_met?: boolean
          id?: string
          manager_plus_messages?: number
          manual_emails?: number
          meeting_prep_done?: boolean | null
          meetings_set?: number
          meetings_unprepared_for?: boolean | null
          meetings_unprepared_note?: string | null
          opportunities_created?: number
          personal_development?: boolean
          phone_pickups?: number | null
          pipeline_moved?: number | null
          prepped_for_all_calls_tomorrow?: boolean | null
          prospecting_block_minutes?: number
          prospects_added?: number
          sales_productivity?: number | null
          sales_recovery?: number | null
          sales_strain?: number | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          sleep_hours?: number | null
          stress?: number | null
          tomorrow_priority?: string | null
          travel_day?: boolean
          updated_at?: string
          user_id?: string | null
          what_drained_you?: string | null
          what_worked_today?: string | null
          workday_end_time?: string | null
          workday_focus?: string | null
          workday_start_time?: string | null
          yesterday_commitment_met?: boolean | null
        }
        Relationships: []
      }
      daily_plan_preferences: {
        Row: {
          created_at: string
          id: string
          lunch_end: string | null
          lunch_start: string | null
          max_back_to_back_meetings: number | null
          min_block_minutes: number
          no_meetings_after: string | null
          no_meetings_before: string | null
          personal_rules: Json
          prefer_new_logo_morning: boolean
          updated_at: string
          user_id: string
          work_end_time: string
          work_start_time: string
        }
        Insert: {
          created_at?: string
          id?: string
          lunch_end?: string | null
          lunch_start?: string | null
          max_back_to_back_meetings?: number | null
          min_block_minutes?: number
          no_meetings_after?: string | null
          no_meetings_before?: string | null
          personal_rules?: Json
          prefer_new_logo_morning?: boolean
          updated_at?: string
          user_id: string
          work_end_time?: string
          work_start_time?: string
        }
        Update: {
          created_at?: string
          id?: string
          lunch_end?: string | null
          lunch_start?: string | null
          max_back_to_back_meetings?: number | null
          min_block_minutes?: number
          no_meetings_after?: string | null
          no_meetings_before?: string | null
          personal_rules?: Json
          prefer_new_logo_morning?: boolean
          updated_at?: string
          user_id?: string
          work_end_time?: string
          work_start_time?: string
        }
        Relationships: []
      }
      daily_time_blocks: {
        Row: {
          ai_reasoning: string | null
          block_feedback: Json | null
          blocks: Json
          completed_goals: Json | null
          created_at: string
          dismissed_block_indices: Json | null
          feedback_rating: number | null
          feedback_submitted_at: string | null
          feedback_text: string | null
          focus_hours_available: number | null
          id: string
          key_metric_targets: Json | null
          meeting_load_hours: number | null
          plan_date: string
          recast_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_reasoning?: string | null
          block_feedback?: Json | null
          blocks?: Json
          completed_goals?: Json | null
          created_at?: string
          dismissed_block_indices?: Json | null
          feedback_rating?: number | null
          feedback_submitted_at?: string | null
          feedback_text?: string | null
          focus_hours_available?: number | null
          id?: string
          key_metric_targets?: Json | null
          meeting_load_hours?: number | null
          plan_date: string
          recast_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_reasoning?: string | null
          block_feedback?: Json | null
          blocks?: Json
          completed_goals?: Json | null
          created_at?: string
          dismissed_block_indices?: Json | null
          feedback_rating?: number | null
          feedback_submitted_at?: string | null
          feedback_text?: string | null
          focus_hours_available?: number | null
          id?: string
          key_metric_targets?: Json | null
          meeting_load_hours?: number | null
          plan_date?: string
          recast_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dave_transcripts: {
        Row: {
          created_at: string
          duration_seconds: number | null
          id: string
          messages: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          messages?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          messages?: Json
          user_id?: string
        }
        Relationships: []
      }
      deal_patterns: {
        Row: {
          analysis: Json
          created_at: string | null
          id: string
          opportunity_id: string | null
          outcome: string
          patterns_identified: string[] | null
          user_id: string
        }
        Insert: {
          analysis?: Json
          created_at?: string | null
          id?: string
          opportunity_id?: string | null
          outcome: string
          patterns_identified?: string[] | null
          user_id: string
        }
        Update: {
          analysis?: Json
          created_at?: string | null
          id?: string
          opportunity_id?: string | null
          outcome?: string
          patterns_identified?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_patterns_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      dismissed_action_items: {
        Row: {
          dismissed_at: string
          id: string
          reason: string | null
          record_id: string
          record_type: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          id?: string
          reason?: string | null
          record_id: string
          record_type: string
          user_id: string
        }
        Update: {
          dismissed_at?: string
          id?: string
          reason?: string | null
          record_id?: string
          record_type?: string
          user_id?: string
        }
        Relationships: []
      }
      dismissed_duplicates: {
        Row: {
          dismissed_at: string
          duplicate_key: string
          id: string
          record_type: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          duplicate_key: string
          id?: string
          record_type?: string
          user_id: string
        }
        Update: {
          dismissed_at?: string
          duplicate_key?: string
          id?: string
          record_type?: string
          user_id?: string
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          category: string
          code: string | null
          component_name: string | null
          created_at: string
          function_name: string | null
          id: string
          message: string
          metadata: Json | null
          raw_message: string | null
          retryable: boolean | null
          route: string | null
          source: string
          trace_id: string
          user_id: string | null
        }
        Insert: {
          category: string
          code?: string | null
          component_name?: string | null
          created_at?: string
          function_name?: string | null
          id?: string
          message: string
          metadata?: Json | null
          raw_message?: string | null
          retryable?: boolean | null
          route?: string | null
          source?: string
          trace_id: string
          user_id?: string | null
        }
        Update: {
          category?: string
          code?: string | null
          component_name?: string | null
          created_at?: string
          function_name?: string | null
          id?: string
          message?: string
          metadata?: Json | null
          raw_message?: string | null
          retryable?: boolean | null
          route?: string | null
          source?: string
          trace_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      holidays: {
        Row: {
          created_at: string
          date: string
          id: string
          name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      icp_sourced_accounts: {
        Row: {
          batch_id: string | null
          company_name: string
          created_at: string | null
          employee_count: string | null
          feedback: string | null
          fit_score: number | null
          hq_location: string | null
          icp_fit_reason: string
          id: string
          industry: string | null
          linkedin_url: string | null
          news_snippet: string | null
          promoted_account_id: string | null
          signal_date: string | null
          status: string | null
          suggested_contacts: Json | null
          trigger_signal: string | null
          updated_at: string | null
          user_id: string
          website: string | null
        }
        Insert: {
          batch_id?: string | null
          company_name: string
          created_at?: string | null
          employee_count?: string | null
          feedback?: string | null
          fit_score?: number | null
          hq_location?: string | null
          icp_fit_reason: string
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          news_snippet?: string | null
          promoted_account_id?: string | null
          signal_date?: string | null
          status?: string | null
          suggested_contacts?: Json | null
          trigger_signal?: string | null
          updated_at?: string | null
          user_id: string
          website?: string | null
        }
        Update: {
          batch_id?: string | null
          company_name?: string
          created_at?: string | null
          employee_count?: string | null
          feedback?: string | null
          fit_score?: number | null
          hq_location?: string | null
          icp_fit_reason?: string
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          news_snippet?: string | null
          promoted_account_id?: string | null
          signal_date?: string | null
          status?: string | null
          suggested_contacts?: Json | null
          trigger_signal?: string | null
          updated_at?: string | null
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "icp_sourced_accounts_promoted_account_id_fkey"
            columns: ["promoted_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      import_account_aliases: {
        Row: {
          account_id: string
          alias_type: string
          alias_value: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          account_id: string
          alias_type: string
          alias_value: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          account_id?: string
          alias_type?: string
          alias_value?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_account_aliases_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      import_header_mappings: {
        Row: {
          created_at: string
          csv_header: string
          data_transform: string | null
          id: string
          target_field: string | null
          target_object: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          csv_header: string
          data_transform?: string | null
          id?: string
          target_field?: string | null
          target_object: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          csv_header?: string
          data_transform?: string | null
          id?: string
          target_field?: string | null
          target_object?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      import_value_mappings: {
        Row: {
          app_value: string
          created_at: string
          csv_value: string
          field_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_value: string
          created_at?: string
          csv_value: string
          field_name: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_value?: string
          created_at?: string
          csv_value?: string
          field_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      intelligence_units: {
        Row: {
          category: string | null
          chunk_id: string | null
          conflicts: Json | null
          consistency_score: number
          created_at: string
          extracted_at: string
          extraction_confidence: number
          extraction_version: string
          id: string
          idea_maturity: string
          metadata: Json | null
          resource_id: string
          source_diversity: number
          support_count: number
          text: string
          unit_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          chunk_id?: string | null
          conflicts?: Json | null
          consistency_score?: number
          created_at?: string
          extracted_at?: string
          extraction_confidence?: number
          extraction_version?: string
          id?: string
          idea_maturity?: string
          metadata?: Json | null
          resource_id: string
          source_diversity?: number
          support_count?: number
          text: string
          unit_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          chunk_id?: string | null
          conflicts?: Json | null
          consistency_score?: number
          created_at?: string
          extracted_at?: string
          extraction_confidence?: number
          extraction_version?: string
          id?: string
          idea_maturity?: string
          metadata?: Json | null
          resource_id?: string
          source_diversity?: number
          support_count?: number
          text?: string
          unit_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_signals: {
        Row: {
          author_or_speaker: string | null
          confidence: number
          created_at: string
          id: string
          relevance: number
          resource_id: string
          signal_timestamp: string
          theme: string
          user_id: string
        }
        Insert: {
          author_or_speaker?: string | null
          confidence?: number
          created_at?: string
          id?: string
          relevance?: number
          resource_id: string
          signal_timestamp?: string
          theme: string
          user_id: string
        }
        Update: {
          author_or_speaker?: string | null
          confidence?: number
          created_at?: string
          id?: string
          relevance?: number
          resource_id?: string
          signal_timestamp?: string
          theme?: string
          user_id?: string
        }
        Relationships: []
      }
      mock_call_sessions: {
        Row: {
          call_type: string
          created_at: string
          difficulty: number
          ended_at: string | null
          grade_data: Json | null
          id: string
          industry: string | null
          live_tracking: Json
          messages: Json
          overall_grade: string | null
          overall_score: number | null
          parent_session_id: string | null
          persona: string
          retry_from_index: number | null
          scenario: Json
          skill_mode: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          call_type?: string
          created_at?: string
          difficulty?: number
          ended_at?: string | null
          grade_data?: Json | null
          id?: string
          industry?: string | null
          live_tracking?: Json
          messages?: Json
          overall_grade?: string | null
          overall_score?: number | null
          parent_session_id?: string | null
          persona?: string
          retry_from_index?: number | null
          scenario?: Json
          skill_mode?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          call_type?: string
          created_at?: string
          difficulty?: number
          ended_at?: string | null
          grade_data?: Json | null
          id?: string
          industry?: string | null
          live_tracking?: Json
          messages?: Json
          overall_grade?: string | null
          overall_score?: number | null
          parent_session_id?: string | null
          persona?: string
          retry_from_index?: number | null
          scenario?: Json
          skill_mode?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_call_sessions_parent_session_id_fkey"
            columns: ["parent_session_id"]
            isOneToOne: false
            referencedRelation: "mock_call_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          account_id: string | null
          activity_log: Json | null
          arr: number | null
          churn_risk: string | null
          close_date: string | null
          created_at: string
          deal_type: string | null
          id: string
          is_new_logo: boolean | null
          last_touch_date: string | null
          linked_renewal_id: string | null
          name: string
          next_step: string | null
          next_step_date: string | null
          notes: string | null
          one_time_amount: number | null
          payment_terms: string | null
          prior_contract_arr: number | null
          renewal_arr: number | null
          salesforce_id: string | null
          salesforce_link: string | null
          stage: string | null
          status: string | null
          term_months: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          activity_log?: Json | null
          arr?: number | null
          churn_risk?: string | null
          close_date?: string | null
          created_at?: string
          deal_type?: string | null
          id?: string
          is_new_logo?: boolean | null
          last_touch_date?: string | null
          linked_renewal_id?: string | null
          name: string
          next_step?: string | null
          next_step_date?: string | null
          notes?: string | null
          one_time_amount?: number | null
          payment_terms?: string | null
          prior_contract_arr?: number | null
          renewal_arr?: number | null
          salesforce_id?: string | null
          salesforce_link?: string | null
          stage?: string | null
          status?: string | null
          term_months?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          activity_log?: Json | null
          arr?: number | null
          churn_risk?: string | null
          close_date?: string | null
          created_at?: string
          deal_type?: string | null
          id?: string
          is_new_logo?: boolean | null
          last_touch_date?: string | null
          linked_renewal_id?: string | null
          name?: string
          next_step?: string | null
          next_step_date?: string | null
          notes?: string | null
          one_time_amount?: number | null
          payment_terms?: string | null
          prior_contract_arr?: number | null
          renewal_arr?: number | null
          salesforce_id?: string | null
          salesforce_link?: string | null
          stage?: string | null
          status?: string | null
          term_months?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_methodology: {
        Row: {
          after_state_notes: string | null
          before_state_notes: string | null
          call_goals: Json | null
          champion_confirmed: boolean
          champion_notes: string | null
          competition_confirmed: boolean
          competition_notes: string | null
          created_at: string
          decision_criteria_confirmed: boolean
          decision_criteria_notes: string | null
          decision_process_confirmed: boolean
          decision_process_notes: string | null
          economic_buyer_confirmed: boolean
          economic_buyer_notes: string | null
          id: string
          identify_pain_confirmed: boolean
          identify_pain_notes: string | null
          metrics_confirmed: boolean
          metrics_notes: string | null
          metrics_value_notes: string | null
          negative_consequences_notes: string | null
          opportunity_id: string
          positive_business_outcomes_notes: string | null
          required_capabilities_notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          after_state_notes?: string | null
          before_state_notes?: string | null
          call_goals?: Json | null
          champion_confirmed?: boolean
          champion_notes?: string | null
          competition_confirmed?: boolean
          competition_notes?: string | null
          created_at?: string
          decision_criteria_confirmed?: boolean
          decision_criteria_notes?: string | null
          decision_process_confirmed?: boolean
          decision_process_notes?: string | null
          economic_buyer_confirmed?: boolean
          economic_buyer_notes?: string | null
          id?: string
          identify_pain_confirmed?: boolean
          identify_pain_notes?: string | null
          metrics_confirmed?: boolean
          metrics_notes?: string | null
          metrics_value_notes?: string | null
          negative_consequences_notes?: string | null
          opportunity_id: string
          positive_business_outcomes_notes?: string | null
          required_capabilities_notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          after_state_notes?: string | null
          before_state_notes?: string | null
          call_goals?: Json | null
          champion_confirmed?: boolean
          champion_notes?: string | null
          competition_confirmed?: boolean
          competition_notes?: string | null
          created_at?: string
          decision_criteria_confirmed?: boolean
          decision_criteria_notes?: string | null
          decision_process_confirmed?: boolean
          decision_process_notes?: string | null
          economic_buyer_confirmed?: boolean
          economic_buyer_notes?: string | null
          id?: string
          identify_pain_confirmed?: boolean
          identify_pain_notes?: string | null
          metrics_confirmed?: boolean
          metrics_notes?: string | null
          metrics_value_notes?: string | null
          negative_consequences_notes?: string | null
          opportunity_id?: string
          positive_business_outcomes_notes?: string | null
          required_capabilities_notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pipeline_hygiene_scans: {
        Row: {
          created_at: string
          critical_issues: number
          health_score: number
          id: string
          issues: Json
          scan_date: string
          summary: Json
          total_issues: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          critical_issues?: number
          health_score?: number
          id?: string
          issues?: Json
          scan_date?: string
          summary?: Json
          total_issues?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          critical_issues?: number
          health_score?: number
          id?: string
          issues?: Json
          scan_date?: string
          summary?: Json
          total_issues?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      playbooks: {
        Row: {
          anti_patterns: string[]
          confidence_score: number
          created_at: string
          id: string
          key_questions: string[]
          persona_fit: string[]
          problem_type: string
          source_resource_ids: string[]
          stage_fit: string[]
          tactic_steps: string[]
          talk_tracks: string[]
          title: string
          traps: string[]
          updated_at: string
          user_id: string
          when_to_use: string
          why_it_matters: string
        }
        Insert: {
          anti_patterns?: string[]
          confidence_score?: number
          created_at?: string
          id?: string
          key_questions?: string[]
          persona_fit?: string[]
          problem_type?: string
          source_resource_ids?: string[]
          stage_fit?: string[]
          tactic_steps?: string[]
          talk_tracks?: string[]
          title: string
          traps?: string[]
          updated_at?: string
          user_id: string
          when_to_use?: string
          why_it_matters?: string
        }
        Update: {
          anti_patterns?: string[]
          confidence_score?: number
          created_at?: string
          id?: string
          key_questions?: string[]
          persona_fit?: string[]
          problem_type?: string
          source_resource_ids?: string[]
          stage_fit?: string[]
          tactic_steps?: string[]
          talk_tracks?: string[]
          title?: string
          traps?: string[]
          updated_at?: string
          user_id?: string
          when_to_use?: string
          why_it_matters?: string
        }
        Relationships: []
      }
      power_hour_sessions: {
        Row: {
          connects: number
          created_at: string
          dials: number
          duration_minutes: number
          ended_at: string | null
          focus: string
          id: string
          journal_date: string | null
          meetings_set: number
          notes: string | null
          started_at: string
          status: string
          synced_to_journal: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          connects?: number
          created_at?: string
          dials?: number
          duration_minutes?: number
          ended_at?: string | null
          focus?: string
          id?: string
          journal_date?: string | null
          meetings_set?: number
          notes?: string | null
          started_at?: string
          status?: string
          synced_to_journal?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          connects?: number
          created_at?: string
          dials?: number
          duration_minutes?: number
          ended_at?: string | null
          focus?: string
          id?: string
          journal_date?: string | null
          meetings_set?: number
          notes?: string | null
          started_at?: string
          status?: string
          synced_to_journal?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pto_days: {
        Row: {
          created_at: string
          date: string
          id: string
          note: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          note?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          note?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      quota_targets: {
        Row: {
          created_at: string
          fiscal_year_end: string
          fiscal_year_start: string
          id: string
          new_arr_acr: number
          new_arr_quota: number
          qpi_new_logo_weight: number | null
          qpi_renewal_weight: number | null
          renewal_arr_acr: number
          renewal_arr_quota: number
          target_accounts_researched_per_day: number | null
          target_connects_per_day: number | null
          target_contacts_prepped_per_day: number | null
          target_customer_meetings_per_week: number | null
          target_dials_per_day: number | null
          target_meetings_set_per_week: number | null
          target_opps_created_per_week: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          fiscal_year_end: string
          fiscal_year_start: string
          id?: string
          new_arr_acr?: number
          new_arr_quota?: number
          qpi_new_logo_weight?: number | null
          qpi_renewal_weight?: number | null
          renewal_arr_acr?: number
          renewal_arr_quota?: number
          target_accounts_researched_per_day?: number | null
          target_connects_per_day?: number | null
          target_contacts_prepped_per_day?: number | null
          target_customer_meetings_per_week?: number | null
          target_dials_per_day?: number | null
          target_meetings_set_per_week?: number | null
          target_opps_created_per_week?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          fiscal_year_end?: string
          fiscal_year_start?: string
          id?: string
          new_arr_acr?: number
          new_arr_quota?: number
          qpi_new_logo_weight?: number | null
          qpi_renewal_weight?: number | null
          renewal_arr_acr?: number
          renewal_arr_quota?: number
          target_accounts_researched_per_day?: number | null
          target_connects_per_day?: number | null
          target_contacts_prepped_per_day?: number | null
          target_customer_meetings_per_week?: number | null
          target_dials_per_day?: number | null
          target_meetings_set_per_week?: number | null
          target_opps_created_per_week?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      renewals: {
        Row: {
          account_id: string | null
          account_name: string
          arr: number
          auto_renew: boolean | null
          churn_risk: string | null
          created_at: string
          cs_notes: string | null
          csm: string | null
          current_agreement_link: string | null
          entitlements: string | null
          health_status: string | null
          id: string
          linked_opportunity_id: string | null
          next_step: string | null
          notes: string | null
          owner: string | null
          planhat_link: string | null
          product: string | null
          renewal_due: string
          renewal_quarter: string | null
          renewal_stage: string | null
          risk_reason: string | null
          term: string | null
          updated_at: string
          usage: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          account_name: string
          arr?: number
          auto_renew?: boolean | null
          churn_risk?: string | null
          created_at?: string
          cs_notes?: string | null
          csm?: string | null
          current_agreement_link?: string | null
          entitlements?: string | null
          health_status?: string | null
          id?: string
          linked_opportunity_id?: string | null
          next_step?: string | null
          notes?: string | null
          owner?: string | null
          planhat_link?: string | null
          product?: string | null
          renewal_due: string
          renewal_quarter?: string | null
          renewal_stage?: string | null
          risk_reason?: string | null
          term?: string | null
          updated_at?: string
          usage?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          account_name?: string
          arr?: number
          auto_renew?: boolean | null
          churn_risk?: string | null
          created_at?: string
          cs_notes?: string | null
          csm?: string | null
          current_agreement_link?: string | null
          entitlements?: string | null
          health_status?: string | null
          id?: string
          linked_opportunity_id?: string | null
          next_step?: string | null
          notes?: string | null
          owner?: string | null
          planhat_link?: string | null
          product?: string | null
          renewal_due?: string
          renewal_quarter?: string | null
          renewal_stage?: string | null
          risk_reason?: string | null
          term?: string | null
          updated_at?: string
          usage?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "renewals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewals_linked_opportunity_id_fkey"
            columns: ["linked_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      research_queue_events: {
        Row: {
          account_id: string
          account_name: string
          assigned_day: string
          created_at: string
          event_type: string
          id: string
          user_id: string
          week_start: string
        }
        Insert: {
          account_id: string
          account_name: string
          assigned_day: string
          created_at?: string
          event_type: string
          id?: string
          user_id: string
          week_start: string
        }
        Update: {
          account_id?: string
          account_name?: string
          assigned_day?: string
          created_at?: string
          event_type?: string
          id?: string
          user_id?: string
          week_start?: string
        }
        Relationships: []
      }
      resource_chunks: {
        Row: {
          actions: Json | null
          chunk_index: number
          content: string
          created_at: string
          id: string
          job_id: string | null
          resource_id: string
          status: string
          summary: string | null
          token_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actions?: Json | null
          chunk_index?: number
          content: string
          created_at?: string
          id?: string
          job_id?: string | null
          resource_id: string
          status?: string
          summary?: string | null
          token_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actions?: Json | null
          chunk_index?: number
          content?: string
          created_at?: string
          id?: string
          job_id?: string | null
          resource_id?: string
          status?: string
          summary?: string | null
          token_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_chunks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resource_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_chunks_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_digests: {
        Row: {
          content_hash: string
          created_at: string
          grading_criteria: Json | null
          id: string
          resource_id: string
          summary: string
          takeaways: string[]
          use_cases: string[]
          user_id: string
        }
        Insert: {
          content_hash?: string
          created_at?: string
          grading_criteria?: Json | null
          id?: string
          resource_id: string
          summary?: string
          takeaways?: string[]
          use_cases?: string[]
          user_id: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          grading_criteria?: Json | null
          id?: string
          resource_id?: string
          summary?: string
          takeaways?: string[]
          use_cases?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_digests_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: true
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_folders: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "resource_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_job_steps: {
        Row: {
          created_at: string
          ended_at: string | null
          error_category: string | null
          error_message: string | null
          id: string
          job_id: string
          metadata: Json | null
          payload_size: number | null
          retry_count: number
          sequence: number
          started_at: string | null
          status: string
          step_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          error_category?: string | null
          error_message?: string | null
          id?: string
          job_id: string
          metadata?: Json | null
          payload_size?: number | null
          retry_count?: number
          sequence?: number
          started_at?: string | null
          status?: string
          step_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          error_category?: string | null
          error_message?: string | null
          id?: string
          job_id?: string
          metadata?: Json | null
          payload_size?: number | null
          retry_count?: number
          sequence?: number
          started_at?: string | null
          status?: string
          step_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_job_steps_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resource_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_jobs: {
        Row: {
          created_at: string
          ended_at: string | null
          error_category: string | null
          error_message: string | null
          id: string
          job_type: string
          metadata: Json | null
          resource_id: string
          retry_count: number
          started_at: string | null
          status: string
          trace_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          error_category?: string | null
          error_message?: string | null
          id?: string
          job_type?: string
          metadata?: Json | null
          resource_id: string
          retry_count?: number
          started_at?: string | null
          status?: string
          trace_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          error_category?: string | null
          error_message?: string | null
          id?: string
          job_type?: string
          metadata?: Json | null
          resource_id?: string
          retry_count?: number
          started_at?: string | null
          status?: string
          trace_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_jobs_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_links: {
        Row: {
          account_id: string | null
          category: string
          created_at: string
          id: string
          label: string
          notes: string | null
          opportunity_id: string | null
          renewal_id: string | null
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          category?: string
          created_at?: string
          id?: string
          label?: string
          notes?: string | null
          opportunity_id?: string | null
          renewal_id?: string | null
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          category?: string
          created_at?: string
          id?: string
          label?: string
          notes?: string | null
          opportunity_id?: string | null
          renewal_id?: string | null
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_links_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_links_renewal_id_fkey"
            columns: ["renewal_id"]
            isOneToOne: false
            referencedRelation: "renewals"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_usage_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          resource_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          resource_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          resource_id?: string
          user_id?: string
        }
        Relationships: []
      }
      resource_versions: {
        Row: {
          change_summary: string | null
          content: string | null
          created_at: string
          file_url: string | null
          id: string
          resource_id: string
          title: string
          user_id: string
          version_number: number
        }
        Insert: {
          change_summary?: string | null
          content?: string | null
          created_at?: string
          file_url?: string | null
          id?: string
          resource_id: string
          title: string
          user_id: string
          version_number: number
        }
        Update: {
          change_summary?: string | null
          content?: string | null
          created_at?: string
          file_url?: string | null
          id?: string
          resource_id?: string
          title?: string
          user_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "resource_versions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          account_id: string | null
          author_or_speaker: string | null
          content: string | null
          content_length: number | null
          content_status: string
          created_at: string
          current_version: number | null
          date_confidence: string | null
          date_source: string | null
          description: string | null
          enriched_at: string | null
          enrichment_audit_log: Json
          enrichment_status: string
          enrichment_version: number
          failure_count: number
          failure_reason: string | null
          file_url: string | null
          folder_id: string | null
          id: string
          is_screenshot_template: boolean | null
          is_template: boolean | null
          last_enrichment_attempt_at: string | null
          last_quality_score: number | null
          last_quality_tier: string | null
          last_status_change_at: string | null
          opportunity_id: string | null
          resource_type: string
          screenshot_structure: string | null
          source_created_at: string | null
          source_published_at: string | null
          source_resource_id: string | null
          tags: string[] | null
          template_category: string | null
          title: string
          updated_at: string
          user_id: string
          validation_version: number
        }
        Insert: {
          account_id?: string | null
          author_or_speaker?: string | null
          content?: string | null
          content_length?: number | null
          content_status?: string
          created_at?: string
          current_version?: number | null
          date_confidence?: string | null
          date_source?: string | null
          description?: string | null
          enriched_at?: string | null
          enrichment_audit_log?: Json
          enrichment_status?: string
          enrichment_version?: number
          failure_count?: number
          failure_reason?: string | null
          file_url?: string | null
          folder_id?: string | null
          id?: string
          is_screenshot_template?: boolean | null
          is_template?: boolean | null
          last_enrichment_attempt_at?: string | null
          last_quality_score?: number | null
          last_quality_tier?: string | null
          last_status_change_at?: string | null
          opportunity_id?: string | null
          resource_type?: string
          screenshot_structure?: string | null
          source_created_at?: string | null
          source_published_at?: string | null
          source_resource_id?: string | null
          tags?: string[] | null
          template_category?: string | null
          title: string
          updated_at?: string
          user_id: string
          validation_version?: number
        }
        Update: {
          account_id?: string | null
          author_or_speaker?: string | null
          content?: string | null
          content_length?: number | null
          content_status?: string
          created_at?: string
          current_version?: number | null
          date_confidence?: string | null
          date_source?: string | null
          description?: string | null
          enriched_at?: string | null
          enrichment_audit_log?: Json
          enrichment_status?: string
          enrichment_version?: number
          failure_count?: number
          failure_reason?: string | null
          file_url?: string | null
          folder_id?: string | null
          id?: string
          is_screenshot_template?: boolean | null
          is_template?: boolean | null
          last_enrichment_attempt_at?: string | null
          last_quality_score?: number | null
          last_quality_tier?: string | null
          last_status_change_at?: string | null
          opportunity_id?: string | null
          resource_type?: string
          screenshot_structure?: string | null
          source_created_at?: string | null
          source_published_at?: string | null
          source_resource_id?: string | null
          tags?: string[] | null
          template_category?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          validation_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "resources_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "resource_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_source_resource_id_fkey"
            columns: ["source_resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_age_snapshots: {
        Row: {
          benchmark_30d_qpi: number | null
          benchmark_6m_qpi: number | null
          created_at: string
          driver_accounts_researched_avg: number | null
          driver_connects_avg: number | null
          driver_contacts_prepped_avg: number | null
          driver_customer_meetings_avg: number | null
          driver_dials_avg: number | null
          driver_meetings_set_avg: number | null
          driver_opps_created_avg: number | null
          id: string
          new_arr_closed: number | null
          new_arr_quota: number | null
          pace_of_aging: number | null
          projected_finish_30d: number | null
          projected_finish_6m: number | null
          qpi_combined: number
          qpi_new_logo: number
          qpi_renewal: number
          renewal_arr_closed: number | null
          renewal_arr_quota: number | null
          sales_age: number
          snapshot_date: string
          status: string
          updated_at: string
          user_id: string | null
          week_ending: string
        }
        Insert: {
          benchmark_30d_qpi?: number | null
          benchmark_6m_qpi?: number | null
          created_at?: string
          driver_accounts_researched_avg?: number | null
          driver_connects_avg?: number | null
          driver_contacts_prepped_avg?: number | null
          driver_customer_meetings_avg?: number | null
          driver_dials_avg?: number | null
          driver_meetings_set_avg?: number | null
          driver_opps_created_avg?: number | null
          id?: string
          new_arr_closed?: number | null
          new_arr_quota?: number | null
          pace_of_aging?: number | null
          projected_finish_30d?: number | null
          projected_finish_6m?: number | null
          qpi_combined?: number
          qpi_new_logo?: number
          qpi_renewal?: number
          renewal_arr_closed?: number | null
          renewal_arr_quota?: number | null
          sales_age?: number
          snapshot_date: string
          status?: string
          updated_at?: string
          user_id?: string | null
          week_ending: string
        }
        Update: {
          benchmark_30d_qpi?: number | null
          benchmark_6m_qpi?: number | null
          created_at?: string
          driver_accounts_researched_avg?: number | null
          driver_connects_avg?: number | null
          driver_contacts_prepped_avg?: number | null
          driver_customer_meetings_avg?: number | null
          driver_dials_avg?: number | null
          driver_meetings_set_avg?: number | null
          driver_opps_created_avg?: number | null
          id?: string
          new_arr_closed?: number | null
          new_arr_quota?: number | null
          pace_of_aging?: number | null
          projected_finish_30d?: number | null
          projected_finish_6m?: number | null
          qpi_combined?: number
          qpi_new_logo?: number
          qpi_renewal?: number
          renewal_arr_closed?: number | null
          renewal_arr_quota?: number | null
          sales_age?: number
          snapshot_date?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          week_ending?: string
        }
        Relationships: []
      }
      strategy_outcomes: {
        Row: {
          account_type: string | null
          context_metadata: Json | null
          created_at: string
          deal_stage: string | null
          event_type: string
          execution_state: string | null
          id: string
          insight_id: string
          insight_maturity: string
          insight_text: string
          outcome: string | null
          score_at_recommendation: number | null
          user_feedback: string | null
          user_id: string
        }
        Insert: {
          account_type?: string | null
          context_metadata?: Json | null
          created_at?: string
          deal_stage?: string | null
          event_type?: string
          execution_state?: string | null
          id?: string
          insight_id: string
          insight_maturity?: string
          insight_text: string
          outcome?: string | null
          score_at_recommendation?: number | null
          user_feedback?: string | null
          user_id: string
        }
        Update: {
          account_type?: string | null
          context_metadata?: Json | null
          created_at?: string
          deal_stage?: string | null
          event_type?: string
          execution_state?: string | null
          id?: string
          insight_id?: string
          insight_maturity?: string
          insight_text?: string
          outcome?: string | null
          score_at_recommendation?: number | null
          user_feedback?: string | null
          user_id?: string
        }
        Relationships: []
      }
      streak_events: {
        Row: {
          check_in_method: string | null
          check_in_time: string | null
          checked_in: boolean
          created_at: string
          daily_score: number | null
          date: string
          goal_met: boolean
          id: string
          is_eligible_day: boolean
          productivity_score: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          check_in_method?: string | null
          check_in_time?: string | null
          checked_in?: boolean
          created_at?: string
          daily_score?: number | null
          date: string
          goal_met?: boolean
          id?: string
          is_eligible_day?: boolean
          productivity_score?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          check_in_method?: string | null
          check_in_time?: string | null
          checked_in?: boolean
          created_at?: string
          daily_score?: number | null
          date?: string
          goal_met?: boolean
          id?: string
          is_eligible_day?: boolean
          productivity_score?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      streak_summary: {
        Row: {
          checkin_level: number
          current_checkin_streak: number
          current_performance_streak: number
          id: string
          longest_checkin_streak: number
          longest_performance_streak: number
          performance_level: number
          total_checkins: number
          total_eligible_days: number
          total_goals_met: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          checkin_level?: number
          current_checkin_streak?: number
          current_performance_streak?: number
          id?: string
          longest_checkin_streak?: number
          longest_performance_streak?: number
          performance_level?: number
          total_checkins?: number
          total_eligible_days?: number
          total_goals_met?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          checkin_level?: number
          current_checkin_streak?: number
          current_performance_streak?: number
          id?: string
          longest_checkin_streak?: number
          longest_performance_streak?: number
          performance_level?: number
          total_checkins?: number
          total_eligible_days?: number
          total_goals_met?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          category: string | null
          completed_at: string | null
          created_at: string
          due_date: string | null
          estimated_minutes: number | null
          id: string
          linked_account_id: string | null
          linked_contact_id: string | null
          linked_opportunity_id: string | null
          linked_record_id: string | null
          linked_record_type: string | null
          motion: string | null
          notes: string | null
          priority: string
          reminder_at: string | null
          status: string
          subtasks: Json | null
          title: string
          updated_at: string
          user_id: string
          workstream: string
        }
        Insert: {
          category?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          estimated_minutes?: number | null
          id?: string
          linked_account_id?: string | null
          linked_contact_id?: string | null
          linked_opportunity_id?: string | null
          linked_record_id?: string | null
          linked_record_type?: string | null
          motion?: string | null
          notes?: string | null
          priority?: string
          reminder_at?: string | null
          status?: string
          subtasks?: Json | null
          title: string
          updated_at?: string
          user_id: string
          workstream?: string
        }
        Update: {
          category?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          estimated_minutes?: number | null
          id?: string
          linked_account_id?: string | null
          linked_contact_id?: string | null
          linked_opportunity_id?: string | null
          linked_record_id?: string | null
          linked_record_type?: string | null
          motion?: string | null
          notes?: string | null
          priority?: string
          reminder_at?: string | null
          status?: string
          subtasks?: Json | null
          title?: string
          updated_at?: string
          user_id?: string
          workstream?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_linked_account_id_fkey"
            columns: ["linked_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_linked_opportunity_id_fkey"
            columns: ["linked_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      template_suggestions: {
        Row: {
          created_at: string
          description: string
          id: string
          source_resource_id: string | null
          status: string
          suggested_content: string | null
          template_category: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          source_resource_id?: string | null
          status?: string
          suggested_content?: string | null
          template_category: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          source_resource_id?: string | null
          status?: string
          suggested_content?: string | null
          template_category?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_suggestions_source_resource_id_fkey"
            columns: ["source_resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_grades: {
        Row: {
          actionable_feedback: string
          acumen_notes: string | null
          acumen_score: number
          behavioral_flags: Json | null
          cadence_notes: string | null
          cadence_score: number
          call_goals_inferred: string[] | null
          call_segments: Json | null
          call_type: string | null
          coaching_issue: string | null
          coaching_why: string | null
          commercial_score: number | null
          competitors_mentioned: string[] | null
          cotm_score: number | null
          cotm_signals: Json | null
          created_at: string
          custom_scorecard_results: Json | null
          deal_progressed: boolean | null
          discovery_score: number | null
          discovery_stats: Json | null
          evidence: Json | null
          feedback_focus: string
          goals_achieved: Json | null
          id: string
          improvements: string[] | null
          likelihood_impact: string | null
          meddicc_score: number | null
          meddicc_signals: Json | null
          methodology_alignment: string | null
          missed_opportunities: Json | null
          next_step_score: number | null
          overall_grade: string
          overall_score: number
          presence_score: number | null
          presence_stats: Json | null
          progression_evidence: string | null
          replacement_behavior: string | null
          strengths: string[] | null
          structure_score: number | null
          style_notes: string | null
          style_score: number
          suggested_questions: Json | null
          summary: string | null
          transcript_id: string
          transcript_moment: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actionable_feedback?: string
          acumen_notes?: string | null
          acumen_score?: number
          behavioral_flags?: Json | null
          cadence_notes?: string | null
          cadence_score?: number
          call_goals_inferred?: string[] | null
          call_segments?: Json | null
          call_type?: string | null
          coaching_issue?: string | null
          coaching_why?: string | null
          commercial_score?: number | null
          competitors_mentioned?: string[] | null
          cotm_score?: number | null
          cotm_signals?: Json | null
          created_at?: string
          custom_scorecard_results?: Json | null
          deal_progressed?: boolean | null
          discovery_score?: number | null
          discovery_stats?: Json | null
          evidence?: Json | null
          feedback_focus?: string
          goals_achieved?: Json | null
          id?: string
          improvements?: string[] | null
          likelihood_impact?: string | null
          meddicc_score?: number | null
          meddicc_signals?: Json | null
          methodology_alignment?: string | null
          missed_opportunities?: Json | null
          next_step_score?: number | null
          overall_grade?: string
          overall_score?: number
          presence_score?: number | null
          presence_stats?: Json | null
          progression_evidence?: string | null
          replacement_behavior?: string | null
          strengths?: string[] | null
          structure_score?: number | null
          style_notes?: string | null
          style_score?: number
          suggested_questions?: Json | null
          summary?: string | null
          transcript_id: string
          transcript_moment?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actionable_feedback?: string
          acumen_notes?: string | null
          acumen_score?: number
          behavioral_flags?: Json | null
          cadence_notes?: string | null
          cadence_score?: number
          call_goals_inferred?: string[] | null
          call_segments?: Json | null
          call_type?: string | null
          coaching_issue?: string | null
          coaching_why?: string | null
          commercial_score?: number | null
          competitors_mentioned?: string[] | null
          cotm_score?: number | null
          cotm_signals?: Json | null
          created_at?: string
          custom_scorecard_results?: Json | null
          deal_progressed?: boolean | null
          discovery_score?: number | null
          discovery_stats?: Json | null
          evidence?: Json | null
          feedback_focus?: string
          goals_achieved?: Json | null
          id?: string
          improvements?: string[] | null
          likelihood_impact?: string | null
          meddicc_score?: number | null
          meddicc_signals?: Json | null
          methodology_alignment?: string | null
          missed_opportunities?: Json | null
          next_step_score?: number | null
          overall_grade?: string
          overall_score?: number
          presence_score?: number | null
          presence_stats?: Json | null
          progression_evidence?: string | null
          replacement_behavior?: string | null
          strengths?: string[] | null
          structure_score?: number | null
          style_notes?: string | null
          style_score?: number
          suggested_questions?: Json | null
          summary?: string | null
          transcript_id?: string
          transcript_moment?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_grades_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: true
            referencedRelation: "call_transcripts"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_reminders: {
        Row: {
          created_at: string | null
          delivered: boolean | null
          id: string
          message: string
          remind_at: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          delivered?: boolean | null
          id?: string
          message: string
          remind_at: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          delivered?: boolean | null
          id?: string
          message?: string
          remind_at?: string
          user_id?: string
        }
        Relationships: []
      }
      weekly_battle_plans: {
        Row: {
          created_at: string
          days_remaining: number | null
          id: string
          moves: Json
          moves_completed: Json
          quota_gap: number | null
          strategy_summary: string | null
          updated_at: string
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          days_remaining?: number | null
          id?: string
          moves?: Json
          moves_completed?: Json
          quota_gap?: number | null
          strategy_summary?: string | null
          updated_at?: string
          user_id: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          days_remaining?: number | null
          id?: string
          moves?: Json
          moves_completed?: Json
          quota_gap?: number | null
          strategy_summary?: string | null
          updated_at?: string
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      weekly_research_queue: {
        Row: {
          assignments: Json
          created_at: string
          id: string
          updated_at: string
          user_id: string
          week_start: string
        }
        Insert: {
          assignments?: Json
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          week_start: string
        }
        Update: {
          assignments?: Json
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          week_start?: string
        }
        Relationships: []
      }
      weekly_reviews: {
        Row: {
          avg_daily_score: number | null
          avg_sentiment: number | null
          biggest_failure: string | null
          biggest_win: string | null
          commitment_for_week: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
          days_goal_met: number | null
          days_logged: number | null
          failure_change_plan: string | null
          id: string
          key_client_meetings: string | null
          key_goals: Json | null
          north_star_goals: Json | null
          skill_development: string | null
          total_conversations: number | null
          total_dials: number | null
          total_meetings_held: number | null
          total_meetings_set: number | null
          total_opps_created: number | null
          total_pipeline_moved: number | null
          total_prospects_added: number | null
          updated_at: string
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          avg_daily_score?: number | null
          avg_sentiment?: number | null
          biggest_failure?: string | null
          biggest_win?: string | null
          commitment_for_week?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          days_goal_met?: number | null
          days_logged?: number | null
          failure_change_plan?: string | null
          id?: string
          key_client_meetings?: string | null
          key_goals?: Json | null
          north_star_goals?: Json | null
          skill_development?: string | null
          total_conversations?: number | null
          total_dials?: number | null
          total_meetings_held?: number | null
          total_meetings_set?: number | null
          total_opps_created?: number | null
          total_pipeline_moved?: number | null
          total_prospects_added?: number | null
          updated_at?: string
          user_id: string
          week_end: string
          week_start: string
        }
        Update: {
          avg_daily_score?: number | null
          avg_sentiment?: number | null
          biggest_failure?: string | null
          biggest_win?: string | null
          commitment_for_week?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          days_goal_met?: number | null
          days_logged?: number | null
          failure_change_plan?: string | null
          id?: string
          key_client_meetings?: string | null
          key_goals?: Json | null
          north_star_goals?: Json | null
          skill_development?: string | null
          total_conversations?: number | null
          total_dials?: number | null
          total_meetings_held?: number | null
          total_meetings_set?: number | null
          total_opps_created?: number | null
          total_pipeline_moved?: number | null
          total_prospects_added?: number | null
          updated_at?: string
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      whoop_connections: {
        Row: {
          access_token: string
          created_at: string
          id: string
          refresh_token: string | null
          scopes: string | null
          token_expires_at: string
          updated_at: string
          user_id: string
          whoop_user_id: string | null
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          refresh_token?: string | null
          scopes?: string | null
          token_expires_at: string
          updated_at?: string
          user_id: string
          whoop_user_id?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          refresh_token?: string | null
          scopes?: string | null
          token_expires_at?: string
          updated_at?: string
          user_id?: string
          whoop_user_id?: string | null
        }
        Relationships: []
      }
      whoop_daily_metrics: {
        Row: {
          date: string
          id: string
          imported_at: string
          raw_payload: Json | null
          recovery_score: number | null
          sleep_score: number | null
          strain_score: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          date: string
          id?: string
          imported_at?: string
          raw_payload?: Json | null
          recovery_score?: number | null
          sleep_score?: number | null
          strain_score?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          date?: string
          id?: string
          imported_at?: string
          raw_payload?: Json | null
          recovery_score?: number | null
          sleep_score?: number | null
          strain_score?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      work_schedule_config: {
        Row: {
          created_at: string
          eod_checkin_time: string
          eod_reminder_time: string
          goal_daily_score_threshold: number
          goal_productivity_threshold: number
          grace_window_end_time: string
          grace_window_hours: number
          id: string
          morning_confirm_time: string
          reminder_enabled: boolean
          reminder_time: string
          updated_at: string
          user_id: string | null
          working_days: number[]
        }
        Insert: {
          created_at?: string
          eod_checkin_time?: string
          eod_reminder_time?: string
          goal_daily_score_threshold?: number
          goal_productivity_threshold?: number
          grace_window_end_time?: string
          grace_window_hours?: number
          id?: string
          morning_confirm_time?: string
          reminder_enabled?: boolean
          reminder_time?: string
          updated_at?: string
          user_id?: string | null
          working_days?: number[]
        }
        Update: {
          created_at?: string
          eod_checkin_time?: string
          eod_reminder_time?: string
          goal_daily_score_threshold?: number
          goal_productivity_threshold?: number
          grace_window_end_time?: string
          grace_window_hours?: number
          id?: string
          morning_confirm_time?: string
          reminder_enabled?: boolean
          reminder_time?: string
          updated_at?: string
          user_id?: string | null
          working_days?: number[]
        }
        Relationships: []
      }
      workday_overrides: {
        Row: {
          created_at: string
          date: string
          id: string
          is_workday: boolean
          reason: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          is_workday: boolean
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          is_workday?: boolean
          reason?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
