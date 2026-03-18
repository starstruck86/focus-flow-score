import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useResourceVersions, useUpdateResource, type ResourceVersion } from '@/hooks/useResources';
import { toast } from 'sonner';

interface VersionHistoryProps {
  resourceId: string;
  onBack: () => void;
  onRestoreVersion: (content: string) => void;
}

export function VersionHistory({ resourceId, onBack, onRestoreVersion }: VersionHistoryProps) {
  const { data: versions = [], isLoading } = useResourceVersions(resourceId);
  const updateResource = useUpdateResource();

  const handleRestore = (version: ResourceVersion) => {
    updateResource.mutate({
      id: resourceId,
      updates: { title: version.title, content: version.content || '' },
      createVersion: { change_summary: `Restored from v${version.version_number}` },
    });
    toast.success(`Restored to version ${version.version_number}`);
    onRestoreVersion(version.content || '');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h3 className="text-sm font-semibold text-foreground">Version History</h3>
        <Badge variant="secondary" className="text-[10px]">{versions.length} versions</Badge>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground py-8 text-center">Loading versions...</p>
      ) : versions.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center">No version history yet</p>
      ) : (
        <div className="space-y-2">
          {versions.map((version, i) => (
            <div
              key={version.id}
              className="group flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card/50 hover:bg-card transition-colors"
            >
              <div className="flex flex-col items-center gap-1 pt-0.5">
                <Badge variant={i === 0 ? 'default' : 'outline'} className="text-[10px] w-8 justify-center">
                  v{version.version_number}
                </Badge>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{version.title}</p>
                {version.change_summary && (
                  <p className="text-xs text-muted-foreground mt-0.5">{version.change_summary}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {new Date(version.created_at).toLocaleString()}
                </p>
                {version.content && (
                  <pre className="text-[11px] text-muted-foreground mt-2 whitespace-pre-wrap line-clamp-3 font-sans">
                    {version.content}
                  </pre>
                )}
              </div>
              {i > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={() => handleRestore(version)}
                >
                  <RotateCcw className="h-3 w-3 mr-1" /> Restore
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
