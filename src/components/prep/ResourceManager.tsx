import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Folder, FolderPlus, FilePlus, FileText, Presentation, Mail, BookOpen,
  ChevronRight, MoreHorizontal, Search, Trash2, Edit3, Clock,
  Star, Tag, Copy, Upload, Link2, Sparkles, Target, Shield,
  GraduationCap, MessageSquare, Loader2, Check, X, AlertTriangle, Globe, Radar,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useResourceFolders, useResources, useCreateFolder, useCreateResource,
  useDeleteResource, useDeleteFolder, useRenameFolder, useUpdateResource, type Resource, type ResourceFolder,
} from '@/hooks/useResources';
import { useClassifyResource, useUploadResource, useAddUrlResource, type ClassificationResult } from '@/hooks/useResourceUpload';
import { ResourceEditor } from './ResourceEditor';
import { ResourceFileViewer } from './ResourceFileViewer';
import { VersionHistory } from './VersionHistory';
import { ReorganizeModal } from './ReorganizeModal';
import { DuplicateResourcesModal } from './DuplicateResourcesModal';
import { useResourceDuplicates } from '@/hooks/useResourceDuplicates';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type PendingItem = {
  id: string;
  status: 'classifying' | 'classified' | 'error';
  classification?: ClassificationResult;
  source: 'file' | 'url';
  file?: File;
  url?: string;
  error?: string;
};

const RESOURCE_TYPE_ICONS: Record<string, React.ElementType> = {
  document: FileText,
  presentation: Presentation,
  email: Mail,
  template: BookOpen,
  prep: Star,
  playbook: BookOpen,
  framework: Target,
  battlecard: Shield,
  training: GraduationCap,
  transcript: MessageSquare,
};

const RESOURCE_TYPE_OPTIONS = [
  { value: 'document', label: 'Document' },
  { value: 'presentation', label: 'Presentation' },
  { value: 'email', label: 'Email Draft' },
  { value: 'prep', label: 'Prep Brief' },
  { value: 'template', label: 'Template' },
  { value: 'playbook', label: 'Playbook' },
  { value: 'framework', label: 'Framework' },
  { value: 'battlecard', label: 'Battle Card' },
  { value: 'training', label: 'Training' },
];

const TEMPLATE_CATEGORIES = [
  'Discovery', 'Demo', 'Follow-Up', 'Proposal', 'QBR', 'Executive', 'Battle Card', 'Other',
];

const ACCEPTED_FILE_TYPES = '.pdf,.docx,.pptx,.txt,.md,.csv,.doc,.xlsx,.xls';

