import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeScoreResult, type DojoScoreResult } from '@/lib/dojo/types';

export interface OriginalScoreResult extends DojoScoreResult {
  isOriginalCall: boolean;
}

export function useScoreOriginalResponse() {
  const [isScoring, setIsScoring] = useState(false);
  const [originalScore, setOriginalScore] = useState<OriginalScoreResult | null>(null);

  const scoreOriginal = useCallback(async (
    scenario: { skillFocus: string; context: string; objection: string },
    repResponse: string
  ) => {
    if (!repResponse || repResponse.length < 10) return null;

    setIsScoring(true);
    try {
      const { data, error } = await supabase.functions.invoke('score-original-response', {
        body: { scenario, repResponse },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const scored = {
        ...normalizeScoreResult(data as Record<string, unknown>),
        isOriginalCall: true,
      };

      setOriginalScore(scored);
      return scored;
    } catch (err) {
      console.error('Score original response error:', err);
      return null;
    } finally {
      setIsScoring(false);
    }
  }, []);

  return { scoreOriginal, isScoring, originalScore };
}
