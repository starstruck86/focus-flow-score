import { useState, useMemo, useEffect } from 'react';
import { useCopilot } from '@/contexts/CopilotContext';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EditableDatePicker } from '@/components/EditableDatePicker';
import { StakeholderMap } from '@/components/StakeholderMap';
import { ResourceLinksPanel } from '@/components/ResourceLinksPanel';
import { TouchLogButtons } from '@/components/TouchLogButtons';
import { LifecycleTierBadge, IcpScorePill, EnrichButton } from '@/components/LifecycleIntelligence';
import { CollapsibleSection, LinkPill, LastTouchIndicator, safeFormat } from '@/components/detail';
import { useDebouncedUpdate } from '@/hooks/useDebouncedUpdate';
import {
  ArrowLeft, ChevronRight, Building2, Target, Users,
  FileText, CheckSquare, Calendar, Sparkles,
} from 'lucide-react';
import { AccountSynopsisModal } from '@/components/AccountSynopsisModal';
import { cn } from '@/lib/utils';
import type { AccountTier, AccountStatus } from '@/types';

const TIER_COLORS: Record<AccountTier, string> = {
  'A': 'border-status-green text-status-green',
  'B': 'border-status-yellow text-status-yellow',
  'C': 'border-muted-foreground text-muted-foreground',
};

const STATUS_COLORS: Record<AccountStatus, string> = {
  'researching': 'bg-blue-500/20 text-blue-400',
  'prepped': 'bg-cyan-500/20 text-cyan-400',
  'active': 'bg-status-green/20 text-status-green',
  'inactive': 'bg-muted text-muted-foreground',
  'disqualified': 'bg-status-red/20 text-status-red',
  'meeting-booked': 'bg-primary/20 text-primary',
};

const STATUS_OPTIONS: { value: AccountStatus; label: string }[] = [
  { value: 'researching', label: 'Researching' },
  { value: 'prepped', label: 'Prepped' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'disqualified', label: 'Disqualified' },
  { value: 'meeting-booked', label: 'Meeting Booked' },
];

