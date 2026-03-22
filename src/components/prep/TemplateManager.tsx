import { useState, useCallback } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Plus, Copy, Trash2, Edit3, ChevronDown, ChevronRight,
  Sparkles, Loader2, Lightbulb, X, RefreshCw, Link2,
  Mail, MessageSquare, Phone, FileText, Target, Presentation,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useTemplates, useCreateResource, useDeleteResource, useUpdateResource,
  useTemplateSuggestions, useDismissSuggestion, useConfirmSuggestion,
  type Resource, type TemplateSuggestion,
} from '@/hooks/useResources';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ResourceEditor } from './ResourceEditor';

const TEMPLATE_CATEGORIES = [
  { value: 'Follow-Up', label: 'Follow-Up', icon: Mail },
  { value: 'Cadences', label: 'Cadences', icon: RefreshCw },
  { value: 'Emails', label: 'Emails', icon: Mail },
  { value: 'Meeting Prep', label: 'Meeting Prep', icon: Target },
  { value: 'Proposals', label: 'Proposals', icon: FileText },
  { value: 'Presentations', label: 'Presentations', icon: Presentation },
  { value: 'Discovery', label: 'Discovery', icon: Target },
  { value: 'Deal Progression', label: 'Deal Progression', icon: ChevronRight },
  { value: 'Re-Engagement', label: 'Re-Engagement', icon: MessageSquare },
  { value: 'Custom', label: 'Custom', icon: FileText },
];

export function TemplateManager() {
  const { data: templates = [] } = useTemplates();
  const { data: suggestions = [] } = useTemplateSuggestions();
  const createResource = useCreateResource();
  const deleteResource = useDeleteResource();
  const updateResource = useUpdateResource();
  const dismissSuggestion = useDismissSuggestion();
  const confirmSuggestion = useConfirmSuggestion();
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', category: 'Custom', subject: '', body: '' });
  const [editingTemplate, setEditingTemplate] = useState<Resource | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(TEMPLATE_CATEGORIES.map(c => c.value)));

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Group templates by category
  const grouped = TEMPLATE_CATEGORIES.reduce((acc, cat) => {
    const items = templates.filter(t => (t.template_category || 'Custom') === cat.value);
    if (items.length > 0) acc.push({ ...cat, items });
    return acc;
  }, [] as (typeof TEMPLATE_CATEGORIES[number] & { items: Resource[] })[]);

  // Uncategorized
  const categorizedValues = new Set(TEMPLATE_CATEGORIES.map(c => c.value));
  const uncategorized = templates.filter(t => t.template_category && !categorizedValues.has(t.template_category));
  if (uncategorized.length > 0) {
    grouped.push({ value: 'Other', label: 'Other', icon: FileText, items: uncategorized });
  }

  const handleAddTemplate = useCallback(() => {
    if (!newTemplate.name || !newTemplate.body) {
      toast.error('Name and body are required');
      return;
    }
    const content = newTemplate.subject
      ? `Subject: ${newTemplate.subject}\n\n${newTemplate.body}`
      : newTemplate.body;

    createResource.mutate({
      title: newTemplate.name.trim(),
      resource_type: 'template',
      content,
      is_template: true,
      template_category: newTemplate.category,
    });
    setNewTemplate({ name: '', category: 'Custom', subject: '', body: '' });
    setShowAdd(false);
  }, [newTemplate, createResource]);

  const handleCopy = useCallback((template: Resource) => {
    navigator.clipboard.writeText(template.content || '');
    toast.success('Copied to clipboard');
  }, []);

  const handleRefreshSuggestions = async () => {
    setRefreshing(true);
    try {
      const { error } = await trackedInvoke<any>('suggest-templates');
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['template-suggestions'] });
      toast.success('Suggestions refreshed');
    } catch {
      toast.error('Failed to refresh suggestions');
    } finally {
      setRefreshing(false);
    }
  };

  if (editingTemplate) {
    return (
      <ResourceEditor
        resource={editingTemplate}
        onBack={() => setEditingTemplate(null)}
        onViewVersions={() => {}}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{templates.length} templates</p>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="ghost" className="h-7 text-xs"
            onClick={handleRefreshSuggestions}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            Suggestions
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Template
          </Button>
        </div>
      </div>

      {/* AI Suggestions */}
      {suggestions.length > 0 && (
        <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-foreground">AI Template Suggestions</span>
          </div>
          {suggestions.map(s => (
            <div key={s.id} className="flex items-start gap-2 p-2 rounded-md border border-border/50 bg-background">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{s.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant="secondary" className="text-[9px]">{s.template_category}</Badge>
                  {s.source_resource_id && (
                    <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                      <Link2 className="h-2.5 w-2.5" /> Based on resource
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  size="sm" variant="default" className="h-7 text-xs"
                  onClick={() => confirmSuggestion.mutate(s)}
                  disabled={confirmSuggestion.isPending}
                >
                  Create
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => dismissSuggestion.mutate(s.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grouped Templates */}
      <ScrollArea className="max-h-[60vh]">
        <div className="space-y-2 pr-1">
          {grouped.map(group => (
            <Collapsible
              key={group.value}
              open={expandedCategories.has(group.value)}
              onOpenChange={() => toggleCategory(group.value)}
            >
              <CollapsibleTrigger className="flex items-center gap-1.5 w-full py-1 hover:text-foreground transition-colors">
                {expandedCategories.has(group.value) ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <group.icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{group.label}</span>
                <Badge variant="secondary" className="text-[10px] ml-1">{group.items.length}</Badge>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 mt-1.5 ml-5">
                {group.items.map(template => (
                  <Card key={template.id} className="group">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditingTemplate(template)}>
                          <p className="text-sm font-medium text-foreground">{template.title}</p>
                          {template.description && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{template.description}</p>
                          )}
                          {template.content && (
                            <pre className="text-[11px] text-muted-foreground mt-1.5 whitespace-pre-wrap line-clamp-3 font-sans">
                              {template.content}
                            </pre>
                          )}
                          {template.tags && template.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {template.tags.slice(0, 4).map(v => (
                                <Badge key={v} variant="outline" className="text-[10px]">{v}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleCopy(template)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingTemplate(template)}>
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => createResource.mutate({
                              title: `${template.title} (Copy)`,
                              resource_type: 'template',
                              content: template.content || '',
                              is_template: true,
                              template_category: template.template_category || undefined,
                            })}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteResource.mutate(template.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </ScrollArea>

      {templates.length === 0 && suggestions.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No templates yet</p>
          <p className="text-xs mt-1">Create a template or click Suggestions to get AI-powered ideas</p>
        </div>
      )}

      {/* Add Template Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Template name"
              value={newTemplate.name}
              onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))}
            />
            <Select value={newTemplate.category} onValueChange={v => setNewTemplate(p => ({ ...p, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TEMPLATE_CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Subject line (optional, use {{variable}} for placeholders)"
              value={newTemplate.subject}
              onChange={e => setNewTemplate(p => ({ ...p, subject: e.target.value }))}
            />
            <Textarea
              placeholder="Template body (use {{variable}} for dynamic fields)"
              value={newTemplate.body}
              onChange={e => setNewTemplate(p => ({ ...p, body: e.target.value }))}
              className="min-h-[200px] text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Tip: Use {'{{variable_name}}'} syntax for dynamic fields.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAddTemplate}>Save Template</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
