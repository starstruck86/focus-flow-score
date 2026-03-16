import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Network, Sparkles, RefreshCw, Plus, Trash2, Pencil, Check, X,
  Crown, Shield, Target, UserCheck, Lightbulb, Users, Ban, Linkedin,
  ArrowDown, ChevronDown, ChevronUp, Upload, Loader2, ImagePlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BUYER_ROLES = [
  { value: 'economic_buyer', label: 'Economic Buyer', icon: Crown, color: 'text-status-yellow', bg: 'bg-status-yellow/10 border-status-yellow/30' },
  { value: 'champion', label: 'Champion', icon: Shield, color: 'text-primary', bg: 'bg-primary/10 border-primary/30' },
  { value: 'technical_buyer', label: 'Technical Buyer', icon: Target, color: 'text-accent', bg: 'bg-accent/10 border-accent/30' },
  { value: 'user_buyer', label: 'User Buyer', icon: UserCheck, color: 'text-status-green', bg: 'bg-status-green/10 border-status-green/30' },
  { value: 'coach', label: 'Coach', icon: Lightbulb, color: 'text-foreground', bg: 'bg-secondary/70 border-border' },
  { value: 'influencer', label: 'Influencer', icon: Users, color: 'text-muted-foreground', bg: 'bg-muted/60 border-border' },
  { value: 'blocker', label: 'Blocker', icon: Ban, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30' },
  { value: 'unknown', label: 'Unknown', icon: Users, color: 'text-muted-foreground', bg: 'bg-muted/50 border-border' },
] as const;

const INFLUENCE_COLORS: Record<string, string> = {
  high: 'ring-2 ring-status-yellow/60',
  medium: 'ring-1 ring-border',
  low: 'ring-1 ring-border/30 opacity-80',
};

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
  const [editReportsTo, setEditReportsTo] = useState('');
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-chart-contacts', accountId] });
      setShowAddForm(false);
      setNewContact({ name: '', title: '', department: '', buyer_role: 'unknown', reporting_to: '' });
      toast.success('Contact added to org chart');
    },
  });

  const generateOrgChart = useCallback(async () => {
    if (!user) return;
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('discover-contacts', {
        body: {
          accountId,
          accountName,
          website,
          industry,
          discoveryMode: 'executive',
          maxContacts: 8,
          focusPrompt: 'Build an org chart: find the reporting hierarchy from VP/Director level through CMO/CRO. Include department heads and key decision makers.',
          includeReportingLines: true,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const newContacts = data?.contacts || [];
      if (newContacts.length === 0) {
        toast.info('No new contacts found for org chart');
        return;
      }

      // Add contacts with reporting_to relationships
      for (const c of newContacts) {
        await supabase.from('contacts').insert({
          name: c.name,
          title: c.title,
          department: c.department || null,
          seniority: c.seniority || null,
          buyer_role: c.buyer_role || 'unknown',
          influence_level: c.influence_level || 'medium',
          linkedin_url: c.linkedin_url || null,
          reporting_to: c.reporting_to || null,
          notes: c.notes || null,
          account_id: accountId,
          user_id: user.id,
          ai_discovered: true,
          discovery_source: 'org-chart-ai',
          status: 'target',
        });
      }

      qc.invalidateQueries({ queryKey: ['org-chart-contacts', accountId] });
      toast.success(`Added ${newContacts.length} contacts to org chart`);
    } catch (err) {
      toast.error('Failed to generate org chart', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsGenerating(false);
    }
  }, [accountId, accountName, website, industry, user, qc]);

  // Handle screenshot drag-and-drop
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!user) return;

    const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    setIsParsingDrop(true);
    try {
      // Upload to storage
      const uploadedUrls: string[] = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const ext = imageFiles[i].name.split('.').pop() || 'png';
        const path = `${user.id}/org-chart/${accountId}/${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage
          .from('enrichment-screenshots')
          .upload(path, imageFiles[i], { upsert: true });
        if (error) { console.error('Upload error:', error); continue; }

        const { data: signedData } = await supabase.storage
          .from('enrichment-screenshots')
          .createSignedUrl(path, 3600);
        if (signedData?.signedUrl) uploadedUrls.push(signedData.signedUrl);
      }

      if (uploadedUrls.length === 0) {
        toast.error('Failed to upload screenshot');
        return;
      }

      toast.info(`Extracting contacts from ${uploadedUrls.length} screenshot(s)...`);

      const { data, error } = await supabase.functions.invoke('parse-account-screenshot', {
        body: {
          imageUrls: uploadedUrls,
          context: `Extract contacts/people for ${accountName}. Focus on names, titles, departments, and LinkedIn URLs.`,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Extraction failed');

      const extractedAccounts = data.accounts || [];
      // Collect all contacts from all extracted accounts
      const allContacts: { name: string; title?: string; email?: string; department?: string }[] = [];
      for (const acc of extractedAccounts) {
        if (acc.contacts) allContacts.push(...acc.contacts);
        // If the account itself looks like a contact entry (common with LinkedIn screenshots)
        // the AI may put people as "accounts" — check if they have a title
        if (acc.name && acc.notes?.includes('title:')) {
          // skip, covered by contacts
        }
      }

      // If no contacts found in the contacts array, the AI may have put people as accounts
      if (allContacts.length === 0) {
        for (const acc of extractedAccounts) {
          if (acc.name) {
            allContacts.push({
              name: acc.name,
              title: acc.industry || acc.notes || undefined, // AI sometimes puts title in unexpected fields
            });
          }
        }
      }

      if (allContacts.length === 0) {
        toast.info('No contacts found in screenshot');
        return;
      }

      // Insert contacts, deduplicating
      let added = 0;
      for (const contact of allContacts) {
        const { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .eq('account_id', accountId)
          .ilike('name', contact.name)
          .maybeSingle();

        if (!existing) {
          await supabase.from('contacts').insert({
            user_id: user.id,
            account_id: accountId,
            name: contact.name,
            title: contact.title || null,
            email: contact.email || null,
            department: contact.department || null,
            status: 'target',
            buyer_role: 'unknown',
            influence_level: 'medium',
            discovery_source: 'screenshot-drop',
          });
          added++;
        }
      }

      qc.invalidateQueries({ queryKey: ['org-chart-contacts', accountId] });
      toast.success(`Added ${added} contact(s) to org chart`, {
        description: allContacts.length > added ? `${allContacts.length - added} duplicate(s) skipped` : undefined,
      });
    } catch (err) {
      toast.error('Failed to parse screenshot', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
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
          roots.push(c); // parent not found, treat as root
        }
      }
    }

    // Sort roots by seniority
    const seniorityOrder: Record<string, number> = { 'c-suite': 0, 'vp': 1, 'director': 2, 'manager': 3, 'individual': 4 };
    roots.sort((a, b) => (seniorityOrder[a.seniority || 'individual'] || 4) - (seniorityOrder[b.seniority || 'individual'] || 4));

    return { roots, childrenMap: map };
  }, [contacts]);

  const renderNode = (contact: ContactNode, depth: number = 0) => {
    const config = getRoleConfig(contact.buyer_role || 'unknown');
    const Icon = config.icon;
    const children = childrenMap.get(contact.id) || [];
    const isEditing = editingId === contact.id;

    return (
      <div key={contact.id} className={cn("relative", depth > 0 && "ml-8")}>
        {depth > 0 && (
          <div className="absolute left-[-20px] top-0 bottom-1/2 w-5 border-l-2 border-b-2 border-border/40 rounded-bl-lg" />
        )}
        <div className={cn(
          "p-3 rounded-lg border bg-card transition-all",
          INFLUENCE_COLORS[contact.influence_level || 'medium'],
          config.bg,
        )}>
          <div className="flex items-start gap-2">
            <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", config.color)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{contact.name}</span>
                {contact.linkedin_url && (
                  <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                    <Linkedin className="h-3 w-3" />
                  </a>
                )}
              </div>
              {contact.title && <p className="text-[11px] text-muted-foreground">{contact.title}</p>}
              {contact.department && <Badge variant="outline" className="text-[10px] px-1.5 py-0 mt-1">{contact.department}</Badge>}
            </div>
            <div className="flex gap-0.5">
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => {
                setEditingId(isEditing ? null : contact.id);
                setEditReportsTo(contact.reporting_to || '');
              }}>
                {isEditing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
              </Button>
            </div>
          </div>

          {isEditing && (
            <div className="mt-2 pt-2 border-t border-border/30 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Reports To</Label>
                  <Select
                    value={editReportsTo || '__none__'}
                    onValueChange={v => setEditReportsTo(v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="None (root)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None (root)</SelectItem>
                      {(contacts || [])
                        .filter(c => c.id !== contact.id)
                        .map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)
                      }
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Role</Label>
                  <Select value={contact.buyer_role || 'unknown'} onValueChange={v => updateContact.mutate({ id: contact.id, updates: { buyer_role: v } })}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BUYER_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 items-center">
                <Button size="sm" className="h-6 text-xs" onClick={() => {
                  updateContact.mutate({ id: contact.id, updates: { reporting_to: editReportsTo || null } });
                  setEditingId(null);
                }}>
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                  onClick={() => {
                    if (window.confirm(`Remove ${contact.name} from the org chart?`)) {
                      deleteContact.mutate(contact.id);
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Delete
                </Button>
              </div>
            </div>
          )}
        </div>

        {children.length > 0 && (
          <div className="mt-2 space-y-2">
            {children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const totalContacts = contacts?.length || 0;

  return (
    <Card>
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
            <Button
              variant="ghost" size="sm" className="h-7 text-xs gap-1"
              onClick={generateOrgChart}
              disabled={isGenerating}
            >
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
          {/* Add form */}
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

          {/* Tree */}
          {totalContacts === 0 ? (
            <div className="text-center py-6">
              <Network className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No contacts yet.</p>
              <p className="text-xs text-muted-foreground">Add manually or use AI Generate to build the org chart.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {roots.map(root => renderNode(root, 0))}
            </div>
          )}

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
