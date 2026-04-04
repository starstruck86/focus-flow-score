import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useResourceJobProgress } from '@/store/useResourceJobProgress';
import { supabase } from '@/integrations/supabase/client';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { recomputeFixAllDerived } from '@/lib/fixAllProgress';
import { resolveResourceWithManualInput, getRecoveryInvalidationKeys } from '@/lib/manualRecoveryResolver';
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
import { Zap, RefreshCw, RotateCcw,
  Folder, FolderPlus, FilePlus, FileText, Presentation, Mail, BookOpen,
  ChevronRight, MoreHorizontal, Search, Trash2, Edit3, Clock,
  Star, Tag, Copy, Upload, Link2, Sparkles, Target, Shield,
  GraduationCap, MessageSquare, Loader2, Check, X, AlertTriangle, Globe, Radar, ListVideo, Podcast,
} from 'lucide-react';
import { ResourceLibraryTable } from './ResourceLibraryTable';
import { LibraryResourceDrawer } from './LibraryResourceDrawer';
import { ResourceAudioInspector } from './ResourceAudioInspector';
import { ManualTranscriptAssist } from './ManualTranscriptAssist';
import { cn } from '@/lib/utils';
import {
  useResourceFolders, useResources, useCreateFolder, useCreateResource,
  useDeleteResource, useBulkDeleteResources, useDeleteFolder, useRenameFolder, useUpdateResource,
  useOperationalizeResource, useResourceSuggestions, useUpdateEnrichmentStatus,
  type Resource, type ResourceFolder, type ResourceSuggestion,
} from '@/hooks/useResources';
import {
  getEnrichmentStatusLabel, getEnrichmentStatusColor, getRecommendedAction,
  getResourceOrigin, type EnrichmentStatus,
} from '@/lib/resourceEligibility';
import { useClassifyResource, useUploadResource, useAddUrlResource, type ClassificationResult } from '@/hooks/useResourceUpload';
import { ResourceEditor } from './ResourceEditor';
import { AIGenerateDialog } from './AIGenerateDialog';
import { ResourceFileViewer } from './ResourceFileViewer';
import { VersionHistory } from './VersionHistory';
import { ReorganizeModal } from './ReorganizeModal';
import { DuplicateResourcesModal } from './DuplicateResourcesModal';
import { PlaylistImportModal } from './PlaylistImportModal';
import { PodcastImportModal } from './PodcastImportModal';
import { WebpageImportModal } from './WebpageImportModal';
import { CourseImportModal } from './CourseImportModal';
import { DeepEnrichModal } from './DeepEnrichModal';
import { EnrichmentJobIndicator } from './EnrichmentJobIndicator';
import { useResourceDuplicates } from '@/hooks/useResourceDuplicates';
import { useConsolidateFolders } from '@/hooks/useConsolidateFolders';
import { ResourceIntelligenceDashboard } from './ResourceIntelligenceDashboard';
import { useAudioJobsMap } from '@/hooks/useAudioJobs';
import { isAudioResource } from '@/lib/salesBrain/audioPipeline';
import { processAudioResource, retryPlatformResolution, retryAudioJob } from '@/lib/salesBrain/audioOrchestrator';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { useCanonicalLifecycle } from '@/hooks/useCanonicalLifecycle';
import { AppFreshnessBar } from './AppFreshnessBar';
import { useAppFreshness } from '@/hooks/useAppFreshness';

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

const ACCEPTED_FILE_TYPES = '.zip,.pdf,.docx,.pptx,.txt,.md,.csv,.doc,.xlsx,.xls';

