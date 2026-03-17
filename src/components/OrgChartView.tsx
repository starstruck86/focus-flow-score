import { useState, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { maybePromoteToResearching } from '@/lib/accountAutoStatus';
import {
  Network, Sparkles, RefreshCw, Plus, Trash2, Pencil, Check, X,
  Crown, Shield, Target, UserCheck, Lightbulb, Users, Ban, Linkedin,
  ChevronDown, ChevronUp, Loader2, ImagePlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BUYER_ROLES = [
  { value: 'economic_buyer', label: 'Economic Buyer', icon: Crown, color: 'text-status-yellow', bg: 'bg-status-yellow/10', border: 'border-status-yellow/40' },
  { value: 'champion', label: 'Champion', icon: Shield, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/40' },
  { value: 'technical_buyer', label: 'Technical Buyer', icon: Target, color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/40' },
  { value: 'user_buyer', label: 'User Buyer', icon: UserCheck, color: 'text-status-green', bg: 'bg-status-green/10', border: 'border-status-green/40' },
  { value: 'coach', label: 'Coach', icon: Lightbulb, color: 'text-foreground', bg: 'bg-secondary/70', border: 'border-border' },
  { value: 'influencer', label: 'Influencer', icon: Users, color: 'text-muted-foreground', bg: 'bg-muted/60', border: 'border-border' },
  { value: 'blocker', label: 'Blocker', icon: Ban, color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/40' },
  { value: 'unknown', label: 'Unknown', icon: Users, color: 'text-muted-foreground', bg: 'bg-card', border: 'border-border' },
] as const;

interface OrgChartViewProps {
  accountId: string;
  accountName: string;
  website?: string;
  industry?: string;
}

function getRoleConfig(role: string) {
  return BUYER_ROLES.find(r => r.value === role) || BUYER_ROLES[BUYER_ROLES.length - 1];
}

interface ContactNode {
  id: string;
  name: string;
  title: string | null;
  department: string | null;
  buyer_role: string | null;
  influence_level: string | null;
  reporting_to: string | null;
  linkedin_url: string | null;
  notes: string | null;
  seniority: string | null;
}

export function OrgChartView({ accountId, accountName, website, industry }: OrgChartViewProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ reporting_to: string; buyer_role: string }>({ reporting_to: '', buyer_role: 'unknown' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', title: '', department: '', buyer_role: 'unknown', reporting_to: '' });
  const [expanded, setExpanded] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isParsingDrop, setIsParsingDrop] = useState(false);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['org-chart-contacts', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at');
      if (error) throw error;
      return (data || []) as ContactNode[];
    },
    enabled: !!accountId && !!user,
  });

  const updateContact = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from('contacts').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-chart-contacts', accountId] }),
  });

  const deleteContact = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contacts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-chart-contacts', accountId] });
      toast.success('Contact removed');
      setEditingId(null);
    },
  });

  const addContactMut = useMutation({
    mutationFn: async (contact: any) => {
      const { error } = await supabase.from('contacts').insert({
        ...contact,
        account_id: accountId,
        user_id: user!.id,
        status: 'target',
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['org-chart-contacts', accountId] });
      setShowAddForm(false);
      setNewContact({ name: '', title: '', department: '', buyer_role: 'unknown', reporting_to: '' });
      toast.success('Contact added to org chart');
      await maybePromoteToResearching(accountId);
    },
  });

  const generateOrgChart = useCallback(async () => {
    if (!user) return;
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('discover-contacts', {
        body: {
          accountId, accountName, website, industry,
          discoveryMode: 'executive', maxContacts: 8,
          focusPrompt: 'Build an org chart: find the reporting hierarchy from VP/Director level through CMO/CRO. Include department heads and key decision makers.',
          includeReportingLines: true,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const newContacts = data?.contacts || [];
      if (newContacts.length === 0) { toast.info('No new contacts found'); return; }

      for (const c of newContacts) {
        await supabase.from('contacts').insert({
          name: c.name, title: c.title, department: c.department || null,
          seniority: c.seniority || null, buyer_role: c.buyer_role || 'unknown',
          influence_level: c.influence_level || 'medium', linkedin_url: c.linkedin_url || null,
          reporting_to: c.reporting_to || null, notes: c.notes || null,
          account_id: accountId, user_id: user.id, ai_discovered: true,
          discovery_source: 'org-chart-ai', status: 'target',
        });
      }

      qc.invalidateQueries({ queryKey: ['org-chart-contacts', accountId] });
      toast.success(`Added ${newContacts.length} contacts to org chart`);
    } catch (err) {
      toast.error('Failed to generate org chart', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setIsGenerating(false);
    }
  }, [accountId, accountName, website, industry, user, qc]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!user) return;

    const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    setIsParsingDrop(true);
    try {
      const uploadedUrls: string[] = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const ext = imageFiles[i].name.split('.').pop() || 'png';
        const path = `${user.id}/org-chart/${accountId}/${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage.from('enrichment-screenshots').upload(path, imageFiles[i], { upsert: true });
        if (error) { console.error('Upload error:', error); continue; }
        const { data: signedData } = await supabase.storage.from('enrichment-screenshots').createSignedUrl(path, 3600);
        if (signedData?.signedUrl) uploadedUrls.push(signedData.signedUrl);
      }

      if (uploadedUrls.length === 0) { toast.error('Failed to upload screenshot'); return; }
      toast.info(`Extracting contacts from ${uploadedUrls.length} screenshot(s)...`);

      const { data, error } = await supabase.functions.invoke('parse-account-screenshot', {
        body: {
          imageUrls: uploadedUrls,
          context: `This is a CONTACTS screenshot for "${accountName}". Extract each PERSON as a contact. Focus on: names, titles, departments, emails, LinkedIn URLs.`,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Extraction failed');

      const allContacts: { name: string; title?: string; email?: string; department?: string }[] = [];
      for (const acc of (data.accounts || [])) {
        if (acc.contacts) allContacts.push(...acc.contacts);
      }
      if (allContacts.length === 0) {
        for (const acc of (data.accounts || [])) {
          if (acc.name) allContacts.push({ name: acc.name, title: acc.industry || acc.notes || undefined });
        }
      }
      if (allContacts.length === 0) { toast.info('No contacts found in screenshot'); return; }

      let added = 0;
      for (const contact of allContacts) {
        const { data: existing } = await supabase.from('contacts').select('id').eq('account_id', accountId).ilike('name', contact.name).maybeSingle();
        if (!existing) {
          await supabase.from('contacts').insert({
            user_id: user.id, account_id: accountId, name: contact.name,
            title: contact.title || null, email: contact.email || null,
            department: contact.department || null, status: 'target',
            buyer_role: 'unknown', influence_level: 'medium', discovery_source: 'screenshot-drop',
          });
          added++;
        }
      }
      qc.invalidateQueries({ queryKey: ['org-chart-contacts', accountId] });
      toast.success(`Added ${added} contact(s)`, { description: allContacts.length > added ? `${allContacts.length - added} duplicate(s) skipped` : undefined });
    } catch (err) {
      toast.error('Failed to parse screenshot', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setIsParsingDrop(false);
    }
  }, [user, accountId, accountName, qc]);

  // Build tree structure
  const { roots, childrenMap } = useMemo(() => {
    if (!contacts) return { roots: [], childrenMap: new Map<string, ContactNode[]>() };
    const map = new Map<string, ContactNode[]>();
    const nameToId = new Map<string, string>();
    for (const c of contacts) nameToId.set(c.name.toLowerCase(), c.id);

    const roots: ContactNode[] = [];
    for (const c of contacts) {
      if (!c.reporting_to) {
        roots.push(c);
      } else {
        const parentId = nameToId.get(c.reporting_to.toLowerCase());
        if (parentId) {
          if (!map.has(parentId)) map.set(parentId, []);
          map.get(parentId)!.push(c);
        } else {
          roots.push(c);
        }
      }
    }

    const seniorityOrder: Record<string, number> = { 'c-suite': 0, 'vp': 1, 'director': 2, 'manager': 3, 'individual': 4 };
    roots.sort((a, b) => (seniorityOrder[a.seniority || 'individual'] || 4) - (seniorityOrder[b.seniority || 'individual'] || 4));
    return { roots, childrenMap: map };
  }, [contacts]);

  // Render a single org chart node card
  const renderNodeCard = (contact: ContactNode) => {
    const config = getRoleConfig(contact.buyer_role || 'unknown');
    const Icon = config.icon;
    const isEditing = editingId === contact.id;

    return (
      <div
        className={cn(
          "relative rounded-xl border-2 bg-card shadow-sm transition-all w-[220px]",
          config.border,
          contact.influence_level === 'high' && "shadow-md ring-1 ring-primary/10",
        )}
      >
        {/* Color top bar */}
        <div className={cn("h-2 rounded-t-[10px]", config.bg)} />

        <div className="px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            {contact.linkedin_url ? (
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold text-foreground hover:text-primary hover:underline transition-colors line-clamp-2"
                onClick={(e) => e.stopPropagation()}
              >
                {contact.name}
              </a>
            ) : (
              <span className="text-sm font-bold text-foreground line-clamp-2">{contact.name}</span>
            )}
          </div>
          {contact.title && (
            <p className="text-xs text-muted-foreground leading-snug line-clamp-2 mb-1">{contact.title}</p>
          )}
          {contact.department && (
            <Badge variant="outline" className="text-[10px] px-2 py-0.5 mt-1 font-normal">
              {contact.department}
            </Badge>
          )}
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <Icon className={cn("h-3.5 w-3.5", config.color)} />
            <span className={cn("text-xs font-medium", config.color)}>{config.label}</span>
          </div>

          {/* Edit/action buttons */}
          <div className="flex items-center justify-center gap-1 mt-2">
            {contact.linkedin_url && (
              <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary">
                  <Linkedin className="h-3.5 w-3.5" />
                </Button>
              </a>
            )}
            <Button
              variant="ghost" size="sm" className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                if (isEditing) {
                  setEditingId(null);
                } else {
                  setEditingId(contact.id);
                  setEditForm({ reporting_to: contact.reporting_to || '', buyer_role: contact.buyer_role || 'unknown' });
                }
              }}
            >
              {isEditing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5 text-muted-foreground" />}
            </Button>
          </div>
        </div>

        {/* Inline edit panel */}
        {isEditing && (
          <div className="px-3 pb-3 pt-1 border-t border-border/30 space-y-2">
            <div>
              <Label className="text-[10px]">Reports To</Label>
              <Select
                value={editForm.reporting_to || '__none__'}
                onValueChange={v => setEditForm(f => ({ ...f, reporting_to: v === '__none__' ? '' : v }))}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (root)</SelectItem>
                  {(contacts || []).filter(c => c.id !== contact.id).map(c => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Role</Label>
              <Select value={editForm.buyer_role} onValueChange={v => setEditForm(f => ({ ...f, buyer_role: v }))}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BUYER_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" className="h-6 text-xs flex-1" onClick={() => {
                updateContact.mutate({
                  id: contact.id,
                  updates: { reporting_to: editForm.reporting_to || null, buyer_role: editForm.buyer_role },
                });
                setEditingId(null);
              }}>
                <Check className="h-3 w-3 mr-1" /> Save
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-6 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if (window.confirm(`Remove ${contact.name}?`)) deleteContact.mutate(contact.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Recursive tree renderer with connecting lines
  const renderTree = (node: ContactNode) => {
    const children = childrenMap.get(node.id) || [];

    return (
      <div key={node.id} className="flex flex-col items-center">
        {renderNodeCard(node)}

        {children.length > 0 && (
          <>
            {/* Vertical line down from parent */}
            <div className="w-px h-5 bg-border" />

            {/* Horizontal connector bar + children */}
            <div className="relative flex items-start">
              {/* Horizontal bar spanning across children */}
              {children.length > 1 && (
                <div
                  className="absolute top-0 bg-border h-px"
                  style={{
                    left: `calc(50% / ${children.length})`,
                    right: `calc(50% / ${children.length})`,
                  }}
                />
              )}

              <div className="flex gap-2 items-start">
                {children.map((child, i) => (
                  <div key={child.id} className="flex flex-col items-center">
                    {/* Vertical line down to child */}
                    <div className="w-px h-5 bg-border" />
                    {renderTree(child)}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const totalContacts = contacts?.length || 0;

  // If there's a single top root with children, show as proper tree.
  // If multiple roots, show them side by side under a virtual "company" node.
  const hasSingleRoot = roots.length === 1;

  return (
    <Card
      className={cn("transition-all", isDragOver && "ring-2 ring-primary/50 bg-primary/5")}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); if (!expanded) setExpanded(true); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(e); }}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            Org Chart
            {totalContacts > 0 && <Badge variant="outline" className="text-[10px]">{totalContacts}</Badge>}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowAddForm(!showAddForm)}>
              <Plus className="h-3 w-3" /> Add
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={generateOrgChart} disabled={isGenerating}>
              {isGenerating ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              AI Generate
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3">
          {isParsingDrop && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Extracting contacts from screenshot...</span>
            </div>
          )}

          {isDragOver && !isParsingDrop && (
            <div className="flex flex-col items-center gap-2 p-6 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 text-center">
              <ImagePlus className="h-8 w-8 text-primary/60" />
              <p className="text-sm font-medium text-primary">Drop screenshot to extract contacts</p>
              <p className="text-xs text-muted-foreground">LinkedIn, CRM, or any contact list</p>
            </div>
          )}

          {showAddForm && (
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Name *</Label>
                  <Input className="h-7 text-xs" value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-[10px]">Title</Label>
                  <Input className="h-7 text-xs" value={newContact.title} onChange={e => setNewContact(p => ({ ...p, title: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-[10px]">Department</Label>
                  <Input className="h-7 text-xs" value={newContact.department} onChange={e => setNewContact(p => ({ ...p, department: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-[10px]">Reports To</Label>
                  <Input className="h-7 text-xs" value={newContact.reporting_to} onChange={e => setNewContact(p => ({ ...p, reporting_to: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-[10px]">Role</Label>
                  <Select value={newContact.buyer_role} onValueChange={v => setNewContact(p => ({ ...p, buyer_role: v }))}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BUYER_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-6 text-xs" disabled={!newContact.name.trim()} onClick={() => addContactMut.mutate(newContact)}>
                  <Check className="h-3 w-3 mr-1" /> Add to Chart
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowAddForm(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Org Chart Tree */}
          {totalContacts === 0 && !isDragOver && !isParsingDrop ? (
            <div className="text-center py-6">
              <Network className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No contacts yet.</p>
              <p className="text-xs text-muted-foreground">Drop a screenshot, add manually, or use AI Generate.</p>
            </div>
          ) : totalContacts > 0 ? (
            <ScrollArea className="w-full">
              <div className="min-w-fit py-4 px-2">
                {hasSingleRoot ? (
                  <div className="flex justify-center">
                    {renderTree(roots[0])}
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    {/* Virtual company node for multiple roots */}
                    <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-4 py-2 text-center shadow-sm">
                      <span className="text-sm font-semibold text-foreground">{accountName}</span>
                    </div>
                    <div className="w-px h-5 bg-border" />
                    <div className="relative flex items-start">
                      {roots.length > 1 && (
                        <div
                          className="absolute top-0 bg-border h-px"
                          style={{
                            left: `calc(50% / ${roots.length})`,
                            right: `calc(50% / ${roots.length})`,
                          }}
                        />
                      )}
                      <div className="flex gap-3 items-start">
                        {roots.map(root => (
                          <div key={root.id} className="flex flex-col items-center">
                            <div className="w-px h-5 bg-border" />
                            {renderTree(root)}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          ) : null}

          {/* Legend */}
          {totalContacts > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
              {BUYER_ROLES.slice(0, -1).map(r => {
                const Icon = r.icon;
                return (
                  <div key={r.value} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Icon className={cn("h-3 w-3", r.color)} />
                    {r.label}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
