import { useState, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Mic, FileText, Plus, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  accountId?: string;
  selectedTranscriptIds: string[];
  onTranscriptIdsChange: (ids: string[]) => void;
  selectedReferenceIds: string[];
  onReferenceIdsChange: (ids: string[]) => void;
}

export function SupportingMaterialsPanel({
  accountId,
  selectedTranscriptIds,
  onTranscriptIdsChange,
  selectedReferenceIds,
  onReferenceIdsChange,
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [whyVisible, setWhyVisible] = useState(false);

  // Auto-load and auto-select relevant transcripts and references
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      // Load recent transcripts
      let tq = supabase
        .from('call_transcripts')
        .select('id, title, call_date, account_id')
        .eq('user_id', user.id)
        .order('call_date', { ascending: false })
        .limit(10);
      if (accountId) tq = tq.eq('account_id', accountId);
      const { data: tData } = await tq;
      setTranscripts(tData || []);

      // Auto-select most recent transcript
      if (tData?.length && selectedTranscriptIds.length === 0) {
        onTranscriptIdsChange([tData[0].id]);
      }

      // Load reference resources
      const { data: rData } = await supabase
        .from('resources' as any)
        .select('id, title, resource_type, updated_at')
        .eq('user_id', user.id)
        .in('resource_type', ['document', 'battlecard', 'one_pager', 'template'])
        .order('updated_at', { ascending: false })
        .limit(20);
      setResources(rData || []);

      // Auto-select top 3 references
      if (rData?.length && selectedReferenceIds.length === 0) {
        onReferenceIdsChange(rData.slice(0, 3).map((r: any) => r.id));
      }
    };
    load();
  }, [user, accountId]);

  const toggleTranscript = (id: string) => {
    onTranscriptIdsChange(
      selectedTranscriptIds.includes(id)
        ? selectedTranscriptIds.filter(x => x !== id)
        : [...selectedTranscriptIds, id]
    );
  };

  const toggleReference = (id: string) => {
    onReferenceIdsChange(
      selectedReferenceIds.includes(id)
        ? selectedReferenceIds.filter(x => x !== id)
        : [...selectedReferenceIds, id]
    );
  };

  const totalSelected = selectedTranscriptIds.length + selectedReferenceIds.length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center justify-between w-full p-2.5 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Supporting Materials</span>
            {totalSelected > 0 && (
              <Badge variant="secondary" className="text-[9px]">{totalSelected} selected</Badge>
            )}
          </div>
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="pt-2 space-y-3">
        {/* Transcripts */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Mic className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Transcripts</span>
          </div>
          {transcripts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {transcripts.map(t => (
                <Badge
                  key={t.id}
                  variant={selectedTranscriptIds.includes(t.id) ? 'default' : 'outline'}
                  className="cursor-pointer text-[10px]"
                  onClick={() => toggleTranscript(t.id)}
                >
                  {t.title || t.call_date}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">No transcripts available</p>
          )}
        </div>

        {/* References */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <FileText className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">References</span>
          </div>
          {resources.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {resources.slice(0, 10).map(r => (
                <Badge
                  key={r.id}
                  variant={selectedReferenceIds.includes(r.id) ? 'default' : 'outline'}
                  className="cursor-pointer text-[10px]"
                  onClick={() => toggleReference(r.id)}
                >
                  {r.title}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">No references available</p>
          )}
        </div>

        {/* Why these were chosen */}
        <button
          onClick={() => setWhyVisible(!whyVisible)}
          className="flex items-center gap-1 text-[10px] text-primary hover:underline"
        >
          <HelpCircle className="h-3 w-3" /> Why these were chosen
        </button>
        {whyVisible && (
          <div className="text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2 space-y-1">
            <p>• Transcripts: most recent calls{accountId ? ' for this account' : ''}</p>
            <p>• References: most recently updated documents, battlecards, and templates</p>
            <p>You can add or remove any items above.</p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
