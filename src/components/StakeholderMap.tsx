// Visual Buyer / Org Stakeholder Map with Power Map Coverage Score
import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Users, Sparkles, Crown, Shield, Target, UserCheck, Lightbulb, Ban, ChevronRight, Linkedin, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const BUYER_ROLES = [
  { value: 'economic_buyer', label: 'Economic Buyer', icon: Crown, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30', critical: true },
  { value: 'champion', label: 'Champion', icon: Shield, color: 'text-primary', bg: 'bg-primary/10 border-primary/30', critical: true },
  { value: 'technical_buyer', label: 'Technical Buyer', icon: Target, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/30', critical: false },
  { value: 'user_buyer', label: 'User Buyer', icon: UserCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/30', critical: false },
  { value: 'coach', label: 'Coach', icon: Lightbulb, color: 'text-purple-500', bg: 'bg-purple-500/10 border-purple-500/30', critical: true },
  { value: 'influencer', label: 'Influencer', icon: Users, color: 'text-cyan-500', bg: 'bg-cyan-500/10 border-cyan-500/30', critical: false },
  { value: 'blocker', label: 'Blocker', icon: Ban, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30', critical: false },
  { value: 'unknown', label: 'Unknown', icon: Users, color: 'text-muted-foreground', bg: 'bg-muted/50 border-muted-foreground/20', critical: false },
] as const;

const INFLUENCE_LEVELS = ['high', 'medium', 'low'] as const;
const CRITICAL_ROLES = ['economic_buyer', 'champion', 'coach'];

function getRoleConfig(role: string) {
  return BUYER_ROLES.find(r => r.value === role) || BUYER_ROLES[BUYER_ROLES.length - 1];
}

interface StakeholderMapProps {
  accountId: string;
  accountName: string;
  website?: string;
  industry?: string;
  opportunityContext?: string;
}

export function StakeholderMap({ accountId, accountName, website, industry, opportunityContext }: StakeholderMapProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [discoveredContacts, setDiscoveredContacts] = useState<any[]>([]);

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

  const addContact = useMutation({
    mutationFn: async (contact: any) => {
      const { error } = await supabase.from('contacts').insert({
        ...contact, account_id: accountId, user_id: user!.id, status: 'target',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stakeholder-contacts', accountId] });
      toast.success('Contact added');
    },
  });

  const discoverContacts = useCallback(async () => {
    setIsDiscovering(true);
    try {
      const { data, error } = await supabase.functions.invoke('discover-contacts', {
        body: { accountId, accountName, website, industry, opportunityContext },
      });
      if (error) {
        console.error('discover-contacts invoke error:', error);
        throw new Error(typeof error === 'object' && error.message ? error.message : String(error));
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.success) throw new Error('Discovery returned no results');
      toast.success(`Found ${data.new_contacts || 0} new contacts`);
      return data.contacts || [];
    } catch (err) {
      console.error('Contact discovery failed:', err);
      toast.error('Contact discovery failed', { description: err instanceof Error ? err.message : 'Unknown error' });
      return null;
    } finally {
      setIsDiscovering(false);
    }
  }, [accountId, accountName, website, industry, opportunityContext]);

  const handleDiscover = async () => {
    const result = await discoverContacts();
    if (result) setDiscoveredContacts(result);
  };

  const confirmContact = (contact: any) => {
    addContact.mutate({
      name: contact.name, title: contact.title, department: contact.department || null,
      seniority: contact.seniority || null, linkedin_url: contact.linkedin_url || null,
      buyer_role: contact.buyer_role || 'unknown', influence_level: contact.influence_level || 'medium',
      notes: contact.notes || null, ai_discovered: true, discovery_source: contact.confidence || 'ai',
    });
    setDiscoveredContacts(prev => prev.filter(c => c.name !== contact.name));
  };

  // Group contacts by buyer role
  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const role of BUYER_ROLES) groups[role.value] = [];
    for (const c of (contacts || [])) {
      const role = (c as any).buyer_role || 'unknown';
      if (!groups[role]) groups[role] = [];
      groups[role].push(c);
    }
    return groups;
  }, [contacts]);

  // Power Map Coverage Score
  const powerMapScore = useMemo(() => {
    const mapped = (contacts || []).filter((c: any) => c.buyer_role && c.buyer_role !== 'unknown');
    const coveredRoles = new Set(mapped.map((c: any) => c.buyer_role));
    const criticalCovered = CRITICAL_ROLES.filter(r => coveredRoles.has(r));
    const hasHighInfluence = mapped.some((c: any) => c.influence_level === 'high');
    const hasMultiThread = mapped.length >= 3;

    let score = 0;
    score += criticalCovered.length * 25; // 25 pts each for EB, Champion, Coach
    score += hasHighInfluence ? 10 : 0;
    score += hasMultiThread ? 15 : 0;

    const gaps = CRITICAL_ROLES.filter(r => !coveredRoles.has(r));
    return { score: Math.min(100, score), gaps, criticalCovered, totalMapped: mapped.length };
  }, [contacts]);

  const totalContacts = contacts?.length || 0;
  const mappedContacts = (contacts || []).filter((c: any) => c.buyer_role && c.buyer_role !== 'unknown').length;

  if (isLoading) {
    return <Card className="metric-card"><CardContent className="pt-6"><Skeleton className="h-40 w-full" /></CardContent></Card>;
  }

  return (
    <Card className="metric-card border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Stakeholder Map
            {totalContacts > 0 && (
              <Badge variant="outline" className="text-[10px]">{mappedContacts}/{totalContacts} mapped</Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={handleDiscover} disabled={isDiscovering}>
              <Sparkles className={cn("h-3.5 w-3.5", isDiscovering && "animate-spin")} />
              <span className="ml-1 text-xs">{isDiscovering ? 'Finding...' : 'AI Discover'}</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Power Map Score */}
        {totalContacts > 0 && (
          <div className="p-2.5 rounded-lg border border-border bg-muted/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Power Map Score</span>
              <Badge variant={powerMapScore.score >= 75 ? 'default' : powerMapScore.score >= 40 ? 'secondary' : 'destructive'} className="text-[10px]">
                {powerMapScore.score}/100
              </Badge>
            </div>
            <Progress value={powerMapScore.score} className="h-1.5" />
            {powerMapScore.gaps.length > 0 && (
              <div className="flex items-start gap-1.5 text-[10px] text-amber-500">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>Missing: {powerMapScore.gaps.map(g => getRoleConfig(g).label).join(', ')}</span>
              </div>
            )}
          </div>
        )}

        {/* Discovered contacts pending confirmation */}
        {discoveredContacts.length > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-xs font-medium text-primary">{discoveredContacts.length} contacts discovered — confirm to add:</p>
            {discoveredContacts.map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-2 p-2 rounded bg-background/80">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    {c.linkedin_url && (
                      <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400">
                        <Linkedin className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{c.title}</p>
                  <Badge variant="outline" className={cn("text-[9px] mt-0.5", getRoleConfig(c.buyer_role).bg)}>
                    {getRoleConfig(c.buyer_role).label}
                  </Badge>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="default" className="h-6 text-[10px] px-2" onClick={() => confirmContact(c)}>Add</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setDiscoveredContacts(prev => prev.filter((_, idx) => idx !== i))}>Skip</Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Org Map Visual */}
        {totalContacts === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No stakeholders mapped yet</p>
            <p className="text-xs mt-1">Use AI Discover to find key contacts</p>
          </div>
        ) : (
          <div className="space-y-2">
            {BUYER_ROLES.filter(role => grouped[role.value]?.length > 0).map(role => {
              const RoleIcon = role.icon;
              return (
                <div key={role.value} className={cn("rounded-lg border p-2.5", role.bg)}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <RoleIcon className={cn("h-3.5 w-3.5", role.color)} />
                    <span className="text-xs font-semibold">{role.label}</span>
                    <Badge variant="outline" className="text-[9px] ml-auto">{grouped[role.value].length}</Badge>
                  </div>
                  <div className="space-y-1">
                    {grouped[role.value].map((contact: any) => (
                      <div
                        key={contact.id}
                        className="flex items-center gap-2 p-1.5 rounded bg-background/60 hover:bg-background/80 cursor-pointer group"
                        onClick={() => setEditingContact(editingContact === contact.id ? null : contact.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">{contact.name}</span>
                            {contact.influence_level === 'high' && <span className="text-[9px] text-amber-500">★</span>}
                            {contact.linkedin_url && (
                              <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-blue-500 hover:text-blue-400">
                                <Linkedin className="h-3 w-3" />
                              </a>
                            )}
                            {(contact as any).ai_discovered && <Sparkles className="h-2.5 w-2.5 text-primary/50" />}
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{contact.title || 'No title'}</p>
                        </div>
                        <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", editingContact === contact.id && "rotate-90")} />
                      </div>
                    ))}
                  </div>
                  {grouped[role.value].some((c: any) => editingContact === c.id) && (
                    <div className="mt-2 p-2 rounded bg-background border space-y-2">
                      {(() => {
                        const c = grouped[role.value].find((c: any) => editingContact === c.id);
                        if (!c) return null;
                        return (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <Select value={(c as any).buyer_role || 'unknown'} onValueChange={(v) => updateContact.mutate({ id: c.id, updates: { buyer_role: v } })}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {BUYER_ROLES.map(r => (<SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>))}
                                </SelectContent>
                              </Select>
                              <Select value={(c as any).influence_level || 'medium'} onValueChange={(v) => updateContact.mutate({ id: c.id, updates: { influence_level: v } })}>
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {INFLUENCE_LEVELS.map(l => (<SelectItem key={l} value={l} className="text-xs capitalize">{l} influence</SelectItem>))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Input className="h-7 text-xs" placeholder="LinkedIn URL" defaultValue={c.linkedin_url || ''} onBlur={(e) => {
                              if (e.target.value !== (c.linkedin_url || '')) updateContact.mutate({ id: c.id, updates: { linkedin_url: e.target.value || null } });
                            }} />
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
