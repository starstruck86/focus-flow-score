import React, { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Search,
  Plus,
  MoreHorizontal,
  Filter,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EditableDatePicker } from '@/components/EditableDatePicker';
import { OpportunityDetailsField } from '@/components/OpportunityDetailsField';
import { ClosedWonModal } from '@/components/quota/ClosedWonModal';
import { OpportunityNameCell } from '@/components/table/ClickableNameCell';
import type { Opportunity, OpportunityStatus, OpportunityStage, ChurnRisk, DealType } from '@/types';
import { format, parseISO, isToday, isPast, isThisQuarter } from 'date-fns';
import { 
  useDbOpportunities, 
  useDbRenewals, 
  useUpdateOpportunity, 
  useDeleteOpportunity, 
  useAddOpportunity,
  useUpdateRenewal,
  type DbOpportunity,
  type DbRenewal,
} from '@/hooks/useAccountsData';

const STATUS_COLORS: Record<OpportunityStatus, string> = {
  'active': 'bg-status-green/20 text-status-green',
  'stalled': 'bg-status-yellow/20 text-status-yellow',
  'closed-lost': 'bg-status-red/20 text-status-red',
  'closed-won': 'bg-green-600/20 text-green-400',
};

const CHURN_RISK_COLORS: Record<ChurnRisk, string> = {
  'certain': 'bg-green-600/20 text-green-400',
  'low': 'bg-status-green/20 text-status-green',
  'medium': 'bg-status-yellow/20 text-status-yellow',
  'high': 'bg-status-red/20 text-status-red',
};

const STATUS_ORDER: OpportunityStatus[] = ['active', 'stalled', 'closed-lost', 'closed-won'];

const STAGE_OPTIONS: OpportunityStage[] = ['', 'Prospect', 'Discover', 'Demo', 'Proposal', 'Negotiate', 'Closed Won', 'Closed Lost'];

const STAGE_LABELS: Record<string, string> = {
  '': '—',
  'Prospect': '1 - Prospect',
  'Discover': '2 - Discover',
  'Demo': '3 - Demo',
  'Proposal': '4 - Proposal',
  'Negotiate': '5 - Negotiate',
  'Closed Won': '6 - Closed Won',
  'Closed Lost': '7 - Closed Lost',
};

type SavedView = 'all' | 'active' | 'stalled' | 'next-step-due' | 'closing-this-quarter' | 'no-next-step';

// Transform database opportunity to UI format
function dbToUiOpportunity(db: DbOpportunity): Opportunity {
  return {
    id: db.id,
    name: db.name,
    accountId: db.account_id ?? undefined,
    salesforceLink: db.salesforce_link ?? undefined,
    salesforceId: db.salesforce_id ?? undefined,
    linkedContactIds: [],
    status: (db.status as OpportunityStatus) || 'active',
    stage: (db.stage as OpportunityStage) || '',
    arr: db.arr ?? undefined,
    churnRisk: (db.churn_risk as ChurnRisk) ?? undefined,
    closeDate: db.close_date ?? undefined,
    nextStep: db.next_step ?? undefined,
    nextStepDate: db.next_step_date ?? undefined,
    lastTouchDate: db.last_touch_date ?? undefined,
    notes: db.notes ?? undefined,
    activityLog: (db.activity_log as any[]) || [],
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    dealType: (db.deal_type as DealType) ?? undefined,
    paymentTerms: db.payment_terms as any,
    termMonths: db.term_months ?? undefined,
    priorContractArr: db.prior_contract_arr ?? undefined,
    renewalArr: db.renewal_arr ?? undefined,
    oneTimeAmount: db.one_time_amount ?? undefined,
    isNewLogo: db.is_new_logo ?? undefined,
  };
}

// Transform database renewal to simplified format for filtering
interface RenewalForFilter {
  id: string;
  linkedOpportunityId?: string;
  accountName: string;
  arr: number;
  renewalDue: string;
  churnRisk?: ChurnRisk;
}

function dbToRenewalFilter(db: DbRenewal): RenewalForFilter {
  return {
    id: db.id,
    linkedOpportunityId: db.linked_opportunity_id ?? undefined,
    accountName: db.account_name,
    arr: db.arr,
    renewalDue: db.renewal_due,
    churnRisk: (db.churn_risk as ChurnRisk) ?? undefined,
  };
}

