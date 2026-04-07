/**
 * Prep Workspace — workflow-first execution surface.
 *
 * Flow: Pick deliverable type → Accept recommended starting point → Generate draft in 2-3 clicks.
 */

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2, ChevronDown, Eye, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OutputType, ExecutionTemplate, ExecutionOutput } from '@/lib/executionTemplateTypes';
import { OUTPUT_TYPE_LABELS } from '@/lib/executionTemplateTypes';

import { DeliverableTypeSelector } from './DeliverableTypeSelector';
import { RecommendedStartingPoints } from './RecommendedStartingPoints';
import { SupportingMaterialsPanel } from './SupportingMaterialsPanel';
import { PrepDraftOutput } from './PrepDraftOutput';

export function PrepWorkspace() {
  const { user } = useAuth();

  // Section 1: Deliverable type
  const [outputType, setOutputType] = useState<OutputType>('discovery_prep_sheet');

  // Context
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [stage, setStage] = useState('');
  const [persona, setPersona] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [tone, setTone] = useState('');

  // Template / base content
  const [selectedBase, setSelectedBase] = useState<{ body: string; title: string; id?: string } | null>(null);

  // Supporting materials
  const [transcriptIds, setTranscriptIds] = useState<string[]>([]);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);

  // Custom instructions
  const [customInstructions, setCustomInstructions] = useState('');
  const [instructionsExpanded, setInstructionsExpanded] = useState(false);

  // Draft
  const [draft, setDraft] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sources, setSources] = useState<string[]>([]);

  // Preview
  const [previewContent, setPreviewContent] = useState<{ body: string; title: string } | null>(null);

  // Accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-for-prep', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await fromActiveAccounts()
        .select('id, name')
        .eq('user_id', user!.id)
        .order('name');
      return data || [];
    },
  });

  const handleSelectTemplate = useCallback((t: ExecutionTemplate) => {
    setSelectedBase({ body: t.body, title: t.title, id: t.id });
    if (t.stage) setStage(t.stage);
    if (t.persona) setPersona(t.persona);
    if (t.competitor) setCompetitor(t.competitor);
    if (t.tone) setTone(t.tone);
    toast.success(`"${t.title}" selected as base`);
  }, []);

  const handleSelectOutput = useCallback((o: ExecutionOutput) => {
    setSelectedBase({ body: o.content, title: o.title, id: o.id });
    if (o.stage) setStage(o.stage);
    if (o.persona) setPersona(o.persona);
    if (o.competitor) setCompetitor(o.competitor);
    toast.success(`"${o.title}" loaded as base`);
  }, []);

  const handlePreview = useCallback((body: string, title: string) => {
    setPreviewContent({ body, title });
  }, []);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setSources([]);
    try {
      const genSources: string[] = [];
      if (selectedBase) genSources.push(`Base: ${selectedBase.title}`);

      const { data, error } = await supabase.functions.invoke('generate-execution-draft', {
        body: {
          outputType,
          accountName: accountName || undefined,
          stage: stage || undefined,
          persona: persona || undefined,
          competitor: competitor || undefined,
          tone: tone || undefined,
          templateBody: selectedBase?.body || undefined,
          customInstructions: customInstructions || undefined,
        },
      });

      if (error) throw error;

      setDraft(data?.content || '');
      setDraftSubject(data?.subject_line || '');
      genSources.push(...(data?.sources || []));
      setSources(genSources);
      toast.success('Draft generated');
    } catch (err) {
      console.error('Generation error:', err);
      toast.error('Generation failed');
      if (selectedBase?.body) {
        setDraft(selectedBase.body);
        setSources([`${selectedBase.title} (direct — generation unavailable)`]);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClear = () => {
    setSelectedBase(null);
    setDraft('');
    setDraftSubject('');
    setSources([]);
    setCustomInstructions('');
    setTranscriptIds([]);
    setReferenceIds([]);
  };

  return (
    <div className="space-y-4">
      {/* Section 1: Deliverable Type */}
      <DeliverableTypeSelector value={outputType} onChange={setOutputType} />

      {/* Context row — compact */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">Account</Label>
          <Select
            value={accountId || '__none__'}
            onValueChange={v => {
              const id = v === '__none__' ? '' : v;
              setAccountId(id);
              setAccountName(accounts.find(a => a.id === id)?.name || '');
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Optional" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Stage</Label>
          <Input value={stage} onChange={e => setStage(e.target.value)} placeholder="e.g. Discovery" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Persona</Label>
          <Input value={persona} onChange={e => setPersona(e.target.value)} placeholder="e.g. VP Marketing" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Competitor</Label>
          <Input value={competitor} onChange={e => setCompetitor(e.target.value)} placeholder="e.g. Klaviyo" className="h-8 text-xs" />
        </div>
      </div>

      {/* Section 2: Recommended Starting Points */}
      <RecommendedStartingPoints
        outputType={outputType}
        stage={stage}
        persona={persona}
        competitor={competitor}
        onSelectTemplate={handleSelectTemplate}
        onSelectOutput={handleSelectOutput}
        onPreview={handlePreview}
      />

      {/* Selected base indicator */}
      {selectedBase && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/20">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs truncate flex-1">Using: {selectedBase.title}</span>
          <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" onClick={() => setSelectedBase(null)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Section 3: Supporting Materials (collapsed) */}
      <SupportingMaterialsPanel
        accountId={accountId || undefined}
        selectedTranscriptIds={transcriptIds}
        onTranscriptIdsChange={setTranscriptIds}
        selectedReferenceIds={referenceIds}
        onReferenceIdsChange={setReferenceIds}
      />

      {/* Section 4: Custom Instructions (compact) */}
      <Collapsible open={instructionsExpanded} onOpenChange={setInstructionsExpanded}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className={cn('h-3 w-3 transition-transform', instructionsExpanded && 'rotate-180')} />
            Custom Instructions
            {customInstructions && <Badge variant="secondary" className="text-[9px]">Set</Badge>}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1.5">
          <Textarea
            value={customInstructions}
            onChange={e => setCustomInstructions(e.target.value)}
            placeholder="e.g. Focus on ROI metrics, keep tone consultative…"
            className="text-xs min-h-[48px]"
            rows={2}
          />
        </CollapsibleContent>
      </Collapsible>

      {/* Section 5: Generate */}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
          ) : (
            <><Sparkles className="h-4 w-4 mr-2" /> Generate Draft</>
          )}
        </Button>
        {(draft || selectedBase || customInstructions) && (
          <Button variant="outline" size="sm" onClick={handleClear}>
            Clear
          </Button>
        )}
      </div>

      {/* Draft output with save-back */}
      <PrepDraftOutput
        draft={draft}
        onDraftChange={setDraft}
        subjectLine={draftSubject}
        onSubjectChange={setDraftSubject}
        outputType={outputType}
        accountName={accountName}
        sources={sources}
        onRegenerate={handleGenerate}
        isGenerating={isGenerating}
      />

      {/* Preview overlay */}
      {previewContent && (
        <div className="fixed inset-0 z-50 bg-background/80 flex items-center justify-center p-4" onClick={() => setPreviewContent(null)}>
          <div className="bg-card border rounded-lg shadow-lg max-w-2xl w-full max-h-[80vh] overflow-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">{previewContent.title}</h3>
              <Button size="sm" variant="ghost" onClick={() => setPreviewContent(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <pre className="text-xs whitespace-pre-wrap text-muted-foreground">{previewContent.body}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
