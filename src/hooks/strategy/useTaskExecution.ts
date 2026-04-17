import { useState, useCallback, useRef, useEffect } from 'react';
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
  grounded_by_id?: string | null;
  status?: 'pending' | 'accepted' | 'rejected';
}

export interface DiscoverySection {
  id: string;
  name: string;
  /** v2: KI/playbook 8-char ids the section was grounded in. */
  grounded_by?: string[];
  content: any;
}

export interface SourceEntry {
  id: string;
  label: string;
  url?: string | null;
  accessed?: string | null;
}

export interface LibraryCoverageEntry {
  id: string;
  title: string;
  type: 'KI' | 'Playbook';
  sections?: string[];
}

export interface RubricCheck {
  citation_density?: 'pass' | 'warn' | 'fail';
  cockpit_completeness?: 'pass' | 'warn' | 'fail';
  discovery_question_specificity?: 'pass' | 'warn' | 'fail';
  library_grounding?: 'pass' | 'warn' | 'fail';
  appendix_richness?: 'pass' | 'warn' | 'fail';
  notes?: string[];
}

export interface TaskRunResult {
  run_id: string;
  draft: { sections: DiscoverySection[]; sources?: SourceEntry[] };
  review: {
    strengths: string[];
    redlines: Redline[];
    library_coverage?: { used: LibraryCoverageEntry[]; gaps: string[]; score?: number };
    rubric_check?: RubricCheck;
  };
}

const PROGRESS_LABELS: Record<string, string> = {
  queued: 'Queued…',
  library_retrieval: 'Pulling internal playbooks & KIs…',
  research: 'Researching company & market…',
  synthesis: 'Synthesizing strategic intelligence…',
  document_authoring: 'Authoring prep document…',
  review: 'Reviewing against playbooks…',
  completed: 'Done',
  failed: 'Failed',
};

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes hard cap

function normalizeTaskRunResult(runId: string, payload?: { draft?: any; review?: any }): TaskRunResult {
  const rawDraft = payload?.draft && typeof payload.draft === 'object' ? payload.draft : {};
  const rawReview = payload?.review && typeof payload.review === 'object' ? payload.review : {};

  const sections: DiscoverySection[] = Array.isArray(rawDraft.sections)
    ? rawDraft.sections.map((section: any, index: number) => ({
        id: typeof section?.id === 'string' && section.id ? section.id : `section-${index + 1}`,
        name: typeof section?.name === 'string' && section.name
          ? section.name
          : typeof section?.id === 'string' && section.id
            ? section.id.replace(/_/g, ' ')
            : `Section ${index + 1}`,
        grounded_by: Array.isArray(section?.grounded_by) ? section.grounded_by : undefined,
        content: section?.content ?? null,
      }))
    : [];

  const redlines: Redline[] = Array.isArray(rawReview.redlines)
    ? rawReview.redlines.map((redline: any, index: number) => ({
        id: typeof redline?.id === 'string' && redline.id ? redline.id : `r${index}`,
        section_id: typeof redline?.section_id === 'string' && redline.section_id ? redline.section_id : sections[index]?.id || `section-${index + 1}`,
        section_name: typeof redline?.section_name === 'string' && redline.section_name
          ? redline.section_name
          : sections.find((section) => section.id === redline?.section_id)?.name || 'Section',
        current_text: typeof redline?.current_text === 'string' ? redline.current_text : '',
        proposed_text: typeof redline?.proposed_text === 'string' ? redline.proposed_text : '',
        rationale: typeof redline?.rationale === 'string' ? redline.rationale : '',
        grounded_by_id: redline?.grounded_by_id ?? null,
        status: redline?.status === 'accepted' || redline?.status === 'rejected' ? redline.status : 'pending',
      }))
    : [];

  const sources: SourceEntry[] | undefined = Array.isArray(rawDraft.sources)
    ? rawDraft.sources.map((source: any, index: number) => ({
        id: typeof source?.id === 'string' && source.id ? source.id : `source-${index + 1}`,
        label: typeof source?.label === 'string' && source.label ? source.label : `Source ${index + 1}`,
        url: typeof source?.url === 'string' ? source.url : null,
        accessed: typeof source?.accessed === 'string' ? source.accessed : null,
      }))
    : undefined;

  return {
    run_id: runId,
    draft: {
      sections,
      ...(sources ? { sources } : {}),
    },
    review: {
      strengths: Array.isArray(rawReview.strengths)
        ? rawReview.strengths.filter((item: unknown): item is string => typeof item === 'string')
        : [],
      redlines,
      library_coverage: rawReview?.library_coverage,
      rubric_check: rawReview?.rubric_check,
    },
  };
}

async function callDiscoveryPrep(body: Record<string, unknown>) {
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
      body: JSON.stringify(body),
    },
  );
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 429) throw new Error('Rate limited — please try again in a moment.');
    if (resp.status === 402) throw new Error('AI credits exhausted.');
    throw new Error(json?.error || `Error ${resp.status}`);
  }
  return json;
}

export function useTaskExecution() {
  const { user } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [result, setResult] = useState<TaskRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => () => { cancelRef.current = true; }, []);

  const runDiscoveryPrep = useCallback(async (inputs: TaskInputs) => {
    if (!user) { toast.error('Please sign in'); return null; }
    setIsRunning(true);
    setError(null);
    setProgressLabel(PROGRESS_LABELS.queued);
    cancelRef.current = false;

    try {
      // 1) Kick off the background job (returns immediately).
      const start = await callDiscoveryPrep({ action: 'generate', inputs });
      const runId: string | undefined = start?.run_id;
      if (!runId) throw new Error('Failed to start Discovery Prep job');

      // 2) Poll until completed/failed.
      const startedAt = Date.now();
      while (!cancelRef.current) {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          throw new Error('Discovery Prep is taking longer than expected. Please check back shortly.');
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const status = await callDiscoveryPrep({ action: 'status', run_id: runId });
        const step: string = status?.progress_step || status?.status || 'queued';
        setProgressLabel(PROGRESS_LABELS[step] || step);

        if (status?.status === 'failed') {
          throw new Error(status?.error || 'Discovery Prep generation failed');
        }
        if (status?.status === 'completed') {
          const data = normalizeTaskRunResult(runId, {
            draft: status?.draft,
            review: status?.review,
          });
          setResult(data);
          toast.success('Discovery Prep document generated');
          return data;
        }
      }
      return null;
    } catch (e: any) {
      const msg = e.message || 'Failed to generate prep doc';
      setError(msg);
      toast.error(msg);
      return null;
    } finally {
      setIsRunning(false);
      setProgressLabel(null);
    }
  }, [user]);

  const applyRedline = useCallback(async (runId: string, sectionId: string, proposedText: string) => {
    if (!user) return;
    try {
      const data = await callDiscoveryPrep({
        action: 'apply_redline',
        run_id: runId,
        section_id: sectionId,
        proposed_text: proposedText,
      });
      if (result) {
        const nextResult = normalizeTaskRunResult(runId, {
          draft: data?.draft_output ?? result.draft,
          review: data?.review_output ?? result.review,
        });
        setResult({
          ...nextResult,
          review: {
            ...nextResult.review,
            redlines: nextResult.review.redlines.map(r =>
              r.section_id === sectionId ? { ...r, status: 'accepted' as const } : r,
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
          r.id === redlineId ? { ...r, status: 'rejected' as const } : r,
        ),
      },
    });
  }, [result]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setProgressLabel(null);
  }, []);

  return { isRunning, progressLabel, result, error, runDiscoveryPrep, applyRedline, rejectRedline, reset };
}
