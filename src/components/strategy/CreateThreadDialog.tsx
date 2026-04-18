/**
 * Create Thread Dialog — object-native thread creation with lane/type/object selection.
 */
import { useState, useEffect } from 'react';
import { Building2, Target, Map, MessageSquare, Search, Mail, FileText, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import type { StrategyLane, StrategyThreadType } from '@/types/strategy';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateThread: (opts: CreateThreadOpts) => void;
}

export interface CreateThreadOpts {
  title: string;
  lane: StrategyLane;
  threadType: StrategyThreadType;
  linkedAccountId?: string;
  linkedOpportunityId?: string;
  linkedTerritoryId?: string;
}

const THREAD_TYPES: {
  value: StrategyThreadType;
  label: string;
  icon: typeof Building2;
  description: string;
  defaultLane: StrategyLane;
}[] = [
  { value: 'account_linked', label: 'Account Strategy', icon: Building2, description: 'Research, plan, and strategize around an account', defaultLane: 'research' },
  { value: 'opportunity_linked', label: 'Opportunity Strategy', icon: Target, description: 'Build and refine deal strategy', defaultLane: 'strategy' },
  { value: 'territory_linked', label: 'Territory Planning', icon: Map, description: 'Tier and prioritize your territory', defaultLane: 'strategy' },
  { value: 'freeform', label: 'Freeform', icon: MessageSquare, description: 'Open-ended strategic workspace', defaultLane: 'brainstorm' },
];

