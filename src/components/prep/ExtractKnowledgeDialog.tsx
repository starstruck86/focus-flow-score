/**
 * ExtractKnowledgeDialog — action extraction with auto-activate and auto-template creation
 */

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Zap, FileText, Brain } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useInsertKnowledgeItems, useKnowledgeItems } from '@/hooks/useKnowledgeItems';
import { extractKnowledgeHeuristic, extractKnowledgeLLMFallback, type ExtractionSource } from '@/lib/knowledgeExtraction';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceId?: string;
}

/** Detect if content has reusable structure → auto-create execution template */
async function autoCreateTemplate(
  resource: { id: string; title: string; content: string; tags?: string[] },
  userId: string
) {
  const structurePatterns = [
    /subject\s*:/i, /dear\s/i, /hi\s\[/i, /step\s*\d/i,
    /agenda/i, /\[.*name.*\]/i, /\{.*\}/, /template/i,
    /follow.up/i, /email/i,
  ];
  const isStructured = structurePatterns.filter(p => p.test(resource.content)).length >= 2;
  if (!isStructured || resource.content.length < 200) return false;

  const { error } = await supabase.from('execution_templates' as any).insert({
    user_id: userId,
    title: resource.title,
    body: resource.content,
    template_type: 'email',
    output_type: detectOutputType(resource.content),
    source_resource_id: resource.id,
    tags: resource.tags || [],
    template_origin: 'promoted_from_resource',
    status: 'active',
    created_by_user: false,
    confidence_score: 0.7,
  } as any);

  return !error;
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

export function ExtractKnowledgeDialog({ open, onOpenChange, resourceId }: Props) {
  const { user } = useAuth();
  const insert = useInsertKnowledgeItems();
  const { data: existingItems = [] } = useKnowledgeItems();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    extracted: number;
    activated: number;
    templatesCreated: number;
    failed: number;
    skipped: number;
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

      const existingSourceIds = new Set(existingItems.map(i => i.source_resource_id).filter(Boolean));

      const allItems: any[] = [];
      let skipped = 0;
      let templatesCreated = 0;
      let failed = 0;

      for (const resource of resources) {
        if (!resourceId && existingSourceIds.has(resource.id)) {
          skipped++;
          continue;
        }

        const source: ExtractionSource = {
          resourceId: resource.id,
          userId: user.id,
          title: resource.title,
          content: resource.content,
          description: resource.description,
          tags: resource.tags || [],
          resourceType: resource.resource_type,
        };

        // Try heuristic first, then LLM fallback
        let items = extractKnowledgeHeuristic(source);
        if (items.length === 0 && (resource.content?.length ?? 0) >= 100) {
          items = await extractKnowledgeLLMFallback(source);
        }

        if (items.length === 0) {
          failed++;
          continue;
        }

        // All items are auto-activated by the updated extraction logic
        allItems.push(...items);

        // Auto-create template if structured
        if (resource.content && resource.content.length >= 200) {
          const created = await autoCreateTemplate(
            { id: resource.id, title: resource.title, content: resource.content, tags: resource.tags },
            user.id
          );
          if (created) templatesCreated++;
        }
      }

      if (allItems.length === 0) {
        toast.info(`No actionable units found (${skipped} already extracted, ${failed} failed)`);
        setResult({ extracted: 0, activated: 0, templatesCreated, failed, skipped });
      } else {
        const activated = allItems.filter(i => i.active).length;
        await insert.mutateAsync(allItems);
        setResult({ extracted: allItems.length, activated, templatesCreated, failed, skipped });
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
              ? 'Extract actionable units (things to SAY, ASK, WRITE, USE) from this resource.'
              : 'Convert enriched resources into execution-ready tactics, templates, and prompt modules.'}
          </DialogDescription>
        </DialogHeader>

        {result && (
          <div className="rounded-lg bg-muted p-3 text-sm space-y-1.5">
            <p className="font-medium">{result.extracted} actionable units extracted</p>
            {result.activated > 0 && (
              <p className="text-xs text-emerald-600 flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {result.activated} auto-activated (ready for execution)
              </p>
            )}
            {result.templatesCreated > 0 && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {result.templatesCreated} templates auto-created
              </p>
            )}
            {result.failed > 0 && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <Brain className="h-3 w-3" />
                {result.failed} resources need transformation
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
