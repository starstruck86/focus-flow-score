import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import {
  ArrowLeft, Save, Clock, Sparkles, BookOpen, Lightbulb, PanelRight,
  Building2, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUpdateResource, useAllResources, type Resource } from '@/hooks/useResources';
import { toast } from 'sonner';
import { RichTextEditor, type RichTextEditorRef, htmlToMarkdown } from './RichTextEditor';
import { EditorFooter } from './EditorFooter';
import { ExportMenu } from './ExportMenu';
import { AIGenerateDialog } from './AIGenerateDialog';
import { TemplatePicker } from './TemplatePicker';
import { SmartSuggestionsPanel } from './SmartSuggestionsPanel';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface ResourceEditorProps {
  resource: Resource;
  onBack: () => void;
  onViewVersions: () => void;
}

export function ResourceEditor({ resource, onBack, onViewVersions }: ResourceEditorProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState(resource.title);
  const [content, setContent] = useState(resource.content || '');
  const [hasChanges, setHasChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [lastSaved, setLastSaved] = useState<Date | undefined>();
  const [showSaveVersion, setShowSaveVersion] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');
  const [showAIGenerate, setShowAIGenerate] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showReferencePanel, setShowReferencePanel] = useState(false);
  const [linkedAccountId, setLinkedAccountId] = useState(resource.account_id || '');
  const [linkedOppId, setLinkedOppId] = useState(resource.opportunity_id || '');
  const [refSearch, setRefSearch] = useState('');
  const [viewingRef, setViewingRef] = useState<Resource | null>(null);

  const editorRef = useRef<RichTextEditorRef>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateResource = useUpdateResource();

  // Fetch accounts for CRM linking
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-select', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('accounts').select('id, name, industry').order('name');
      return data || [];
    },
    enabled: !!user,
  });

  // Fetch opportunities for CRM linking
  const { data: opportunities = [] } = useQuery({
    queryKey: ['opps-select', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('opportunities').select('id, name, stage, account_id').order('name');
      return data || [];
    },
    enabled: !!user,
  });

  // All resources for reference panel
  const { data: allResources = [] } = useAllResources();
  const filteredRefResources = allResources.filter(r =>
    r.id !== resource.id && r.title.toLowerCase().includes(refSearch.toLowerCase())
  );

  // Account context for AI
  const linkedAccount = accounts.find(a => a.id === linkedAccountId);
  const accountContext = linkedAccount
    ? { name: linkedAccount.name, industry: linkedAccount.industry || undefined }
    : null;

  // Track content changes
  const handleContentChange = useCallback((md: string) => {
    setContent(md);
    setHasChanges(true);
    setSaveStatus('unsaved');

    // Auto-save after 2s
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      setSaveStatus('saving');
      updateResource.mutate(
        { id: resource.id, updates: { title, content: md, account_id: linkedAccountId || null, opportunity_id: linkedOppId || null } },
        {
          onSuccess: () => {
            setSaveStatus('saved');
            setLastSaved(new Date());
            setHasChanges(false);
          },
          onError: () => setSaveStatus('unsaved'),
        }
      );
    }, 2000);
  }, [resource.id, title, linkedAccountId, linkedOppId, updateResource]);

  // Title change triggers auto-save
  useEffect(() => {
    if (title !== resource.title) {
      setHasChanges(true);
      setSaveStatus('unsaved');
    }
  }, [title, resource.title]);

  const handleSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaveStatus('saving');
    updateResource.mutate(
      { id: resource.id, updates: { title, content, account_id: linkedAccountId || null, opportunity_id: linkedOppId || null } },
      {
        onSuccess: () => {
          setSaveStatus('saved');
          setLastSaved(new Date());
          setHasChanges(false);
          toast.success('Saved');
        },
        onError: () => { setSaveStatus('unsaved'); toast.error('Save failed'); },
      }
    );
  }, [resource.id, title, content, linkedAccountId, linkedOppId, updateResource]);

  const handleSaveVersion = useCallback(() => {
    updateResource.mutate({
      id: resource.id,
      updates: { title, content },
      createVersion: { change_summary: changeSummary || undefined },
    });
    setHasChanges(false);
    setSaveStatus('saved');
    setLastSaved(new Date());
    setShowSaveVersion(false);
    setChangeSummary('');
    toast.success('Version saved');
  }, [resource.id, title, content, changeSummary, updateResource]);

  const handleAIGenerated = useCallback((markdown: string) => {
    editorRef.current?.setContent(markdown);
    setContent(markdown);
    setHasChanges(true);
    setSaveStatus('unsaved');
  }, []);

  const handleTemplateSelect = useCallback((template: { title: string; content: string; type: string }) => {
    setTitle(template.title);
    editorRef.current?.setContent(template.content);
    setContent(template.content);
    setHasChanges(true);
    setSaveStatus('unsaved');
  }, []);

  const handleSuggestionApply = useCallback((text: string) => {
    editorRef.current?.insertContent('\n\n' + text);
    setContent(prev => prev + '\n\n' + text);
    setHasChanges(true);
    setSaveStatus('unsaved');
  }, []);

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // Cleanup timer
  useEffect(() => () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); }, []);

  const mainEditor = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap p-3 border-b border-border">
        <Button variant="ghost" size="sm" className="h-8" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="flex-1 min-w-[200px] h-8 text-sm font-medium border-0 bg-transparent focus-visible:ring-1 px-2"
        />
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">v{resource.current_version}</Badge>
          <Badge variant="secondary" className="text-[10px] capitalize">{resource.resource_type}</Badge>
          {resource.is_template && <Badge className="text-[10px] bg-primary/20 text-primary">Template</Badge>}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border flex-wrap">
        {/* CRM Linking */}
        <Select value={linkedAccountId} onValueChange={setLinkedAccountId}>
          <SelectTrigger className="h-7 text-[10px] w-[140px]">
            <Building2 className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Link Account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Account</SelectItem>
            {accounts.map(a => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowTemplates(true)}>
            <BookOpen className="h-3.5 w-3.5 mr-1" /> Templates
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAIGenerate(true)}>
            <Sparkles className="h-3.5 w-3.5 mr-1" /> Generate
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onViewVersions}>
            <Clock className="h-3.5 w-3.5 mr-1" /> History
          </Button>
          <ExportMenu title={title} markdown={content} />
          <Button
            variant={showSuggestions ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowSuggestions(!showSuggestions)}
          >
            <Lightbulb className="h-3.5 w-3.5 mr-1" /> Suggest
          </Button>
          <Button
            variant={showReferencePanel ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowReferencePanel(!showReferencePanel)}
          >
            <PanelRight className="h-3.5 w-3.5 mr-1" /> Reference
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowSaveVersion(true)} disabled={!hasChanges}>
            <Save className="h-3.5 w-3.5 mr-1" /> Version
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!hasChanges}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
        </div>
      </div>

      {/* Digest Intelligence Section */}
      <DigestViewer resourceId={resource.id} />

      {/* Editor */}
      <div className="flex-1 overflow-auto">
        <RichTextEditor
          ref={editorRef}
          initialMarkdown={resource.content || ''}
          onChange={handleContentChange}
        />
      </div>

      {/* Footer */}
      <EditorFooter content={content} saveStatus={saveStatus} lastSaved={lastSaved} />

      {/* Dialogs */}
      <AIGenerateDialog
        open={showAIGenerate}
        onOpenChange={setShowAIGenerate}
        onGenerated={handleAIGenerated}
        accountContext={accountContext}
      />
      <TemplatePicker
        open={showTemplates}
        onOpenChange={setShowTemplates}
        onSelect={handleTemplateSelect}
      />

      {/* Save Version Dialog */}
      <Dialog open={showSaveVersion} onOpenChange={setShowSaveVersion}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Save New Version</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This will create version {(resource.current_version || 0) + 1} of this resource.
            </p>
            <Input
              value={changeSummary}
              onChange={e => setChangeSummary(e.target.value)}
              placeholder="What changed? (optional)"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSaveVersion()}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowSaveVersion(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSaveVersion}>Save Version</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  // Reference panel content
  const referencePanel = (
    <div className="flex flex-col h-full border-l border-border">
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={refSearch}
            onChange={e => setRefSearch(e.target.value)}
            placeholder="Search resources..."
            className="h-7 text-xs pl-7"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {viewingRef ? (
          <div className="p-3">
            <Button variant="ghost" size="sm" className="h-6 text-xs mb-2" onClick={() => setViewingRef(null)}>
              <ArrowLeft className="h-3 w-3 mr-1" /> Back
            </Button>
            <h3 className="text-sm font-medium mb-2">{viewingRef.title}</h3>
            <div className="prose prose-xs dark:prose-invert max-w-none text-xs">
              {viewingRef.content || <span className="text-muted-foreground italic">No content</span>}
            </div>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {filteredRefResources.slice(0, 30).map(r => (
              <button
                key={r.id}
                onClick={() => setViewingRef(r)}
                className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent/50 transition-colors flex items-center gap-2"
              >
                <span className="truncate flex-1">{r.title}</span>
                <Badge variant="outline" className="text-[8px] shrink-0">{r.resource_type}</Badge>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );

  return (
    <div className="h-[calc(100vh-200px)] flex">
      {showReferencePanel ? (
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={showSuggestions ? 50 : 65} minSize={40}>
            {mainEditor}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={showSuggestions ? 25 : 35} minSize={20}>
            {referencePanel}
          </ResizablePanel>
          {showSuggestions && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize={25} minSize={18}>
                <SmartSuggestionsPanel
                  content={content}
                  documentType={resource.resource_type}
                  onApply={handleSuggestionApply}
                  onClose={() => setShowSuggestions(false)}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      ) : showSuggestions ? (
        <div className="flex w-full">
          <div className="flex-1">{mainEditor}</div>
          <SmartSuggestionsPanel
            content={content}
            documentType={resource.resource_type}
            onApply={handleSuggestionApply}
            onClose={() => setShowSuggestions(false)}
          />
        </div>
      ) : (
        <div className="w-full">{mainEditor}</div>
      )}
    </div>
  );
}
