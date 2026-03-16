import { useState, useMemo, useEffect } from 'react';
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
import { CollapsibleSection, LinkPill, safeFormat, safeDaysSince } from '@/components/detail';
import { useDebouncedUpdate } from '@/hooks/useDebouncedUpdate';
import {
  ArrowLeft, ChevronRight, Target, Users,
  FileText, CheckSquare, TrendingUp, Building2,
  Activity, Sparkles, Network,
} from 'lucide-react';
import { ClaudeSynopsisModal } from '@/components/ClaudeSynopsisModal';
import { OrgChartView } from '@/components/OrgChartView';
import { cn } from '@/lib/utils';
import type { OpportunityStage, OpportunityStatus, DealType, ChurnRisk } from '@/types';

const STATUS_COLORS: Record<OpportunityStatus, string> = {
  'active': 'bg-status-green/20 text-status-green',
  'stalled': 'bg-status-yellow/20 text-status-yellow',
  'closed-lost': 'bg-status-red/20 text-status-red',
  'closed-won': 'bg-green-600/20 text-green-400',
};

const STAGE_OPTIONS: OpportunityStage[] = ['', 'Prospect', 'Discover', 'Demo', 'Proposal', 'Negotiate', 'Closed Won', 'Closed Lost'];
const STAGE_LABELS: Record<string, string> = {
  '': '—', 'Prospect': '1 - Prospect', 'Discover': '2 - Discover', 'Demo': '3 - Demo',
  'Proposal': '4 - Proposal', 'Negotiate': '5 - Negotiate', 'Closed Won': '6 - Closed Won', 'Closed Lost': '7 - Closed Lost',
};

const STAGE_COLORS: Record<string, string> = {
  '': 'bg-muted', 'Prospect': 'bg-blue-500', 'Discover': 'bg-cyan-500', 'Demo': 'bg-status-yellow',
  'Proposal': 'bg-orange-500', 'Negotiate': 'bg-purple-500', 'Closed Won': 'bg-status-green', 'Closed Lost': 'bg-status-red',
};

function StagePath({ currentStage }: { currentStage: OpportunityStage }) {
  const stages = STAGE_OPTIONS.filter(s => s !== '' && s !== 'Closed Lost');
  const currentIdx = stages.indexOf(currentStage as any);
  const isClosed = currentStage === 'Closed Lost';

  return (
    <div className="flex items-center gap-1 w-full">
      {stages.map((stage, i) => (
        <div key={stage} className="flex-1 flex flex-col items-center gap-1">
          <div className={cn(
            "h-1.5 w-full rounded-full transition-colors",
            i <= currentIdx && !isClosed ? STAGE_COLORS[stage] : 'bg-muted',
            isClosed && 'bg-status-red/30'
          )} />
          <span className={cn("text-[9px] leading-tight text-center",
            i === currentIdx ? 'text-foreground font-medium' : 'text-muted-foreground'
          )}>{stage}</span>
        </div>
      ))}
    </div>
  );
}

