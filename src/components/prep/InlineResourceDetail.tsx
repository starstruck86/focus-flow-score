/**
 * InlineResourceDetail — Expandable detail view rendered inline beneath a resource row.
 * Tabs: Source | Extracted Content | Knowledge
 */
import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Eye, ExternalLink, FileText, Code, Copy, Check,
  Loader2, AlertTriangle, CheckCircle2, ChevronUp, X, Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useCanonicalLifecycle } from '@/hooks/useCanonicalLifecycle';
import { deriveProcessingState } from '@/lib/processingState';
import { getResourceOrigin } from '@/lib/resourceEligibility';
import { decodeHTMLEntities } from '@/lib/stringUtils';
import type { Resource } from '@/hooks/useResources';
import type { KnowledgeItem } from '@/hooks/useKnowledgeItems';

interface Props {
  resource: Resource;
  onClose: () => void;
  onAction: (action: string, resource: Resource) => void;
}

// ── Metadata Header ────────────────────────────────────────
function MetadataHeader({ resource, onClose, onAction }: Props) {
  const qc = useQueryClient();
  const { summary } = useCanonicalLifecycle();
  const status = summary?.resources.find(r => r.resource_id === resource.id);
  const ps = deriveProcessingState(resource);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(resource.title);
  const [saving, setSaving] = useState(false);

  const displayTitle = decodeHTMLEntities(resource.title);

  const handleSaveTitle = async () => {
    if (!editTitle.trim() || editTitle.trim() === resource.title) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('resources')
        .update({ title: editTitle.trim(), updated_at: new Date().toISOString() } as any)
        .eq('id', resource.id);
      if (error) throw error;
      toast.success('Title updated');
      qc.invalidateQueries({ queryKey: ['resources'] });
      setIsEditing(false);
    } catch (err: any) {
      toast.error(`Failed to update title: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const blockedLabel = status?.blocked_reason && status.blocked_reason !== 'none'
    ? status.blocked_reason.replace(/_/g, ' ')
    : null;

  const nextAction = blockedLabel
    ? status?.blocked_reason === 'no_extraction' ? 'Run extraction'
    : status?.blocked_reason === 'no_activation' ? 'Activate KI'
    : status?.blocked_reason === 'missing_contexts' ? 'Repair contexts'
    : status?.blocked_reason === 'empty_content' ? 'Re-enrich content'
    : 'Review'
    : null;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-muted/30 border-b border-border">
      <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
        {isEditing ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              className="h-7 text-sm font-semibold max-w-[300px]"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') { setIsEditing(false); setEditTitle(resource.title); }
              }}
            />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleSaveTitle} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setIsEditing(false); setEditTitle(resource.title); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <>
            <h3 className="text-sm font-semibold text-foreground truncate max-w-[300px]">{displayTitle}</h3>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-50 hover:opacity-100" onClick={() => setIsEditing(true)} title="Edit title">
              <Pencil className="h-3 w-3" />
            </Button>
          </>
        )}
        <Badge variant="outline" className="text-[9px] shrink-0">{ps.label}</Badge>
        <Badge variant="outline" className="text-[9px] shrink-0 capitalize">{resource.resource_type}</Badge>
        {resource.updated_at && (
          <Badge variant="outline" className="text-[9px] shrink-0">
            Updated {new Date(resource.updated_at).toLocaleDateString()}
          </Badge>
        )}
        {status && status.knowledge_item_count > 0 && (
          <Badge variant="secondary" className="text-[9px] shrink-0">
            {status.active_ki_count}/{status.knowledge_item_count} KI
          </Badge>
        )}
        {blockedLabel && (
          <Badge variant="destructive" className="text-[9px] shrink-0">{blockedLabel}</Badge>
        )}
        {nextAction && (
          <span className="text-[10px] text-primary font-medium shrink-0">→ {nextAction}</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {resource.file_url && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
            <a href={resource.file_url} target="_blank" rel="noopener noreferrer" title="Open source in new tab">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} title="Collapse">
          <ChevronUp className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Source Tab ──────────────────────────────────────────────
function SourceTab({ resource }: { resource: Resource }) {
  const r = resource as any;
  const fileUrl = r.file_url;
  const isPdf = fileUrl?.toLowerCase().endsWith('.pdf');
  const isWeb = fileUrl?.startsWith('http') && !isPdf;
  const hasTranscript = !!r.content && r.content.length > 0;

  // For web URLs, show cleaned content from the resource itself
  if (isPdf && fileUrl) {
    return (
      <div className="p-4 h-[70vh] min-h-0">
        <iframe
          src={fileUrl}
          className="w-full h-full rounded-lg border border-border"
          title="PDF preview"
        />
      </div>
    );
  }

  if (isWeb) {
    return (
      <div className="p-4 space-y-3 h-[70vh] min-h-0 flex flex-col">
        <div className="flex items-center gap-2">
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate">
            {fileUrl}
          </a>
        </div>
        {hasTranscript ? (
          <ContentBlock content={r.content} label="Cleaned article content" />
        ) : (
          <EmptyState message="No cleaned content available" />
        )}
      </div>
    );
  }

  // Audio/video: show transcript
  if (hasTranscript) {
    return (
      <div className="p-4 h-[70vh] min-h-0">
        <ContentBlock content={r.content} label="Transcript" />
      </div>
    );
  }

  // Fallback: metadata
  return (
    <div className="p-4 space-y-2">
      <EmptyState message="Source preview not available" />
      <div className="text-xs text-muted-foreground space-y-1">
        <p>Type: {resource.resource_type}</p>
        {fileUrl && <p className="truncate">URL: {fileUrl}</p>}
        {r.resolution_method && <p>Resolution: {r.resolution_method.replace(/_/g, ' ')}</p>}
      </div>
      {fileUrl && (
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
          <a href={fileUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3 w-3" /> Open Source
          </a>
        </Button>
      )}
    </div>
  );
}

// ── Extracted Content Tab ──────────────────────────────────
function ExtractedContentTab({ resource }: { resource: Resource }) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const r = resource as any;

  // Lazy-load full content
  const { data: fullContent, isLoading } = useQuery({
    queryKey: ['resource-content', resource.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('resources')
        .select('content, content_length, extraction_method, resolution_method, last_quality_tier, last_quality_score, failure_reason')
        .eq('id', resource.id)
        .single();
      return data;
    },
  });

  const content = fullContent?.content ?? r.content ?? '';
  const contentLength = fullContent?.content_length ?? r.content_length ?? content.length;
  const extractionMethod = fullContent?.extraction_method ?? r.extraction_method;
  const qualityTier = fullContent?.last_quality_tier ?? r.last_quality_tier;
  const qualityScore = fullContent?.last_quality_score ?? r.last_quality_score;
  const failureReason = fullContent?.failure_reason ?? r.failure_reason;
  const hasMeaningfulContent = Math.max(contentLength, content.trim().length) >= 1000;
  const shouldShowFailureReason = Boolean(failureReason) && !hasMeaningfulContent;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error('Failed to copy'); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!content) {
    return (
      <div className="p-4">
        <EmptyState message="No extracted content" />
        {shouldShowFailureReason && (
          <div className="mt-2 flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{failureReason}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 h-[70vh] min-h-0 flex flex-col">
      {/* Stats bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[9px]">{contentLength.toLocaleString()} chars</Badge>
        <Badge variant="outline" className="text-[9px]">
          {content.split(/\s+/).filter(Boolean).length.toLocaleString()} words
        </Badge>
        {extractionMethod && (
          <Badge variant="outline" className="text-[9px]">{extractionMethod.replace(/_/g, ' ')}</Badge>
        )}
        {qualityTier && (
          <Badge variant="secondary" className="text-[9px]">{qualityTier}</Badge>
        )}
        {qualityScore != null && (
          <Badge variant="outline" className="text-[9px]">Score: {Math.round(qualityScore)}</Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2"
            onClick={() => setShowRaw(v => !v)}>
            <Code className="h-3 w-3" /> {showRaw ? 'Clean' : 'Raw'}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={handleCopy}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      {shouldShowFailureReason && (
        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded-md p-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{failureReason}</span>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0 rounded-md border border-border/60 p-3">
        <pre className={cn(
          'whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground',
          showRaw ? 'font-mono text-[11px]' : 'font-sans',
        )}>
          {content}
        </pre>
      </ScrollArea>
    </div>
  );
}

// ── Knowledge Tab ──────────────────────────────────────────
function KnowledgeTab({ resourceId }: { resourceId: string }) {
  const { user } = useAuth();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['knowledge-items-for-resource', resourceId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('knowledge_items')
        .select('id, title, tactic_summary, confidence_score, framework, who, active, chapter, status, applies_to_contexts, tags, macro_situation, micro_strategy, how_to_execute, what_this_unlocks, when_to_use, example_usage')
        .eq('source_resource_id', resourceId)
        .order('confidence_score', { ascending: false });
      if (error) throw error;
      return data as KnowledgeItem[];
    },
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-4">
        <EmptyState message="No knowledge items derived from this resource" />
      </div>
    );
  }

  return (
    <ScrollArea className="h-[70vh] min-h-0">
      <div className="p-4 space-y-2 pr-3">
        {items.map(ki => (
          <div key={ki.id} className={cn(
            'rounded-lg border p-3 space-y-2',
            ki.active ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-muted/20',
          )}>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-semibold text-foreground flex-1 min-w-0">{ki.title}</p>
              <Badge variant={ki.active ? 'default' : 'secondary'} className="text-[8px] h-4 px-1.5">
                {ki.active ? 'Active' : ki.status}
              </Badge>
              {ki.confidence_score != null && (
                <Badge variant="outline" className="text-[8px] h-4 px-1.5">
                  {Math.round(ki.confidence_score * 100)}%
                </Badge>
              )}
            </div>
            {ki.tactic_summary && (
              <p className="text-[11px] text-muted-foreground leading-relaxed border-l-2 border-primary/20 pl-2">{ki.tactic_summary}</p>
            )}
            {/* Structured play fields */}
            {ki.macro_situation && (
              <div className="text-[10px] space-y-0.5">
                <span className="font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Situation</span>
                <p className="text-muted-foreground leading-relaxed">{ki.macro_situation}</p>
              </div>
            )}
            {ki.how_to_execute && (
              <div className="text-[10px] space-y-0.5">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">How to Execute</span>
                <p className="text-muted-foreground leading-relaxed">{ki.how_to_execute}</p>
              </div>
            )}
            {ki.example_usage && (
              <div className="text-[10px] space-y-0.5">
                <span className="font-semibold text-primary uppercase tracking-wide">Example</span>
                <p className="text-muted-foreground leading-relaxed italic">{ki.example_usage}</p>
              </div>
            )}
            <div className="flex items-center gap-1.5 flex-wrap">
              {ki.framework && ki.who && (
                <Badge variant="outline" className="text-[8px] h-4 px-1">
                  {ki.framework} — {ki.who}
                </Badge>
              )}
              {ki.chapter && (
                <Badge variant="outline" className="text-[8px] h-4 px-1">{ki.chapter}</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ── Shared helpers ─────────────────────────────────────────
function ContentBlock({ content, label }: { content: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <ScrollArea className="h-full min-h-0 rounded-md border border-border/60 p-3">
        <pre className="whitespace-pre-wrap break-words text-xs font-sans leading-relaxed text-foreground">
          {content}
        </pre>
      </ScrollArea>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
      <FileText className="h-6 w-6 mb-2 opacity-40" />
      <p className="text-xs">{message}</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────
export function InlineResourceDetail({ resource, onClose, onAction }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll into view on mount
  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative z-10 isolate bg-card border-b-2 border-primary/20 animate-fade-in"
    >
      <MetadataHeader resource={resource} onClose={onClose} onAction={onAction} />
      <Tabs defaultValue="source" className="w-full">
        <div className="px-4 pt-2 border-b border-border">
          <TabsList className="h-8 bg-transparent p-0 gap-4">
            <TabsTrigger value="source" className="h-7 text-xs px-0 pb-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Source
            </TabsTrigger>
            <TabsTrigger value="extracted" className="h-7 text-xs px-0 pb-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Extracted Content
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="h-7 text-xs px-0 pb-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Knowledge
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="source" className="mt-0">
          <SourceTab resource={resource} />
        </TabsContent>
        <TabsContent value="extracted" className="mt-0">
          <ExtractedContentTab resource={resource} />
        </TabsContent>
        <TabsContent value="knowledge" className="mt-0">
          <KnowledgeTab resourceId={resource.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
