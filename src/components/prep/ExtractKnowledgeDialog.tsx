/**
 * ExtractKnowledgeDialog — action extraction with trust validation,
 * dedup suppression, and resource routing.
 */

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Zap, FileText, Brain, ShieldCheck, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useInsertKnowledgeItems, useKnowledgeItems } from '@/hooks/useKnowledgeItems';
import { extractKnowledgeHeuristic, extractKnowledgeLLMFallback, type ExtractionSource } from '@/lib/knowledgeExtraction';
import { routeResource, deduplicateTemplates, deduplicateExamples } from '@/lib/trustValidation';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceId?: string;
}

export function ExtractKnowledgeDialog({ open, onOpenChange, resourceId }: Props) {
  const { user } = useAuth();
  const insert = useInsertKnowledgeItems();
  const { data: existingItems = [] } = useKnowledgeItems();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    extracted: number;
    activated: number;
    templatesCreated: number;
    examplesCreated: number;
    duplicatesSuppressed: number;
    failed: number;
    skipped: number;
    routed: Record<string, number>;
  } | null>(null);

  const handleExtract = async () => {
    if (!user) return;
    setLoading(true);
    setResult(null);

    try {
      let query = supabase
        .from('resources')
        .select('id, title, content, description, tags, resource_type, content_length')
        .in('enrichment_status', ['enriched', 'deep_enriched', 'verified'])
        .gt('content_length', 200)
        .order('content_length', { ascending: false })
        .limit(100);

      if (resourceId) {
        query = supabase
          .from('resources')
          .select('id, title, content, description, tags, resource_type, content_length')
          .eq('id', resourceId)
          .limit(1);
      }

      const { data: resources, error } = await query;
      if (error) throw error;
      if (!resources?.length) {
        toast.info('No enriched resources with content found');
        setLoading(false);
        return;
      }

      // Fetch existing templates and examples for dedup
      const [existingTplRes, existingExRes] = await Promise.all([
        supabase.from('execution_templates' as any).select('title, body').eq('user_id', user.id).limit(200),
        supabase.from('execution_outputs').select('title, content').eq('user_id', user.id).eq('is_strong_example', true).limit(200),
      ]);
      const existingTemplates = ((existingTplRes.data || []) as unknown as Array<{ title: string; body?: string }>);
      const existingExamples = ((existingExRes.data || []) as unknown as Array<{ title: string; content?: string }>);

      const existingSourceIds = new Set(existingItems.map(i => i.source_resource_id).filter(Boolean));
      const existingForDedup = existingItems.map(i => ({ title: i.title, tactic_summary: i.tactic_summary }));

      const allItems: any[] = [];
      let skipped = 0;
      let templatesCreated = 0;
      let examplesCreated = 0;
      let duplicatesSuppressed = 0;
      let failed = 0;
      const routed: Record<string, number> = {};

      for (const resource of resources) {
        if (!resourceId && existingSourceIds.has(resource.id)) {
          skipped++;
          continue;
        }

        // Route resource to appropriate output path
        const route = routeResource({
          title: resource.title,
          content: resource.content,
          resource_type: resource.resource_type,
          tags: resource.tags,
          content_length: resource.content_length,
        });
        routed[route.path] = (routed[route.path] || 0) + 1;

        // Handle based on route
        if (route.path === 'reference_only') {
          continue; // Skip reference-only resources
        }

        if (route.path === 'template_candidate') {
          // Check for duplicate before creating
          if (!deduplicateTemplates(resource.title, resource.content || '', existingTemplates)) {
            const { error: tplErr } = await supabase.from('execution_templates' as any).insert({
              user_id: user.id,
              title: resource.title,
              body: resource.content || '',
              template_type: 'email',
              output_type: detectOutputType(resource.content || ''),
              source_resource_id: resource.id,
              tags: resource.tags || [],
              template_origin: 'promoted_from_resource',
              status: 'active',
              created_by_user: false,
              confidence_score: route.confidence,
            } as any);
            if (!tplErr) {
              templatesCreated++;
              existingTemplates.push({ title: resource.title, body: resource.content || '' });
            }
          } else {
            duplicatesSuppressed++;
          }
          // Still extract tactics from templates
        }

        if (route.path === 'example_candidate') {
          if (!deduplicateExamples(resource.title, resource.content || '', existingExamples)) {
            const { error: exErr } = await supabase.from('execution_outputs').insert({
              user_id: user.id,
              title: resource.title,
              content: resource.content || '',
              output_type: detectOutputType(resource.content || ''),
              is_strong_example: true,
            });
            if (!exErr) {
              examplesCreated++;
              existingExamples.push({ title: resource.title, content: resource.content || '' });
            }
          } else {
            duplicatesSuppressed++;
          }
        }

        // Extract tactics (for tactic_candidate and also template/example resources)
        const source: ExtractionSource = {
          resourceId: resource.id,
          userId: user.id,
          title: resource.title,
          content: resource.content,
          description: resource.description,
          tags: resource.tags || [],
          resourceType: resource.resource_type,
        };

        let items = extractKnowledgeHeuristic(source, existingForDedup);
        if (items.length === 0 && (resource.content?.length ?? 0) >= 100) {
          items = await extractKnowledgeLLMFallback(source, existingForDedup);
        }

        if (items.length === 0) {
          failed++;
          continue;
        }

        allItems.push(...items);
        // Track for intra-batch dedup
        for (const item of items) {
          existingForDedup.push({ title: item.title, tactic_summary: item.tactic_summary });
        }
      }

      if (allItems.length === 0 && templatesCreated === 0 && examplesCreated === 0) {
        toast.info(`No new assets created (${skipped} already extracted, ${failed} failed)`);
        setResult({ extracted: 0, activated: 0, templatesCreated, examplesCreated, duplicatesSuppressed, failed, skipped, routed });
      } else {
        if (allItems.length > 0) {
          await insert.mutateAsync(allItems);
        }
        const activated = allItems.filter(i => i.active).length;
        setResult({ extracted: allItems.length, activated, templatesCreated, examplesCreated, duplicatesSuppressed, failed, skipped, routed });
      }
    } catch (err) {
      console.error('Extraction failed:', err);
      toast.error('Extraction failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Action Extraction
          </DialogTitle>
          <DialogDescription>
            {resourceId
              ? 'Extract actionable units with trust validation from this resource.'
              : 'Route resources into templates, examples, and tactics with dedup + validation.'}
          </DialogDescription>
        </DialogHeader>

        {result && (
          <div className="rounded-lg bg-muted p-3 text-sm space-y-1.5">
            <p className="font-medium flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              {result.extracted} tactics · {result.templatesCreated} templates · {result.examplesCreated} examples
            </p>
            {result.activated > 0 && (
              <p className="text-xs text-emerald-600 flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {result.activated} auto-activated (all trust gates passed)
              </p>
            )}
            {result.duplicatesSuppressed > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                {result.duplicatesSuppressed} duplicates suppressed
              </p>
            )}
            {result.failed > 0 && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {result.failed} resources need transformation
              </p>
            )}
            {Object.keys(result.routed).length > 0 && (
              <p className="text-xs text-muted-foreground">
                Routed: {Object.entries(result.routed).map(([k, v]) => `${k.replace(/_/g, ' ')} (${v})`).join(' · ')}
              </p>
            )}
            {result.skipped > 0 && (
              <p className="text-xs text-muted-foreground">{result.skipped} already processed</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setResult(null); }}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          {!result && (
            <Button onClick={handleExtract} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? 'Extracting...' : 'Extract Actions'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function detectOutputType(content: string): string {
  const lower = content.toLowerCase();
  if (/discovery/i.test(lower)) return 'discovery_recap_email';
  if (/demo/i.test(lower)) return 'demo_followup_email';
  if (/pricing|roi/i.test(lower)) return 'pricing_followup_email';
  if (/renewal/i.test(lower)) return 'renewal_followup_email';
  if (/agenda/i.test(lower)) return 'meeting_agenda';
  if (/executive|cxo/i.test(lower)) return 'executive_followup_email';
  return 'custom';
}
