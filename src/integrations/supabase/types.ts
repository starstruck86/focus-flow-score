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
      contacts: {
        Row: {
          account_id: string | null
          created_at: string
          department: string | null
          email: string | null
          id: string
          last_touch_date: string | null
          linkedin_url: string | null
          name: string
          notes: string | null
          preferred_channel: string | null
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
          created_at?: string
          department?: string | null
          email?: string | null
          id?: string
          last_touch_date?: string | null
          linkedin_url?: string | null
          name: string
          notes?: string | null
          preferred_channel?: string | null
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
          created_at?: string
          department?: string | null
          email?: string | null
          id?: string
          last_touch_date?: string | null
          linkedin_url?: string | null
          name?: string
          notes?: string | null
          preferred_channel?: string | null
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
      daily_time_blocks: {
        Row: {
          ai_reasoning: string | null
          block_feedback: Json | null
          blocks: Json
          completed_goals: Json | null
          created_at: string
          feedback_rating: number | null
          feedback_submitted_at: string | null
          feedback_text: string | null
          focus_hours_available: number | null
          id: string
          key_metric_targets: Json | null
          meeting_load_hours: number | null
          plan_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_reasoning?: string | null
          block_feedback?: Json | null
          blocks?: Json
          completed_goals?: Json | null
          created_at?: string
          feedback_rating?: number | null
          feedback_submitted_at?: string | null
          feedback_text?: string | null
          focus_hours_available?: number | null
          id?: string
          key_metric_targets?: Json | null
          meeting_load_hours?: number | null
          plan_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_reasoning?: string | null
          block_feedback?: Json | null
          blocks?: Json
          completed_goals?: Json | null
          created_at?: string
          feedback_rating?: number | null
          feedback_submitted_at?: string | null
          feedback_text?: string | null
          focus_hours_available?: number | null
          id?: string
          key_metric_targets?: Json | null
          meeting_load_hours?: number | null
          plan_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
