import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Sparkles, Upload, Library, Save, BookmarkPlus,
  Star, RotateCcw, FileText, Copy, ChevronRight,
} from 'lucide-react';
import { OUTPUT_TYPES, OUTPUT_TYPE_LABELS } from '@/lib/executionTemplateTypes';
import type { OutputType, ExecutionTemplate, ExecutionOutput } from '@/lib/executionTemplateTypes';
import { TemplateRecommendationPanel } from '@/components/execute/TemplateRecommendationPanel';
import { PriorOutputRecommendationPanel } from '@/components/execute/PriorOutputRecommendationPanel';
import { SaveAsTemplateDialog } from '@/components/execute/SaveAsTemplateDialog';
import { UploadTemplateDialog } from '@/components/execute/UploadTemplateDialog';
import { TemplateLibraryDrawer } from '@/components/execute/TemplateLibraryDrawer';
import { useSaveOutput, usePromoteOutputToTemplate } from '@/hooks/useExecutionOutputs';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export default function ExecuteWorkspace() {
  const { user } = useAuth();

  // Generation form state
  const [outputType, setOutputType] = useState<OutputType>('demo_followup_email');
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [stage, setStage] = useState('');
  const [persona, setPersona] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [tone, setTone] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<ExecutionTemplate | null>(null);

  // Draft state
  const [draft, setDraft] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationSources, setGenerationSources] = useState<string[]>([]);

  // Dialog state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const saveOutput = useSaveOutput();
  const promoteOutput = usePromoteOutputToTemplate();

  // Load accounts for the selector
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-for-execute', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', user!.id)
        .is('deleted_at', null)
        .order('name');
      return data || [];
    },
  });

  const handleSelectTemplate = useCallback((t: ExecutionTemplate) => {
    setSelectedTemplate(t);
    if (t.output_type !== 'custom') setOutputType(t.output_type as OutputType);
    if (t.stage) setStage(t.stage);
    if (t.persona) setPersona(t.persona);
    if (t.competitor) setCompetitor(t.competitor);
    if (t.tone) setTone(t.tone);
    toast.success(`Template "${t.title}" loaded`);
  }, []);

  const handleUseOutputAsBase = useCallback((o: ExecutionOutput) => {
    setDraft(o.content);
    setDraftSubject(o.subject_line || '');
    if (o.stage) setStage(o.stage);
    if (o.persona) setPersona(o.persona);
    if (o.competitor) setCompetitor(o.competitor);
    toast.success('Prior output loaded as base');
  }, []);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationSources([]);
    try {
      const sources: string[] = [];
      let baseContent = '';

      if (selectedTemplate) {
        baseContent = selectedTemplate.body;
        sources.push(`Template: ${selectedTemplate.title}`);
      }

      // Call edge function for generation
      const { data, error } = await supabase.functions.invoke('generate-execution-draft', {
        body: {
          outputType,
          accountName: accountName || undefined,
          stage: stage || undefined,
          persona: persona || undefined,
          competitor: competitor || undefined,
          tone: tone || undefined,
          templateBody: baseContent || undefined,
          customInstructions: customInstructions || undefined,
        },
      });

      if (error) throw error;

      setDraft(data?.content || 'Generation failed — try again.');
      setDraftSubject(data?.subject_line || '');
      sources.push(...(data?.sources || []));
      setGenerationSources(sources);
      toast.success('Draft generated');
    } catch (err) {
      console.error('Generation error:', err);
      toast.error('Generation failed');
      // Fallback: use template body directly
      if (selectedTemplate?.body) {
        setDraft(selectedTemplate.body);
        setGenerationSources([`Template: ${selectedTemplate.title} (direct — generation unavailable)`]);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveOutput = () => {
    if (!draft.trim()) { toast.error('Nothing to save'); return; }
    saveOutput.mutate({
      title: `${OUTPUT_TYPE_LABELS[outputType]} — ${accountName || 'No Account'} — ${new Date().toLocaleDateString()}`,
      output_type: outputType,
      content: draft,
      subject_line: draftSubject || null,
      account_id: accountId || null,
      account_name: accountName || null,
      stage: stage || null,
      persona: persona || null,
      competitor: competitor || null,
      template_id_used: selectedTemplate?.id || null,
      custom_instructions: customInstructions || null,
    }, {
      onSuccess: () => toast.success('Output saved'),
      onError: () => toast.error('Save failed'),
    });
  };

  return (
    <div className="min-h-screen bg-background pt-[env(safe-area-inset-top)]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Execute</h1>
            <p className="text-sm text-muted-foreground">Generate, reuse, and improve your best sales work</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setUploadDialogOpen(true)}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload Template
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
              <Library className="h-3.5 w-3.5 mr-1.5" /> Template Library
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Generate Form */}
          <div className="lg:col-span-4 space-y-4">
            <Card>
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm">What are you creating?</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                <div>
                  <Label className="text-xs">Output Type</Label>
                  <Select value={outputType} onValueChange={v => setOutputType(v as OutputType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OUTPUT_TYPES.map(t => (
                        <SelectItem key={t} value={t}>{OUTPUT_TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Account</Label>
                  <Select
                    value={accountId || '__none__'}
                    onValueChange={v => {
                      const id = v === '__none__' ? '' : v;
                      setAccountId(id);
                      const acct = accounts.find(a => a.id === id);
                      setAccountName(acct?.name || '');
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No account</SelectItem>
                      {accounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Stage</Label>
                    <Input value={stage} onChange={e => setStage(e.target.value)} placeholder="e.g. Discovery" className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Persona</Label>
                    <Input value={persona} onChange={e => setPersona(e.target.value)} placeholder="e.g. VP Marketing" className="h-8 text-sm" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Competitor</Label>
                    <Input value={competitor} onChange={e => setCompetitor(e.target.value)} placeholder="e.g. Klaviyo" className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Tone</Label>
                    <Input value={tone} onChange={e => setTone(e.target.value)} placeholder="e.g. Professional" className="h-8 text-sm" />
                  </div>
                </div>

                {selectedTemplate && (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/20">
                    <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-xs truncate flex-1">{selectedTemplate.title}</span>
                    <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" onClick={() => setSelectedTemplate(null)}>
                      Clear
                    </Button>
                  </div>
                )}

                <div>
                  <Label className="text-xs">Custom Instructions</Label>
                  <Textarea
                    value={customInstructions}
                    onChange={e => setCustomInstructions(e.target.value)}
                    rows={3}
                    placeholder="Any special instructions for this output…"
                    className="text-sm"
                  />
                </div>

                <Button className="w-full" onClick={handleGenerate} disabled={isGenerating}>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  {isGenerating ? 'Generating…' : 'Generate Draft'}
                </Button>
              </CardContent>
            </Card>

            {/* Recommendations */}
            <TemplateRecommendationPanel
              outputType={outputType}
              stage={stage}
              persona={persona}
              competitor={competitor}
              onSelect={handleSelectTemplate}
              onPreview={handleSelectTemplate}
            />

            <PriorOutputRecommendationPanel
              outputType={outputType}
              onUseAsBase={handleUseOutputAsBase}
              onPromote={(o) => promoteOutput.mutate(o as any, {
                onSuccess: () => toast.success('Promoted to template'),
              })}
            />
          </div>

          {/* Right: Draft Workspace */}
          <div className="lg:col-span-8 space-y-4">
            <Card className="min-h-[500px]">
              <CardHeader className="pb-2 pt-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Draft Workspace</CardTitle>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={handleSaveOutput} disabled={!draft.trim()}>
                      <Save className="h-3 w-3 mr-1" /> Save Output
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setSaveDialogOpen(true)} disabled={!draft.trim()}>
                      <BookmarkPlus className="h-3 w-3 mr-1" /> Save as Template
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => { if (draft) navigator.clipboard.writeText(draft); toast.success('Copied'); }}>
                      <Copy className="h-3 w-3 mr-1" /> Copy
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={handleGenerate} disabled={isGenerating || !draft}>
                      <RotateCcw className="h-3 w-3 mr-1" /> Regenerate
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {draftSubject && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Subject Line</Label>
                    <Input
                      value={draftSubject}
                      onChange={e => setDraftSubject(e.target.value)}
                      className="font-medium"
                    />
                  </div>
                )}

                <Textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={20}
                  placeholder={
                    selectedTemplate
                      ? 'Click "Generate Draft" to create output using your selected template…'
                      : 'Select an output type and generate, or paste/type your content here…'
                  }
                  className="text-sm font-mono"
                />

                {/* Generation sources */}
                {generationSources.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium text-muted-foreground">Sources used:</p>
                    <div className="flex flex-wrap gap-1">
                      {generationSources.map((s, i) => (
                        <Badge key={i} variant="outline" className="text-[9px]">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick actions on draft */}
                {draft && (
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border">
                    {[
                      { label: 'Make shorter', icon: ChevronRight },
                      { label: 'Make stronger', icon: Star },
                      { label: 'Executive version', icon: FileText },
                    ].map(({ label, icon: Icon }) => (
                      <Button key={label} size="sm" variant="outline" className="h-6 text-[10px]">
                        <Icon className="h-3 w-3 mr-1" /> {label}
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <SaveAsTemplateDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        initialBody={draft}
        initialSubject={draftSubject}
        initialOutputType={outputType}
      />
      <UploadTemplateDialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen} />
      <TemplateLibraryDrawer open={libraryOpen} onOpenChange={setLibraryOpen} onSelect={handleSelectTemplate} />
    </div>
  );
}