export default function OpportunityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { accounts, opportunities, updateOpportunity, tasks } = useStore();

  const opp = opportunities.find(o => o.id === id);
  const linkedAccount = opp ? accounts.find(a => a.id === opp.accountId) : null;

  const { debouncedUpdate, flush } = useDebouncedUpdate(updateOpportunity, id || '');
  useEffect(() => flush, [flush]);
  const [showSynopsis, setShowSynopsis] = useState(false);

  const oppTasks = useMemo(() =>
    tasks.filter(t => t.linkedOpportunityId === id && t.status !== 'done' && t.status !== 'dropped'),
    [tasks, id]);

  if (!opp) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-muted-foreground">Opportunity not found</p>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Go Back
          </Button>
        </div>
      </Layout>
    );
  }

  const handleUpdate = (updates: Partial<typeof opp>) => {
    updateOpportunity(opp.id, updates);
  };

  const daysInStage = safeDaysSince(opp.updatedAt) ?? 0;
  const daysSinceTouch = safeDaysSince(opp.lastTouchDate);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {linkedAccount ? (
            <>
              <button onClick={() => navigate('/outreach')} className="hover:text-foreground transition-colors">Accounts</button>
              <ChevronRight className="h-3 w-3" />
              <button onClick={() => navigate(`/accounts/${linkedAccount.id}`)} className="hover:text-foreground transition-colors">
                {linkedAccount.name}
              </button>
            </>
          ) : (
            <button onClick={() => navigate(-1)} className="hover:text-foreground transition-colors">Back</button>
          )}
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium truncate">{opp.name}</span>
        </div>

        {/* Highlights Panel */}
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <h1 className="text-xl font-bold truncate">{opp.name}</h1>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <Badge className={cn("text-[10px]", STATUS_COLORS[opp.status])}>
                    {opp.status.replace('-', ' ')}
                  </Badge>
                  {opp.dealType && <Badge variant="outline" className="text-[10px]">{opp.dealType}</Badge>}
                  {linkedAccount && (
                    <button onClick={() => navigate(`/accounts/${linkedAccount.id}`)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <Building2 className="h-3 w-3" />{linkedAccount.name}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowSynopsis(true)}>
                  <Sparkles className="h-3.5 w-3.5" /> Paste Synopsis
                </Button>
                <LinkPill label="Salesforce" url={opp.salesforceLink} />
              </div>
            </div>

            <div className="mt-4">
              <StagePath currentStage={opp.stage} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">ARR</p>
                <p className="text-lg font-bold">{opp.arr ? `$${(opp.arr / 1000).toFixed(0)}k` : '—'}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Close Date</p>
                <p className="text-sm font-medium">{safeFormat(opp.closeDate, 'MMM d')}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Days in Stage</p>
                <p className="text-lg font-bold">{daysInStage}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Last Touch</p>
                <p className={cn("text-sm font-medium",
                  daysSinceTouch === null ? 'text-muted-foreground' :
                  daysSinceTouch <= 3 ? 'text-status-green' : daysSinceTouch <= 7 ? 'text-status-yellow' : 'text-status-red'
                )}>{daysSinceTouch !== null ? `${daysSinceTouch}d ago` : '—'}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/30">
                <p className="text-[10px] uppercase text-muted-foreground tracking-wider">Activities</p>
                <p className="text-lg font-bold">{opp.activityLog.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <TouchLogButtons accountId={opp.accountId || ''} compact />
        </div>

        {/* Details */}
        <CollapsibleSection title="Deal Details" icon={Target} defaultOpen={true}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 py-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Account</Label>
              <Select value={opp.accountId || 'none'} onValueChange={v => handleUpdate({
                accountId: v === 'none' ? undefined : v,
                accountName: v === 'none' ? undefined : accounts.find(a => a.id === v)?.name
              })}>
                <SelectTrigger className="h-8"><SelectValue placeholder="Select account..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No account</SelectItem>
                  {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Stage</Label>
              <Select value={opp.stage || 'none'} onValueChange={v => handleUpdate({ stage: (v === 'none' ? '' : v) as OpportunityStage })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {STAGE_OPTIONS.filter(s => s).map(s => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">ARR</Label>
              <Input className="h-8" type="number" defaultValue={opp.arr || ''} onBlur={e => handleUpdate({ arr: e.target.value ? Number(e.target.value) : undefined })} placeholder="$0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Close Date</Label>
              <EditableDatePicker value={opp.closeDate} onChange={v => handleUpdate({ closeDate: v })} placeholder="Select date" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={opp.status} onValueChange={v => handleUpdate({ status: v as OpportunityStatus })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="stalled">Stalled</SelectItem>
                  <SelectItem value="closed-won">Closed Won</SelectItem>
                  <SelectItem value="closed-lost">Closed Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Deal Type</Label>
              <Select value={opp.dealType || 'none'} onValueChange={v => handleUpdate({ dealType: v === 'none' ? undefined : v as DealType })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="new-logo">New Logo</SelectItem>
                  <SelectItem value="expansion">Expansion</SelectItem>
                  <SelectItem value="renewal">Renewal</SelectItem>
                  <SelectItem value="one-time">One-Time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Churn Risk</Label>
              <Select value={opp.churnRisk || 'none'} onValueChange={v => handleUpdate({ churnRisk: v === 'none' ? undefined : v as ChurnRisk })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="certain">Certain</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Next Step Date</Label>
              <EditableDatePicker value={opp.nextStepDate} onChange={v => handleUpdate({ nextStepDate: v })} placeholder="Set date" />
            </div>
            <div className="space-y-1 col-span-full">
              <Label className="text-xs text-muted-foreground">Next Step</Label>
              <Input className="h-8" defaultValue={opp.nextStep || ''} onBlur={e => handleUpdate({ nextStep: e.target.value })} placeholder="Next step..." />
            </div>
            <div className="space-y-1 col-span-full">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Textarea rows={3} defaultValue={opp.notes || ''} onBlur={e => handleUpdate({ notes: e.target.value })} placeholder="Deal notes..." />
            </div>
          </div>
        </CollapsibleSection>

        <Separator />

        {/* Financial Details for renewals */}
        {(opp.dealType === 'renewal' || opp.dealType === 'expansion') && (
          <>
            <CollapsibleSection title="Renewal / Financial Details" icon={TrendingUp} defaultOpen={false}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 py-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Prior Contract ARR</Label>
                  <Input className="h-8" type="number" defaultValue={opp.priorContractArr || ''}
                    onBlur={e => handleUpdate({ priorContractArr: e.target.value ? Number(e.target.value) : undefined })} placeholder="$0" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Renewal ARR</Label>
                  <Input className="h-8" type="number" defaultValue={opp.renewalArr || ''}
                    onBlur={e => handleUpdate({ renewalArr: e.target.value ? Number(e.target.value) : undefined })} placeholder="$0" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">One-Time Amount</Label>
                  <Input className="h-8" type="number" defaultValue={opp.oneTimeAmount || ''}
                    onBlur={e => handleUpdate({ oneTimeAmount: e.target.value ? Number(e.target.value) : undefined })} placeholder="$0" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Term (months)</Label>
                  <Input className="h-8" type="number" defaultValue={opp.termMonths || ''}
                    onBlur={e => handleUpdate({ termMonths: e.target.value ? Number(e.target.value) : undefined })} placeholder="12" />
                </div>
              </div>
            </CollapsibleSection>
            <Separator />
          </>
        )}

        {/* Org Chart */}
        {opp.accountId && linkedAccount && (
          <>
            <CollapsibleSection title="Org Chart" icon={Network} defaultOpen={false}>
              <OrgChartView
                accountId={opp.accountId}
                accountName={linkedAccount.name}
                website={linkedAccount.website}
                industry={linkedAccount.industry}
              />
            </CollapsibleSection>
            <Separator />
          </>
        )}

        {/* Stakeholders */}
        {opp.accountId && linkedAccount && (
          <>
            <CollapsibleSection title="Stakeholder Map" icon={Users}>
              <StakeholderMap
                accountId={opp.accountId}
                accountName={linkedAccount.name}
                website={linkedAccount.website}
                industry={linkedAccount.industry}
                opportunityContext={`${opp.name} - ${opp.stage} - $${opp.arr || 0} ARR`}
              />
            </CollapsibleSection>
            <Separator />
          </>
        )}

        {/* Tasks */}
        <CollapsibleSection title="Tasks" icon={CheckSquare} count={oppTasks.length}>
          {oppTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No open tasks</p>
          ) : (
            <div className="space-y-1 py-2">
              {oppTasks.map(task => (
                <div key={task.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                  <Badge variant="outline" className="text-[10px]">{task.priority}</Badge>
                  <span className="text-sm flex-1 truncate">{task.title}</span>
                  {task.dueDate && <span className="text-xs text-muted-foreground">{safeFormat(task.dueDate, 'MMM d')}</span>}
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        <Separator />

        {/* Resources */}
        <CollapsibleSection title="Resources & Links" icon={FileText}>
          <ResourceLinksPanel recordType="opportunity" recordId={opp.id} parentAccountId={opp.accountId} />
        </CollapsibleSection>

        <Separator />

        {/* Activity Log */}
        <CollapsibleSection title="Activity Timeline" icon={Activity} count={opp.activityLog.length} defaultOpen={true}>
          {opp.activityLog.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No activities logged yet</p>
          ) : (
            <div className="space-y-2 py-2">
              {[...opp.activityLog].reverse().map(activity => (
                <div key={activity.id} className="flex items-start gap-3 p-2 rounded-lg bg-muted/30">
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {safeFormat(activity.date, 'MMM d')}
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-medium capitalize">{activity.type.replace('-', ' ')}</span>
                    {activity.notes && <p className="text-xs text-muted-foreground">{activity.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      </div>

      <ClaudeSynopsisModal
        open={showSynopsis}
        onOpenChange={setShowSynopsis}
        opportunity={opp}
      />
    </Layout>
  );
}
