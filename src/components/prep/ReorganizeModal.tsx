import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowRight, Loader2, Sparkles, Check, X } from 'lucide-react';
import { useAllResources, useUpdateResource } from '@/hooks/useResources';
import { useReorganizeLibrary, type ClassificationResult } from '@/hooks/useResourceUpload';
import { useCreateFolder, useResourceFolders } from '@/hooks/useResources';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Suggestion = {
  id: string;
  original: { title: string; tags: string[] | null };
  suggested: ClassificationResult;
  accepted: boolean;
};

export function ReorganizeModal({ open, onOpenChange }: Props) {
  const { data: resources = [] } = useAllResources();
  const { data: folders = [] } = useResourceFolders();
  const reorganize = useReorganizeLibrary();
  const updateResource = useUpdateResource();
  const createFolder = useCreateFolder();
  const { user } = useAuth();

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'review' | 'applying'>('idle');

  const handleAnalyze = async () => {
    setPhase('analyzing');
    try {
      const result = await reorganize.mutateAsync(
        resources.map(r => ({ id: r.id, title: r.title, content: r.content, tags: r.tags }))
      );
      setSuggestions(result.map(r => ({ ...r, accepted: true })));
      setPhase('review');
    } catch {
      toast.error('Analysis failed');
      setPhase('idle');
    }
  };

  const toggleItem = (id: string) => {
    setSuggestions(prev => prev.map(s => s.id === id ? { ...s, accepted: !s.accepted } : s));
  };

  const handleApply = async () => {
    if (!user) return;
    setPhase('applying');
    const accepted = suggestions.filter(s => s.accepted);

    try {
      // Collect unique folder names needed
      const neededFolders = [...new Set(accepted.map(s => s.suggested.suggested_folder))];
      const folderMap = new Map<string, string>();

      for (const name of neededFolders) {
        const existing = folders.find(f => f.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          folderMap.set(name, existing.id);
        } else {
          const { data } = await supabase
            .from('resource_folders')
            .insert({ name, user_id: user.id })
            .select()
            .single();
          if (data) folderMap.set(name, data.id);
        }
      }

      // Apply updates
      for (const s of accepted) {
        const folderId = folderMap.get(s.suggested.suggested_folder);
        await updateResource.mutateAsync({
          id: s.id,
          updates: {
            title: s.suggested.title,
            description: s.suggested.description,
            resource_type: s.suggested.resource_type,
            tags: s.suggested.tags,
            folder_id: folderId || undefined,
          },
        });
      }

      toast.success(`Reorganized ${accepted.length} resource(s)`);
      onOpenChange(false);
      setSuggestions([]);
      setPhase('idle');
    } catch {
      toast.error('Failed to apply changes');
      setPhase('review');
    }
  };

  const acceptedCount = suggestions.filter(s => s.accepted).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Reorganize Library
          </DialogTitle>
        </DialogHeader>

        {phase === 'idle' && (
          <div className="text-center py-8 space-y-4">
            <p className="text-sm text-muted-foreground">
              AI will analyze all {resources.length} resources and suggest better titles, types, tags, and folder organization.
            </p>
            <Button onClick={handleAnalyze} disabled={resources.length === 0}>
              <Sparkles className="h-4 w-4 mr-2" /> Analyze Library
            </Button>
          </div>
        )}

        {phase === 'analyzing' && (
          <div className="text-center py-12 space-y-3">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Analyzing {resources.length} resources...</p>
            <p className="text-xs text-muted-foreground">This may take a minute</p>
          </div>
        )}

        {phase === 'review' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{acceptedCount} of {suggestions.length} changes selected</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setSuggestions(prev => prev.map(s => ({ ...s, accepted: true })))}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSuggestions(prev => prev.map(s => ({ ...s, accepted: false })))}>
                  Deselect All
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[400px]">
              <div className="space-y-2 pr-2">
                {suggestions.map(s => (
                  <div
                    key={s.id}
                    className={`p-3 rounded-lg border transition-colors ${
                      s.accepted ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-card/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Checkbox checked={s.accepted} onCheckedChange={() => toggleItem(s.id)} className="mt-1" />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground truncate">{s.original.title}</span>
                          <ArrowRight className="h-3 w-3 shrink-0 text-primary" />
                          <span className="font-medium text-foreground truncate">{s.suggested.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="secondary" className="text-[10px] capitalize">{s.suggested.resource_type}</Badge>
                          <Badge variant="outline" className="text-[10px]">{s.suggested.suggested_folder}</Badge>
                          {s.suggested.tags.slice(0, 3).map(t => (
                            <Badge key={t} variant="outline" className="text-[10px] font-normal">{t}</Badge>
                          ))}
                        </div>
                        {s.suggested.description && (
                          <p className="text-[10px] text-muted-foreground line-clamp-1">{s.suggested.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleApply} disabled={acceptedCount === 0}>
                <Check className="h-4 w-4 mr-1" /> Apply {acceptedCount} Changes
              </Button>
            </div>
          </div>
        )}

        {phase === 'applying' && (
          <div className="text-center py-12 space-y-3">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Applying changes...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
