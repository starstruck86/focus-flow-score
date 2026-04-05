/**
 * Temporary admin page to run test + bulk KI extraction on audio resources.
 * Navigate to /bulk-extract to use.
 */
import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { extractKnowledgeLLMFallback, type ExtractionSource } from '@/lib/knowledgeExtraction';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

interface ResourceRow {
  id: string;
  title: string;
  resource_type: string;
  content: string;
  description: string | null;
  tags: string[];
  user_id: string;
}

interface ExtractResult {
  resourceId: string;
  title: string;
  extracted: number;
  activated: number;
  error?: string;
}

export default function BulkExtractRunner() {
  const { user } = useAuth();
  const [phase, setPhase] = useState<'idle' | 'testing' | 'test_done' | 'running' | 'done'>('idle');
  const [results, setResults] = useState<ExtractResult[]>([]);
  const [current, setCurrent] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const abortRef = useRef(false);

  const extractOne = useCallback(async (r: ResourceRow): Promise<ExtractResult> => {
    const source: ExtractionSource = {
      resourceId: r.id,
      userId: r.user_id,
      title: r.title,
      content: r.content,
      description: r.description || '',
      tags: r.tags || [],
      resourceType: r.resource_type,
    };

    try {
      const llmResult = await extractKnowledgeLLMFallback(source);
      if (llmResult.serverPersisted) {
        return { resourceId: r.id, title: r.title, extracted: llmResult.serverSavedCount, activated: llmResult.serverActiveCount, error: null };
      }
      if (llmResult.items.length === 0) {
        return { resourceId: r.id, title: r.title, extracted: 0, activated: 0, error: 'No items returned' };
      }

      const { data: inserted, error } = await supabase
        .from('knowledge_items' as any)
        .insert(llmResult.items as any)
        .select('id, active');

      if (error) {
        return { resourceId: r.id, title: r.title, extracted: 0, activated: 0, error: error.message };
      }

      const count = inserted?.length ?? 0;
      const activeCount = inserted?.filter((i: any) => i.active).length ?? 0;
      return { resourceId: r.id, title: r.title, extracted: count, activated: activeCount };
    } catch (err: any) {
      return { resourceId: r.id, title: r.title, extracted: 0, activated: 0, error: err?.message || 'Unknown' };
    }
  }, []);

  const fetchResources = useCallback(async (limit?: number) => {
    // Get audio resources with preprocessed content (has ## headings) and 0 active KIs
    const { data, error } = await supabase
      .from('resources')
      .select('id, title, resource_type, content, description, tags, user_id')
      .in('resource_type', ['audio', 'podcast', 'transcript', 'podcast_episode', 'video', 'recording'])
      .not('content', 'is', null)
      .order('created_at', { ascending: true });

    if (error || !data) return [];

    // Filter: must have >= 2 ## headings (preprocessed)
    const preprocessed = (data as unknown as ResourceRow[]).filter(r => {
      const headings = (r.content || '').match(/^## /gm)?.length ?? 0;
      return headings >= 2 && (r.content || '').length > 500;
    });

    // Check which ones already have active KIs
    const needsExtraction: ResourceRow[] = [];
    for (const r of preprocessed) {
      const { count } = await supabase
        .from('knowledge_items' as any)
        .select('id', { count: 'exact', head: true })
        .eq('source_resource_id', r.id)
        .eq('status', 'active');

      if ((count ?? 0) === 0) {
        needsExtraction.push(r);
      }
    }

    if (limit) return needsExtraction.slice(0, limit);
    return needsExtraction;
  }, []);

  const runTest = useCallback(async () => {
    setPhase('testing');
    setResults([]);
    abortRef.current = false;

    const resources = await fetchResources(5);
    setProgress({ done: 0, total: resources.length });

    for (const r of resources) {
      if (abortRef.current) break;
      setCurrent(r.title);
      const result = await extractOne(r);
      setResults(prev => [...prev, result]);
      setProgress(prev => ({ ...prev, done: prev.done + 1 }));
    }

    setCurrent('');
    setPhase('test_done');
    toast.success('Test extraction complete — review results below');
  }, [fetchResources, extractOne]);

  const runFull = useCallback(async () => {
    setPhase('running');
    setResults([]);
    abortRef.current = false;

    const resources = await fetchResources();
    setProgress({ done: 0, total: resources.length });
    toast.info(`Starting full extraction: ${resources.length} resources`);

    for (const r of resources) {
      if (abortRef.current) break;
      setCurrent(r.title);
      const result = await extractOne(r);
      setResults(prev => [...prev, result]);
      setProgress(prev => ({ ...prev, done: prev.done + 1 }));
    }

    setCurrent('');
    setPhase('done');
    toast.success('Full extraction complete!');
  }, [fetchResources, extractOne]);

  const totalExtracted = results.reduce((s, r) => s + r.extracted, 0);
  const totalActivated = results.reduce((s, r) => s + r.activated, 0);
  const totalFailed = results.filter(r => r.error).length;

  if (!user) return <div className="p-8">Please log in</div>;

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Bulk KI Extraction Runner</h1>

      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button onClick={runTest} disabled={phase === 'testing' || phase === 'running'}>
              🧪 Test on 5 Resources
            </Button>
            <Button 
              onClick={runFull} 
              disabled={phase !== 'test_done' && phase !== 'done'}
              variant={phase === 'test_done' ? 'default' : 'secondary'}
            >
              🚀 Run Full Extraction
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => { abortRef.current = true; }}
              disabled={phase !== 'testing' && phase !== 'running'}
            >
              Cancel
            </Button>
          </div>

          {(phase === 'testing' || phase === 'running') && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Processing {progress.done}/{progress.total}...
              </p>
              <p className="text-sm font-medium truncate">{current}</p>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all" 
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-4">
              Results
              <Badge variant="outline">{totalExtracted} extracted</Badge>
              <Badge variant="outline" className="text-green-600">{totalActivated} activated</Badge>
              {totalFailed > 0 && <Badge variant="destructive">{totalFailed} failed</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded-md border text-sm">
                    <span className="truncate flex-1 mr-4">{r.title}</span>
                    <div className="flex gap-2 shrink-0">
                      {r.error ? (
                        <Badge variant="destructive" className="text-xs">{r.error.slice(0, 40)}</Badge>
                      ) : (
                        <>
                          <Badge variant="outline">{r.extracted} KIs</Badge>
                          <Badge variant="outline" className="text-green-600">{r.activated} active</Badge>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
