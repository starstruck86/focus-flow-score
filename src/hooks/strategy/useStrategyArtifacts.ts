import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface StrategyArtifact {
  id: string;
  user_id: string;
  thread_id: string | null;
  source_output_id: string | null;
  artifact_type: string;
  title: string;
  content_json: Record<string, unknown>;
  rendered_text: string | null;
  version: number;
  parent_artifact_id: string | null;
  linked_account_id: string | null;
  linked_opportunity_id: string | null;
  created_at: string;
  updated_at: string;
}

const TRANSFORM_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-transform-output`;

export function useStrategyArtifacts(threadId: string | null) {
  const { user } = useAuth();
  const [artifacts, setArtifacts] = useState<StrategyArtifact[]>([]);
  const [isTransforming, setIsTransforming] = useState(false);

  const fetchArtifacts = useCallback(async () => {
    if (!threadId || !user) { setArtifacts([]); return; }
    const { data } = await (supabase as any)
      .from('strategy_artifacts')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false });
    if (data) setArtifacts(data as StrategyArtifact[]);
  }, [threadId, user]);

  useEffect(() => { fetchArtifacts(); }, [fetchArtifacts]);

  const transformOutput = useCallback(async (
    sourceOutputId: string,
    targetArtifactType: string,
  ): Promise<StrategyArtifact | null> => {
    if (!user || isTransforming) return null;
    setIsTransforming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(TRANSFORM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ sourceOutputId, targetArtifactType, threadId }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Error ${resp.status}`);
      }

      const { artifact } = await resp.json();
      toast.success(`${targetArtifactType.replace(/_/g, ' ')} created`);
      await fetchArtifacts();
      return artifact as StrategyArtifact;
    } catch (e: any) {
      toast.error(e.message || 'Transform failed');
      return null;
    } finally {
      setIsTransforming(false);
    }
  }, [user, threadId, isTransforming, fetchArtifacts]);

  const regenerateArtifact = useCallback(async (
    artifactId: string,
    targetArtifactType: string,
  ): Promise<StrategyArtifact | null> => {
    if (!user || isTransforming) return null;
    setIsTransforming(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(TRANSFORM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ parentArtifactId: artifactId, targetArtifactType, threadId }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Error ${resp.status}`);
      }

      const { artifact } = await resp.json();
      toast.success('New version created');
      await fetchArtifacts();
      return artifact as StrategyArtifact;
    } catch (e: any) {
      toast.error(e.message || 'Regeneration failed');
      return null;
    } finally {
      setIsTransforming(false);
    }
  }, [user, threadId, isTransforming, fetchArtifacts]);

  return { artifacts, isTransforming, transformOutput, regenerateArtifact, refetch: fetchArtifacts };
}
