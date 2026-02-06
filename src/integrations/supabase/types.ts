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
      daily_journal_entries: {
        Row: {
          account_deep_work_minutes: number
          accounts_researched: number
          admin_heavy_day: boolean
          automated_emails: number
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
          daily_score: number | null
          date: string
          dials: number
          distractions: string | null
          energy: number | null
          expansion_touchpoints: number
          focus_mode: string
          focus_quality: number | null
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
          prepped_for_all_calls_tomorrow: boolean | null
          prospecting_block_minutes: number
          prospects_added: number
          sales_productivity: number | null
          sales_recovery: number | null
          sales_strain: number | null
          sleep_hours: number | null
          stress: number | null
          travel_day: boolean
          updated_at: string
          user_id: string | null
          what_drained_you: string | null
          what_worked_today: string | null
        }
        Insert: {
          account_deep_work_minutes?: number
          accounts_researched?: number
          admin_heavy_day?: boolean
          automated_emails?: number
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
          daily_score?: number | null
          date: string
          dials?: number
          distractions?: string | null
          energy?: number | null
          expansion_touchpoints?: number
          focus_mode?: string
          focus_quality?: number | null
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
          prepped_for_all_calls_tomorrow?: boolean | null
          prospecting_block_minutes?: number
          prospects_added?: number
          sales_productivity?: number | null
          sales_recovery?: number | null
          sales_strain?: number | null
          sleep_hours?: number | null
          stress?: number | null
          travel_day?: boolean
          updated_at?: string
          user_id?: string | null
          what_drained_you?: string | null
          what_worked_today?: string | null
        }
        Update: {
          account_deep_work_minutes?: number
          accounts_researched?: number
          admin_heavy_day?: boolean
          automated_emails?: number
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
          daily_score?: number | null
          date?: string
          dials?: number
          distractions?: string | null
          energy?: number | null
          expansion_touchpoints?: number
          focus_mode?: string
          focus_quality?: number | null
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
          prepped_for_all_calls_tomorrow?: boolean | null
          prospecting_block_minutes?: number
          prospects_added?: number
          sales_productivity?: number | null
          sales_recovery?: number | null
          sales_strain?: number | null
          sleep_hours?: number | null
          stress?: number | null
          travel_day?: boolean
          updated_at?: string
          user_id?: string | null
          what_drained_you?: string | null
          what_worked_today?: string | null
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
