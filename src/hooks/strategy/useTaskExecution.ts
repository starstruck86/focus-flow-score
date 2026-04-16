import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface TaskInputs {
  company_name: string;
  rep_name?: string;
  participants: { name: string; title?: string; role?: string; side?: 'internal' | 'prospect' }[];
  opportunity?: string;
  stage?: string;
  prior_notes?: string;
  scale?: string;
  desired_next_step?: string;
  website?: string;
  thread_id?: string;
  account_id?: string;
  opportunity_id?: string;
}

export interface Redline {
  id: string;
  section_id: string;
  section_name: string;
  current_text: string;
  proposed_text: string;
  rationale: string;
  status?: 'pending' | 'accepted' | 'rejected';
}

export interface DiscoverySection {
  id: string;
  name: string;
  content: any;
}

export interface TaskRunResult {
  run_id: string;
  draft: { sections: DiscoverySection[] };
  review: { strengths: string[]; redlines: Redline[] };
}

export function useTaskExecution() {
  const { user } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<TaskRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDiscoveryPrep = useCallback(async (inputs: TaskInputs) => {
    if (!user) { toast.error('Please sign in'); return null; }
    setIsRunning(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-discovery-prep`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ action: 'generate', inputs }),
        }
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        if (resp.status === 429) throw new Error('Rate limited — please try again in a moment.');
        if (resp.status === 402) throw new Error('AI credits exhausted.');
        throw new Error(err.error || `Error ${resp.status}`);
      }

      const data: TaskRunResult = await resp.json();
      // Ensure redlines have status
      if (data.review?.redlines) {
        data.review.redlines = data.review.redlines.map((r, i) => ({
          ...r,
          id: r.id || `r${i}`,
          status: r.status || 'pending',
        }));
      }
      setResult(data);
      toast.success('Discovery Prep document generated');
      return data;
    } catch (e: any) {
      const msg = e.message || 'Failed to generate prep doc';
      setError(msg);
      toast.error(msg);
      return null;
    } finally {
      setIsRunning(false);
    }
  }, [user]);

  const applyRedline = useCallback(async (runId: string, sectionId: string, proposedText: string) => {
    if (!user) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-discovery-prep`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ action: 'apply_redline', run_id: runId, section_id: sectionId, proposed_text: proposedText }),
        }
      );

      if (!resp.ok) throw new Error('Failed to apply edit');

      const data = await resp.json();
      if (result) {
        setResult({
          ...result,
          draft: data.draft_output,
          review: {
            ...result.review,
            redlines: result.review.redlines.map(r =>
              r.section_id === sectionId ? { ...r, status: 'accepted' as const } : r
            ),
          },
        });
      }
      toast.success('Edit applied');
    } catch (e: any) {
      toast.error(e.message || 'Failed to apply');
    }
  }, [user, result]);

  const rejectRedline = useCallback((redlineId: string) => {
    if (!result) return;
    setResult({
      ...result,
      review: {
        ...result.review,
        redlines: result.review.redlines.map(r =>
          r.id === redlineId ? { ...r, status: 'rejected' as const } : r
        ),
      },
    });
  }, [result]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { isRunning, result, error, runDiscoveryPrep, applyRedline, rejectRedline, reset };
}
