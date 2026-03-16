import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Users,
  Sparkles,
  Crown,
  Shield,
  Target,
  UserCheck,
  Lightbulb,
  Ban,
  Linkedin,
  AlertTriangle,
  SlidersHorizontal,
  RotateCcw,
  Trash2,
  Pencil,
  Upload,
  Loader2,
  ImagePlus,
  Plus,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BUYER_ROLES = [
  { value: 'economic_buyer', label: 'Economic Buyer', icon: Crown, color: 'text-status-yellow', bg: 'bg-status-yellow/10 border-status-yellow/30', critical: true },
  { value: 'champion', label: 'Champion', icon: Shield, color: 'text-primary', bg: 'bg-primary/10 border-primary/30', critical: true },
  { value: 'technical_buyer', label: 'Technical Buyer', icon: Target, color: 'text-accent', bg: 'bg-accent/10 border-accent/30', critical: false },
  { value: 'user_buyer', label: 'User Buyer', icon: UserCheck, color: 'text-status-green', bg: 'bg-status-green/10 border-status-green/30', critical: false },
  { value: 'coach', label: 'Coach', icon: Lightbulb, color: 'text-foreground', bg: 'bg-secondary/70 border-border', critical: true },
  { value: 'influencer', label: 'Influencer', icon: Users, color: 'text-muted-foreground', bg: 'bg-muted/60 border-border', critical: false },
  { value: 'blocker', label: 'Blocker', icon: Ban, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30', critical: false },
  { value: 'unknown', label: 'Unknown', icon: Users, color: 'text-muted-foreground', bg: 'bg-muted/50 border-border', critical: false },
] as const;

const INFLUENCE_LEVELS = ['high', 'medium', 'low'] as const;
const CRITICAL_ROLES = ['economic_buyer', 'champion', 'coach'];
const DISCOVERY_MODES = [
  { value: 'auto', label: 'Auto' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'digital_engagement', label: 'Digital Engagement' },
  { value: 'marketing_ops', label: 'Marketing Ops' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'cx_loyalty', label: 'CX / Loyalty' },
  { value: 'operations', label: 'Operations' },
  { value: 'it', label: 'IT / Systems' },
  { value: 'executive', label: 'Executive' },
] as const;
const TARGET_COUNTS = ['3', '5', '8', '10'] as const;

const ENTERPRISE_DIVISION_PRESETS: Record<string, string[]> = {
  metlife: ['Group Benefits', 'Retirement & Income Solutions', 'Auto & Home', 'Pet Insurance', 'Dental', 'Asia', 'Latin America', 'EMEA', 'Corporate / Enterprise'],
  cvs: ['CVS Pharmacy', 'CVS Caremark', 'Aetna', 'CVS Health Corporate', 'CVS Specialty', 'MinuteClinic', 'CVS Media Exchange'],
};

function getDivisionPresets(accountName: string): string[] {
  const lower = accountName.toLowerCase();
  for (const [key, presets] of Object.entries(ENTERPRISE_DIVISION_PRESETS)) {
    if (lower.includes(key)) return presets;
  }
  return ['Corporate', 'Digital', 'North America', 'EMEA', 'APAC'];
}

function getRoleConfig(role: string) {
  return BUYER_ROLES.find((entry) => entry.value === role) || BUYER_ROLES[BUYER_ROLES.length - 1];
}

interface StakeholderMapProps {
  accountId: string;
  accountName: string;
  website?: string;
  industry?: string;
  opportunityContext?: string;
}

interface DiscoveryMeta {
  source?: string;
  total_found?: number;
  new_contacts?: number;
  discovery_mode?: string;
  focus_prompt?: string | null;
  website_research_used?: boolean;
}

export function StakeholderMap({ accountId, accountName, website, industry, opportunityContext }: StakeholderMapProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [discoveredContacts, setDiscoveredContacts] = useState<any[]>([]);
  const [showTuning, setShowTuning] = useState(Boolean(opportunityContext));
  const [discoveryMode, setDiscoveryMode] = useState<string>('auto');
  const [maxContacts, setMaxContacts] = useState<string>('5');
  const [focusPrompt, setFocusPrompt] = useState(opportunityContext || '');
  const [division, setDivision] = useState('');
  const [lastDiscoveryMeta, setLastDiscoveryMeta] = useState<DiscoveryMeta | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isParsingDrop, setIsParsingDrop] = useState(false);
  const [draggedContactId, setDraggedContactId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', title: '', department: '', buyer_role: 'unknown', reporting_to: '' });
  const [addingUnderParent, setAddingUnderParent] = useState<string | null>(null);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddTitle, setQuickAddTitle] = useState('');

  useEffect(() => {
    setDiscoveredContacts([]);
    setEditingContact(null);
    setLastDiscoveryMeta(null);
    setDiscoveryMode('auto');
    setMaxContacts('5');
    setFocusPrompt(opportunityContext || '');
    setDivision('');
  }, [accountId, opportunityContext]);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['stakeholder-contacts', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && !!user,
  });

  const updateContact = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from('contacts').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stakeholder-contacts', accountId] }),
  });

  const deleteContact = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contacts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stakeholder-contacts', accountId] });
      setEditingContact(null);
      toast.success('Contact removed');
    },
  });

  const addContact = useMutation({
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
      qc.invalidateQueries({ queryKey: ['stakeholder-contacts', accountId] });
      toast.success('Contact added');
    },
  });

  const discoverContacts = useCallback(async () => {
    if (!user) {
      toast.error('Sign in to use stakeholder discovery');
      return null;
    }

    setIsDiscovering(true);
    try {
      const payload = {
        accountId,
        accountName,
        website,
        industry,
        opportunityContext,
        discoveryMode,
        maxContacts: Number(maxContacts),
        focusPrompt: focusPrompt.trim() || null,
        division: division.trim() || null,
      };

      const { data, error } = await supabase.functions.invoke('discover-contacts', {
        body: payload,
      });

      if (error) {
        console.error('discover-contacts invoke error:', error);
        throw new Error(typeof error === 'object' && error.message ? error.message : String(error));
      }

      if (data?.error) throw new Error(data.error);
      if (!data?.success) throw new Error('Discovery returned no results');

      setLastDiscoveryMeta(data);

      const nextContacts = Array.isArray(data.contacts) ? data.contacts : [];
      if (nextContacts.length === 0) {
        toast.success('Discovery complete', {
          description: 'No new contacts matched — adjust the tuning and try again.',
        });
      } else {
        toast.success(`Found ${data.new_contacts || nextContacts.length} new contacts`, {
          description: `${data.discovery_mode || discoveryMode} mode${data.website_research_used ? ' • website context used' : ''}`,
        });
      }

      return nextContacts;
    } catch (err) {
      console.error('Contact discovery failed:', err);
      toast.error('Contact discovery failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
      return null;
    } finally {
      setIsDiscovering(false);
    }
  }, [accountId, accountName, website, industry, opportunityContext, discoveryMode, maxContacts, focusPrompt, division, user]);

  const handleDiscover = async () => {
    const result = await discoverContacts();
    if (result) setDiscoveredContacts(result);
  };

  const resetTuning = () => {
    setDiscoveryMode('auto');
    setMaxContacts('5');
    setFocusPrompt(opportunityContext || '');
    setDivision('');
  };

  const handleScreenshotFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0 || !user) return;

    setIsParsingDrop(true);
    try {
      const uploadedUrls: string[] = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const ext = imageFiles[i].name.split('.').pop() || 'png';
        const path = `${user.id}/stakeholder/${accountId}/${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage
          .from('enrichment-screenshots')
          .upload(path, imageFiles[i], { upsert: true });
        if (error) { console.error('Upload error:', error); continue; }
        const { data: signedData } = await supabase.storage
          .from('enrichment-screenshots')
          .createSignedUrl(path, 3600);
        if (signedData?.signedUrl) uploadedUrls.push(signedData.signedUrl);
      }

      if (uploadedUrls.length === 0) { toast.error('Failed to upload screenshot'); return; }

      toast.info(`Extracting contacts from ${uploadedUrls.length} screenshot(s)...`);

      const { data, error } = await supabase.functions.invoke('parse-account-screenshot', {
        body: {
          imageUrls: uploadedUrls,
          context: `This is a CONTACTS screenshot for "${accountName}". Extract each PERSON as a contact under one account. Focus on person names, job titles, departments, emails, LinkedIn URLs.`,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Extraction failed');

      const extractedAccounts = data.accounts || [];
      const allContacts: { name: string; title?: string; email?: string; department?: string }[] = [];
      for (const acc of extractedAccounts) {
        if (acc.contacts) allContacts.push(...acc.contacts);
      }
      if (allContacts.length === 0) {
        for (const acc of extractedAccounts) {
          if (acc.name) allContacts.push({ name: acc.name, title: acc.industry || acc.notes || undefined });
        }
      }

      if (allContacts.length === 0) { toast.info('No contacts found in screenshot'); return; }

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

      qc.invalidateQueries({ queryKey: ['stakeholder-contacts', accountId] });
      toast.success(`Added ${added} contact(s)`, {
        description: allContacts.length > added ? `${allContacts.length - added} duplicate(s) skipped` : undefined,
      });
    } catch (err) {
      toast.error('Failed to parse screenshot', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsParsingDrop(false);
      setIsDragOver(false);
    }
  }, [user, accountId, accountName, qc]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleScreenshotFiles(Array.from(e.dataTransfer.files));
  }, [handleScreenshotFiles]);

  const handleUploadClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files) handleScreenshotFiles(Array.from(target.files));
    };
    input.click();
  };

  const confirmContact = (contact: any) => {
    const tenureParts: string[] = [];
    if (typeof contact.company_tenure_months === 'number') tenureParts.push(`Company tenure: ${contact.company_tenure_months}mo`);
    if (typeof contact.role_tenure_months === 'number') tenureParts.push(`Role tenure: ${contact.role_tenure_months}mo`);
    const tenureNote = tenureParts.length > 0 ? tenureParts.join(' | ') : '';
    const combinedNotes = [contact.notes, tenureNote].filter(Boolean).join(' — ');

    addContact.mutate({
      name: contact.name,
      title: contact.title,
      department: contact.department || null,
      seniority: contact.seniority || null,
      linkedin_url: contact.linkedin_url || null,
      buyer_role: contact.buyer_role || 'unknown',
      influence_level: contact.influence_level || 'medium',
      notes: combinedNotes || null,
      ai_discovered: true,
      discovery_source: lastDiscoveryMeta?.source || contact.confidence || 'ai',
    });
    setDiscoveredContacts((prev) => prev.filter((entry) => entry.name !== contact.name));
  };

  // Build tree structure for org chart display
  const { roots, childrenMap } = useMemo(() => {
    if (!contacts) return { roots: [] as any[], childrenMap: new Map<string, any[]>() };
    const map = new Map<string, any[]>();
    const nameToId = new Map<string, string>();
    for (const c of contacts) nameToId.set(c.name.toLowerCase(), c.id);

    const roots: any[] = [];
    for (const c of contacts) {
      const reportingTo = (c as any).reporting_to;
      if (!reportingTo) {
        roots.push(c);
      } else {
        const parentId = nameToId.get(reportingTo.toLowerCase());
        if (parentId) {
          if (!map.has(parentId)) map.set(parentId, []);
          map.get(parentId)!.push(c);
        } else {
          roots.push(c);
        }
      }
    }

    const seniorityOrder: Record<string, number> = { 'c-suite': 0, 'vp': 1, 'director': 2, 'manager': 3, 'individual': 4 };
    roots.sort((a: any, b: any) => (seniorityOrder[a.seniority || 'individual'] || 4) - (seniorityOrder[b.seniority || 'individual'] || 4));
    return { roots, childrenMap: map };
  }, [contacts]);

  const powerMapScore = useMemo(() => {
    const mapped = (contacts || []).filter((contact: any) => contact.buyer_role && contact.buyer_role !== 'unknown');
    const coveredRoles = new Set(mapped.map((contact: any) => contact.buyer_role));
    const criticalCovered = CRITICAL_ROLES.filter((role) => coveredRoles.has(role));
    const hasHighInfluence = mapped.some((contact: any) => contact.influence_level === 'high');
    const hasMultiThread = mapped.length >= 3;

    let score = 0;
    score += criticalCovered.length * 25;
    score += hasHighInfluence ? 10 : 0;
    score += hasMultiThread ? 15 : 0;

    const gaps = CRITICAL_ROLES.filter((role) => !coveredRoles.has(role));
    return { score: Math.min(100, score), gaps, criticalCovered, totalMapped: mapped.length };
  }, [contacts]);

  const totalContacts = contacts?.length || 0;
  const mappedContacts = (contacts || []).filter((contact: any) => contact.buyer_role && contact.buyer_role !== 'unknown').length;

  // Render a single org chart node card
  const renderNodeCard = (contact: any) => {
    const config = getRoleConfig(contact.buyer_role || 'unknown');
    const Icon = config.icon;
    const isEditing = editingContact === contact.id;

    return (
      <div
        draggable={!isEditing}
        onDragStart={(e) => {
          e.stopPropagation();
          setDraggedContactId(contact.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', contact.id);
        }}
        onDragEnd={() => { setDraggedContactId(null); setDropTargetId(null); }}
        onDragOver={(e) => {
          if (draggedContactId && draggedContactId !== contact.id) {
            e.preventDefault();
            e.stopPropagation();
            setDropTargetId(contact.id);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTargetId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (draggedContactId && draggedContactId !== contact.id) {
            // Update the dragged contact's reporting_to to this contact's name
            updateContact.mutate({ id: draggedContactId, updates: { reporting_to: contact.name } });
            toast.success('Reporting line updated');
          }
          setDraggedContactId(null);
          setDropTargetId(null);
        }}
        className={cn(
          "relative rounded-lg border-2 bg-card shadow-sm transition-all w-[160px] cursor-grab active:cursor-grabbing",
          config.bg.split(' ')[0] ? `border-${config.bg.split('border-')[1]?.split(' ')[0] || 'border'}` : 'border-border',
          draggedContactId === contact.id && "opacity-40 scale-95",
          dropTargetId === contact.id && "ring-2 ring-primary shadow-lg scale-105",
        )}
      >
        {/* Color top bar */}
        <div className={cn("h-1.5 rounded-t-[6px]", config.bg.split(' ')[0])} />

        <div className="px-3 py-2.5 text-center">
          <div className="flex items-center justify-center gap-1 mb-0.5">
            {contact.linkedin_url ? (
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-foreground hover:text-primary hover:underline transition-colors truncate"
                onClick={(e) => e.stopPropagation()}
              >
                {contact.name}
              </a>
            ) : (
              <span className="text-sm font-semibold text-foreground truncate">{contact.name}</span>
            )}
            {contact.influence_level === 'high' && <span className="text-[9px] text-status-yellow">★</span>}
          </div>
          {contact.title && (
            <p className="text-[11px] text-muted-foreground leading-tight truncate">{contact.title}</p>
          )}
          {(contact as any).department && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 mt-1.5 font-normal">
              {(contact as any).department}
            </Badge>
          )}
          <div className="flex items-center justify-center gap-1 mt-1.5">
            <Icon className={cn("h-3 w-3", config.color)} />
            <span className={cn("text-[10px] font-medium", config.color)}>{config.label}</span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-0.5 mt-1.5">
            {contact.linkedin_url && (
              <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-primary">
                  <Linkedin className="h-3 w-3" />
                </Button>
              </a>
            )}
            <Button
              variant="ghost" size="sm" className="h-5 w-5 p-0"
              onClick={(e) => {
                e.stopPropagation();
                setEditingContact(isEditing ? null : contact.id);
              }}
            >
              {isEditing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3 text-muted-foreground" />}
            </Button>
          </div>
        </div>

        {/* Inline edit panel */}
        {isEditing && (
          <div className="px-3 pb-3 pt-1 border-t border-border/30 space-y-2 text-left">
            <div className="grid grid-cols-1 gap-1.5">
              <Input className="h-7 text-xs" placeholder="Name" defaultValue={contact.name}
                onBlur={(e) => { if (e.target.value.trim() && e.target.value !== contact.name) updateContact.mutate({ id: contact.id, updates: { name: e.target.value.trim() } }); }}
              />
              <Input className="h-7 text-xs" placeholder="Title" defaultValue={contact.title || ''}
                onBlur={(e) => { if (e.target.value !== (contact.title || '')) updateContact.mutate({ id: contact.id, updates: { title: e.target.value || null } }); }}
              />
            </div>
            <div>
              <Label className="text-[10px]">Reports To</Label>
              <Select
                value={(contact as any).reporting_to || '__none__'}
                onValueChange={v => updateContact.mutate({ id: contact.id, updates: { reporting_to: v === '__none__' ? null : v } })}
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
            <div className="grid grid-cols-2 gap-1.5">
              <Select value={contact.buyer_role || 'unknown'} onValueChange={v => updateContact.mutate({ id: contact.id, updates: { buyer_role: v } })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BUYER_ROLES.map(r => <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={contact.influence_level || 'medium'} onValueChange={v => updateContact.mutate({ id: contact.id, updates: { influence_level: v } })}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INFLUENCE_LEVELS.map(l => <SelectItem key={l} value={l} className="text-xs capitalize">{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input className="h-7 text-xs" placeholder="LinkedIn URL" defaultValue={contact.linkedin_url || ''}
              onBlur={(e) => { if (e.target.value !== (contact.linkedin_url || '')) updateContact.mutate({ id: contact.id, updates: { linkedin_url: e.target.value || null } }); }}
            />
            <Button
              variant="ghost" size="sm"
              className="h-6 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 w-full"
              onClick={() => { if (confirm(`Remove ${contact.name}?`)) deleteContact.mutate(contact.id); }}
            >
              <Trash2 className="h-3 w-3 mr-1" /> Remove
            </Button>
          </div>
        )}
      </div>
    );
  };

  // Blank placeholder card for adding a new person under a parent
  const renderBlankCard = (parentName: string) => {
    const isAdding = addingUnderParent === parentName;

    if (isAdding) {
      return (
        <div className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 w-[160px] p-3 space-y-2">
          <Input
            className="h-7 text-xs text-center"
            placeholder="Name"
            value={quickAddName}
            onChange={(e) => setQuickAddName(e.target.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && quickAddName.trim()) addNewContact(parentName); if (e.key === 'Escape') { setAddingUnderParent(null); setQuickAddName(''); setQuickAddTitle(''); } }}
          />
          <Input
            className="h-7 text-xs text-center"
            placeholder="Role/Position"
            value={quickAddTitle}
            onChange={(e) => setQuickAddTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && quickAddName.trim()) addNewContact(parentName); if (e.key === 'Escape') { setAddingUnderParent(null); setQuickAddName(''); setQuickAddTitle(''); } }}
          />
          <div className="flex gap-1">
            <Button size="sm" className="h-6 text-xs flex-1" disabled={!quickAddName.trim()} onClick={() => addNewContact(parentName)}>
              <Check className="h-3 w-3 mr-1" /> Add
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setAddingUnderParent(null); setQuickAddName(''); setQuickAddTitle(''); }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "rounded-lg border-2 border-dashed border-border/40 bg-muted/20 w-[160px] py-4 px-3 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all group",
          draggedContactId && "border-primary/30 bg-primary/5",
        )}
        onClick={() => { setAddingUnderParent(parentName); setQuickAddName(''); setQuickAddTitle(''); }}
        onDragOver={(e) => {
          if (draggedContactId) { e.preventDefault(); e.stopPropagation(); }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (draggedContactId) {
            updateContact.mutate({ id: draggedContactId, updates: { reporting_to: parentName } });
            toast.success('Reporting line updated');
            setDraggedContactId(null);
            setDropTargetId(null);
          }
        }}
      >
        <Plus className="h-4 w-4 mx-auto text-muted-foreground/50 group-hover:text-primary transition-colors" />
        <p className="text-[11px] text-muted-foreground/60 group-hover:text-muted-foreground mt-1 font-medium">Add Name</p>
        <p className="text-[10px] text-muted-foreground/40 group-hover:text-muted-foreground/60">Role/Position</p>
      </div>
    );
  };

  // Root-level drop zone to make a node a root
  const renderRootDropZone = () => {
    if (!draggedContactId) return null;
    return (
      <div
        className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 w-[160px] py-4 px-3 text-center transition-all"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (draggedContactId) {
            updateContact.mutate({ id: draggedContactId, updates: { reporting_to: null } });
            toast.success('Moved to root level');
            setDraggedContactId(null);
            setDropTargetId(null);
          }
        }}
      >
        <p className="text-[11px] text-primary font-medium">Drop here for root level</p>
      </div>
    );
  };

  // Recursive tree renderer with connecting lines
  const renderTree = (node: any): React.ReactNode => {
    const children = childrenMap.get(node.id) || [];
    const allItems = [...children];

    return (
      <div key={node.id} className="flex flex-col items-center">
        {renderNodeCard(node)}

        {/* Always show children + blank placeholder */}
        <div className="w-px h-5 bg-border" />
        <div className="relative flex items-start">
          {(allItems.length + 1) > 1 && (
            <div className="absolute top-0 bg-border h-px" style={{ left: `calc(50% / ${allItems.length + 1})`, right: `calc(50% / ${allItems.length + 1})` }} />
          )}
          <div className="flex gap-3 items-start">
            {allItems.map((child: any) => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="w-px h-5 bg-border" />
                {renderTree(child)}
              </div>
            ))}
            <div className="flex flex-col items-center">
              <div className="w-px h-5 bg-border/30" />
              {renderBlankCard(node.name)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const addNewContact = (parentName?: string) => {
    const name = parentName ? quickAddName : newContact.name;
    const title = parentName ? quickAddTitle : newContact.title;
    if (!name.trim()) return;
    addContact.mutate({
      name: name.trim(),
      title: title || null,
      department: parentName ? null : (newContact.department || null),
      buyer_role: parentName ? 'unknown' : newContact.buyer_role,
      reporting_to: parentName || (newContact.reporting_to || null),
      influence_level: 'medium',
    });
    if (parentName) {
      setAddingUnderParent(null);
      setQuickAddName('');
      setQuickAddTitle('');
    } else {
      setShowAddForm(false);
      setNewContact({ name: '', title: '', department: '', buyer_role: 'unknown', reporting_to: '' });
    }
  };

  if (isLoading) {
    return (
      <Card className="metric-card">
        <CardContent className="pt-6">
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn("metric-card border-primary/20 transition-all", isDragOver && "ring-2 ring-primary/50 bg-primary/5")}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={handleDrop}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Stakeholder Map
          {totalContacts > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {mappedContacts}/{totalContacts} mapped
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-1.5 mt-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowTuning((v) => !v)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Tune
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleDiscover} disabled={isDiscovering}>
            <Sparkles className={cn('h-3.5 w-3.5', isDiscovering && 'animate-spin')} />
            {isDiscovering ? 'Finding...' : 'AI Discover'}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleUploadClick} disabled={isParsingDrop}>
            {isParsingDrop ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Screenshot
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Drag-drop overlay */}
        {isDragOver && !isParsingDrop && (
          <div className="flex flex-col items-center gap-2 p-6 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 text-center">
            <ImagePlus className="h-8 w-8 text-primary/60" />
            <p className="text-sm font-medium text-primary">Drop screenshot to extract contacts</p>
            <p className="text-xs text-muted-foreground">LinkedIn, CRM, or any contact list</p>
          </div>
        )}

        {isParsingDrop && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Extracting contacts from screenshot...</span>
          </div>
        )}

        {/* Add contact form */}
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
              <Button size="sm" className="h-6 text-xs" disabled={!newContact.name.trim()} onClick={() => addNewContact()}>
                <Check className="h-3 w-3 mr-1" /> Add to Chart
              </Button>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowAddForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {showTuning && (
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_100px]">
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Discovery focus</span>
                <Select value={discoveryMode} onValueChange={setDiscoveryMode}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DISCOVERY_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value} className="text-xs">{mode.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Division / BU</span>
                <Input value={division} onChange={(e) => setDivision(e.target.value)} placeholder="e.g. Group Benefits" className="h-8 text-xs" list="division-presets" />
                <datalist id="division-presets">
                  {getDivisionPresets(accountName).map((d) => (<option key={d} value={d} />))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Target</span>
                <Select value={maxContacts} onValueChange={setMaxContacts}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TARGET_COUNTS.map((count) => (<SelectItem key={count} value={count} className="text-xs">{count}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Custom guidance</span>
              <Textarea value={focusPrompt} onChange={(e) => setFocusPrompt(e.target.value)} placeholder="Example: prioritize digital marketing leadership, CRM owner, and the IT approver for this deal." className="min-h-[84px] resize-y text-xs" />
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{accountName}{division ? ` → ${division}` : ''}{website ? ` • ${website}` : ''}{industry ? ` • ${industry}` : ''}</span>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={resetTuning}>
                <RotateCcw className="mr-1 h-3 w-3" /> Reset
              </Button>
            </div>
          </div>
        )}

        {lastDiscoveryMeta && (
          <div className="rounded-lg border border-border bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Last run:</span>{' '}
            {lastDiscoveryMeta.discovery_mode || 'auto'} mode • {lastDiscoveryMeta.source || 'ai'} • {lastDiscoveryMeta.total_found || 0} structured • {lastDiscoveryMeta.new_contacts || 0} net new
          </div>
        )}

        {/* Power Map Score */}
        {totalContacts > 0 && (
          <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Power Map Score</span>
              <Badge variant={powerMapScore.score >= 75 ? 'default' : powerMapScore.score >= 40 ? 'secondary' : 'destructive'} className="text-[10px]">
                {powerMapScore.score}/100
              </Badge>
            </div>
            <Progress value={powerMapScore.score} className="h-1.5" />
            {powerMapScore.gaps.length > 0 && (
              <div className="flex items-start gap-1.5 text-[10px] text-status-yellow">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Missing: {powerMapScore.gaps.map((gap) => getRoleConfig(gap).label).join(', ')}</span>
              </div>
            )}
          </div>
        )}

        {/* Discovery confirmation */}
        {discoveredContacts.length > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-xs font-medium text-primary">
              {discoveredContacts.length} contacts discovered — confirm to add:
            </p>
            {discoveredContacts.map((contact, index) => {
              const companyNew = typeof contact.company_tenure_months === 'number' && contact.company_tenure_months >= 0 && contact.company_tenure_months < 12;
              const roleNew = typeof contact.role_tenure_months === 'number' && contact.role_tenure_months >= 0 && contact.role_tenure_months < 12;
              const linkedinFailed = contact.linkedin_verified === false;
              return (
                <div key={`${contact.name}-${index}`} className={cn('flex items-start justify-between gap-2 rounded bg-background/80 p-2', linkedinFailed && 'opacity-60 border border-destructive/30')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{contact.name}</span>
                      {contact.linkedin_url && (
                        <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer"
                          className={cn('hover:opacity-80', linkedinFailed ? 'text-destructive' : 'text-primary')}>
                          <Linkedin className="h-3 w-3" />
                        </a>
                      )}
                      {contact.linkedin_verified === true && (
                        <Badge variant="outline" className="text-[8px] h-4 border-status-green/50 bg-status-green/10 text-status-green">✓ verified</Badge>
                      )}
                      {linkedinFailed && (
                        <Badge variant="outline" className="text-[8px] h-4 border-destructive/50 bg-destructive/10 text-destructive">unverified</Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{contact.title}{contact.department ? ` · ${contact.department}` : ''}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn('text-[9px]', getRoleConfig(contact.buyer_role).bg)}>
                        {getRoleConfig(contact.buyer_role).label}
                      </Badge>
                      {typeof contact.relevance_score === 'number' && contact.relevance_score >= 0 && (
                        <Badge variant="outline" className={cn('text-[9px]',
                          contact.relevance_score >= 50 ? 'border-status-green/50 bg-status-green/10 text-status-green' :
                          contact.relevance_score >= 20 ? 'border-status-yellow/50 bg-status-yellow/10 text-status-yellow' :
                          'border-destructive/50 bg-destructive/10 text-destructive'
                        )}>
                          {contact.relevance_score >= 50 ? '🎯' : contact.relevance_score >= 20 ? '~' : '⚠'} {contact.relevance_score}% fit
                        </Badge>
                      )}
                    </div>
                    {contact.notes && <p className="mt-1 text-[11px] text-muted-foreground">{contact.notes}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="default" className="h-6 px-2 text-[10px]" onClick={() => confirmContact(contact)}>Add</Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setDiscoveredContacts((prev) => prev.filter((_, i) => i !== index))}>Skip</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Org Chart Tree */}
        {totalContacts === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Users className="mx-auto mb-2 h-10 w-10 opacity-20" />
            <p className="text-sm">No stakeholders mapped yet</p>
            <p className="mt-1 text-xs">Drop a screenshot, use AI Discover, or add manually.</p>
          </div>
        ) : (
          <ScrollArea className="w-full">
            <div className="min-w-fit py-4 px-2">
              {roots.length === 1 ? (
                <div className="flex justify-center">
                  {renderTree(roots[0])}
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-4 py-2 text-center shadow-sm">
                    <span className="text-sm font-semibold text-foreground">{accountName}</span>
                  </div>
                  <div className="w-px h-5 bg-border" />
                  <div className="relative flex items-start">
                    {roots.length > 1 && (
                      <div className="absolute top-0 bg-border h-px" style={{ left: `calc(50% / ${roots.length})`, right: `calc(50% / ${roots.length})` }} />
                    )}
                    <div className="flex gap-3 items-start">
                      {roots.map((root: any) => (
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
    </Card>
  );
}