export function CreateThreadDialog({ open, onOpenChange, onCreateThread }: Props) {
  const { user } = useAuth();
  const [threadType, setThreadType] = useState<StrategyThreadType>('freeform');
  const [lane, setLane] = useState<StrategyLane>('research');
  const [title, setTitle] = useState('');
  const [linkedAccountId, setLinkedAccountId] = useState<string>('');
  const [linkedOpportunityId, setLinkedOpportunityId] = useState<string>('');
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [opportunities, setOpportunities] = useState<{ id: string; name: string }[]>([]);
  const [objectSearch, setObjectSearch] = useState('');

  // Load accounts/opportunities for picker
  useEffect(() => {
    if (!open || !user) return;
    const load = async () => {
      const [acctRes, oppRes] = await Promise.all([
        supabase.from('accounts').select('id, name').eq('user_id', user.id).is('deleted_at', null).order('name').limit(100),
        supabase.from('opportunities').select('id, name').eq('user_id', user.id).order('name').limit(100),
      ]);
      if (acctRes.data) setAccounts(acctRes.data);
      if (oppRes.data) setOpportunities(oppRes.data);
    };
    load();
  }, [open, user]);

  // Update lane when type changes
  useEffect(() => {
    const selected = THREAD_TYPES.find(t => t.value === threadType);
    if (selected) setLane(selected.defaultLane);
  }, [threadType]);

  // Auto-generate title from linked object
  useEffect(() => {
    if (threadType === 'account_linked' && linkedAccountId) {
      const acct = accounts.find(a => a.id === linkedAccountId);
      if (acct) setTitle(`${acct.name} — Strategy`);
    } else if (threadType === 'opportunity_linked' && linkedOpportunityId) {
      const opp = opportunities.find(o => o.id === linkedOpportunityId);
      if (opp) setTitle(`${opp.name} — Deal Strategy`);
    } else if (threadType === 'territory_linked') {
      setTitle('Territory Tiering & Planning');
    }
  }, [threadType, linkedAccountId, linkedOpportunityId, accounts, opportunities]);

  // Linkage validity — prevents the "account_linked but no account selected" bug
  // that caused threads to be created with linked_account_id = NULL
  const linkageValid =
    threadType === 'freeform' ||
    threadType === 'territory_linked' ||
    (threadType === 'account_linked' && !!linkedAccountId) ||
    (threadType === 'opportunity_linked' && !!linkedOpportunityId);

  const handleCreate = () => {
    if (!linkageValid) return;
    onCreateThread({
      title: title.trim() || 'Untitled Thread',
      lane,
      threadType,
      linkedAccountId: threadType === 'account_linked' && linkedAccountId ? linkedAccountId : undefined,
      linkedOpportunityId: threadType === 'opportunity_linked' && linkedOpportunityId ? linkedOpportunityId : undefined,
    });
    onOpenChange(false);
    // Reset
    setThreadType('freeform');
    setTitle('');
    setLinkedAccountId('');
    setLinkedOpportunityId('');
    setObjectSearch('');
  };

  const filteredAccounts = objectSearch
    ? accounts.filter(a => a.name.toLowerCase().includes(objectSearch.toLowerCase()))
    : accounts;

  const filteredOpportunities = objectSearch
    ? opportunities.filter(o => o.name.toLowerCase().includes(objectSearch.toLowerCase()))
    : opportunities;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">New Strategy Thread</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Choose a thread type and link to a business object.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Thread Type Picker */}
          <div className="grid grid-cols-2 gap-2">
            {THREAD_TYPES.map(t => {
              const isSelected = threadType === t.value;
              return (
                <button
                  key={t.value}
                  onClick={() => setThreadType(t.value)}
                  className={cn(
                    'flex items-start gap-2.5 p-3 rounded-lg border text-left transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border hover:border-border/80 hover:bg-muted/30'
                  )}
                >
                  <div className={cn(
                    'h-7 w-7 rounded-md flex items-center justify-center shrink-0',
                    isSelected ? 'bg-primary/15' : 'bg-muted/50'
                  )}>
                    <t.icon className={cn('h-3.5 w-3.5', isSelected ? 'text-primary' : 'text-muted-foreground')} />
                  </div>
                  <div className="min-w-0">
                    <p className={cn('text-xs font-medium', isSelected ? 'text-foreground' : 'text-foreground/80')}>{t.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{t.description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Object Picker */}
          {threadType === 'account_linked' && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Link Account</label>
              <Input
                placeholder="Search accounts…"
                value={objectSearch}
                onChange={e => setObjectSearch(e.target.value)}
                className="h-8 text-xs"
              />
              <div className="max-h-32 overflow-y-auto border border-border rounded-md">
                {filteredAccounts.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground p-2 text-center">No accounts found</p>
                ) : (
                  filteredAccounts.slice(0, 20).map(a => (
                    <button
                      key={a.id}
                      onClick={() => { setLinkedAccountId(a.id); setObjectSearch(''); }}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2',
                        linkedAccountId === a.id && 'bg-primary/5 text-primary'
                      )}
                    >
                      <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{a.name}</span>
                      {linkedAccountId === a.id && <Badge variant="secondary" className="text-[8px] px-1 py-0 ml-auto">Selected</Badge>}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {threadType === 'opportunity_linked' && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Link Opportunity</label>
              <Input
                placeholder="Search opportunities…"
                value={objectSearch}
                onChange={e => setObjectSearch(e.target.value)}
                className="h-8 text-xs"
              />
              <div className="max-h-32 overflow-y-auto border border-border rounded-md">
                {filteredOpportunities.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground p-2 text-center">No opportunities found</p>
                ) : (
                  filteredOpportunities.slice(0, 20).map(o => (
                    <button
                      key={o.id}
                      onClick={() => { setLinkedOpportunityId(o.id); setObjectSearch(''); }}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2',
                        linkedOpportunityId === o.id && 'bg-primary/5 text-primary'
                      )}
                    >
                      <Target className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{o.name}</span>
                      {linkedOpportunityId === o.id && <Badge variant="secondary" className="text-[8px] px-1 py-0 ml-auto">Selected</Badge>}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Lane Picker */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Lane</label>
            <Select value={lane} onValueChange={v => setLane(v as StrategyLane)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="research" className="text-xs">Research</SelectItem>
                <SelectItem value="evaluate" className="text-xs">Evaluate</SelectItem>
                <SelectItem value="build" className="text-xs">Build</SelectItem>
                <SelectItem value="strategy" className="text-xs">Strategy</SelectItem>
                <SelectItem value="brainstorm" className="text-xs">Brainstorm</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Thread Title</label>
            <Input
              placeholder="Thread title…"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <Button size="sm" className="w-full" onClick={handleCreate}>
            Create Thread
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