export function ResourceManager() {
  const { user } = useAuth();
  useConsolidateFolders();
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

  // Playlist import
  const [showPlaylistImport, setShowPlaylistImport] = useState(false);
  const [showPodcastImport, setShowPodcastImport] = useState(false);
  const [showWebpageImport, setShowWebpageImport] = useState(false);
  const [showCourseImport, setShowCourseImport] = useState(false);

  // AI Discover states
  const [showDiscover, setShowDiscover] = useState(false);
  const [discoverQuery, setDiscoverQuery] = useState('');
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [competitorName, setCompetitorName] = useState('');
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [competitorContext, setCompetitorContext] = useState('');
  const [battlecardLoading, setBattlecardLoading] = useState(false);
  const [battlecardProgress, setBattlecardProgress] = useState('');
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set());
  const [showDeepEnrich, setShowDeepEnrich] = useState(false);
  const [inspectingAudioResource, setInspectingAudioResource] = useState<Resource | null>(null);
  const [manualAssistResource, setManualAssistResource] = useState<Resource | null>(null);
  const [drawerResource, setDrawerResource] = useState<Resource | null>(null);
  const [lastFixResult, setLastFixResult] = useState<import('@/lib/fixAllAutoBlockers').FixAllResult | null>(null);
  const [isFixAllRunning, setIsFixAllRunning] = useState(false);
  const [fixAllLiveProgress, setFixAllLiveProgress] = useState<import('@/lib/fixAllProgress').FixAllLiveProgress | null>(null);


  // AI Generate / Transform states
  const [showAIGenerate, setShowAIGenerate] = useState(false);
  const [generateSourceId, setGenerateSourceId] = useState<string | null>(null);
  const [generateInitialType, setGenerateInitialType] = useState<string | undefined>();
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());

  const { data: folders = [] } = useResourceFolders();
  const { data: resources = [] } = useResources(currentFolderId === null ? undefined : currentFolderId);
  const createFolder = useCreateFolder();
  const createResource = useCreateResource();
  const deleteResource = useDeleteResource();
  const bulkDelete = useBulkDeleteResources();
  const deleteFolder = useDeleteFolder();
  const renameFolder = useRenameFolder();
  const updateResource = useUpdateResource();
  const classify = useClassifyResource();
  const uploadResource = useUploadResource();
  const addUrlResource = useAddUrlResource();
  const { totalDuplicates } = useResourceDuplicates();
  const operationalize = useOperationalizeResource();
  const updateEnrichmentStatus = useUpdateEnrichmentStatus();
  const { data: suggestions = [], refetch: refetchSuggestions, isLoading: suggestionsLoading } = useResourceSuggestions(resources.length > 0);
  const { data: audioJobsMap } = useAudioJobsMap();
  const { summary: lifecycle } = useCanonicalLifecycle();
  const queryClient = useQueryClient();
  const freshness = useAppFreshness();
  const now = () => new Date().toISOString();

  // Timer-based recompute for elapsed/eta/stalled while Fix All is running
  useEffect(() => {
    if (!isFixAllRunning) return;
    const id = window.setInterval(() => {
      setFixAllLiveProgress(prev => prev ? recomputeFixAllDerived(prev) : prev);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isFixAllRunning]);


  const lifecycleMap = useMemo(() => {
    const map = new Map<string, { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number }>();
    if (!lifecycle?.resources) return map;
    for (const item of lifecycle.resources) {
      map.set(item.resource_id, {
        stage: item.canonical_stage,
        blocked: item.blocked_reason,
        kiCount: item.knowledge_item_count,
        activeKi: item.active_ki_count,
        activeKiWithCtx: item.active_ki_with_context_count,
      });
    }
    return map;
  }, [lifecycle]);

  const currentFolders = folders.filter(f => f.parent_id === currentFolderId);
  const filteredResources = searchQuery
    ? resources.filter(r => {
        const q = searchQuery.toLowerCase();
        return r.title.toLowerCase().includes(q)
          || (r as any).author_or_speaker?.toLowerCase().includes(q)
          || (r as any).tags?.some((t: string) => t.toLowerCase().includes(q));
      })
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
      let lastZipResource: any = null;
      for (const item of readyItems) {
        if (item.source === 'file' && item.file && item.classification) {
          const result = await uploadResource.mutateAsync({ file: item.file, classification: item.classification, folderId: currentFolderId });
          if (item.file.name.toLowerCase().endsWith('.zip') && result) {
            lastZipResource = result;
          }
        } else if (item.source === 'url' && item.url && item.classification) {
          await addUrlResource.mutateAsync({ url: item.url, classification: item.classification, folderId: currentFolderId });
        }
      }
      // Auto-open the resource if a single ZIP was uploaded
      if (lastZipResource && readyItems.length === 1) {
        // Refetch to get full resource object, then open viewer
        queryClient.invalidateQueries({ queryKey: ['resources'] }).then(() => {
          setViewingResource(lastZipResource);
        });
      }
      setPendingItems(prev => prev.filter(p => p.status === 'error'));
      toast.success(`${readyItems.length} resource${readyItems.length > 1 ? 's' : ''} saved`);
    } catch (err: any) {
      console.error('[ResourceManager] Save failed:', err);
      toast.error(err?.message || 'Some items failed to save');
    } finally {
      setSavingAll(false);
    }
  };

  // AI Resource Discovery
  const handleDiscoverResources = async () => {
    if (!discoverQuery.trim()) return;
    setDiscoverLoading(true);
    try {
      const { data, error } = await trackedInvoke<any>('discover-resources', {
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
          top_folder: r.suggested_folder || r.top_folder || 'Tools & Reference',
          sub_folder: r.sub_folder,
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
      const { data, error } = await trackedInvoke<any>('discover-resources', {
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
    setDrawerResource(resource);
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
      {/* App Freshness Bar */}
      <div className="flex items-center justify-between">
        <ResourceIntelligenceDashboard />
        <AppFreshnessBar />
      </div>
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
            <DropdownMenuItem onClick={() => setShowPlaylistImport(true)}>
              <ListVideo className="h-3.5 w-3.5 mr-2" /> Import YouTube Playlist
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowPodcastImport(true)}>
              <Podcast className="h-3.5 w-3.5 mr-2" /> Import Podcast
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowWebpageImport(true)}>
              <Globe className="h-3.5 w-3.5 mr-2" /> Import from Webpage
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowCourseImport(true)}>
              <BookOpen className="h-3.5 w-3.5 mr-2" /> Import Course
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowDiscover(true)}>
          <Radar className="h-3.5 w-3.5 mr-1" /> AI Discover
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => setShowDeepEnrich(true)}
        >
          <Zap className="h-3.5 w-3.5 mr-1" />
          Deep Enrich
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

      {/* AI Suggestions Banner */}
      {suggestions.length > 0 && (
        <div className="p-3 rounded-lg border border-accent/40 bg-accent/5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-foreground">Smart Suggestions</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => refetchSuggestions()} disabled={suggestionsLoading}>
                {suggestionsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setDismissedSuggestions(new Set(suggestions.map(s => s.description)))}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {suggestions.filter(s => !dismissedSuggestions.has(s.description)).map((s, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-md border border-border/50 bg-background text-xs">
              <div className="flex-1">
                <p className="text-foreground">{s.description}</p>
                {s.deal_context && <p className="text-muted-foreground mt-0.5 text-[10px]">📊 {s.deal_context}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => {
                  setGenerateSourceId(s.source_resource_ids[0] || null);
                  setGenerateInitialType(s.target_type);
                  setShowAIGenerate(true);
                }}>
                  Create
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setDismissedSuggestions(prev => new Set([...prev, s.description]))}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

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
                        <Badge variant="outline" className="text-[9px]">{item.classification.top_folder}{item.classification.sub_folder ? ` / ${item.classification.sub_folder}` : ''}</Badge>
                        {item.source === 'file' && item.file?.name.toLowerCase().endsWith('.zip') && (
                          <Badge className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/20">ZIP Import</Badge>
                        )}
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
          {savingAll && (
            <div className="space-y-1">
              <Progress value={undefined} className="h-1.5" />
              <p className="text-[10px] text-muted-foreground text-center">Uploading and processing...</p>
            </div>
          )}
          {pendingItems.some(p => p.status === 'classified') && (
            <div className="flex justify-end">
              <Button size="sm" className="min-h-[44px] w-full sm:w-auto" onClick={handleConfirmAll} disabled={savingAll}>
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

      {/* Resource Library Table */}
      {(filteredResources.length > 0 || currentFolders.length === 0) && (
        filteredResources.length > 0 ? (
          <ResourceLibraryTable
            resources={filteredResources}
            selectedIds={selectedResourceIds}
            audioJobsMap={audioJobsMap}
            onRefresh={freshness.refreshData}
            isRefreshing={freshness.isRefreshing}
            lastFixResult={lastFixResult}
            fixAllLiveProgress={fixAllLiveProgress}
            isFixAllRunning={isFixAllRunning}
            
            onToggleSelect={(id) => setSelectedResourceIds(prev => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
            onToggleSelectAll={() => setSelectedResourceIds(prev => {
              if (prev.size === filteredResources.length) return new Set();
              return new Set(filteredResources.map(r => r.id));
            })}
            onResourceClick={handleResourceClick}
            onBulkAction={async (action, resourceIds) => {
              switch (action) {
                case 'fix_all_auto': {
                  const { createFixAllProgress, markFixAllPhase, markFixAllItemStart, markFixAllItemDone, markFixAllItemFailed, finalizeFixAllProgress, recomputeFixAllDerived } = await import('@/lib/fixAllProgress');
                  setIsFixAllRunning(true);
                  setFixAllLiveProgress(createFixAllProgress(resourceIds.length));
                  setLastFixResult(null);
                  try {
                    const { runFixAllAutoBlockers } = await import('@/lib/fixAllAutoBlockers');
                    const { deriveResourceTruth } = await import('@/lib/resourceTruthState');

                    // Build blocker groups from live truth
                    const blockerGroupMap = new Map<string, string[]>();
                    for (const id of resourceIds) {
                      const r = filteredResources.find(res => res.id === id);
                      if (!r) continue;
                      const truth = deriveResourceTruth(r, lifecycleMap.get(id), audioJobsMap?.get(id));
                      const blockerType = truth.primary_blocker?.type;
                      if (blockerType && truth.primary_blocker?.fixability !== 'manual_only') {
                        const existing = blockerGroupMap.get(blockerType) ?? [];
                        existing.push(id);
                        blockerGroupMap.set(blockerType, existing);
                      }
                    }

                    const blockerGroups = [...blockerGroupMap.entries()].map(([type, ids]) => ({
                      type: type as any,
                      resourceIds: ids,
                    }));

                    const result = await runFixAllAutoBlockers(
                      blockerGroups,
                      (msg) => {
                        setFixAllLiveProgress(prev =>
                          prev ? recomputeFixAllDerived({ ...prev, currentMessage: msg, lastProgressAt: new Date().toISOString() }) : prev
                        );
                      },
                      undefined,
                      {
                        onPhaseChange: (phase, label, message) => {
                          setFixAllLiveProgress(prev =>
                            prev ? markFixAllPhase(prev, phase, label, message) : prev
                          );
                        },
                        onItemStart: (resourceId, _phase, message) => {
                          setFixAllLiveProgress(prev =>
                            prev ? markFixAllItemStart(prev, resourceId, message) : prev
                          );
                        },
                        onItemDone: (resourceId, _phase, message) => {
                          setFixAllLiveProgress(prev =>
                            prev ? markFixAllItemDone(prev, resourceId, message) : prev
                          );
                        },
                        onItemFailed: (resourceId, _phase, message) => {
                          setFixAllLiveProgress(prev =>
                            prev ? markFixAllItemFailed(prev, resourceId, message) : prev
                          );
                        },
                      },
                    );

                    queryClient.invalidateQueries({ queryKey: ['resources'] });
                    queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });
                    queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
                    queryClient.invalidateQueries({ queryKey: ['all-resources'] });

                    setLastFixResult(result);

                    if (result.system_ready) {
                      toast.success(`All ${result.blockers_fixed} blockers resolved!`, {
                        description: 'System is now ready.',
                        duration: 8000,
                      });
                    } else {
                      toast.warning(`Fixed ${result.blockers_fixed}, ${result.blockers_after} remain`, {
                        description: result.reason,
                        duration: 8000,
                      });
                    }
                  } catch (err: any) {
                    toast.error('Auto-fix failed', { description: err?.message });
                  } finally {
                    setIsFixAllRunning(false);
                    setFixAllLiveProgress(prev => {
                      if (!prev) return prev;
                      return { ...prev, isRunning: false, running: 0, runningIds: [], currentMessage: 'Fix All complete' };
                    });
                  }
                  break;
                }
                case 'bulk_enrich': {
                  // Select these resource IDs and open the enrich modal
                  setSelectedResourceIds(new Set(resourceIds));
                  setShowDeepEnrich(true);
                  break;
                }
                case 'bulk_extract': {
                  toast.info(`Starting extraction for ${resourceIds.length} resources...`);
                  const progressStore = useResourceJobProgress.getState();
                  progressStore.startBatch(resourceIds, 'extract');
                  try {
                    const { autoOperationalizeBatch } = await import('@/lib/autoOperationalize');
                    const results = await autoOperationalizeBatch(resourceIds, undefined, async (resourceId, phase, result) => {
                      const store = useResourceJobProgress.getState();
                      if (phase === 'start') store.markRunning(resourceId, result?.resourceTitle);
                      else if (phase === 'done') {
                        if (result?.success) store.markDone(resourceId, `${result.knowledgeExtracted} KI`);
                        else store.markFailed(resourceId, result?.reason);
                      }
                    });
                    useResourceJobProgress.getState().endBatch();
                    queryClient.invalidateQueries({ queryKey: ['resources'] });
                    queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });
                    queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
                    const totalKI = results.reduce((s, r) => s + r.knowledgeExtracted, 0);
                    toast.success(`Extracted ${totalKI} KIs from ${results.filter(r => r.knowledgeExtracted > 0).length} resources`);
                  } catch (error: any) {
                    useResourceJobProgress.getState().endBatch();
                    toast.error('Batch extraction failed', { description: error?.message });
                  }
                  break;
                }
                case 'bulk_re_enrich': {
                  setSelectedResourceIds(new Set(resourceIds));
                  setShowDeepEnrich(true);
                  break;
                }
                case 'bulk_retry_stalled': {
                  toast.info(`Retrying ${resourceIds.length} stalled jobs…`);
                  try {
                    const { clearStalledJobStatus } = await import('@/lib/fixAllAutoBlockers');
                    for (const id of resourceIds) {
                      await clearStalledJobStatus(id);
                      await invokeEnrichResource(
                        { resource_id: id, force: true },
                        { componentName: 'ResourceManager' },
                      );
                    }
                    queryClient.invalidateQueries({ queryKey: ['resources'] });
                    queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
                    toast.success(`Retried ${resourceIds.length} stalled jobs`);
                  } catch (err: any) {
                    toast.error('Stalled retry failed', { description: err?.message });
                  }
                  break;
                }
                case 'bulk_activate': {
                  toast.info(`Activating ${resourceIds.length} resources…`);
                  try {
                    const { autoOperationalizeBatch } = await import('@/lib/autoOperationalize');
                    const progressStore = useResourceJobProgress.getState();
                    progressStore.startBatch(resourceIds, 'activate');
                    const results = await autoOperationalizeBatch(resourceIds, undefined, async (resourceId, phase, result) => {
                      const store = useResourceJobProgress.getState();
                      if (phase === 'start') store.markRunning(resourceId, result?.resourceTitle);
                      else if (phase === 'done') {
                        if (result?.success) store.markDone(resourceId, `${result.knowledgeActivated ?? 0} activated`);
                        else store.markFailed(resourceId, result?.reason);
                      }
                    });
                    useResourceJobProgress.getState().endBatch();
                    queryClient.invalidateQueries({ queryKey: ['resources'] });
                    queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });
                    queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
                    const totalActivated = results.reduce((s, r) => s + (r.knowledgeActivated ?? 0), 0);
                    toast.success(`Activated ${totalActivated} KIs across ${results.filter(r => (r.knowledgeActivated ?? 0) > 0).length} resources`);
                  } catch (err: any) {
                    useResourceJobProgress.getState().endBatch();
                    toast.error('Bulk activation failed', { description: err?.message });
                  }
                  break;
                }
              }
            }}
            onAction={async (action, resource) => {
              switch (action) {
                case 'view':
                  if (resource.file_url) setViewingResource(resource);
                  else setEditingResource(resource);
                  break;
                case 'extract': {
                  // Run extraction pipeline (knowledge extraction from content-backed resources)
                  toast.loading('Extracting knowledge...', { id: 'extract-single' });
                  try {
                    await supabase.from('resources' as any).update({
                      active_job_type: 'extract',
                      active_job_status: 'running',
                      active_job_started_at: now(),
                      active_job_updated_at: now(),
                      active_job_finished_at: null,
                      active_job_result_summary: null,
                      active_job_error: null,
                    } as any).eq('id', resource.id);

                    const { autoOperationalizeResource } = await import('@/lib/autoOperationalize');
                    const result = await autoOperationalizeResource(resource.id);

                    await supabase.from('resources' as any).update({
                      active_job_type: 'extract',
                      active_job_status: 'succeeded',
                      active_job_updated_at: now(),
                      active_job_finished_at: now(),
                      active_job_result_summary: `${result.knowledgeExtracted} KI extracted`,
                      active_job_error: null,
                    } as any).eq('id', resource.id);

                    toast.dismiss('extract-single');
                    queryClient.invalidateQueries({ queryKey: ['resources'] });
                    queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });
                    queryClient.invalidateQueries({ queryKey: ['all-resources'] });
                    queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
                    console.log('[Extract] Result:', {
                      resourceId: resource.id,
                      title: resource.title,
                      outcome: result.outcome,
                      knowledgeExtracted: result.knowledgeExtracted,
                      knowledgeActivated: result.knowledgeActivated,
                      operationalized: result.operationalized,
                      stagesCompleted: result.stagesCompleted,
                    });
                    if (result.operationalized || result.knowledgeExtracted > 0) {
                      toast.success(`Extracted ${result.knowledgeExtracted} knowledge items`, {
                        description: `${result.knowledgeActivated} auto-activated · Stage: ${result.currentStage}`,
                        duration: 6000,
                      });
                    } else {
                      toast.info(result.reason || 'No knowledge items extracted', {
                        description: `Stage reached: ${result.currentStage}`,
                      });
                    }
                  } catch (error: any) {
                    await supabase.from('resources' as any).update({
                      active_job_type: 'extract',
                      active_job_status: 'failed',
                      active_job_updated_at: now(),
                      active_job_finished_at: now(),
                      active_job_result_summary: null,
                      active_job_error: error?.message ?? 'Extraction failed',
                    } as any).eq('id', resource.id);

                    toast.dismiss('extract-single');
                    console.error('[Extract] Failed:', error);
                    toast.error('Extraction failed', { description: error?.message });
                  }
                  break;
                }
                case 'activate':
                case 'repair_contexts': {
                  const toastId = action === 'activate' ? 'activate-single' : 'repair-contexts-single';
                  toast.loading(action === 'activate' ? 'Activating knowledge…' : 'Repairing contexts…', { id: toastId });
                  try {
                    await supabase.from('resources' as any).update({
                      active_job_type: 'extract',
                      active_job_status: 'running',
                      active_job_started_at: now(),
                      active_job_updated_at: now(),
                      active_job_finished_at: null,
                      active_job_result_summary: null,
                      active_job_error: null,
                    } as any).eq('id', resource.id);

                    const { autoOperationalizeResource } = await import('@/lib/autoOperationalize');
                    const result = await autoOperationalizeResource(resource.id);

                    await supabase.from('resources' as any).update({
                      active_job_type: 'extract',
                      active_job_status: 'succeeded',
                      active_job_updated_at: now(),
                      active_job_finished_at: now(),
                      active_job_result_summary: `${result.knowledgeActivated} KI activated`,
                      active_job_error: null,
                    } as any).eq('id', resource.id);

                    toast.dismiss(toastId);
                    queryClient.invalidateQueries({ queryKey: ['resources'] });
                    queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });
                    queryClient.invalidateQueries({ queryKey: ['all-resources'] });
                    queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
                    if (result.operationalized) toast.success('Resource is now complete');
                    else toast.success(action === 'activate' ? 'Activation finished' : 'Context repair finished');
                  } catch (error: any) {
                    await supabase.from('resources' as any).update({
                      active_job_type: 'extract',
                      active_job_status: 'failed',
                      active_job_updated_at: now(),
                      active_job_finished_at: now(),
                      active_job_result_summary: null,
                      active_job_error: error?.message ?? 'Operationalization failed',
                    } as any).eq('id', resource.id);

                    toast.dismiss(toastId);
                    toast.error(action === 'activate' ? 'Activation failed' : 'Context repair failed', { description: error?.message });
                  }
                  break;
                }
                case 'reparse_file': {
                  // Re-parse uploaded file via dedicated server-side pipeline
                  const origin = getResourceOrigin(resource);
                  if (origin !== 'uploaded_file') {
                    toast.error('This resource is not an uploaded file');
                    break;
                  }
                  const parseToastId = toast.loading('Parsing uploaded file…');
                  try {
                    const { parseUploadedFile } = await import('@/hooks/useResourceUpload');
                    const result = await parseUploadedFile(resource.id);
                    
                    if (result.success) {
                      toast.success(
                        `Parsed successfully: ${result.content_length?.toLocaleString()} chars extracted`,
                        { id: parseToastId, description: `Parser: ${result.parser_used || 'auto'}` }
                      );
                      queryClient.invalidateQueries({ queryKey: ['resources'] });
                      queryClient.invalidateQueries({ queryKey: ['all-resources'] });
                      queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });
                      queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
                    } else {
                      const reason = result.diagnostics?.result as string || 'unknown';
                      const reasonLabels: Record<string, string> = {
                        unsupported_type: 'Unsupported file type',
                        file_missing_from_storage: 'File missing from storage',
                        quality_gate_failed: 'Could not extract meaningful text',
                      };
                      toast.error(reasonLabels[reason] || 'Parse failed', {
                        id: parseToastId,
                        description: result.error || `Diagnostics: ${reason}`,
                      });
                      queryClient.invalidateQueries({ queryKey: ['resources'] });
                    }
                  } catch (error: any) {
                    toast.error('File parse failed', { id: parseToastId, description: error?.message });
                  }
                  break;
                }
                case 'deep_enrich':
                case 're_enrich': {
                  // Route audio resources through the audio orchestrator
                  if (isAudioResource(resource.file_url, resource.resource_type) && resource.file_url) {
                    toast.info('Processing audio resource...');
                    try {
                      const result = await processAudioResource(resource.id, resource.file_url);
                      queryClient.invalidateQueries({ queryKey: ['audio-jobs-map'] });
                      if ('transcript' in result && result.success) {
                        toast.success(`Audio transcribed (${result.totalWords} words)`);
                      } else if ('finalStatus' in result) {
                        if (result.finalStatus === 'metadata_only') {
                          toast.info('Metadata captured — no direct audio available', { description: 'Use Manual Assist to paste transcript' });
                        } else if (result.finalStatus === 'needs_manual_assist') {
                          toast.info('Manual assist needed', { description: result.failureReason || 'Open Manual Assist to provide transcript' });
                        } else if (result.finalStatus === 'completed') {
                          toast.success('Audio processing complete');
                        } else {
                          toast.error(result.failureReason || 'Audio processing failed');
                        }
                      }
                    } catch (error: any) {
                      toast.error('Audio processing failed', { description: error?.message });
                    }
                    break;
                  }
                  // Standard enrichment for non-audio
                  {
                    const isReEnrich = action === 're_enrich';
                    const queuedStatus = isReEnrich ? 'queued_for_reenrich' : 'queued_for_deep_enrich';

                    // Optimistic UI: immediately set queued status so table/queue updates
                    updateEnrichmentStatus.mutate(
                      { id: resource.id, enrichment_status: queuedStatus, failure_reason: null },
                      { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resources'] }) },
                    );
                    toast.info(isReEnrich ? 'Re-enriching...' : 'Enriching...');

                    try {
                      const result = await invokeEnrichResource<any>(
                        { resource_id: resource.id, force: isReEnrich },
                        { componentName: 'ResourceManager' },
                      );

                      // Always invalidate after edge function completes
                      queryClient.invalidateQueries({ queryKey: ['resources'] });
                      queryClient.invalidateQueries({ queryKey: ['incoming-queue'] });
                      queryClient.invalidateQueries({ queryKey: ['all-resources'] });
                      queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });

                      if (result.error) {
                        console.error('[Enrich] Edge function error:', result.error);
                        toast.error(result.error.message, { description: result.error.recoveryHint });
                        break;
                      }
                      if (result.data?.final_status === 'enriched') toast.success('Content enriched');
                      else if (result.data?.final_status === 'partial') toast.info('Partially enriched', { description: result.data?.recovery_hint || result.data?.failure_reason });
                      else toast.info(result.data?.failure_reason || 'Enrichment rerouted');
                    } catch (error: any) {
                      console.error('[Enrich] Unexpected error:', error);
                      queryClient.invalidateQueries({ queryKey: ['resources'] });
                      toast.error('Enrichment failed', { description: error?.message });
                    }
                  }
                  break;
                }
                case 'retry':
                  updateEnrichmentStatus.mutate({ id: resource.id, enrichment_status: 'not_enriched', failure_reason: null });
                  toast.success('Reset for retry');
                  break;
                case 'reset':
                  updateEnrichmentStatus.mutate({ id: resource.id, enrichment_status: 'not_enriched', failure_reason: null });
                  toast.success('Status reset');
                  break;
                case 'mark_duplicate':
                  updateEnrichmentStatus.mutate({ id: resource.id, enrichment_status: 'duplicate' });
                  toast.success('Marked as duplicate');
                  break;
                case 'delete':
                  if (!confirm('Delete this resource? This cannot be undone.')) break;
                  deleteResource.mutate(resource.id);
                  break;
                case 'bulk_delete': {
                  const ids = Array.from(selectedResourceIds);
                  if (ids.length === 0) break;
                  if (!confirm(`Delete ${ids.length} resources? This cannot be undone.`)) break;
                  bulkDelete.mutate(ids, {
                    onSuccess: () => setSelectedResourceIds(new Set()),
                  });
                  break;
                }
                case 'bulk_enrich':
                  setShowDeepEnrich(true);
                  break;
                case 'bulk_autoOp':
                case 'bulk_autoOp_filtered': {
                  const ids = filteredResources
                    .filter((r) => selectedResourceIds.has(r.id))
                    .map((r) => r.id);
                  if (ids.length === 0) {
                    toast.info('No resources selected');
                    break;
                  }
                  const progressStore = useResourceJobProgress.getState();
                  progressStore.startBatch(ids, 'extract');
                  try {
                    const { autoOperationalizeBatch } = await import('@/lib/autoOperationalize');
                    const now = () => new Date().toISOString();
                    const results = await autoOperationalizeBatch(ids, undefined, async (resourceId, phase, result) => {
                      const store = useResourceJobProgress.getState();
                      if (phase === 'start') {
                        store.markRunning(resourceId, result?.resourceTitle);
                        // Persist durable generic job status
                        supabase.from('resources' as any).update({
                          active_job_type: 'extract',
                          active_job_status: 'running',
                          active_job_started_at: now(),
                          active_job_updated_at: now(),
                          active_job_finished_at: null,
                          active_job_result_summary: null,
                          active_job_error: null,
                        } as any).eq('id', resourceId).then(() => {});
                      } else if (phase === 'done') {
                        const succeeded = result && result.success;
                        if (succeeded) {
                          store.markDone(resourceId, `${result.knowledgeExtracted} KI`);
                        } else {
                          store.markFailed(resourceId, result?.reason);
                        }
                        // Persist durable outcome
                        supabase.from('resources' as any).update({
                          active_job_status: succeeded ? 'succeeded' : 'failed',
                          active_job_updated_at: now(),
                          active_job_finished_at: now(),
                          active_job_result_summary: succeeded ? `${result!.knowledgeExtracted} KI extracted` : null,
                          active_job_error: succeeded ? null : (result?.reason ?? 'Unknown error'),
                        } as any).eq('id', resourceId).then(() => {});
                      }
                    });
                    useResourceJobProgress.getState().endBatch();
                    queryClient.invalidateQueries({ queryKey: ['resources'] });
                    queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });
                    queryClient.invalidateQueries({ queryKey: ['all-resources'] });
                    queryClient.invalidateQueries({ queryKey: ['incoming-queue'] });

                    const succeeded = results.filter(r => r.knowledgeExtracted > 0 || r.operationalized);
                    const totalKI = results.reduce((s, r) => s + r.knowledgeExtracted, 0);
                    const totalActivated = results.reduce((s, r) => s + r.knowledgeActivated, 0);
                    const needsReview = results.filter(r => r.needsReview);

                    if (succeeded.length > 0) {
                      toast.success(`Extracted ${totalKI} knowledge items from ${succeeded.length} resources`, {
                        description: `${totalActivated} auto-activated · ${needsReview.length} need review`,
                        duration: 8000,
                      });
                    } else {
                      toast.warning('No knowledge items extracted', {
                        description: `${needsReview.length} need manual review. ${results.filter(r => r.outcome === 'no_content').length} had no content.`,
                      });
                    }
                    setSelectedResourceIds(new Set());
                  } catch (error: any) {
                    useResourceJobProgress.getState().endBatch();
                    toast.error('Batch extraction failed', { description: error?.message });
                  }
                  break;
                }
                case 'bulk_fix':
                case 'bulk_fix_filtered': {
                  // Route to deep enrich for content fixes
                  setShowDeepEnrich(true);
                  break;
                }
                case 'bulk_extract': {
                  // Extract all resources that need extraction (triggered from queue)
                  // This re-routes through the same batch extraction pipeline
                  const ids = Array.from(selectedResourceIds).length > 0
                    ? Array.from(selectedResourceIds)
                    : filteredResources.filter(r => {
                        const lc = (r as any)._lifecycle;
                        return r.enrichment_status && ['deep_enriched', 'enriched', 'verified'].includes(r.enrichment_status);
                      }).map(r => r.id);
                  if (ids.length === 0) {
                    toast.info('No resources eligible for extraction');
                    break;
                  }
                  toast.info(`Starting extraction for ${ids.length} resources...`);
                  const progressStore = useResourceJobProgress.getState();
                  progressStore.startBatch(ids, 'extract');
                  try {
                    const { autoOperationalizeBatch } = await import('@/lib/autoOperationalize');
                    const results = await autoOperationalizeBatch(ids, undefined, async (resourceId, phase, result) => {
                      const store = useResourceJobProgress.getState();
                      if (phase === 'start') store.markRunning(resourceId, result?.resourceTitle);
                      else if (phase === 'done') {
                        if (result?.success) store.markDone(resourceId, `${result.knowledgeExtracted} KI`);
                        else store.markFailed(resourceId, result?.reason);
                      }
                    });
                    useResourceJobProgress.getState().endBatch();
                    queryClient.invalidateQueries({ queryKey: ['resources'] });
                    queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });
                    queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
                    const totalKI = results.reduce((s, r) => s + r.knowledgeExtracted, 0);
                    toast.success(`Extracted ${totalKI} KIs from ${results.filter(r => r.knowledgeExtracted > 0).length} resources`);
                  } catch (error: any) {
                    useResourceJobProgress.getState().endBatch();
                    toast.error('Batch extraction failed', { description: error?.message });
                  }
                  break;
                }
                case 'bulk_re_enrich': {
                  // Re-enrich resources (missing content, stale version)
                  setShowDeepEnrich(true);
                  break;
                }
                case 'bulk_retry_stalled': {
                  // Clear stalled job status and re-enrich
                  toast.info('Clearing stalled jobs and retrying...');
                  try {
                    const { clearStalledJobStatus } = await import('@/lib/fixAllAutoBlockers');
                    const cleared = await clearStalledJobStatus(resource.id);
                    if (cleared) {
                      // Trigger re-enrich after clearing
                      const enrichResult = await invokeEnrichResource(
                        { resource_id: resource.id, force: true },
                        { componentName: 'ResourceManager' },
                      );
                      queryClient.invalidateQueries({ queryKey: ['resources'] });
                      queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
                      if (enrichResult.error) toast.error('Retry failed', { description: enrichResult.error.message });
                      else toast.success('Stalled job cleared and re-enrichment started');
                    } else {
                      toast.error('Failed to clear stalled job status');
                    }
                  } catch (err: any) {
                    toast.error('Stalled retry failed', { description: err?.message });
                  }
                  break;
                }
                case 'bulk_activate':
                case 'bulk_activate_filtered': {
                  toast.info('Activating resource…');
                  try {
                    const { autoOperationalizeBatch } = await import('@/lib/autoOperationalize');
                    const results = await autoOperationalizeBatch([resource.id]);
                    queryClient.invalidateQueries({ queryKey: ['resources'] });
                    queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });
                    queryClient.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
                    const totalActivated = results.reduce((s, r) => s + (r.knowledgeActivated ?? 0), 0);
                    toast.success(`Activated ${totalActivated} KIs`);
                  } catch (err: any) {
                    toast.error('Activation failed', { description: err?.message });
                  }
                  break;
                }
                case 'bulk_tag':
                case 'bulk_tag_filtered': {
                  toast.info('Auto-tagging runs automatically during extraction');
                  break;
                }
                case 'inspect_audio':
                  setInspectingAudioResource(resource);
                  break;
                case 'manual_assist':
                  setManualAssistResource(resource);
                  break;
                case 'retry_resolve': {
                  const job = audioJobsMap?.get(resource.id);
                  if (job) {
                    toast.info('Retrying platform resolution...');
                    const result = await retryPlatformResolution(job.id);
                    queryClient.invalidateQueries({ queryKey: ['audio-jobs-map'] });
                    if (result?.finalStatus === 'audio_resolved') toast.success('Audio URL resolved!');
                    else toast.info(result?.failureReason || 'Resolution complete');
                  }
                  break;
                }
                case 'retry_transcription': {
                  const job = audioJobsMap?.get(resource.id);
                  if (job) {
                    toast.info('Retrying transcription...');
                    const result = await retryAudioJob(job.id);
                    queryClient.invalidateQueries({ queryKey: ['audio-jobs-map'] });
                    if (result.success) toast.success(`Transcribed (${result.totalWords} words)`);
                    else toast.error(result.failureReason || 'Transcription failed');
                  }
                  break;
                }
              }
            }}
          />
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No resources yet</p>
            <p className="text-xs mt-1">Create a document, upload a file, or add a link</p>
          </div>
        )
      )}

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
      <PlaylistImportModal open={showPlaylistImport} onOpenChange={setShowPlaylistImport} />
      <PodcastImportModal open={showPodcastImport} onOpenChange={setShowPodcastImport} />
      <WebpageImportModal open={showWebpageImport} onOpenChange={setShowWebpageImport} />
      <CourseImportModal open={showCourseImport} onOpenChange={setShowCourseImport} />
      <AIGenerateDialog
        open={showAIGenerate}
        onOpenChange={(open) => { setShowAIGenerate(open); if (!open) { setGenerateSourceId(null); setGenerateInitialType(undefined); } }}
        onGenerated={(markdown) => {
          createResource.mutate({
            title: 'AI Generated Resource',
            folder_id: currentFolderId,
            resource_type: generateInitialType || 'document',
            content: markdown,
          }, {
            onSuccess: (data) => setEditingResource(data as Resource),
          });
        }}
        sourceResourceId={generateSourceId}
        initialOutputType={generateInitialType}
      />

      {/* Deep Enrich modal for all unenriched resources */}
      <DeepEnrichModal
        open={showDeepEnrich}
        onOpenChange={setShowDeepEnrich}
        resources={resources}
        selectedIds={selectedResourceIds}
        audioJobsMap={audioJobsMap}
      />

      {/* Floating enrichment job indicator */}
      <EnrichmentJobIndicator onOpenModal={() => setShowDeepEnrich(true)} />

      {/* Audio Inspector Panel */}
      {inspectingAudioResource && (
        <div className="fixed bottom-4 right-4 z-50 w-[380px] max-h-[500px] shadow-xl">
          <ResourceAudioInspector
            resource={inspectingAudioResource}
            audioJob={audioJobsMap?.get(inspectingAudioResource.id) || null}
            onClose={() => setInspectingAudioResource(null)}
            onRetryResolve={async () => {
              const job = audioJobsMap?.get(inspectingAudioResource.id);
              if (job) {
                toast.info('Retrying resolution...');
                await retryPlatformResolution(job.id);
                queryClient.invalidateQueries({ queryKey: ['audio-jobs-map'] });
              }
            }}
            onRetryTranscription={async () => {
              const job = audioJobsMap?.get(inspectingAudioResource.id);
              if (job) {
                toast.info('Retrying transcription...');
                await retryAudioJob(job.id);
                queryClient.invalidateQueries({ queryKey: ['audio-jobs-map'] });
              }
            }}
            onOpenManualAssist={() => {
              setManualAssistResource(inspectingAudioResource);
            }}
          />
        </div>
      )}

      {/* Manual Transcript Assist */}
      <ManualTranscriptAssist
        open={!!manualAssistResource}
        onOpenChange={(open) => { if (!open) setManualAssistResource(null); }}
        resourceId={manualAssistResource?.id || ''}
        resourceTitle={manualAssistResource?.title || ''}
        resourceUrl={manualAssistResource?.file_url || null}
        audioJob={manualAssistResource ? (audioJobsMap?.get(manualAssistResource.id) || null) : null}
        onSubmit={async (data) => {
          if (!manualAssistResource || !user?.id) return;

          if (data.mode === 'paste_transcript' || data.mode === 'paste_notes') {
            // Use shared recovery resolver for content paste
            const result = await resolveResourceWithManualInput({
              mode: data.mode === 'paste_transcript' ? 'paste_transcript' : 'paste_content',
              resourceId: manualAssistResource.id,
              userId: user.id,
              text: data.content,
            });
            // Also update audio job if present
            const job = audioJobsMap?.get(manualAssistResource.id);
            if (job) {
              await supabase.from('audio_jobs').update({
                stage: 'completed',
                transcript_text: data.content,
                transcript_word_count: data.content.split(/\s+/).filter(Boolean).length,
                has_transcript: true,
                transcript_mode: data.mode === 'paste_transcript' ? 'direct_transcription' : 'manual_assist',
                final_resolution_status: 'completed',
                failure_code: null,
                failure_reason: null,
              }).eq('id', job.id);
            }
            for (const key of getRecoveryInvalidationKeys()) {
              queryClient.invalidateQueries({ queryKey: key });
            }
            queryClient.invalidateQueries({ queryKey: ['audio-jobs-map'] });
            toast.success(result.success ? (result.message || 'Content saved & re-enrichment started') : result.message);
          } else if (data.mode === 'provide_alt_url' || data.mode === 'provide_audio_url') {
            if (data.content) {
              toast.info('Processing provided URL...');
              const result = await processAudioResource(manualAssistResource.id, data.content);
              queryClient.invalidateQueries({ queryKey: ['audio-jobs-map'] });
              if ('success' in result && result.success) {
                toast.success('Audio processed successfully');
              } else {
                toast.info('Resolution complete — check audio inspector for details');
              }
            }
          } else if (data.mode === 'metadata_only') {
            await resolveResourceWithManualInput({
              mode: 'metadata_only',
              resourceId: manualAssistResource.id,
              userId: user.id,
            });
            const job = audioJobsMap?.get(manualAssistResource.id);
            if (job) {
              await supabase.from('audio_jobs').update({
                stage: 'metadata_only_complete',
                transcript_mode: 'metadata_only',
                final_resolution_status: 'metadata_only',
              }).eq('id', job.id);
            }
            for (const key of getRecoveryInvalidationKeys()) {
              queryClient.invalidateQueries({ queryKey: key });
            }
            queryClient.invalidateQueries({ queryKey: ['audio-jobs-map'] });
            toast.success('Marked as metadata-only');
          }
          setManualAssistResource(null);
        }}
      />

      {/* Bulk selection bar moved into ResourceLibraryTable */}

      {/* Library resource detail drawer */}
      {drawerResource && (
        <LibraryResourceDrawer
          resource={drawerResource}
          open={!!drawerResource}
          onOpenChange={(open) => { if (!open) setDrawerResource(null); }}
          onEdit={() => { setEditingResource(drawerResource); setDrawerResource(null); }}
          onResourceUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['resources'] });
            queryClient.invalidateQueries({ queryKey: ['all-resources'] });
            queryClient.invalidateQueries({ queryKey: ['resource-folders'] });
          }}
        />
      )}
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
