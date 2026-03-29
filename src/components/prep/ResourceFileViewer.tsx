import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, ExternalLink, Download, FileText, BookOpen, Target, Shield,
  GraduationCap, MessageSquare, Presentation, Mail, Edit3, Tag, Archive, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Resource } from '@/hooks/useResources';
import { useResourceFileUrl } from '@/hooks/useResourceUpload';
import ReactMarkdown from 'react-markdown';

const TYPE_ICONS: Record<string, React.ElementType> = {
  document: FileText,
  playbook: BookOpen,
  framework: Target,
  battlecard: Shield,
  training: GraduationCap,
  transcript: MessageSquare,
  presentation: Presentation,
  email: Mail,
  template: BookOpen,
  prep: FileText,
};

const TYPE_COLORS: Record<string, string> = {
  playbook: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  framework: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  battlecard: 'bg-red-500/10 text-red-500 border-red-500/20',
  training: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  transcript: 'bg-green-500/10 text-green-500 border-green-500/20',
  template: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
};

interface Props {
  resource: Resource;
  onBack: () => void;
  onEdit: () => void;
}

export function ResourceFileViewer({ resource, onBack, onEdit }: Props) {
  const [fileUrl, setFileUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const getFileUrl = useResourceFileUrl();

  const isExternal = resource.file_url?.startsWith('http://') || resource.file_url?.startsWith('https://');
  const isPdf = resource.file_url?.toLowerCase().endsWith('.pdf');
  const isNotionZip = (resource as any).resolution_method === 'notion_zip_import' || (resource as any).extraction_method === 'notion_zip_import';
  const hasTextContent = resource.content && !resource.content.startsWith('[File:') && !resource.content.startsWith('[External');

  useEffect(() => {
    if (resource.file_url) {
      setLoading(true);
      getFileUrl(resource.file_url)
        .then(setFileUrl)
        .catch(() => setFileUrl(''))
        .finally(() => setLoading(false));
    }
  }, [resource.file_url]);

  const Icon = TYPE_ICONS[resource.resource_type] || FileText;
  const colorClass = TYPE_COLORS[resource.resource_type] || 'bg-muted text-muted-foreground';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-8 gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onEdit} className="h-8 gap-1">
          <Edit3 className="h-3.5 w-3.5" /> Edit
        </Button>
      </div>

      {/* Metadata */}
      <div className="p-4 rounded-lg border border-border/50 bg-card/50 space-y-3">
        <div className="flex items-start gap-3">
          <div className={cn('p-2 rounded-lg border', colorClass)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{resource.title}</h2>
            {resource.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{resource.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs capitalize">{resource.resource_type}</Badge>
          {isNotionZip && (
            <Badge className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1">
              <Archive className="h-3 w-3" /> Notion ZIP Import
            </Badge>
          )}
          {resource.is_template && <Badge variant="outline" className="text-xs">Template</Badge>}
          {resource.template_category && <Badge variant="outline" className="text-xs">{resource.template_category}</Badge>}
          {(resource as any).content_length > 0 && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {((resource as any).content_length as number).toLocaleString()} chars
            </Badge>
          )}
          {(resource as any).enrichment_status && (
            <Badge variant="outline" className="text-xs gap-1">
              <Zap className="h-3 w-3" /> {(resource as any).enrichment_status}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">v{resource.current_version}</span>
          <span className="text-[10px] text-muted-foreground">
            Updated {new Date(resource.updated_at).toLocaleDateString()}
          </span>
        </div>

        {resource.tags && resource.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Tag className="h-3 w-3 text-muted-foreground" />
            {resource.tags.map(tag => (
              <Badge key={tag} variant="outline" className="text-[10px] font-normal">{tag}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Actions for files/links */}
      {resource.file_url && (
        <div className="flex items-center gap-2">
          {isExternal ? (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" asChild>
              <a href={resource.file_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Open in New Tab
              </a>
            </Button>
          ) : fileUrl ? (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" asChild>
              <a href={fileUrl} download>
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </Button>
          ) : null}
        </div>
      )}

      {/* Content Preview */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading preview...</div>
      ) : isPdf && fileUrl ? (
        <iframe
          src={fileUrl}
          className="w-full h-[600px] rounded-lg border border-border"
          title={resource.title}
        />
      ) : hasTextContent ? (
        <div className="p-4 rounded-lg border border-border/50 bg-card/50 prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{resource.content || ''}</ReactMarkdown>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No inline preview available</p>
          <p className="text-xs mt-1">
            {isExternal ? 'Open the link to view content' : 'Download the file to view'}
          </p>
        </div>
      )}
    </div>
  );
}