interface OpportunitiesTableProps {
  onOpenDrawer: (opportunity: Opportunity) => void;
  renewalsOnly?: boolean;
  excludeRenewals?: boolean;
  showChurnRisk?: boolean;
  columnOrder?: 'default' | 'outreach';
}

export function OpportunitiesTable({ onOpenDrawer, renewalsOnly = false, excludeRenewals = false, showChurnRisk = true, columnOrder = 'default' }: OpportunitiesTableProps) {
  // Database hooks
  const { data: dbOpportunities = [], isLoading: oppsLoading } = useDbOpportunities();
  const { data: dbRenewals = [], isLoading: renewalsLoading } = useDbRenewals();
  const updateOpportunityMutation = useUpdateOpportunity();
  const deleteOpportunityMutation = useDeleteOpportunity();
  const addOpportunityMutation = useAddOpportunity();
  const updateRenewalMutation = useUpdateRenewal();

  // Transform DB data to UI format
  const opportunities = useMemo(() => dbOpportunities.map(dbToUiOpportunity), [dbOpportunities]);
  const renewals = useMemo(() => dbRenewals.map(dbToRenewalFilter), [dbRenewals]);

  // Wrapper functions for mutations
  const updateOpportunity = (id: string, updates: Partial<Opportunity>) => {
    // Transform UI updates to DB format
    const dbUpdates: Partial<DbOpportunity> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.stage !== undefined) dbUpdates.stage = updates.stage;
    if (updates.arr !== undefined) dbUpdates.arr = updates.arr;
    if (updates.churnRisk !== undefined) dbUpdates.churn_risk = updates.churnRisk;
    if (updates.closeDate !== undefined) dbUpdates.close_date = updates.closeDate;
    if (updates.nextStep !== undefined) dbUpdates.next_step = updates.nextStep;
    if (updates.nextStepDate !== undefined) dbUpdates.next_step_date = updates.nextStepDate;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    if (updates.dealType !== undefined) dbUpdates.deal_type = updates.dealType;
    if (updates.paymentTerms !== undefined) dbUpdates.payment_terms = updates.paymentTerms;
    if (updates.termMonths !== undefined) dbUpdates.term_months = updates.termMonths;
    if (updates.priorContractArr !== undefined) dbUpdates.prior_contract_arr = updates.priorContractArr;
    if (updates.renewalArr !== undefined) dbUpdates.renewal_arr = updates.renewalArr;
    if (updates.oneTimeAmount !== undefined) dbUpdates.one_time_amount = updates.oneTimeAmount;
    if (updates.isNewLogo !== undefined) dbUpdates.is_new_logo = updates.isNewLogo;
    updateOpportunityMutation.mutate({ id, updates: dbUpdates });
  };

  const deleteOpportunity = (id: string) => {
    deleteOpportunityMutation.mutate(id);
  };

  const updateRenewal = (id: string, updates: { linkedOpportunityId?: string }) => {
    const dbUpdates: Partial<DbRenewal> = {};
    if (updates.linkedOpportunityId !== undefined) dbUpdates.linked_opportunity_id = updates.linkedOpportunityId;
    updateRenewalMutation.mutate({ id, updates: dbUpdates });
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [savedView, setSavedView] = useState<SavedView>('all');
  const [showAddRow, setShowAddRow] = useState(false);
  const [newOppName, setNewOppName] = useState('');
  const [selectedRenewalId, setSelectedRenewalId] = useState('');
  const [closedWonModalOpen, setClosedWonModalOpen] = useState(false);
  const [closedWonOpportunity, setClosedWonOpportunity] = useState<Opportunity | null>(null);
  const [expandedOppIds, setExpandedOppIds] = useState<Set<string>>(new Set());

  // Get renewals that don't have linked opportunities yet (for adding new renewal opps)
  const renewalsWithoutOpps = useMemo(() => {
    return renewals.filter(r => !r.linkedOpportunityId || !opportunities.some(o => o.id === r.linkedOpportunityId));
  }, [renewals, opportunities]);

  // Handle status change - trigger modal for Closed Won
  const handleStatusChange = (opp: Opportunity, newStatus: OpportunityStatus) => {
    if (newStatus === 'closed-won' && opp.status !== 'closed-won') {
      // Open modal to collect required fields
      setClosedWonOpportunity(opp);
      setClosedWonModalOpen(true);
    } else {
      updateOpportunity(opp.id, { status: newStatus });
    }
  };

  const handleClosedWonSave = (updates: Partial<Opportunity>) => {
    if (closedWonOpportunity) {
      updateOpportunity(closedWonOpportunity.id, updates);
    }
    setClosedWonOpportunity(null);
  };

  // Get renewal-linked opportunity IDs
  const renewalOpportunityIds = useMemo(() => {
    return new Set(renewals.filter(r => r.linkedOpportunityId).map(r => r.linkedOpportunityId));
  }, [renewals]);


  const filteredOpportunities = useMemo(() => {
    let filtered = opportunities.filter(opp =>
      opp.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Filter to only renewal opportunities if renewalsOnly is true
    if (renewalsOnly) {
      filtered = filtered.filter(opp => renewalOpportunityIds.has(opp.id));
    }
    
    // Exclude renewal opportunities if excludeRenewals is true (for New Logo tab)
    if (excludeRenewals) {
      filtered = filtered.filter(opp => !renewalOpportunityIds.has(opp.id));
    }

    switch (savedView) {
      case 'active':
        filtered = filtered.filter(o => o.status === 'active');
        break;
      case 'stalled':
        filtered = filtered.filter(o => o.status === 'stalled');
        break;
      case 'next-step-due':
        filtered = filtered.filter(o => {
          if (!o.nextStepDate) return false;
          const date = parseISO(o.nextStepDate);
          return isToday(date) || isPast(date);
        });
        break;
      case 'closing-this-quarter':
        filtered = filtered.filter(o => {
          if (!o.closeDate) return false;
          return isThisQuarter(parseISO(o.closeDate));
        });
        break;
      case 'no-next-step':
        filtered = filtered.filter(o => !o.nextStepDate && o.nextStep !== 'TBD');
        break;
    }

    return filtered;
  }, [opportunities, searchQuery, savedView, renewalsOnly, excludeRenewals, renewalOpportunityIds]);

  // Group by status
  const groupedOpportunities = useMemo(() => {
    const groups: Record<OpportunityStatus, Opportunity[]> = {
      'active': [],
      'stalled': [],
      'closed-lost': [],
      'closed-won': [],
    };

    filteredOpportunities.forEach(opp => {
      groups[opp.status].push(opp);
    });

    return groups;
  }, [filteredOpportunities]);

  const handleAddOpportunity = async () => {
    if (!newOppName.trim()) return;
    
    // If we're in renewalsOnly mode and a renewal is selected, link the opportunity to it
    if (renewalsOnly && selectedRenewalId) {
      const renewal = renewals.find(r => r.id === selectedRenewalId);
      if (renewal) {
        // Calculate close date as day before renewal date
        const dueDate = new Date(renewal.renewalDue);
        const closeDateObj = new Date(dueDate);
        closeDateObj.setDate(closeDateObj.getDate() - 1);
        const closeDate = closeDateObj.toISOString().split('T')[0];
        
        // Add the opportunity with renewal details and link to renewal
        try {
          const result = await addOpportunityMutation.mutateAsync({
            name: newOppName.trim(),
            status: 'active',
            stage: '1 - Prospect',
            arr: renewal.arr,
            churn_risk: renewal.churnRisk || 'low',
            close_date: closeDate,
          });
          
          // Link the new opportunity to the renewal
          if (result?.id) {
            updateRenewal(renewal.id, { linkedOpportunityId: result.id });
          }
        } catch (error) {
          console.error('Failed to add opportunity:', error);
        }
      }
    } else {
      // Regular opportunity creation
      addOpportunityMutation.mutate({
        name: newOppName.trim(),
        status: 'active',
        stage: '1 - Prospect',
      });
    }
    
    setNewOppName('');
    setSelectedRenewalId('');
    setShowAddRow(false);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      return format(parseISO(dateStr), 'M/d/yy');
    } catch {
      return dateStr;
    }
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Cell components for reordering
  const StatusCell = ({ opp }: { opp: Opportunity }) => (
    <TableCell>
      <Select
        value={opp.status}
        onValueChange={(v) => handleStatusChange(opp, v as OpportunityStatus)}
      >
        <SelectTrigger className="h-7 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="stalled">Stalled</SelectItem>
          <SelectItem value="closed-lost">Closed Lost</SelectItem>
          <SelectItem value="closed-won">Closed Won</SelectItem>
        </SelectContent>
      </Select>
    </TableCell>
  );

  const NameCell = ({ opp }: { opp: Opportunity }) => (
    <TableCell>
      <OpportunityNameCell 
        name={opp.name} 
        salesforceLink={opp.salesforceLink}
        onNameChange={(name) => updateOpportunity(opp.id, { name })}
        onSalesforceLinkChange={(link) => {
          const dbUpdates: Partial<DbOpportunity> = { salesforce_link: link || null };
          updateOpportunityMutation.mutate({ id: opp.id, updates: dbUpdates });
        }}
        onOpenDetails={() => onOpenDrawer(opp)}
      />
    </TableCell>
  );

  const ArrInput = ({ opp }: { opp: Opportunity }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(opp.arr?.toString() || '');

    const handleBlur = () => {
      setIsEditing(false);
      updateOpportunity(opp.id, { arr: editValue ? Number(editValue) : undefined });
    };

    if (isEditing) {
      return (
        <Input
          type="number"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
          autoFocus
          className="h-7 w-28 text-xs"
        />
      );
    }

    return (
      <button
        onClick={() => {
          setEditValue(opp.arr?.toString() || '');
          setIsEditing(true);
        }}
        className="h-7 w-28 text-xs text-left px-3 py-1 rounded-md border border-transparent hover:border-input"
      >
        {formatCurrency(opp.arr)}
      </button>
    );
  };

  const ArrCell = ({ opp }: { opp: Opportunity }) => (
    <TableCell>
      <ArrInput opp={opp} />
    </TableCell>
  );

  const ChurnRiskCell = ({ opp }: { opp: Opportunity }) => (
    <TableCell>
      <Select
        value={opp.churnRisk || 'none'}
        onValueChange={(v) => updateOpportunity(opp.id, { churnRisk: (v === 'none' ? undefined : v) as ChurnRisk | undefined })}
      >
        <SelectTrigger className={cn("h-7 w-24 text-xs", opp.churnRisk && CHURN_RISK_COLORS[opp.churnRisk])}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">—</SelectItem>
          <SelectItem value="certain">Certain</SelectItem>
          <SelectItem value="low">Low</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="high">High</SelectItem>
        </SelectContent>
      </Select>
    </TableCell>
  );

  const CloseDateCell = ({ opp }: { opp: Opportunity }) => (
    <TableCell>
      <EditableDatePicker
        value={opp.closeDate}
        onChange={(v) => updateOpportunity(opp.id, { closeDate: v })}
        placeholder="—"
        compact
        className={cn("w-28")}
      />
    </TableCell>
  );

  const NextStepCell = ({ opp }: { opp: Opportunity }) => (
    <TableCell>
      <EditableDatePicker
        value={opp.nextStepDate}
        onChange={(v) => updateOpportunity(opp.id, { 
          nextStepDate: v,
          nextStep: v ? undefined : opp.nextStep 
        })}
        placeholder={opp.nextStep || '—'}
        compact
        className={cn(
          "w-28",
          opp.nextStepDate && isPast(parseISO(opp.nextStepDate)) && !isToday(parseISO(opp.nextStepDate)) && "[&_button]:border-status-red"
        )}
      />
    </TableCell>
  );

  const StageCell = ({ opp }: { opp: Opportunity }) => (
    <TableCell>
      <Select
        value={opp.stage || 'none'}
        onValueChange={(v) => updateOpportunity(opp.id, { stage: (v === 'none' ? '' : v) as OpportunityStage })}
      >
        <SelectTrigger className="h-7 w-24 text-xs">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">—</SelectItem>
          {STAGE_OPTIONS.filter(s => s).map(stage => (
            <SelectItem key={stage} value={stage}>{STAGE_LABELS[stage]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </TableCell>
  );

  const LastTouchCell = ({ opp }: { opp: Opportunity }) => (
    <TableCell className="text-xs text-muted-foreground">
      {formatDate(opp.lastTouchDate)}
    </TableCell>
  );

  const NotesCell = ({ opp, expanded = false }: { opp: Opportunity; expanded?: boolean }) => (
    <TableCell className="align-top py-3">
      {expanded ? (
        <Textarea
          value={opp.notes || ''}
          onChange={(e) => updateOpportunity(opp.id, { notes: e.target.value })}
          placeholder="Add notes..."
          className="min-h-[36px] text-sm resize-none py-2 px-3 w-full"
          style={{ fieldSizing: 'content' } as React.CSSProperties}
        />
      ) : (
        <Textarea
          value={opp.notes || ''}
          onChange={(e) => updateOpportunity(opp.id, { notes: e.target.value })}
          placeholder="Add notes..."
          className="min-h-[32px] h-8 text-xs resize-none py-1"
          rows={1}
        />
      )}
    </TableCell>
  );

  const ActionsCell = ({ opp }: { opp: Opportunity }) => (
    <TableCell>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onOpenDrawer(opp)}>
            Open Details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => deleteOpportunity(opp.id)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TableCell>
  );

  const toggleExpand = (id: string) => {
    setExpandedOppIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderOpportunityRow = (opp: Opportunity) => {
    const isExpanded = expandedOppIds.has(opp.id);

    if (renewalsOnly) {
      return (
        <React.Fragment key={opp.id}>
          <TableRow className="group hover:bg-muted/30 cursor-pointer" onClick={() => toggleExpand(opp.id)}>
            <TableCell className="w-8 py-3">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); toggleExpand(opp.id); }}>
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </Button>
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <Select
                value={opp.status}
                onValueChange={(v) => handleStatusChange(opp, v as OpportunityStatus)}
              >
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="stalled">Stalled</SelectItem>
                  <SelectItem value="closed-lost">Closed Lost</SelectItem>
                  <SelectItem value="closed-won">Closed Won</SelectItem>
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell className="align-top py-3">
              <OpportunityNameCell
                name={opp.name}
                salesforceLink={opp.salesforceLink}
                onNameChange={(name) => updateOpportunity(opp.id, { name })}
                onSalesforceLinkChange={(link) => {
                  const dbUpdates: Partial<DbOpportunity> = { salesforce_link: link || null };
                  updateOpportunityMutation.mutate({ id: opp.id, updates: dbUpdates });
                }}
                onOpenDetails={() => onOpenDrawer(opp)}
              />
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <ArrInput opp={opp} />
            </TableCell>
            {showChurnRisk && (
              <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                <Select
                  value={opp.churnRisk || 'none'}
                  onValueChange={(v) => updateOpportunity(opp.id, { churnRisk: (v === 'none' ? undefined : v) as ChurnRisk | undefined })}
                >
                  <SelectTrigger className={cn("h-8 w-24 text-xs", opp.churnRisk && CHURN_RISK_COLORS[opp.churnRisk])}>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    <SelectItem value="certain">Certain</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
            )}
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <EditableDatePicker
                value={opp.closeDate}
                onChange={(v) => updateOpportunity(opp.id, { closeDate: v })}
                placeholder="—"
                compact
                className="w-28"
              />
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <Select
                value={opp.stage || 'none'}
                onValueChange={(v) => updateOpportunity(opp.id, { stage: (v === 'none' ? '' : v) as OpportunityStage })}
              >
                <SelectTrigger className="h-8 w-24 text-xs">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {STAGE_OPTIONS.filter(s => s).map(stage => (
                    <SelectItem key={stage} value={stage}>{STAGE_LABELS[stage]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpenDrawer(opp)}>
                    Open Details
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => deleteOpportunity(opp.id)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
          {isExpanded && (
            <TableRow className="hover:bg-transparent border-b-2">
              <TableCell colSpan={showChurnRisk ? 8 : 7} className="pt-0 pb-3">
                <OpportunityDetailsField
                  nextStepDate={opp.nextStepDate}
                  onNextStepDateChange={(v) => updateOpportunity(opp.id, { nextStepDate: v })}
                  lastTouchDate={opp.lastTouchDate}
                  onLastTouchDateChange={(v) => updateOpportunity(opp.id, { lastTouchDate: v })}
                  notes={opp.notes}
                  onNotesChange={(v) => updateOpportunity(opp.id, { notes: v })}
                  isRenewal={true}
                  priorContractArr={opp.priorContractArr}
                  onPriorContractArrChange={(v) => updateOpportunity(opp.id, { priorContractArr: v })}
                  renewalArr={opp.renewalArr}
                  onRenewalArrChange={(v) => updateOpportunity(opp.id, { renewalArr: v })}
                  oneTimeAmount={opp.oneTimeAmount}
                  onOneTimeAmountChange={(v) => updateOpportunity(opp.id, { oneTimeAmount: v })}
                />
              </TableCell>
            </TableRow>
          )}
        </React.Fragment>
      );
    }

    // Weekly Outreach / New Logo view
    if (columnOrder === 'outreach') {
      return (
        <React.Fragment key={opp.id}>
          <TableRow className="group hover:bg-muted/30 cursor-pointer" onClick={() => toggleExpand(opp.id)}>
            <TableCell className="w-8 py-3">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); toggleExpand(opp.id); }}>
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </Button>
            </TableCell>
            <TableCell className="align-top py-3">
              <OpportunityNameCell
                name={opp.name}
                salesforceLink={opp.salesforceLink}
                onNameChange={(name) => updateOpportunity(opp.id, { name })}
                onSalesforceLinkChange={(link) => {
                  const dbUpdates: Partial<DbOpportunity> = { salesforce_link: link || null };
                  updateOpportunityMutation.mutate({ id: opp.id, updates: dbUpdates });
                }}
                onOpenDetails={() => onOpenDrawer(opp)}
              />
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <Select
                value={opp.status}
                onValueChange={(v) => handleStatusChange(opp, v as OpportunityStatus)}
              >
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="stalled">Stalled</SelectItem>
                  <SelectItem value="closed-lost">Closed Lost</SelectItem>
                  <SelectItem value="closed-won">Closed Won</SelectItem>
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <Select
                value={opp.stage || 'none'}
                onValueChange={(v) => updateOpportunity(opp.id, { stage: (v === 'none' ? '' : v) as OpportunityStage })}
              >
                <SelectTrigger className="h-8 w-24 text-xs">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {STAGE_OPTIONS.filter(s => s).map(stage => (
                    <SelectItem key={stage} value={stage}>{STAGE_LABELS[stage]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <ArrInput opp={opp} />
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <EditableDatePicker
                value={opp.closeDate}
                onChange={(v) => updateOpportunity(opp.id, { closeDate: v })}
                placeholder="—"
                compact
                className="w-28"
              />
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpenDrawer(opp)}>
                    Open Details
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => deleteOpportunity(opp.id)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
          {isExpanded && (
            <TableRow className="hover:bg-transparent border-b-2">
              <TableCell colSpan={7} className="pt-0 pb-3">
                <OpportunityDetailsField
                  nextStepDate={opp.nextStepDate}
                  onNextStepDateChange={(v) => updateOpportunity(opp.id, { nextStepDate: v })}
                  lastTouchDate={opp.lastTouchDate}
                  onLastTouchDateChange={(v) => updateOpportunity(opp.id, { lastTouchDate: v })}
                  notes={opp.notes}
                  onNotesChange={(v) => updateOpportunity(opp.id, { notes: v })}
                />
              </TableCell>
            </TableRow>
          )}
        </React.Fragment>
      );
    }

    // Default view (fallback — also uses chevron expand)
    return (
      <React.Fragment key={opp.id}>
        <TableRow className="group hover:bg-muted/30 cursor-pointer" onClick={() => toggleExpand(opp.id)}>
          <TableCell className="w-8 py-3">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); toggleExpand(opp.id); }}>
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </Button>
          </TableCell>
          <StatusCell opp={opp} />
          <NameCell opp={opp} />
          <ArrCell opp={opp} />
          {showChurnRisk && <ChurnRiskCell opp={opp} />}
          <CloseDateCell opp={opp} />
          <StageCell opp={opp} />
          <ActionsCell opp={opp} />
        </TableRow>
        {isExpanded && (
          <TableRow className="hover:bg-transparent border-b-2">
            <TableCell colSpan={showChurnRisk ? 8 : 7} className="pt-0 pb-3">
              <OpportunityDetailsField
                nextStepDate={opp.nextStepDate}
                onNextStepDateChange={(v) => updateOpportunity(opp.id, { nextStepDate: v })}
                lastTouchDate={opp.lastTouchDate}
                onLastTouchDateChange={(v) => updateOpportunity(opp.id, { lastTouchDate: v })}
                notes={opp.notes}
                onNotesChange={(v) => updateOpportunity(opp.id, { notes: v })}
              />
            </TableCell>
          </TableRow>
        )}
      </React.Fragment>
    );
  };

  const renderStatusGroup = (status: OpportunityStatus, opps: Opportunity[]) => {
    if (opps.length === 0) return null;

    const statusLabel = status.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

    return (
      <>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={9} className="py-2">
            <div className="flex items-center gap-2">
              <Badge className={cn("text-xs", STATUS_COLORS[status])}>
                {statusLabel}
              </Badge>
              <span className="text-xs text-muted-foreground">
                ({opps.length})
              </span>
            </div>
          </TableCell>
        </TableRow>
        {opps.map(renderOpportunityRow)}
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search opportunities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={savedView} onValueChange={(v) => setSavedView(v as SavedView)}>
          <SelectTrigger className="w-48">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All Opportunities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Opportunities</SelectItem>
            <SelectItem value="active">Active Pipeline</SelectItem>
            <SelectItem value="stalled">Stalled Deals</SelectItem>
            <SelectItem value="next-step-due">Next Step Due/Overdue</SelectItem>
            <SelectItem value="closing-this-quarter">Closing This Quarter</SelectItem>
            <SelectItem value="no-next-step">No Next Step</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setShowAddRow(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Opportunity
        </Button>
      </div>

      {/* Table */}
      <div className="metric-card overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columnOrder === 'outreach' ? (
                // Weekly Outreach headers
                <>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="w-[25%]">Opportunity</TableHead>
                  <TableHead className="w-[15%]">Status</TableHead>
                  <TableHead className="w-[12%]">Stage</TableHead>
                  <TableHead className="w-[12%]">ARR</TableHead>
                  <TableHead className="w-[15%]">Close Date</TableHead>
                  <TableHead className="w-[6%]"></TableHead>
                </>
              ) : renewalsOnly ? (
                // Renewals-only headers
                <>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="w-[15%]">Status</TableHead>
                  <TableHead className="w-[25%]">Opportunity</TableHead>
                  <TableHead className="w-[12%]">ARR</TableHead>
                  {showChurnRisk && <TableHead className="w-[12%]">Churn Risk</TableHead>}
                  <TableHead className="w-[15%]">Close Date</TableHead>
                  <TableHead className="w-[15%]">Stage</TableHead>
                  <TableHead className="w-[6%]"></TableHead>
                </>
              ) : (
                <>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="w-[130px]">Status</TableHead>
                  <TableHead className="w-[200px]">Opportunity</TableHead>
                  <TableHead className="w-[100px]">ARR</TableHead>
                  {showChurnRisk && <TableHead className="w-[100px]">Churn Risk</TableHead>}
                  <TableHead className="w-[130px]">Close Date</TableHead>
                  <TableHead className="w-[100px]">Stage</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {showAddRow && (
              <TableRow>
                <TableCell colSpan={9}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {renewalsOnly && (
                      <Select 
                        value={selectedRenewalId} 
                        onValueChange={(id) => {
                          setSelectedRenewalId(id);
                          const renewal = renewals.find(r => r.id === id);
                          if (renewal && !newOppName) {
                            setNewOppName(`${renewal.accountName} Renewal`);
                          }
                        }}
                      >
                        <SelectTrigger className="w-56">
                          <SelectValue placeholder="Select renewal account..." />
                        </SelectTrigger>
                        <SelectContent>
                          {renewals.map(renewal => (
                            <SelectItem key={renewal.id} value={renewal.id}>
                              {renewal.accountName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Input
                      value={newOppName}
                      onChange={(e) => setNewOppName(e.target.value)}
                      placeholder="Opportunity name..."
                      className="max-w-sm"
                      autoFocus={!renewalsOnly}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (!renewalsOnly || selectedRenewalId)) handleAddOpportunity();
                        if (e.key === 'Escape') {
                          setShowAddRow(false);
                          setNewOppName('');
                          setSelectedRenewalId('');
                        }
                      }}
                    />
                    <Button 
                      size="sm" 
                      onClick={handleAddOpportunity}
                      disabled={renewalsOnly && !selectedRenewalId}
                    >
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      setShowAddRow(false);
                      setNewOppName('');
                      setSelectedRenewalId('');
                    }}>Cancel</Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {oppsLoading || renewalsLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Loading opportunities...
                </TableCell>
              </TableRow>
            ) : filteredOpportunities.length === 0 && !showAddRow ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  {opportunities.length === 0
                    ? "No opportunities yet. Add your first opportunity to get started!"
                    : "No opportunities match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              STATUS_ORDER.map(status => renderStatusGroup(status, groupedOpportunities[status]))
            )}
          </TableBody>
        </Table>
      </div>
      
      {/* Closed Won Modal */}
      {closedWonOpportunity && (
        <ClosedWonModal
          open={closedWonModalOpen}
          onOpenChange={setClosedWonModalOpen}
          opportunity={closedWonOpportunity}
          onSave={handleClosedWonSave}
        />
      )}
    </div>
  );
}
