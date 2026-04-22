/**
 * Cycle 1 Canary — Supabase repository.
 *
 * Direct table access. RLS enforces per-user isolation.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  CanaryReviewRow,
  Decision,
  EvidenceSummary,
  FlagState,
  ParsedCanary,
} from './types';

export interface InsertCanaryReviewInput {
  userId: string;
  rawInput: string;
  parsed: ParsedCanary;
  evidence: EvidenceSummary;
  recommendation: Decision;
  decision: Decision;
  decisionNotes: string | null;
  flagState: FlagState;
}

export async function insertCanaryReview(
  input: InsertCanaryReviewInput,
): Promise<CanaryReviewRow> {
  const { data, error } = await supabase
    .from('canary_reviews')
    .insert({
      user_id: input.userId,
      raw_input: input.rawInput,
      parsed_json: input.parsed as unknown as Record<string, unknown>,
      evidence_summary: input.evidence as unknown as Record<string, unknown>,
      recommendation: input.recommendation,
      decision: input.decision,
      decision_notes: input.decisionNotes,
      flag_state: input.flagState as unknown as Record<string, unknown>,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as unknown as CanaryReviewRow;
}

export async function fetchLatestCanaryReview(
  userId: string,
): Promise<CanaryReviewRow | null> {
  const { data, error } = await supabase
    .from('canary_reviews')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as CanaryReviewRow) ?? null;
}
