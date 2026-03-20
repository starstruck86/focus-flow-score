import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Edit3, Trash2, Play, Loader2, Copy } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CustomPrompt {
  id: string;
  title: string;
  prompt_text: string;
  content_type: string;
  variables: string[];
  created_at: string;
}

export function CustomPromptsManager() {
  const { user } = useAuth();
  const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDialog, setEditDialog] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Partial<CustomPrompt> | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPrompts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('custom_prompts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setPrompts((data as any[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadPrompts(); }, [loadPrompts]);

  const handleSave = useCallback(async () => {
    if (!user || !editingPrompt?.title || !editingPrompt?.prompt_text) return;
    setSaving(true);
    try {
      // Extract variables like {{var_name}}
      const vars = [...(editingPrompt.prompt_text.match(/\{\{(\w+)\}\}/g) || [])].map(v => v.replace(/\{\{|\}\}/g, ''));

      if (editingPrompt.id) {
        const { error } = await supabase.from('custom_prompts').update({
          title: editingPrompt.title,
          prompt_text: editingPrompt.prompt_text,
          content_type: editingPrompt.content_type || 'document',
          variables: vars,
        }).eq('id', editingPrompt.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('custom_prompts').insert({
          user_id: user.id,
          title: editingPrompt.title,
          prompt_text: editingPrompt.prompt_text,
          content_type: editingPrompt.content_type || 'document',
          variables: vars,
        } as any);
        if (error) throw error;
      }
      toast.success(editingPrompt.id ? 'Prompt updated' : 'Prompt created');
      setEditDialog(false);
      setEditingPrompt(null);
      loadPrompts();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }, [user, editingPrompt, loadPrompts]);

  const handleDelete = useCallback(async (id: string) => {
    const { error } = await supabase.from('custom_prompts').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Prompt deleted'); loadPrompts(); }
  }, [loadPrompts]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Prompt copied');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Save reusable AI prompts with {{variables}}</p>
        <Button size="sm" onClick={() => { setEditingPrompt({ title: '', prompt_text: '', content_type: 'document' }); setEditDialog(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> New Prompt
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : prompts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-xs text-muted-foreground">
            No custom prompts yet. Create one to get started!
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {prompts.map(p => (
            <Card key={p.id} className="group hover:border-primary/30 transition-colors">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{p.title}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{p.prompt_text}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Badge variant="secondary" className="text-[10px]">{p.content_type}</Badge>
                      {p.variables?.map(v => (
                        <Badge key={v} variant="outline" className="text-[10px]">{`{{${v}}}`}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleCopy(p.prompt_text)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingPrompt(p); setEditDialog(true); }}>
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(p.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit/Create Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPrompt?.id ? 'Edit Prompt' : 'New Custom Prompt'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Title</label>
              <Input
                value={editingPrompt?.title || ''}
                onChange={e => setEditingPrompt(prev => prev ? { ...prev, title: e.target.value } : null)}
                placeholder="e.g. Discovery Call Prep"
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Content Type</label>
              <Select
                value={editingPrompt?.content_type || 'document'}
                onValueChange={v => setEditingPrompt(prev => prev ? { ...prev, content_type: v } : null)}
              >
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="presentation">Presentation</SelectItem>
                  <SelectItem value="prep">Meeting Prep</SelectItem>
                  <SelectItem value="battlecard">Battlecard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Prompt Template</label>
              <Textarea
                value={editingPrompt?.prompt_text || ''}
                onChange={e => setEditingPrompt(prev => prev ? { ...prev, prompt_text: e.target.value } : null)}
                placeholder="Use {{variable_name}} for dynamic values, e.g. Research {{company}} and prepare..."
                className="text-sm min-h-[120px]"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Variables like {'{{company}}'}, {'{{pain_points}}'} will be auto-detected
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !editingPrompt?.title || !editingPrompt?.prompt_text}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
