/**
 * ExtractKnowledgeDialog — trigger extraction with optional auto-activate for high-confidence items
 */

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useInsertKnowledgeItems, useKnowledgeItems } from '@/hooks/useKnowledgeItems';
import { extractKnowledgeHeuristic, type ExtractionSource } from '@/lib/knowledgeExtraction';
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
  const [autoActivate, setAutoActivate] = useState(true);
  const [result, setResult] = useState<{ extracted: number; skipped: number; activated: number } | null>(null);

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

      const allItems = [];
      let skipped = 0;

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

        const items = extractKnowledgeHeuristic(source);
        allItems.push(...items);
      }

      if (allItems.length === 0) {
        toast.info(`No new knowledge found (${skipped} resources already extracted)`);
        setResult({ extracted: 0, skipped, activated: 0 });
      } else {
        // Auto-activate high-confidence items
        let activated = 0;
        if (autoActivate) {
          for (const item of allItems) {
            if (item.confidence_score >= 0.55) {
              item.active = true;
              item.status = 'active' as any;
              activated++;
            }
          }
        }

        await insert.mutateAsync(allItems);
        setResult({ extracted: allItems.length, skipped, activated });
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
            Extract Knowledge
          </DialogTitle>
          <DialogDescription>
            {resourceId
              ? 'Extract structured knowledge items from this resource.'
              : 'Scan enriched resources and extract structured knowledge for your playbooks.'}
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="flex items-center gap-2 py-2">
            <Checkbox
              id="auto-activate"
              checked={autoActivate}
              onCheckedChange={(c) => setAutoActivate(!!c)}
            />
            <Label htmlFor="auto-activate" className="text-xs text-muted-foreground cursor-pointer">
              Auto-activate high-confidence items (≥70%)
            </Label>
          </div>
        )}

        {result && (
          <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
            <p className="font-medium">{result.extracted} knowledge items extracted</p>
            {result.activated > 0 && (
              <p className="text-xs text-emerald-600 flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {result.activated} auto-activated (high confidence)
              </p>
            )}
            {result.skipped > 0 && (
              <p className="text-xs text-muted-foreground">{result.skipped} resources already processed</p>
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
              {loading ? 'Extracting...' : 'Extract'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
