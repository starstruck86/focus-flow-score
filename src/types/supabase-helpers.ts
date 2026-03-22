/**
 * Typed interfaces for Supabase query results and JSON column shapes.
 * These supplement the auto-generated types in integrations/supabase/types.ts
 * for cases where JSON columns need explicit structure or dynamic field access is needed.
 */

import type { Database } from '@/integrations/supabase/types';

// ── Table Row type aliases ────────────────────────────────────
export type AccountRow = Database['public']['Tables']['accounts']['Row'];
export type AccountInsert = Database['public']['Tables']['accounts']['Insert'];
export type OpportunityRow = Database['public']['Tables']['opportunities']['Row'];
export type OpportunityInsert = Database['public']['Tables']['opportunities']['Insert'];
export type TaskRow = Database['public']['Tables']['tasks']['Row'];
export type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
export type TaskUpdate = Database['public']['Tables']['tasks']['Update'];
export type RenewalRow = Database['public']['Tables']['renewals']['Row'];
export type ContactRow = Database['public']['Tables']['contacts']['Row'];
export type ContactInsert = Database['public']['Tables']['contacts']['Insert'];
export type DailyJournalRow = Database['public']['Tables']['daily_journal_entries']['Row'];
export type DailyJournalInsert = Database['public']['Tables']['daily_journal_entries']['Insert'];
export type CalendarEventRow = Database['public']['Tables']['calendar_events']['Row'];
export type WhoopMetricRow = Database['public']['Tables']['whoop_daily_metrics']['Row'];
export type TranscriptGradeRow = Database['public']['Tables']['transcript_grades']['Row'];
export type PipelineHygieneScanRow = Database['public']['Tables']['pipeline_hygiene_scans']['Row'];
export type WeeklyBattlePlanRow = Database['public']['Tables']['weekly_battle_plans']['Row'];
export type ResourceDigestRow = Database['public']['Tables']['resource_digests']['Row'];
export type MethodologyRow = Database['public']['Tables']['opportunity_methodology']['Row'];
export type MethodologyInsert = Database['public']['Tables']['opportunity_methodology']['Insert'];

// ── JSON column shapes ────────────────────────────────────────

/** Shape of pipeline_hygiene_scans.summary JSON */
export interface HygieneScanSummary {
  top_issues?: string[];
  [key: string]: unknown;
}

/** Shape of weekly_battle_plans.moves / moves_completed JSON items */
export interface BattlePlanMove {
  action?: string;
  description?: string;
  [key: string]: unknown;
}

/** Shape of resource_digests.grading_criteria JSON */
export interface GradingCriteria {
  categories?: Array<{ name: string; description?: string }>;
  [key: string]: unknown;
}

/** Action memory record stored in localStorage */
export interface ActionMemoryRecord {
  actionId: string;
  outcome: 'completed' | 'ignored' | 'deferred';
  timestamp: number;
  entityType?: string;
}

/** Shape for trackedInvoke result from pipeline-hygiene */
export interface PipelineHygieneResult {
  health_score?: number;
  total_issues?: number;
  critical_issues?: number;
  summary?: HygieneScanSummary;
}

/** Shape for trackedInvoke result from prioritize-accounts */
export interface PrioritizeAccountsResult {
  ranked?: Array<{ name?: string; account_name?: string; reason?: string; rationale?: string }>;
  accounts?: Array<{ name?: string; account_name?: string; reason?: string; rationale?: string }>;
}

/** Shape for trackedInvoke result from weekly-battle-plan */
export interface WeeklyBattlePlanResult {
  strategy_summary?: string;
}

/** Shape for trackedInvoke result from weekly-patterns */
export interface WeeklyPatternsResult {
  summary?: string;
  patterns_summary?: string;
}

/** Shape for trackedInvoke result from whoop-sync */
export interface WhoopSyncResult {
  synced?: number;
  error?: string;
}

/** Dynamic access to MEDDICC confirmed fields */
export type MeddiccFieldKey = 'metrics' | 'economic_buyer' | 'decision_criteria' | 'decision_process' | 'identify_pain' | 'champion' | 'competition';

export function isMeddiccConfirmed(row: MethodologyRow, field: MeddiccFieldKey): boolean {
  const key = `${field}_confirmed` as keyof MethodologyRow;
  return !!row[key];
}
