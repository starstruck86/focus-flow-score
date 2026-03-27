import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Folder, FileText, Presentation, Mail, BookOpen,
  Star, ChevronRight, ExternalLink, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCreateResource, type Resource, type ResourceFolder } from '@/hooks/useResources';
import { Input } from '@/components/ui/input';
import { format, parseISO } from 'date-fns';
import { useNavigate } from 'react-router-dom';

const TYPE_ICONS: Record<string, React.ElementType> = {
  document: FileText,
  presentation: Presentation,
  email: Mail,
  template: BookOpen,
  prep: Star,
};

interface OpportunityResourcesPanelProps {
  opportunityId: string;
  opportunityName: string;
  accountId?: string | null;
}

export function OpportunityResourcesPanel({ opportunityId, opportunityName, accountId }: OpportunityResourcesPanelProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const createResource = useCreateResource();
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');

  // Fetch resources linked to this opportunity
  const { data: oppResources = [] } = useQuery({
    queryKey: ['resources', 'opportunity', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resources')
        .select('*')
        .eq('opportunity_id', opportunityId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as Resource[];
    },
    enabled: !!user && !!opportunityId,
  });

  // Fetch account-level resources (shared across opps for same account)
  const { data: accountResources = [] } = useQuery({
    queryKey: ['resources', 'account', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resources')
        .select('*')
        .eq('account_id', accountId!)
        .is('opportunity_id', null)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as Resource[];
    },
    enabled: !!user && !!accountId,
  });

  // Fetch folders that might be linked (by naming convention)
  const { data: folders = [] } = useQuery({
    queryKey: ['resource-folders', 'opportunity', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resource_folders')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data as ResourceFolder[]).filter(f =>
        f.name.toLowerCase().includes(opportunityName.toLowerCase().split(' ')[0])
      );
    },
    enabled: !!user && !!opportunityId,
  });

  const handleQuickAdd = () => {
    if (!quickTitle.trim()) return;
    createResource.mutate({
      title: quickTitle.trim(),
      resource_type: 'document',
      folder_id: null,
    }, {
      onSuccess: (result) => {
        if (result?.id) {
          supabase.from('resources').update({ opportunity_id: opportunityId }).eq('id', result.id).then();
        }
        setQuickTitle('');
        setShowQuickAdd(false);
      },
    });
  };

  const formatDate = (d: string) => {
    try { return format(parseISO(d), 'M/d'); } catch { return ''; }
  };

  const renderResourceRow = (resource: Resource) => {
    const Icon = TYPE_ICONS[resource.resource_type] || FileText;
    return (
      <button
        key={resource.id}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md hover:bg-muted transition-colors group/res"
        onClick={() => navigate('/prep')}
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs truncate flex-1">{resource.title}</span>
        {resource.is_template && (
          <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
            Template
          </Badge>
        )}
        <span className="text-[10px] text-muted-foreground shrink-0">
          v{resource.current_version || 1}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {formatDate(resource.updated_at)}
        </span>
      </button>
    );
  };

  const totalCount = oppResources.length + accountResources.length;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground">Resources</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
            {totalCount}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-1 px-2"
            onClick={() => setShowQuickAdd(!showQuickAdd)}
          >
            <Plus className="h-3 w-3" /> New
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-1 px-2"
            onClick={() => navigate('/prep')}
          >
            <ExternalLink className="h-3 w-3" /> Sales Brain
          </Button>
        </div>
      </div>

      {/* Quick add inline */}
      {showQuickAdd && (
        <div className="flex items-center gap-2">
          <Input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="Resource name..."
            className="h-7 text-xs"
            onKeyDown={(e) => e.key === 'Enter' && handleQuickAdd()}
            autoFocus
          />
          <Button size="sm" className="h-7 text-xs px-3" onClick={handleQuickAdd}>
            Add
          </Button>
        </div>
      )}

      {/* Linked folders */}
      {folders.length > 0 && (
        <div className="space-y-1">
          {folders.map(folder => (
            <button
              key={folder.id}
              className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md hover:bg-muted transition-colors"
              onClick={() => navigate('/prep')}
            >
              <Folder className="h-3.5 w-3.5 text-primary/70" />
              <span className="text-xs font-medium truncate">{folder.name}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto" />
            </button>
          ))}
        </div>
      )}

      {/* Opportunity-specific resources */}
      {oppResources.length > 0 && (
        <div className="space-y-0.5">
          {accountResources.length > 0 && (
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pt-1">
              This Opportunity
            </p>
          )}
          {oppResources.map(renderResourceRow)}
        </div>
      )}

      {/* Account-level resources (grouped separately) */}
      {accountResources.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pt-1">
            Account Shared
          </p>
          {accountResources.map(renderResourceRow)}
        </div>
      )}

      {totalCount === 0 && !showQuickAdd && folders.length === 0 && (
        <p className="text-[11px] text-muted-foreground text-center py-2">
          No resources linked yet. Click <strong>New</strong> to create one.
        </p>
      )}
    </div>
  );
}
