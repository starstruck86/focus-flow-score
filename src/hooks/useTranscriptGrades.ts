import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface CotmSignals {
  before_identified: boolean;
  before_evidence?: string;
  negative_consequences: boolean;
  negative_consequences_evidence?: string;
  after_defined: boolean;
  after_evidence?: string;
  pbo_articulated: boolean;
  pbo_evidence?: string;
  required_capabilities: boolean;
  capabilities_evidence?: string;
  metrics_captured: boolean;
  metrics_evidence?: string;
}

export interface MeddiccSignals {
  metrics: boolean;
  metrics_detail?: string;
  economic_buyer: boolean;
  economic_buyer_detail?: string;
  decision_criteria: boolean;
  decision_criteria_detail?: string;
  decision_process: boolean;
  decision_process_detail?: string;
  identify_pain: boolean;
  identify_pain_detail?: string;
  champion: boolean;
  champion_detail?: string;
  competition: boolean;
  competition_detail?: string;
}

export interface DiscoveryStats {
  total_questions: number;
  open_ended_pct: number;
  impact_questions: number;
  follow_up_depth: number;
}

export interface PresenceStats {
  talk_ratio_estimate: number;
  rambling_detected: boolean;
  interruptions_detected: boolean;
  flow_control: number;
}

export interface CallSegment {
  segment: string;
  quality: number;
  notes: string;
}

export interface EvidenceItem {
  category: string;
  score_given: number;
  quote: string;
  assessment: string;
}

export interface MissedOpportunity {
  opportunity: string;
  moment: string;
  example: string;
}

export interface SuggestedQuestion {
  question: string;
  framework: string;
  why: string;
}

export interface TranscriptGrade {
  id: string;
  user_id: string;
  transcript_id: string;
  overall_grade: string;
  overall_score: number;
  style_score: number;
  acumen_score: number;
  cadence_score: number;
  style_notes: string | null;
  acumen_notes: string | null;
  cadence_notes: string | null;
  strengths: string[];
  improvements: string[];
  actionable_feedback: string;
  feedback_focus: string;
  summary: string | null;
  methodology_alignment: string | null;
  created_at: string;
  updated_at: string;
  // V1 framework fields
  structure_score: number;
  cotm_score: number;
  meddicc_score: number;
  discovery_score: number;
  presence_score: number;
  commercial_score: number;
  next_step_score: number;
  call_segments: CallSegment[];
  cotm_signals: CotmSignals;
  meddicc_signals: MeddiccSignals;
  discovery_stats: DiscoveryStats;
  presence_stats: PresenceStats;
  evidence: EvidenceItem[];
  missed_opportunities: MissedOpportunity[];
  suggested_questions: SuggestedQuestion[];
  behavioral_flags: string[];
  replacement_behavior: string | null;
  coaching_issue: string | null;
  coaching_why: string | null;
  transcript_moment: string | null;
  call_type: string | null;
}

export function useTranscriptGrade(transcriptId: string | undefined) {
  return useQuery({
    queryKey: ['transcript-grade', transcriptId],
    queryFn: async () => {
      if (!transcriptId) return null;
      const { data, error } = await supabase
        .from('transcript_grades' as any)
        .select('*')
        .eq('transcript_id', transcriptId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TranscriptGrade | null;
    },
    enabled: !!transcriptId,
  });
}

export function useAllTranscriptGrades() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['transcript-grades', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transcript_grades' as any)
        .select('*, call_transcripts!inner(title, call_date, call_type, account_id)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as (TranscriptGrade & {
        call_transcripts: { title: string; call_date: string; call_type: string | null; account_id: string | null };
      })[];
    },
    enabled: !!user,
  });
}

export function useGradeTranscript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (transcriptId: string) => {
      const { data, error } = await trackedInvoke<TranscriptGrade>('grade-transcript', {
        body: { transcript_id: transcriptId },
        componentName: 'useGradeTranscript',
      });
      if (error) throw new Error(error.message);
      return data!;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['transcript-grade', data.transcript_id] });
      qc.invalidateQueries({ queryKey: ['transcript-grades'] });
      toast.success(`Transcript graded: ${data.overall_grade}`);
    },
    onError: (err: Error) => {
      toast.error('Grading failed', { description: err.message });
    },
  });
}

// Behavioral pattern analysis across all grades
export function useBehavioralPatterns() {
  const { data: allGrades } = useAllTranscriptGrades();

  if (!allGrades?.length) return { patterns: [], weakestArea: null, trendSummary: [] };

  // Count behavioral flags across all calls
  const flagCounts: Record<string, number> = {};
  allGrades.forEach(g => {
    (g.behavioral_flags || []).forEach((flag: string) => {
      flagCounts[flag] = (flagCounts[flag] || 0) + 1;
    });
  });

  const patterns = Object.entries(flagCounts)
    .map(([flag, count]) => ({
      flag,
      count,
      pct: Math.round((count / allGrades.length) * 100),
      label: formatFlag(flag),
    }))
    .sort((a, b) => b.count - a.count);

  // Find weakest category
  const categories = ['structure_score', 'cotm_score', 'meddicc_score', 'discovery_score', 'presence_score', 'commercial_score', 'next_step_score'] as const;
  const avgScores = categories.map(cat => ({
    category: cat.replace('_score', ''),
    avg: allGrades.reduce((s, g) => s + ((g as any)[cat] || 0), 0) / allGrades.length,
  }));
  const weakestArea = avgScores.sort((a, b) => a.avg - b.avg)[0];

  // Trend summary - compare recent 3 vs older 3
  const recent = allGrades.slice(0, 3);
  const older = allGrades.slice(3, 6);
  const trendSummary: { dimension: string; direction: 'improving' | 'declining' | 'stable'; delta: number }[] = [];
  if (recent.length >= 2 && older.length >= 2) {
    categories.forEach(cat => {
      const recentAvg = recent.reduce((s, g) => s + ((g as any)[cat] || 0), 0) / recent.length;
      const olderAvg = older.reduce((s, g) => s + ((g as any)[cat] || 0), 0) / older.length;
      const delta = recentAvg - olderAvg;
      trendSummary.push({
        dimension: cat.replace('_score', ''),
        direction: delta > 0.3 ? 'improving' : delta < -0.3 ? 'declining' : 'stable',
        delta: Math.round(delta * 10) / 10,
      });
    });
  }

  return { patterns, weakestArea, trendSummary };
}

function formatFlag(flag: string): string {
  const map: Record<string, string> = {
    over_talking: 'Over-talking',
    weak_questioning: 'Weak questioning',
    premature_solution: 'Jumps to solution too early',
    no_next_step: 'No clear next step',
    weak_close: 'Weak close control',
    no_business_case: 'No business case built',
    skipped_discovery: 'Skipped discovery',
    no_metrics: 'Failed to capture metrics',
    no_economic_buyer: 'Never reached Economic Buyer',
    no_pain_quantified: 'Pain not quantified',
  };
  return map[flag] || flag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// MEDDICC completeness across all graded calls
export function useMeddiccCompleteness() {
  const { data: allGrades } = useAllTranscriptGrades();
  if (!allGrades?.length) return null;

  const fields = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'] as const;
  const completeness = fields.map(field => {
    const covered = allGrades.filter(g => g.meddicc_signals && (g.meddicc_signals as any)[field]).length;
    return { field, covered, total: allGrades.length, pct: Math.round((covered / allGrades.length) * 100) };
  });

  const overallPct = Math.round(completeness.reduce((s, c) => s + c.pct, 0) / fields.length);
  return { completeness, overallPct };
}
