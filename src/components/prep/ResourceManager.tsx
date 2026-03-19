import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Folder, FolderPlus, FilePlus, FileText, Presentation, Mail, BookOpen,
  ChevronRight, MoreHorizontal, Search, Trash2, Edit3, Clock,
  Star, Tag, Copy, Upload, Link2, Sparkles, Target, Shield,
  GraduationCap, MessageSquare, Loader2, Check, X, AlertTriangle,
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

  // Upload/URL states
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [classifying, setClassifying] = useState(false);
  const [pendingClassification, setPendingClassification] = useState<{
    classification: ClassificationResult;
    source: 'file' | 'url';
    file?: File;
    url?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: folders = [] } = useResourceFolders();
  const { data: resources = [] } = useResources(currentFolderId === null ? undefined : currentFolderId);
  const createFolder = useCreateFolder();
  const createResource = useCreateResource();
  const deleteResource = useDeleteResource();
  const deleteFolder = useDeleteFolder();
  const renameFolder = useRenameFolder();
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

  // File upload handler
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error('File must be under 20MB');
      return;
    }
    setClassifying(true);
    try {
      const text = await extractTextPreview(file);
      const classification = await classify.mutateAsync({
        text,
        filename: file.name,
      });
      setPendingClassification({ classification, source: 'file', file });
    } catch {
      toast.error('Classification failed — please try again');
    } finally {
      setClassifying(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // URL handler
  const handleAddUrl = async () => {
    if (!urlInput.trim()) return;
    setClassifying(true);
    setShowAddUrl(false);
    try {
      const classification = await classify.mutateAsync({ url: urlInput.trim() });
      setPendingClassification({ classification, source: 'url', url: urlInput.trim() });
      setUrlInput('');
    } catch {
      toast.error('Classification failed — please try again');
    } finally {
      setClassifying(false);
    }
  };

  // Confirm classification
  const handleConfirmClassification = async () => {
    if (!pendingClassification) return;
    const { classification, source, file, url } = pendingClassification;
    try {
      if (source === 'file' && file) {
        await uploadResource.mutateAsync({ file, classification, folderId: currentFolderId });
      } else if (source === 'url' && url) {
        await addUrlResource.mutateAsync({ url, classification, folderId: currentFolderId });
      }
    } finally {
      setPendingClassification(null);
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
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowNewFolder(true)}>
          <FolderPlus className="h-3.5 w-3.5 mr-1" /> Folder
        </Button>

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

      {/* Classifying indicator */}
      {classifying && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-foreground">AI is classifying your content...</span>
        </div>
      )}

      {/* Classification confirmation */}
      {pendingClassification && (
        <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">AI Classification</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16">Title:</span>
              <span className="text-sm font-medium">{pendingClassification.classification.title}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16">Type:</span>
              <Badge variant="secondary" className="text-xs capitalize">{pendingClassification.classification.resource_type}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16">Folder:</span>
              <Badge variant="outline" className="text-xs">{pendingClassification.classification.suggested_folder}</Badge>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground w-16">Tags:</span>
              {pendingClassification.classification.tags.map(t => (
                <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
              ))}
            </div>
            {pendingClassification.classification.description && (
              <p className="text-xs text-muted-foreground">{pendingClassification.classification.description}</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPendingClassification(null)}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmClassification}
              disabled={uploadResource.isPending || addUrlResource.isPending}>
              {(uploadResource.isPending || addUrlResource.isPending) ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 mr-1" />
              )}
              Confirm & Save
            </Button>
          </div>
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
                    <span className="text-sm font-medium text-foreground truncate">{resource.title}</span>
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

      {/* Add URL Dialog */}
      <Dialog open={showAddUrl} onOpenChange={setShowAddUrl}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Link / URL</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="https://docs.google.com/... or any URL"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
            />
            <p className="text-[10px] text-muted-foreground">
              Google Drive, Notion, Thinkific, or any external resource
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAddUrl(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAddUrl} disabled={!urlInput.trim()}>
                <Sparkles className="h-3.5 w-3.5 mr-1" /> Classify & Add
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
