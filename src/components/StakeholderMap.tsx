import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
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
  ChevronRight,
  Linkedin,
  AlertTriangle,
  SlidersHorizontal,
  RotateCcw,
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
  { value: 'revenue', label: 'Revenue' },
  { value: 'operations', label: 'Operations' },
  { value: 'it', label: 'IT / Systems' },
  { value: 'executive', label: 'Executive' },
] as const;
const TARGET_COUNTS = ['3', '5', '8', '10'] as const;
const DIVISION_PRESETS = ['', 'Group Benefits', 'Retirement & Income', 'Auto & Home', 'Pharmacy', 'Health', 'Caremark', 'Aetna', 'Digital', 'Corporate'] as const;

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
  }, [accountId, accountName, website, industry, opportunityContext, discoveryMode, maxContacts, focusPrompt, user]);

  const handleDiscover = async () => {
    const result = await discoverContacts();
    if (result) setDiscoveredContacts(result);
  };

  const resetTuning = () => {
    setDiscoveryMode('auto');
    setMaxContacts('5');
    setFocusPrompt(opportunityContext || '');
  };

  const confirmContact = (contact: any) => {
    addContact.mutate({
      name: contact.name,
      title: contact.title,
      department: contact.department || null,
      seniority: contact.seniority || null,
      linkedin_url: contact.linkedin_url || null,
      buyer_role: contact.buyer_role || 'unknown',
      influence_level: contact.influence_level || 'medium',
      notes: contact.notes || null,
      ai_discovered: true,
      discovery_source: lastDiscoveryMeta?.source || contact.confidence || 'ai',
    });
    setDiscoveredContacts((prev) => prev.filter((entry) => entry.name !== contact.name));
  };

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const role of BUYER_ROLES) groups[role.value] = [];
    for (const contact of contacts || []) {
      const role = (contact as any).buyer_role || 'unknown';
      if (!groups[role]) groups[role] = [];
      groups[role].push(contact);
    }
    return groups;
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
    <Card className="metric-card border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Stakeholder Map
              {totalContacts > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {mappedContacts}/{totalContacts} mapped
                </Badge>
              )}
            </CardTitle>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Tune discovery by buyer group, target count, or deal-specific guidance.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setShowTuning((value) => !value)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="ml-1 text-xs">Tune</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDiscover} disabled={isDiscovering}>
              <Sparkles className={cn('h-3.5 w-3.5', isDiscovering && 'animate-spin')} />
              <span className="ml-1 text-xs">{isDiscovering ? 'Finding...' : 'AI Discover'}</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {showTuning && (
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-[1fr_120px]">
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Discovery focus</span>
                <Select value={discoveryMode} onValueChange={setDiscoveryMode}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISCOVERY_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value} className="text-xs">
                        {mode.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Target count</span>
                <Select value={maxContacts} onValueChange={setMaxContacts}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_COUNTS.map((count) => (
                      <SelectItem key={count} value={count} className="text-xs">
                        {count} contacts
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Custom guidance</span>
              <Textarea
                value={focusPrompt}
                onChange={(event) => setFocusPrompt(event.target.value)}
                placeholder="Example: prioritize digital marketing leadership, CRM owner, and the IT approver for this deal."
                className="min-h-[84px] resize-y text-xs"
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">
                {accountName}
                {website ? ` • ${website}` : ''}
                {industry ? ` • ${industry}` : ''}
              </span>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={resetTuning}>
                <RotateCcw className="mr-1 h-3 w-3" />
                Reset
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

        {totalContacts > 0 && (
          <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Power Map Score</span>
              <Badge
                variant={powerMapScore.score >= 75 ? 'default' : powerMapScore.score >= 40 ? 'secondary' : 'destructive'}
                className="text-[10px]"
              >
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

        {discoveredContacts.length > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-xs font-medium text-primary">
              {discoveredContacts.length} contacts discovered — confirm to add:
            </p>
            {discoveredContacts.map((contact, index) => (
              <div key={`${contact.name}-${index}`} className="flex items-start justify-between gap-2 rounded bg-background/80 p-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{contact.name}</span>
                    {contact.linkedin_url && (
                      <a
                        href={contact.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary/80"
                      >
                        <Linkedin className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{contact.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={cn('text-[9px]', getRoleConfig(contact.buyer_role).bg)}>
                      {getRoleConfig(contact.buyer_role).label}
                    </Badge>
                    {contact.confidence && (
                      <Badge variant="outline" className="text-[9px] capitalize">
                        {contact.confidence}
                      </Badge>
                    )}
                  </div>
                  {contact.notes && <p className="mt-1 text-[11px] text-muted-foreground">{contact.notes}</p>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="default" className="h-6 px-2 text-[10px]" onClick={() => confirmContact(contact)}>
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setDiscoveredContacts((prev) => prev.filter((_, currentIndex) => currentIndex !== index))}
                  >
                    Skip
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalContacts === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Users className="mx-auto mb-2 h-10 w-10 opacity-20" />
            <p className="text-sm">No stakeholders mapped yet</p>
            <p className="mt-1 text-xs">Use AI Discover, then tune the focus if results are too narrow.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {BUYER_ROLES.filter((role) => grouped[role.value]?.length > 0).map((role) => {
              const RoleIcon = role.icon;
              return (
                <div key={role.value} className={cn('rounded-lg border p-2.5', role.bg)}>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <RoleIcon className={cn('h-3.5 w-3.5', role.color)} />
                    <span className="text-xs font-semibold">{role.label}</span>
                    <Badge variant="outline" className="ml-auto text-[9px]">
                      {grouped[role.value].length}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {grouped[role.value].map((contact: any) => (
                      <div
                        key={contact.id}
                        className="group flex cursor-pointer items-center gap-2 rounded bg-background/60 p-1.5 hover:bg-background/80"
                        onClick={() => setEditingContact(editingContact === contact.id ? null : contact.id)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{contact.name}</span>
                            {contact.influence_level === 'high' && <span className="text-[9px] text-status-yellow">★</span>}
                            {contact.linkedin_url && (
                              <a
                                href={contact.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                className="text-primary hover:text-primary/80"
                              >
                                <Linkedin className="h-3 w-3" />
                              </a>
                            )}
                            {(contact as any).ai_discovered && <Sparkles className="h-2.5 w-2.5 text-primary/60" />}
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">{contact.title || 'No title'}</p>
                        </div>
                        <ChevronRight className={cn('h-3 w-3 text-muted-foreground transition-transform', editingContact === contact.id && 'rotate-90')} />
                      </div>
                    ))}
                  </div>

                  {grouped[role.value].some((contact: any) => editingContact === contact.id) && (
                    <div className="mt-2 space-y-2 rounded border bg-background p-2">
                      {(() => {
                        const currentContact = grouped[role.value].find((contact: any) => editingContact === contact.id);
                        if (!currentContact) return null;
                        return (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <Select
                                value={(currentContact as any).buyer_role || 'unknown'}
                                onValueChange={(value) => updateContact.mutate({ id: currentContact.id, updates: { buyer_role: value } })}
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {BUYER_ROLES.map((entry) => (
                                    <SelectItem key={entry.value} value={entry.value} className="text-xs">
                                      {entry.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={(currentContact as any).influence_level || 'medium'}
                                onValueChange={(value) => updateContact.mutate({ id: currentContact.id, updates: { influence_level: value } })}
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {INFLUENCE_LEVELS.map((level) => (
                                    <SelectItem key={level} value={level} className="text-xs capitalize">
                                      {level} influence
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Input
                              className="h-7 text-xs"
                              placeholder="LinkedIn URL"
                              defaultValue={currentContact.linkedin_url || ''}
                              onBlur={(event) => {
                                if (event.target.value !== (currentContact.linkedin_url || '')) {
                                  updateContact.mutate({
                                    id: currentContact.id,
                                    updates: { linkedin_url: event.target.value || null },
                                  });
                                }
                              }}
                            />
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
