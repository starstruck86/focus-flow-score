import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { FileText, Search, Clock, Target, RefreshCw, Trash2, Building2, GraduationCap } from 'lucide-react';
import { useCallTranscripts, useDeleteTranscript, type CallTranscript } from '@/hooks/useCallTranscripts';
import { useGradeTranscript, useTranscriptGrade } from '@/hooks/useTranscriptGrades';
import { useStore } from '@/store/useStore';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SalesCoachPanel } from '@/components/SalesCoachPanel';

interface TranscriptViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  opportunityId?: string;
  renewalId?: string;
}

export function TranscriptViewer({ open, onOpenChange, accountId, opportunityId, renewalId }: TranscriptViewerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { opportunities, renewals, accounts } = useStore();
  const deleteTranscript = useDeleteTranscript();

  const { data: transcripts, isLoading } = useCallTranscripts(
    open ? { accountId, opportunityId, renewalId } : undefined
  );

  const filtered = useMemo(() => {
    if (!transcripts) return [];
    if (!searchQuery.trim()) return transcripts;
    const q = searchQuery.toLowerCase();
    return transcripts.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.content.toLowerCase().includes(q) ||
      t.summary?.toLowerCase().includes(q) ||
      t.participants?.toLowerCase().includes(q) ||
      t.tags?.some(tag => tag.toLowerCase().includes(q))
    );
  }, [transcripts, searchQuery]);

  const selected = filtered.find(t => t.id === selectedId);

  const getLinkedName = (t: CallTranscript) => {
    if (t.opportunity_id) {
      return opportunities.find(o => o.id === t.opportunity_id)?.name;
    }
    if (t.renewal_id) {
      return renewals.find(r => r.id === t.renewal_id)?.accountName;
    }
    if (t.account_id) {
      return accounts.find(a => a.id === t.account_id)?.name;
    }
    return null;
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTranscript.mutateAsync(id);
      if (selectedId === id) setSelectedId(null);
      toast.success('Transcript deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Call Transcripts
            {transcripts && <Badge variant="outline" className="ml-2">{transcripts.length}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search transcripts..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-3 flex-1 min-h-0">
          {/* List */}
          <div className="w-1/3 overflow-y-auto space-y-1 border-r border-border pr-3">
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-muted rounded w-3/4 mb-1" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {searchQuery ? 'No transcripts match your search' : 'No transcripts yet'}
              </p>
            ) : (
              filtered.map(t => (
                <div
                  key={t.id}
                  className={cn(
                    "p-2 rounded-lg cursor-pointer transition-colors text-sm",
                    selectedId === t.id ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"
                  )}
                  onClick={() => setSelectedId(t.id)}
                >
                  <p className="font-medium truncate text-xs">{t.title || t.call_type || 'Untitled'}</p>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    <span>{t.call_date}</span>
                    {t.call_type && <span>• {t.call_type}</span>}
                  </div>
                  {getLinkedName(t) && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                      <Building2 className="h-2.5 w-2.5" />
                      <span className="truncate">{getLinkedName(t)}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Detail */}
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{selected.title || 'Untitled'}</h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <span>{selected.call_date}</span>
                      {selected.call_type && <Badge variant="outline" className="text-[10px]">{selected.call_type}</Badge>}
                      {selected.duration_minutes && <span>{selected.duration_minutes} min</span>}
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="sm" className="text-destructive h-7"
                    onClick={() => handleDelete(selected.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {selected.participants && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground mb-0.5">Participants</p>
                    <p className="text-sm">{selected.participants}</p>
                  </div>
                )}

                {selected.summary && (
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                    <p className="text-[11px] font-semibold text-muted-foreground mb-1">Summary</p>
                    <p className="text-sm whitespace-pre-wrap">{selected.summary}</p>
                  </div>
                )}

                {selected.tags && selected.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {selected.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                )}

                {selected.notes && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground mb-0.5">Notes</p>
                    <p className="text-sm whitespace-pre-wrap">{selected.notes}</p>
                  </div>
                )}

                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1">Full Transcript</p>
                  <div className="text-sm whitespace-pre-wrap font-mono bg-muted/30 p-3 rounded-lg border border-border/50 max-h-[400px] overflow-y-auto">
                    {selected.content}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                <div className="text-center">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Select a transcript to view</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
