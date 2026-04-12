import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { SkillFocus } from '@/lib/dojo/scenarios';

export interface ExtractedScenario {
  title: string;
  skillFocus: SkillFocus;
  context: string;
  objection: string;
  difficulty: 'foundational' | 'intermediate' | 'advanced';
  sourceExcerpt: string;
  repResponse: string;
  coachingHint: string;
}

/** Metadata carried to Dojo session for before/after comparison */
export interface TranscriptOrigin {
  transcriptId: string;
  transcriptTitle: string;
  sourceExcerpt: string;
  repResponse: string;
  coachingHint: string;
}

export function useExtractScenarios() {
  const [isExtracting, setIsExtracting] = useState(false);
  const [scenarios, setScenarios] = useState<ExtractedScenario[] | null>(null);

  const extract = async (transcript: string, title?: string, callType?: string) => {
    setIsExtracting(true);
    setScenarios(null);

    try {
      const { data, error } = await supabase.functions.invoke('extract-scenarios', {
        body: { transcript, title, callType },
      });

      if (error) throw error;

      if (data?.error) {
        if (data.error.includes('Rate limited')) {
          toast.error('Rate limited — try again in a moment');
        } else if (data.error.includes('credits')) {
          toast.error('AI credits exhausted');
        } else {
          toast.error(data.error);
        }
        return null;
      }

      const extracted = data.scenarios as ExtractedScenario[];
      setScenarios(extracted);
      toast.success(`Extracted ${extracted.length} training scenarios`);
      return extracted;
    } catch (err) {
      console.error('Extract scenarios error:', err);
      toast.error('Failed to extract scenarios');
      return null;
    } finally {
      setIsExtracting(false);
    }
  };

  const clear = () => setScenarios(null);

  return { extract, isExtracting, scenarios, clear };
}