export default function AccountDetail() {
  const [showSynopsis, setShowSynopsis] = useState(false);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { accounts, updateAccount, opportunities, renewals, tasks, contacts } = useStore();

  const account = accounts.find(a => a.id === id);

  // Debounced update for text inputs
  const { debouncedUpdate, flush } = useDebouncedUpdate(updateAccount, id || '');

  // Flush pending updates on unmount
  useEffect(() => flush, [flush]);

  const accountOpps = useMemo(() =>
    opportunities.filter(o => o.accountId === id), [opportunities, id]);
  const accountRenewals = useMemo(() =>
    renewals.filter(r => r.accountId === id), [renewals, id]);
  const accountTasks = useMemo(() =>
    tasks.filter(t => t.linkedAccountId === id && t.status !== 'done' && t.status !== 'dropped'),
    [tasks, id]);
  const accountContacts = useMemo(() =>
    contacts.filter(c => c.accountId === id), [contacts, id]);

  const totalArr = useMemo(() =>
    accountOpps.filter(o => o.status === 'active' || o.status === 'closed-won')
      .reduce((sum, o) => sum + (o.arr || 0), 0), [accountOpps]);

  if (!account) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-muted-foreground">Account not found</p>
          <Button variant="outline" onClick={() => navigate('/outreach')}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back to Accounts
          </Button>
        </div>
      </Layout>
    );
  }

  const handleUpdate = (updates: Partial<typeof account>) => {
    updateAccount(account.id, updates);
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button onClick={() => navigate('/outreach')} className="hover:text-foreground transition-colors">
            Accounts
          </button>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium truncate">{account.name}</span>
        </div>

        {/* Highlights Panel */}
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold truncate">{account.name}</h1>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <Badge variant="outline" className={cn("text-[10px] border", TIER_COLORS[account.tier])}>
                      Tier {account.tier}
                    </Badge>
                    <Badge className={cn("text-[10px]", STATUS_COLORS[account.accountStatus])}>
                      {account.accountStatus}
                    </Badge>
                    <IcpScorePill account={account} />
                    {account.motion && (
                      <Badge variant="outline" className="text-[10px]">{account.motion}</Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <LinkPill label="Salesforce" url={account.salesforceLink} />
                <LinkPill label="Website" url={account.website} />
                <LinkPill label="Planhat" url={account.planhatLink} />
                <LinkPill label="Agreement" url={account.currentAgreementLink} />
              </div>
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Pipeline ARR</p>
                <p className="text-lg font-bold">${(totalArr / 1000).toFixed(0)}k</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Opportunities</p>
                <p className="text-lg font-bold">{accountOpps.length}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Renewals</p>
                <p className="text-lg font-bold">{accountRenewals.length}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Contacts</p>
                <p className="text-lg font-bold">{accountContacts.length}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Last Touch</p>
                <LastTouchIndicator date={account.lastTouchDate} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <TouchLogButtons accountId={account.id} compact />
          <EnrichButton account={account} compact />
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowSynopsis(true)}>
            <Sparkles className="h-3.5 w-3.5" />
            Paste Synopsis
          </Button>
        </div>

        <AccountSynopsisModal
          open={showSynopsis}
          onOpenChange={setShowSynopsis}
          account={account}
        />

        {/* Details Section */}
        <CollapsibleSection title="Account Details" icon={Building2} defaultOpen={true}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 py-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={account.accountStatus} onValueChange={v => handleUpdate({ accountStatus: v as AccountStatus })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Tier</Label>
              <Select value={account.tier} onValueChange={v => handleUpdate({ tier: v as AccountTier })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['A', 'B', 'C'] as const).map(t => <SelectItem key={t} value={t}>Tier {t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Priority</Label>
              <Select value={account.priority} onValueChange={v => handleUpdate({ priority: v as any })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Industry</Label>
              <Input className="h-8" defaultValue={account.industry || ''} onBlur={e => handleUpdate({ industry: e.target.value })} placeholder="Industry..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Next Step</Label>
              <Input className="h-8" defaultValue={account.nextStep || ''} onBlur={e => handleUpdate({ nextStep: e.target.value })} placeholder="Next step..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Next Touch Due</Label>
              <EditableDatePicker value={account.nextTouchDue} onChange={v => handleUpdate({ nextTouchDue: v })} placeholder="Set date" />
            </div>
            <div className="space-y-1 col-span-full">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Textarea rows={3} defaultValue={account.notes || ''} onBlur={e => handleUpdate({ notes: e.target.value })} placeholder="Account notes..." />
            </div>
          </div>
        </CollapsibleSection>

        <Separator />

        {/* Opportunities */}
        <CollapsibleSection title="Opportunities" icon={Target} count={accountOpps.length}>
          {accountOpps.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No opportunities linked</p>
          ) : (
            <div className="space-y-2 py-2">
              {accountOpps.map(opp => (
                <button key={opp.id} onClick={() => navigate(`/opportunities/${opp.id}`)}
                  className="w-full text-left p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{opp.name}</span>
                    <div className="flex items-center gap-2">
                      {opp.arr && <span className="text-sm font-mono">${(opp.arr / 1000).toFixed(0)}k</span>}
                      <Badge variant="outline" className="text-[10px]">{opp.stage || 'No Stage'}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {opp.closeDate && <span>Close: {safeFormat(opp.closeDate, 'MMM d')}</span>}
                    {opp.nextStep && <span className="truncate">→ {opp.nextStep}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <Separator />

        {/* Renewals */}
        <CollapsibleSection title="Renewals" icon={Calendar} count={accountRenewals.length}>
          {accountRenewals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No renewals linked</p>
          ) : (
            <div className="space-y-2 py-2">
              {accountRenewals.map(ren => (
                <div key={ren.id} className="p-3 rounded-lg border border-border/50">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{ren.accountName}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono">${(ren.arr / 1000).toFixed(0)}k</span>
                      <Badge variant="outline" className={cn("text-[10px]",
                        ren.healthStatus === 'green' ? 'text-status-green border-status-green' :
                        ren.healthStatus === 'yellow' ? 'text-status-yellow border-status-yellow' :
                        'text-status-red border-status-red'
                      )}>{ren.healthStatus}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>Due: {safeFormat(ren.renewalDue, 'MMM d, yyyy')}</span>
                    {ren.csm && <span>CSM: {ren.csm}</span>}
                    {ren.nextStep && <span className="truncate">→ {ren.nextStep}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <Separator />

        {/* Stakeholders / Contacts */}
        <CollapsibleSection title="Contacts & Stakeholders" icon={Users} count={accountContacts.length}>
          <StakeholderMap
            accountId={account.id}
            accountName={account.name}
            website={account.website}
            industry={account.industry}
          />
        </CollapsibleSection>

        <Separator />

        {/* Open Tasks */}
        <CollapsibleSection title="Open Tasks" icon={CheckSquare} count={accountTasks.length}>
          {accountTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No open tasks</p>
          ) : (
            <div className="space-y-1 py-2">
              {accountTasks.map(task => (
                <div key={task.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                  <Badge variant="outline" className="text-[10px]">{task.priority}</Badge>
                  <span className="text-sm flex-1 truncate">{task.title}</span>
                  {task.dueDate && (
                    <span className="text-xs text-muted-foreground">{safeFormat(task.dueDate, 'MMM d')}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <Separator />

        {/* Resources & Links */}
        <CollapsibleSection title="Resources & Links" icon={FileText}>
          <ResourceLinksPanel recordType="account" recordId={account.id} />
        </CollapsibleSection>
      </div>
    </Layout>
  );
}
