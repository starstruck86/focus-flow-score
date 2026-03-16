import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkles, Users, CheckCircle2, XCircle, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface BatchResult {
  accountId: string;
  accountName?: string;
  success?: boolean;
  error?: string;
  new_contacts?: number;
  total_found?: number;
  contacts?: any[];
}

export function BatchDiscoveryModal({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [discoveryMode, setDiscoveryMode] = useState('auto');
  const [maxContacts, setMaxContacts] = useState('5');
  const [searchFilter, setSearchFilter] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [progress, setProgress] = useState(0);

  const { data: accounts } = useQuery({
    queryKey: ['batch-discovery-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, name, industry, website, tier, priority')
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!user,
  });

  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    if (!searchFilter.trim()) return accounts;
    const lower = searchFilter.toLowerCase();
    return accounts.filter((a) => a.name.toLowerCase().includes(lower));
  }, [accounts, searchFilter]);

  const toggleAccount = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredAccounts.map((a) => a.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const runBatchDiscovery = async () => {
    if (selectedIds.size === 0) return;
    setIsRunning(true);
    setResults([]);
    setProgress(0);

    const ids = Array.from(selectedIds);
    const batchResults: BatchResult[] = [];

    // Process one at a time to avoid edge function timeouts
    for (let i = 0; i < ids.length; i++) {
      const accountId = ids[i];
      const account = accounts?.find((a) => a.id === accountId);
      setProgress(Math.round(((i) / ids.length) * 100));

      try {
        const { data, error } = await supabase.functions.invoke('discover-contacts', {
          body: {
            accountId,
            accountName: account?.name,
            website: account?.website,
            industry: account?.industry,
            discoveryMode,
            maxContacts: Number(maxContacts),
          },
        });

        if (error) {
          batchResults.push({ accountId, accountName: account?.name, error: String(error.message || error) });
        } else if (data?.error) {
          batchResults.push({ accountId, accountName: account?.name || data.accountName, error: data.error });
        } else {
          batchResults.push({
            accountId,
            accountName: account?.name || data.accountName,
            success: true,
            new_contacts: data.new_contacts,
            total_found: data.total_found,
            contacts: data.contacts,
          });
        }
      } catch (err) {
        batchResults.push({
          accountId,
          accountName: account?.name,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      setResults([...batchResults]);
    }

    setProgress(100);
    setIsRunning(false);

    const succeeded = batchResults.filter((r) => r.success);
    const totalNew = succeeded.reduce((sum, r) => sum + (r.new_contacts || 0), 0);
    toast.success(`Batch discovery complete`, {
      description: `${succeeded.length}/${ids.length} accounts • ${totalNew} total new contacts found`,
    });

    // Invalidate stakeholder queries for all processed accounts
    for (const id of ids) {
      qc.invalidateQueries({ queryKey: ['stakeholder-contacts', id] });
    }
  };

  const confirmAllDiscovered = async () => {
    if (!user) return;
    let added = 0;
    for (const result of results) {
      if (!result.success || !result.contacts?.length) continue;
      for (const contact of result.contacts) {
        const { error } = await supabase.from('contacts').insert({
          account_id: result.accountId,
          user_id: user.id,
          name: contact.name,
          title: contact.title,
          department: contact.department || null,
          seniority: contact.seniority || null,
          linkedin_url: contact.linkedin_url || null,
          buyer_role: contact.buyer_role || 'unknown',
          influence_level: contact.influence_level || 'medium',
          notes: contact.notes || null,
          ai_discovered: true,
          discovery_source: 'batch-discovery',
          status: 'target',
        });
        if (!error) added++;
      }
    }
    toast.success(`Added ${added} contacts across ${results.filter((r) => r.success).length} accounts`);
    for (const r of results) {
      qc.invalidateQueries({ queryKey: ['stakeholder-contacts', r.accountId] });
    }
    setResults([]);
  };

  const totalNewContacts = results.filter((r) => r.success).reduce((s, r) => s + (r.new_contacts || 0), 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-display">
            <Users className="h-4 w-4 text-primary" />
            Batch Stakeholder Discovery
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter accounts..."
              className="h-8 text-xs pl-8"
            />
          </div>
          <Select value={discoveryMode} onValueChange={setDiscoveryMode}>
            <SelectTrigger className="h-8 text-xs w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DISCOVERY_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={maxContacts} onValueChange={setMaxContacts}>
            <SelectTrigger className="h-8 text-xs w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['3', '5', '8', '10'].map((c) => (
                <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{selectedIds.size} selected</span>
          <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={selectAll}>
            Select all ({filteredAccounts.length})
          </Button>
          {selectedIds.size > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={clearSelection}>
              Clear
            </Button>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0 max-h-[300px] border rounded-lg">
          <div className="p-2 space-y-0.5">
            {filteredAccounts.map((account) => (
              <label
                key={account.id}
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors',
                  selectedIds.has(account.id) && 'bg-primary/5'
                )}
              >
                <Checkbox
                  checked={selectedIds.has(account.id)}
                  onCheckedChange={() => toggleAccount(account.id)}
                  disabled={isRunning}
                />
                <span className="flex-1 text-xs font-medium truncate">{account.name}</span>
                {account.tier && (
                  <Badge variant="outline" className="text-[9px]">{account.tier}</Badge>
                )}
                {account.industry && (
                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{account.industry}</span>
                )}
                {results.find((r) => r.accountId === account.id) && (
                  results.find((r) => r.accountId === account.id)?.success ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-status-green shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  )
                )}
              </label>
            ))}
          </div>
        </ScrollArea>

        {isRunning && (
          <div className="space-y-1">
            <Progress value={progress} className="h-1.5" />
            <p className="text-[11px] text-muted-foreground text-center">
              Processing {results.length}/{selectedIds.size} accounts...
            </p>
          </div>
        )}

        {results.length > 0 && !isRunning && (
          <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">
                Results: {results.filter((r) => r.success).length}/{results.length} succeeded • {totalNewContacts} new contacts
              </span>
              {totalNewContacts > 0 && (
                <Button size="sm" className="h-7 text-xs" onClick={confirmAllDiscovered}>
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Add all {totalNewContacts} contacts
                </Button>
              )}
            </div>
            <div className="space-y-1 max-h-[120px] overflow-y-auto">
              {results.map((r) => (
                <div key={r.accountId} className="flex items-center gap-2 text-[11px]">
                  {r.success ? (
                    <CheckCircle2 className="h-3 w-3 text-status-green shrink-0" />
                  ) : (
                    <XCircle className="h-3 w-3 text-destructive shrink-0" />
                  )}
                  <span className="font-medium truncate">{r.accountName}</span>
                  {r.success ? (
                    <span className="text-muted-foreground ml-auto shrink-0">{r.new_contacts} new</span>
                  ) : (
                    <span className="text-destructive ml-auto truncate max-w-[200px]">{r.error}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isRunning}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={runBatchDiscovery}
            disabled={isRunning || selectedIds.size === 0}
          >
            {isRunning ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Running...</>
            ) : (
              <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Discover ({selectedIds.size})</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