export function ResourceManager() {
  const { user } = useAuth();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'All Resources' }]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showNewResource, setShowNewResource] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newResource, setNewResource] = useState({ title: '', resource_type: 'document', is_template: false, template_category: '' });
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [viewingResource, setViewingResource] = useState<Resource | null>(null);
  const [viewingVersions, setViewingVersions] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<ResourceFolder | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [showReorganize, setShowReorganize] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [renamingResourceId, setRenamingResourceId] = useState<string | null>(null);
  const [renameResourceTitle, setRenameResourceTitle] = useState('');

  // Upload/URL states
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [savingAll, setSavingAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI Discover states
  const [showDiscover, setShowDiscover] = useState(false);
  const [discoverQuery, setDiscoverQuery] = useState('');
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [competitorName, setCompetitorName] = useState('');
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [competitorContext, setCompetitorContext] = useState('');
  const [battlecardLoading, setBattlecardLoading] = useState(false);
  const [battlecardProgress, setBattlecardProgress] = useState('');

  const { data: folders = [] } = useResourceFolders();
  const { data: resources = [] } = useResources(currentFolderId === null ? undefined : currentFolderId);
  const createFolder = useCreateFolder();
  const createResource = useCreateResource();
  const deleteResource = useDeleteResource();
  const deleteFolder = useDeleteFolder();
  const renameFolder = useRenameFolder();
  const updateResource = useUpdateResource();
  const classify = useClassifyResource();
  const uploadResource = useUploadResource();
  const addUrlResource = useAddUrlResource();
  const { totalDuplicates } = useResourceDuplicates();

  const currentFolders = folders.filter(f => f.parent_id === currentFolderId);
  const filteredResources = searchQuery
    ? resources.filter(r => r.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : resources;

  const navigateToFolder = useCallback((folder: ResourceFolder) => {
    setCurrentFolderId(folder.id);
    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name }]);
    setSearchQuery('');
  }, []);

  const navigateToPath = useCallback((index: number) => {
    const targetPath = folderPath.slice(0, index + 1);
    setFolderPath(targetPath);
    setCurrentFolderId(targetPath[targetPath.length - 1].id);
    setSearchQuery('');
  }, [folderPath]);

  const handleCreateFolder = useCallback(() => {
    if (!newFolderName.trim()) return;
    createFolder.mutate({ name: newFolderName.trim(), parent_id: currentFolderId });
    setNewFolderName('');
    setShowNewFolder(false);
  }, [newFolderName, currentFolderId, createFolder]);

  const handleCreateResource = useCallback(() => {
    if (!newResource.title.trim()) return;
    createResource.mutate({
      title: newResource.title.trim(),
      folder_id: currentFolderId,
      resource_type: newResource.resource_type,
      is_template: newResource.is_template,
      template_category: newResource.is_template ? newResource.template_category : undefined,
      content: '',
    }, {
      onSuccess: (data) => setEditingResource(data as Resource),
    });
    setNewResource({ title: '', resource_type: 'document', is_template: false, template_category: '' });
    setShowNewResource(false);
  }, [newResource, currentFolderId, createResource]);

  const handleRenameFolder = useCallback(() => {
    if (!renamingFolder || !renameFolderName.trim()) return;
    renameFolder.mutate({ id: renamingFolder.id, name: renameFolderName.trim() });
    setRenamingFolder(null);
    setRenameFolderName('');
  }, [renamingFolder, renameFolderName, renameFolder]);

  const handleRenameResource = useCallback(() => {
    if (!renamingResourceId || !renameResourceTitle.trim()) return;
    updateResource.mutate({ id: renamingResourceId, updates: { title: renameResourceTitle.trim() } });
    toast.success('Resource renamed');
    setRenamingResourceId(null);
    setRenameResourceTitle('');
  }, [renamingResourceId, renameResourceTitle, updateResource]);

  // Classify items in batches of 3
  const classifyBatch = async (items: PendingItem[]) => {
    for (let i = 0; i < items.length; i += 3) {
      const batch = items.slice(i, i + 3);
      await Promise.allSettled(
        batch.map(async (item) => {
          try {
            let classification: ClassificationResult;
            if (item.source === 'file' && item.file) {
              const text = await extractTextPreview(item.file);
              classification = await classify.mutateAsync({ text, filename: item.file.name });
            } else if (item.source === 'url' && item.url) {
              classification = await classify.mutateAsync({ url: item.url });
            } else {
              throw new Error('Invalid item');
            }
            setPendingItems(prev => prev.map(p =>
              p.id === item.id ? { ...p, status: 'classified' as const, classification } : p
            ));
          } catch {
            setPendingItems(prev => prev.map(p =>
              p.id === item.id ? { ...p, status: 'error' as const, error: 'Classification failed' } : p
            ));
          }
        })
      );
      // Small delay between batches to avoid rate limiting
      if (i + 3 < items.length) await new Promise(r => setTimeout(r, 300));
    }
  };

  // File upload handler — supports multiple files
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const validFiles = files.filter(f => {
      if (f.size > 20 * 1024 * 1024) {
        toast.error(`${f.name} exceeds 20MB limit`);
        return false;
      }
      return true;
    });
    if (!validFiles.length) return;

    const newItems: PendingItem[] = validFiles.map(file => ({
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'classifying' as const,
      source: 'file' as const,
      file,
    }));
    setPendingItems(prev => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    classifyBatch(newItems);
  };

  // Bulk URL handler
  const handleAddUrls = async () => {
    // Extract all URLs from the input — handles newlines, spaces, commas, or mixed separators
    const urlPattern = /https?:\/\/[^\s,<>"']+/gi;
    const urls = (urlInput.match(urlPattern) || []).map(u => u.replace(/[)}\]]+$/, '').trim());
    const uniqueUrls = [...new Set(urls)];
    if (!uniqueUrls.length) {
      toast.error('No valid URLs found');
      return;
    }
    setShowAddUrl(false);
    setUrlInput('');

    const newItems: PendingItem[] = uniqueUrls.map(url => ({
      id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'classifying' as const,
      source: 'url' as const,
      url,
    }));
    setPendingItems(prev => [...prev, ...newItems]);
    classifyBatch(newItems);
  };

  // Update a pending item's title
  const updatePendingTitle = (id: string, title: string) => {
    setPendingItems(prev => prev.map(p =>
      p.id === id && p.classification ? { ...p, classification: { ...p.classification, title } } : p
    ));
  };

  // Remove a pending item
  const removePendingItem = (id: string) => {
    setPendingItems(prev => prev.filter(p => p.id !== id));
  };

  // Confirm all classified items
  const handleConfirmAll = async () => {
    const readyItems = pendingItems.filter(p => p.status === 'classified' && p.classification);
    if (!readyItems.length) return;
    setSavingAll(true);
    try {
      for (const item of readyItems) {
        if (item.source === 'file' && item.file && item.classification) {
          await uploadResource.mutateAsync({ file: item.file, classification: item.classification, folderId: currentFolderId });
        } else if (item.source === 'url' && item.url && item.classification) {
          await addUrlResource.mutateAsync({ url: item.url, classification: item.classification, folderId: currentFolderId });
        }
      }
      setPendingItems(prev => prev.filter(p => p.status === 'error'));
      toast.success(`${readyItems.length} resource${readyItems.length > 1 ? 's' : ''} saved`);
    } catch {
      toast.error('Some items failed to save');
    } finally {
      setSavingAll(false);
    }
  };

  // AI Resource Discovery
  const handleDiscoverResources = async () => {
    if (!discoverQuery.trim()) return;
    setDiscoverLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('discover-resources', {
        body: { type: 'resource-search', query: discoverQuery.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const resources = data?.resources || [];
      if (!resources.length) {
        toast.info('No resources found. Try a different query.');
        return;
      }

      const newItems: PendingItem[] = resources.map((r: any) => ({
        id: `discover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'classified' as const,
        source: 'url' as const,
        url: r.url,
        classification: {
          title: r.title,
          description: r.description,
          resource_type: r.resource_type,
          tags: r.tags,
          suggested_folder: r.suggested_folder,
        },
      }));
      setPendingItems(prev => [...prev, ...newItems]);
      setShowDiscover(false);
      setDiscoverQuery('');
      toast.success(`Found ${resources.length} resources — review and confirm below`);
    } catch (e: any) {
      toast.error(e.message || 'Discovery failed');
    } finally {
      setDiscoverLoading(false);
    }
  };

  // Competitor Intel
  const handleBuildBattlecard = async () => {
    if (!competitorName.trim() || !competitorUrl.trim()) return;
    setBattlecardLoading(true);
    setBattlecardProgress('Mapping website...');
    try {
      const { data, error } = await supabase.functions.invoke('discover-resources', {
        body: {
          type: 'competitor-intel',
          companyName: competitorName.trim(),
          websiteUrl: competitorUrl.trim(),
          context: competitorContext.trim(),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Save battlecard as a resource
      const { data: folder } = await supabase
        .from('resource_folders')
        .select('id')
        .eq('name', 'Battlecards')
        .maybeSingle();

      let folderId = folder?.id;
      if (!folderId) {
        const { data: newFolder } = await supabase
          .from('resource_folders')
          .insert({ name: 'Battlecards', user_id: user!.id })
          .select('id')
          .single();
        folderId = newFolder?.id;
      }

      await createResource.mutateAsync({
        title: `${competitorName} — Competitive Battlecard`,
        folder_id: folderId || null,
        resource_type: 'battlecard',
        content: data.markdown,
      });

      setShowDiscover(false);
      setCompetitorName('');
      setCompetitorUrl('');
      setCompetitorContext('');
      toast.success(`Battlecard created — ${data.pages_scraped} pages analyzed`);
    } catch (e: any) {
      toast.error(e.message || 'Battlecard generation failed');
    } finally {
      setBattlecardLoading(false);
      setBattlecardProgress('');
    }
  };

  const handleResourceClick = (resource: Resource) => {
    if (resource.file_url) {
      setViewingResource(resource);
    } else {
      setEditingResource(resource);
    }
  };

  if (editingResource) {
    return (
      <ResourceEditor
        resource={editingResource}
        onBack={() => setEditingResource(null)}
        onViewVersions={() => setViewingVersions(editingResource.id)}
      />
    );
  }

  if (viewingResource) {
    return (
      <ResourceFileViewer
        resource={viewingResource}
        onBack={() => setViewingResource(null)}
        onEdit={() => { setEditingResource(viewingResource); setViewingResource(null); }}
      />
    );
  }

  if (viewingVersions) {
    return (
      <VersionHistory
        resourceId={viewingVersions}
        onBack={() => setViewingVersions(null)}
        onRestoreVersion={() => setViewingVersions(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {folderPath.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            <button
              className={cn("hover:text-foreground transition-colors", i === folderPath.length - 1 && "text-foreground font-medium")}
              onClick={() => navigateToPath(i)}
            >
              {p.name}
            </button>
          </span>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search resources..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        {/* Only show Folder button inside a folder, or at root if < 8 top-level folders */}
        {(currentFolderId !== null || folders.filter(f => !f.parent_id).length < 8) && (
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowNewFolder(true)}>
            <FolderPlus className="h-3.5 w-3.5 mr-1" /> {currentFolderId ? 'Sub-Folder' : 'Folder'}
          </Button>
        )}

        {/* Add dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-8 text-xs">
              <FilePlus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowNewResource(true)}>
              <FileText className="h-3.5 w-3.5 mr-2" /> New Resource
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-2" /> Upload File
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowAddUrl(true)}>
              <Link2 className="h-3.5 w-3.5 mr-2" /> Add Link / URL
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowDiscover(true)}>
          <Radar className="h-3.5 w-3.5 mr-1" /> AI Discover
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowReorganize(true)}>
          <Sparkles className="h-3.5 w-3.5 mr-1" /> Reorganize
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs relative" onClick={() => setShowDuplicates(true)}>
          <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Duplicates
          {totalDuplicates > 0 && (
            <Badge variant="destructive" className="absolute -top-1.5 -right-1.5 h-4 min-w-4 text-[9px] px-1 flex items-center justify-center">
              {totalDuplicates}
            </Badge>
          )}
        </Button>
      </div>

      {/* Batch review panel */}
      {pendingItems.length > 0 && (
        <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">
                {pendingItems.filter(p => p.status === 'classifying').length > 0
                  ? `Classifying ${pendingItems.filter(p => p.status === 'classifying').length} item(s)...`
                  : `${pendingItems.filter(p => p.status === 'classified').length} item(s) ready`}
              </span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPendingItems([])}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              {pendingItems.map(item => (
                <div key={item.id} className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-background">
                  {item.status === 'classifying' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
                  {item.status === 'classified' && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  {item.status === 'error' && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                  <div className="flex-1 min-w-0">
                    {item.status === 'classified' && item.classification ? (
                      <Input
                        value={item.classification.title}
                        onChange={e => updatePendingTitle(item.id, e.target.value)}
                        className="h-7 text-xs"
                      />
                    ) : item.status === 'error' ? (
                      <span className="text-xs text-destructive">{item.error}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground truncate block">
                        {item.source === 'file' ? item.file?.name : item.url}
                      </span>
                    )}
                    {item.status === 'classified' && item.classification && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant="secondary" className="text-[9px] capitalize">{item.classification.resource_type}</Badge>
                        <Badge variant="outline" className="text-[9px]">{item.classification.suggested_folder}</Badge>
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removePendingItem(item.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
          {pendingItems.some(p => p.status === 'classified') && (
            <div className="flex justify-end">
              <Button size="sm" onClick={handleConfirmAll} disabled={savingAll}>
                {savingAll ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5 mr-1" />
                )}
                Confirm All ({pendingItems.filter(p => p.status === 'classified').length})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Folders */}
      {currentFolders.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {currentFolders.map(folder => (
            <div
              key={folder.id}
              className="group flex items-center gap-2 p-2.5 rounded-lg border border-border/50 bg-card/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-colors"
              onClick={() => navigateToFolder(folder)}
            >
              <Folder className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium text-foreground truncate flex-1">{folder.name}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setRenamingFolder(folder); setRenameFolderName(folder.name); }}>
                    <Edit3 className="h-3.5 w-3.5 mr-2" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteFolder.mutate(folder.id); }}>
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {/* Resources */}
      {filteredResources.length > 0 ? (
        <div className="space-y-1.5">
          {filteredResources.map(resource => {
            const Icon = RESOURCE_TYPE_ICONS[resource.resource_type] || FileText;
            const hasFile = !!resource.file_url;
            const isExternal = resource.file_url?.startsWith('http');
            return (
              <div
                key={resource.id}
                className="group flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-colors"
                onClick={() => handleResourceClick(resource)}
              >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {renamingResourceId === resource.id ? (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Input
                          value={renameResourceTitle}
                          onChange={e => setRenameResourceTitle(e.target.value)}
                          className="h-6 text-sm px-1.5 w-48"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameResource();
                            if (e.key === 'Escape') { setRenamingResourceId(null); setRenameResourceTitle(''); }
                          }}
                        />
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRenameResource}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setRenamingResourceId(null); setRenameResourceTitle(''); }}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-sm font-medium text-foreground truncate">{resource.title}</span>
                    )}
                    {resource.is_template && <Badge variant="secondary" className="text-[10px] shrink-0">Template</Badge>}
                    {resource.template_category && <Badge variant="outline" className="text-[10px] shrink-0">{resource.template_category}</Badge>}
                    {hasFile && !isExternal && <Upload className="h-3 w-3 text-muted-foreground shrink-0" />}
                    {isExternal && <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground capitalize">{resource.resource_type}</span>
                    <span className="text-[10px] text-muted-foreground">v{resource.current_version}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(resource.updated_at).toLocaleDateString()}
                    </span>
                    {resource.tags && resource.tags.length > 0 && (
                      <div className="flex items-center gap-1 ml-1">
                        {resource.tags.slice(0, 3).map(t => (
                          <Badge key={t} variant="outline" className="text-[8px] font-normal py-0 px-1">{t}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); setViewingVersions(resource.id); }}
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingResource(resource); }}>
                        <Edit3 className="h-3.5 w-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setRenamingResourceId(resource.id); setRenameResourceTitle(resource.title); }}>
                        <Tag className="h-3.5 w-3.5 mr-2" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setViewingVersions(resource.id); }}>
                        <Clock className="h-3.5 w-3.5 mr-2" /> Version History
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation();
                        createResource.mutate({
                          title: `${resource.title} (Copy)`,
                          folder_id: resource.folder_id,
                          resource_type: resource.resource_type,
                          content: resource.content || '',
                          is_template: resource.is_template || false,
                          template_category: resource.template_category || undefined,
                        });
                      }}>
                        <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteResource.mutate(resource.id); }}>
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      ) : currentFolders.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No resources yet</p>
          <p className="text-xs mt-1">Create a document, upload a file, or add a link</p>
        </div>
      ) : null}

      {/* New Folder Dialog */}
      <Dialog open={showNewFolder} onOpenChange={setShowNewFolder}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Folder</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              placeholder="Folder name..."
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowNewFolder(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreateFolder}>Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Resource Dialog */}
      <Dialog open={showNewResource} onOpenChange={setShowNewResource}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Resource</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              value={newResource.title}
              onChange={e => setNewResource(p => ({ ...p, title: e.target.value }))}
              placeholder="Resource title..."
              autoFocus
            />
            <Select value={newResource.resource_type} onValueChange={v => setNewResource(p => ({ ...p, resource_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESOURCE_TYPE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is-template"
                checked={newResource.is_template}
                onChange={e => setNewResource(p => ({ ...p, is_template: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="is-template" className="text-xs text-muted-foreground">Save as reusable template</label>
            </div>
            {newResource.is_template && (
              <Select value={newResource.template_category} onValueChange={v => setNewResource(p => ({ ...p, template_category: v }))}>
                <SelectTrigger><SelectValue placeholder="Template category..." /></SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowNewResource(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreateResource}>Create & Edit</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add URLs Dialog */}
      <Dialog open={showAddUrl} onOpenChange={setShowAddUrl}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Links / URLs</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder={"https://docs.google.com/...\nhttps://loom.com/...\nhttps://zoom.us/..."}
              rows={5}
              autoFocus
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Paste one URL per line. Google Drive, Notion, Thinkific, Loom, or any external resource.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAddUrl(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAddUrls} disabled={!urlInput.trim()}>
                <Sparkles className="h-3.5 w-3.5 mr-1" /> Classify All
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Folder Dialog */}
      <Dialog open={!!renamingFolder} onOpenChange={open => !open && setRenamingFolder(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename Folder</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              value={renameFolderName}
              onChange={e => setRenameFolderName(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleRenameFolder()}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRenamingFolder(null)}>Cancel</Button>
              <Button size="sm" onClick={handleRenameFolder}>Rename</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Discover Dialog */}
      <Dialog open={showDiscover} onOpenChange={setShowDiscover}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Radar className="h-5 w-5 text-primary" /> AI Resource Discovery</DialogTitle></DialogHeader>
          <Tabs defaultValue="resources">
            <TabsList className="w-full">
              <TabsTrigger value="resources" className="flex-1 text-xs"><Globe className="h-3.5 w-3.5 mr-1" /> Find Resources</TabsTrigger>
              <TabsTrigger value="competitor" className="flex-1 text-xs"><Shield className="h-3.5 w-3.5 mr-1" /> Competitor Intel</TabsTrigger>
            </TabsList>

            <TabsContent value="resources" className="space-y-3 mt-3">
              <Textarea
                value={discoverQuery}
                onChange={e => setDiscoverQuery(e.target.value)}
                placeholder={"e.g. Top 1% MEDDICC training resources, podcasts, and books for enterprise SaaS sales\n\nBest cold calling frameworks and YouTube channels for outbound B2B\n\nElite negotiation techniques and courses for complex deal cycles"}
                rows={4}
                className="text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Describe what you're looking for. AI will search the web for the best books, podcasts, videos, frameworks, and articles.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowDiscover(false)}>Cancel</Button>
                <Button size="sm" onClick={handleDiscoverResources} disabled={discoverLoading || !discoverQuery.trim()}>
                  {discoverLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Radar className="h-3.5 w-3.5 mr-1" />}
                  {discoverLoading ? 'Searching...' : 'Discover'}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="competitor" className="space-y-3 mt-3">
              <div className="space-y-2">
                <Input
                  value={competitorName}
                  onChange={e => setCompetitorName(e.target.value)}
                  placeholder="Competitor name (e.g. Klaviyo)"
                  className="text-sm"
                />
                <Input
                  value={competitorUrl}
                  onChange={e => setCompetitorUrl(e.target.value)}
                  placeholder="Website URL (e.g. https://klaviyo.com)"
                  className="text-sm"
                />
                <Textarea
                  value={competitorContext}
                  onChange={e => setCompetitorContext(e.target.value)}
                  placeholder="Optional context: What do you sell? What does your prospect use this competitor for?"
                  rows={3}
                  className="text-sm"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                AI will deep-scrape the competitor's website (product, pricing, help docs) and build a comprehensive battlecard with strengths, weaknesses, and how to pitch against them.
              </p>
              {battlecardLoading && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>{battlecardProgress || 'Building battlecard...'}</span>
                  </div>
                  <Progress value={undefined} className="h-1.5" />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowDiscover(false)}>Cancel</Button>
                <Button size="sm" onClick={handleBuildBattlecard} disabled={battlecardLoading || !competitorName.trim() || !competitorUrl.trim()}>
                  {battlecardLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Shield className="h-3.5 w-3.5 mr-1" />}
                  {battlecardLoading ? 'Scraping & Analyzing...' : 'Build Battlecard'}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Reorganize Modal */}
      <ReorganizeModal open={showReorganize} onOpenChange={setShowReorganize} />
      <DuplicateResourcesModal open={showDuplicates} onOpenChange={setShowDuplicates} />
    </div>
  );
}

async function extractTextPreview(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (['txt', 'md', 'csv', 'json', 'xml', 'html'].includes(ext || '')) {
    const text = await file.text();
    return text.slice(0, 3000);
  }
  return '';
}
