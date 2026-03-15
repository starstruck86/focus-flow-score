import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LayoutGrid, List } from 'lucide-react';
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
import { DeleteOpportunityDialog } from '@/components/quota/DeleteOpportunityDialog';
import { OpportunityNameCell } from '@/components/table/ClickableNameCell';
import { DisplaySelectCell } from '@/components/table/DisplaySelectCell';
import { EditableNumberCell, EditableTextareaCell, EditableTextCell } from '@/components/table/EditableCell';
import { ManageColumnsPopover } from '@/components/table/ManageColumnsPopover';
import { CustomFieldCell, CustomFieldRow } from '@/components/table/CustomFieldCell';
import { MetricFieldCell } from '@/components/table/MetricFieldCell';
import { SortableHeader, useTableSort } from '@/components/table/SortableHeader';
import { useCustomFields } from '@/hooks/useCustomFields';
import { applySortWithFallback } from '@/lib/sortUtils';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { BulkActionsBar } from '@/components/BulkActionsBar';
import { KanbanBoard } from '@/components/KanbanBoard';
import { Checkbox } from '@/components/ui/checkbox';
import { useStore } from '@/store/useStore';
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

const STATUS_ORDER: OpportunityStatus[] = ['active', 'stalled', 'closed-won', 'closed-lost'];

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

// Sort ranks for opp-specific enums
const OPP_STATUS_SORT_RANK: Record<OpportunityStatus, number> = {
  'active': 1,
  'stalled': 2,
  'closed-won': 3,
  'closed-lost': 4,
};

const OPP_STAGE_SORT_RANK: Record<string, number> = {
  '': 0,
  'Prospect': 1,
  'Discover': 2,
  'Demo': 3,
  'Proposal': 4,
  'Negotiate': 5,
  'Closed Won': 6,
  'Closed Lost': 7,
};

const CHURN_RISK_SORT_RANK: Record<string, number> = {
  'low': 1,
  'medium': 2,
  'high': 3,
  'certain': 4,
};

type SavedView = 'all' | 'active' | 'stalled' | 'next-step-due' | 'closing-this-quarter' | 'no-next-step';

/**
 * Normalize status: if stage says "Closed Won" or "Closed Lost" but status doesn't match, fix it.
 */
function normalizeOppStatus(status: OpportunityStatus, stage: OpportunityStage): OpportunityStatus {
  if (stage === 'Closed Won' && status !== 'closed-won') return 'closed-won';
  if (stage === 'Closed Lost' && status !== 'closed-lost') return 'closed-lost';
  return status;
}

// Transform database opportunity to UI format
function dbToUiOpportunity(db: DbOpportunity): Opportunity {
  const rawStatus = (db.status as OpportunityStatus) || 'active';
  const stage = (db.stage as OpportunityStage) || '';
  return {
    id: db.id,
    name: db.name,
    accountId: db.account_id ?? undefined,
    salesforceLink: db.salesforce_link ?? undefined,
    salesforceId: db.salesforce_id ?? undefined,
    linkedContactIds: [],
    status: normalizeOppStatus(rawStatus, stage),
    stage,
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
  stageFilter?: OpportunityStage | null;
  onClearStageFilter?: () => void;
  highlightId?: string | null;
}

export function OpportunitiesTable({ onOpenDrawer, renewalsOnly = false, excludeRenewals = false, showChurnRisk = true, columnOrder = 'default', stageFilter, onClearStageFilter, highlightId }: OpportunitiesTableProps) {
  // Custom fields for this specific opportunities context
  const oppTabTarget = renewalsOnly ? 'opportunities-renewals' as const : 'opportunities-newlogo' as const;
  const { fields, getFieldValue } = useCustomFields();
  const summaryCustomFields = fields.filter(
    f => f.tabTarget === oppTabTarget && (f.placement === 'summary' || f.placement === 'both')
  );
  // Database hooks
  const { data: dbOpportunities = [], isLoading: oppsLoading } = useDbOpportunities();
  const { data: dbRenewals = [], isLoading: renewalsLoading } = useDbRenewals();
  const updateOpportunityMutation = useUpdateOpportunity();
  const deleteOpportunityMutation = useDeleteOpportunity();
  const addOpportunityMutation = useAddOpportunity();
  const updateRenewalMutation = useUpdateRenewal();

  // Zustand store data (source of truth when DB is empty)
  const {
    renewals: storeRenewals,
    opportunities: storeOpportunities,
    accounts: storeAccounts,
  } = useStore();

  // Transform DB data to UI format, merge with store opps
  const opportunities = useMemo(() => {
    const dbMapped = dbOpportunities.map(dbToUiOpportunity);
    const dbIds = new Set(dbMapped.map(o => o.id));
    // Add store opportunities not already in DB (for backward compat)
    const storeOnly = storeOpportunities
      .filter(o => !dbIds.has(o.id))
      .map(o => ({ ...o, status: normalizeOppStatus(o.status, o.stage) }));
    return [...dbMapped, ...storeOnly];
  }, [dbOpportunities, storeOpportunities]);

  // Merge DB renewals with Zustand store renewals (same source as Renewals tab)
  const renewals = useMemo(() => {
    const dbMapped = dbRenewals.map(dbToRenewalFilter);
    const dbIds = new Set(dbMapped.map(r => r.id));
    // Add store renewals not already in DB
    const storeOnly = storeRenewals
      .filter(r => !dbIds.has(r.id))
      .map(r => ({
        id: r.id,
        linkedOpportunityId: r.linkedOpportunityId,
        accountName: r.accountName,
        arr: r.arr,
        renewalDue: r.renewalDue,
        churnRisk: (r.churnRisk as ChurnRisk) ?? undefined,
      }));
    return [...dbMapped, ...storeOnly];
  }, [dbRenewals, storeRenewals]);

  const accountMap = useMemo(
    () => new Map(storeAccounts.map(account => [account.id, account])),
    [storeAccounts]
  );

  // Sort hook
  const { sortConfig, handleSort } = useTableSort();

  // Check if an opportunity exists in the database (has UUID format)
  const dbOpportunityIds = useMemo(() => new Set(dbOpportunities.map(o => o.id)), [dbOpportunities]);
  const { updateOpportunity: storeUpdateOpportunity } = useStore();

  // Wrapper functions for mutations
  const updateOpportunity = (id: string, updates: Partial<Opportunity>) => {
    // If this opportunity is in the DB, update via mutation
    if (dbOpportunityIds.has(id)) {
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
    } else {
      // Fall back to Zustand store for legacy/store-only opportunities
      storeUpdateOpportunity(id, updates);
    }
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
  const [deleteDialogOpp, setDeleteDialogOpp] = useState<Opportunity | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const bulkSelection = useBulkSelection<Opportunity>();

  // Get renewals that don't have linked opportunities yet (for adding new renewal opps)
  const renewalsWithoutOpps = useMemo(() => {
    return renewals.filter(r => !r.linkedOpportunityId || !opportunities.some(o => o.id === r.linkedOpportunityId));
  }, [renewals, opportunities]);

  // Handle status change - trigger modal for Closed Won
  const handleStatusChange = (opp: Opportunity, newStatus: OpportunityStatus) => {
    if (newStatus === 'closed-won' && opp.status !== 'closed-won') {
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

  // Get renewal-linked opportunity IDs — includes both linked renewals AND deal_type='renewal'
  const renewalOpportunityIds = useMemo(() => {
    const ids = new Set<string>();
    renewals.filter(r => r.linkedOpportunityId).forEach(r => ids.add(r.linkedOpportunityId!));
    opportunities.filter(o => o.dealType === 'renewal').forEach(o => ids.add(o.id));
    return ids;
  }, [renewals, opportunities]);


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

    // Apply stage filter from parent (e.g., pipeline tiles)
    if (stageFilter !== undefined && stageFilter !== null) {
      filtered = filtered.filter(opp => (opp.stage || '') === stageFilter);
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
        filtered = filtered.filter(o => !o.nextStep && !o.nextStepDate);
        break;
    }

    return filtered;
  }, [opportunities, searchQuery, savedView, renewalsOnly, excludeRenewals, renewalOpportunityIds, stageFilter]);

  // Sort opportunities
  const sortKeyMap: Record<string, { key: keyof Opportunity; customRank?: Record<string, number> }> = {
    status: { key: 'status', customRank: OPP_STATUS_SORT_RANK },
    name: { key: 'name' },
    arr: { key: 'arr' },
    churnRisk: { key: 'churnRisk', customRank: CHURN_RISK_SORT_RANK },
    closeDate: { key: 'closeDate' },
    stage: { key: 'stage', customRank: OPP_STAGE_SORT_RANK },
    nextStep: { key: 'nextStep' },
    priorContractArr: { key: 'priorContractArr' },
    renewalArr: { key: 'renewalArr' },
    oneTimeAmount: { key: 'oneTimeAmount' },
  };

  const defaultOppSort = (items: Opportunity[]) => items; // keep grouped by status

  // When user sorts, we flatten (don't group by status)
  const isUserSorted = sortConfig !== null;

  const sortedOpportunities = useMemo(() => {
    if (!isUserSorted) return filteredOpportunities;
    // Custom field sorting
    if (sortConfig?.key.startsWith('custom:')) {
      const fieldId = sortConfig.key.slice(7);
      const direction = sortConfig.direction!;
      return [...filteredOpportunities].sort((a, b) => {
        const aVal = getFieldValue(a.id, fieldId);
        const bVal = getFieldValue(b.id, fieldId);
        let comparison = 0;
        if (aVal == null && bVal != null) comparison = 1;
        else if (aVal != null && bVal == null) comparison = -1;
        else if (typeof aVal === 'number' && typeof bVal === 'number') comparison = aVal - bVal;
        else comparison = String(aVal ?? '').localeCompare(String(bVal ?? ''));
        return direction === 'desc' ? -comparison : comparison;
      });
    }
    return applySortWithFallback(filteredOpportunities, sortConfig, defaultOppSort, sortKeyMap);
  }, [filteredOpportunities, sortConfig, isUserSorted]);

  // Group by status (only when no user sort active)
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
    
    if (renewalsOnly && selectedRenewalId) {
      const renewal = renewals.find(r => r.id === selectedRenewalId);
      if (renewal) {
        const dueDate = new Date(renewal.renewalDue);
        const closeDateObj = new Date(dueDate);
        closeDateObj.setDate(closeDateObj.getDate() - 1);
        const closeDate = closeDateObj.toISOString().split('T')[0];
        
        try {
          const result = await addOpportunityMutation.mutateAsync({
            name: newOppName.trim(),
            status: 'active',
            stage: '1 - Prospect',
            arr: renewal.arr,
            churn_risk: renewal.churnRisk || 'low',
            close_date: closeDate,
            deal_type: 'renewal',
          });
          
          if (result?.id) {
            updateRenewal(renewal.id, { linkedOpportunityId: result.id });
          }
        } catch (error) {
          console.error('Failed to add opportunity:', error);
        }
      }
    } else {
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

  const STATUS_SELECT_OPTIONS = [
    { value: 'active', label: 'Active', className: 'bg-status-green/20 text-status-green' },
    { value: 'stalled', label: 'Stalled', className: 'bg-status-yellow/20 text-status-yellow' },
    { value: 'closed-lost', label: 'Closed Lost', className: 'bg-status-red/20 text-status-red' },
    { value: 'closed-won', label: 'Closed Won', className: 'bg-green-600/20 text-green-400' },
  ];

  const STAGE_SELECT_OPTIONS = [
    { value: 'none', label: '—', className: 'bg-muted text-muted-foreground' },
    { value: 'Prospect', label: '1 - Prospect', className: 'bg-blue-500/20 text-blue-400' },
    { value: 'Discover', label: '2 - Discover', className: 'bg-cyan-500/20 text-cyan-400' },
    { value: 'Demo', label: '3 - Demo', className: 'bg-status-yellow/20 text-status-yellow' },
    { value: 'Proposal', label: '4 - Proposal', className: 'bg-orange-500/20 text-orange-400' },
    { value: 'Negotiate', label: '5 - Negotiate', className: 'bg-purple-500/20 text-purple-400' },
    { value: 'Closed Won', label: '6 - Closed Won', className: 'bg-status-green/20 text-status-green' },
    { value: 'Closed Lost', label: '7 - Closed Lost', className: 'bg-status-red/20 text-status-red' },
  ];

  const CHURN_RISK_SELECT_OPTIONS = [
    { value: 'none', label: '—', className: 'bg-muted text-muted-foreground' },
    { value: 'low', label: '1 - Low', className: 'bg-status-green/20 text-status-green' },
    { value: 'medium', label: '2 - Medium', className: 'bg-status-yellow/20 text-status-yellow' },
    { value: 'high', label: '3 - High', className: 'bg-status-red/20 text-status-red' },
    { value: 'certain', label: '4 - OOB', className: 'bg-purple-600/20 text-purple-400' },
  ];

  // Next Step cell — display-first editable text
  const NextStepTextCell = ({ opp }: { opp: Opportunity }) => (
    <TableCell className="align-top py-3 max-w-[200px]" onClick={(e) => e.stopPropagation()}>
      <EditableTextCell
        value={opp.nextStep || ''}
        onChange={(v) => updateOpportunity(opp.id, { nextStep: v })}
        emptyText="+ Add"
        className="truncate"
      />
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
            onClick={() => setDeleteDialogOpp(opp)}
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

  // Auto-expand and scroll to highlighted opportunity
  const [localHighlight, setLocalHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (highlightId) {
      setLocalHighlight(highlightId);
      setExpandedOppIds(prev => new Set(prev).add(highlightId));
      // Retry scroll until element appears (max 2s)
      let attempts = 0;
      const scrollInterval = setInterval(() => {
        const el = document.querySelector(`[data-opp-id="${highlightId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          clearInterval(scrollInterval);
        }
        if (++attempts > 20) clearInterval(scrollInterval);
      }, 100);
      const timer = setTimeout(() => setLocalHighlight(null), 4000);
      return () => { clearTimeout(timer); clearInterval(scrollInterval); };
    }
  }, [highlightId]);

  const renderOpportunityRow = (opp: Opportunity) => {
    const isExpanded = expandedOppIds.has(opp.id);
    const linkedAccount = opp.accountId ? accountMap.get(opp.accountId) : undefined;
    const stakeholderAccountName = linkedAccount?.name ?? opp.accountName;

    if (renewalsOnly) {
      const expansion = (opp.renewalArr || 0) - (opp.priorContractArr || 0);
      const totalValue = (opp.renewalArr || 0) + (opp.oneTimeAmount || 0);

      return (
        <React.Fragment key={opp.id}>
           <TableRow data-opp-id={opp.id} className={cn("group hover:bg-muted/30 cursor-pointer", localHighlight === opp.id && "ring-2 ring-primary/50 bg-primary/5 animate-pulse")} onClick={() => toggleExpand(opp.id)}>
            <TableCell className="w-8 py-3" onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={bulkSelection.isSelected(opp.id)} onCheckedChange={() => bulkSelection.toggle(opp.id)} />
            </TableCell>
            <TableCell className="w-8 py-3">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); toggleExpand(opp.id); }}>
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </Button>
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <DisplaySelectCell
                value={opp.status}
                options={STATUS_SELECT_OPTIONS}
                onChange={(v) => handleStatusChange(opp, v as OpportunityStatus)}
              />
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
            {showChurnRisk && (
              <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                <DisplaySelectCell
                  value={opp.churnRisk || 'none'}
                  options={CHURN_RISK_SELECT_OPTIONS}
                  onChange={(v) => updateOpportunity(opp.id, { churnRisk: (v === 'none' ? undefined : v) as ChurnRisk | undefined })}
                />
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
              <DisplaySelectCell
                value={opp.stage || 'none'}
                options={STAGE_SELECT_OPTIONS}
                onChange={(v) => updateOpportunity(opp.id, { stage: (v === 'none' ? '' : v) as OpportunityStage })}
              />
            </TableCell>
            {/* ARR Breakdown columns */}
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <EditableNumberCell
                value={opp.priorContractArr || 0}
                onChange={(v) => updateOpportunity(opp.id, { priorContractArr: v || undefined })}
                format="currency"
              />
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <EditableNumberCell
                value={opp.renewalArr || 0}
                onChange={(v) => updateOpportunity(opp.id, { renewalArr: v || undefined })}
                format="currency"
              />
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <EditableNumberCell
                value={opp.oneTimeAmount || 0}
                onChange={(v) => updateOpportunity(opp.id, { oneTimeAmount: v || undefined })}
                format="currency"
              />
            </TableCell>
            <TableCell className="align-top py-3 text-right font-mono text-sm">
              {expansion !== 0 ? formatCurrency(expansion) : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="align-top py-3 text-right font-mono text-sm font-semibold">
              {totalValue !== 0 ? formatCurrency(totalValue) : <span className="text-muted-foreground">—</span>}
            </TableCell>
            {summaryCustomFields.map(field => (
              <TableCell key={field.id} className="align-top py-2" onClick={(e) => e.stopPropagation()}>
                <MetricFieldCell field={field} recordId={opp.id} />
              </TableCell>
            ))}
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
                    onClick={() => setDeleteDialogOpp(opp)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
          {isExpanded && (
            <TableRow className="hover:bg-transparent border-b-2">
              <TableCell colSpan={99} className="pt-0 pb-3">
                <OpportunityDetailsField
                  tabTarget={oppTabTarget}
                  opportunityId={opp.id}
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
                  accountId={opp.accountId}
                  accountName={stakeholderAccountName}
                  accountWebsite={linkedAccount?.website}
                  accountIndustry={linkedAccount?.industry}
                  opportunityContext={`${opp.name} - ${opp.stage} - $${opp.arr || 0} ARR`}
                />
              </TableCell>
            </TableRow>
          )}
        </React.Fragment>
      );
    }

    // Weekly Outreach / New Logo view
    if (columnOrder === 'outreach') {
      // Last touch indicator
      const lastTouchDays = opp.lastTouchDate 
        ? Math.floor((Date.now() - new Date(opp.lastTouchDate).getTime()) / 86400000)
        : null;
      const lastTouchColor = lastTouchDays === null ? 'text-status-red' 
        : lastTouchDays <= 3 ? 'text-status-green' 
        : lastTouchDays <= 7 ? 'text-status-yellow' 
        : 'text-status-red';

      return (
        <React.Fragment key={opp.id}>
          <TableRow data-opp-id={opp.id} className={cn("group hover:bg-muted/30 cursor-pointer", localHighlight === opp.id && "ring-2 ring-primary/50 bg-primary/5 animate-pulse")} onClick={() => toggleExpand(opp.id)}>
            <TableCell className="w-8 py-3" onClick={(e) => e.stopPropagation()}>
              <Checkbox checked={bulkSelection.isSelected(opp.id)} onCheckedChange={() => bulkSelection.toggle(opp.id)} />
            </TableCell>
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
              <DisplaySelectCell
                value={opp.status}
                options={STATUS_SELECT_OPTIONS}
                onChange={(v) => handleStatusChange(opp, v as OpportunityStatus)}
              />
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <DisplaySelectCell
                value={opp.stage || 'none'}
                options={STAGE_SELECT_OPTIONS}
                onChange={(v) => updateOpportunity(opp.id, { stage: (v === 'none' ? '' : v) as OpportunityStage })}
              />
            </TableCell>
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <EditableNumberCell
                value={opp.arr || 0}
                onChange={(v) => updateOpportunity(opp.id, { arr: v || undefined })}
                format="currency"
              />
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
              <span className={cn("text-[10px] font-medium", lastTouchColor)}>
                {lastTouchDays === null ? 'Never' : `${lastTouchDays}d ago`}
              </span>
            </TableCell>
            <NextStepTextCell opp={opp} />
            {summaryCustomFields.map(field => (
              <TableCell key={field.id} className="align-top py-2" onClick={(e) => e.stopPropagation()}>
                <MetricFieldCell field={field} recordId={opp.id} />
              </TableCell>
            ))}
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
                    onClick={() => setDeleteDialogOpp(opp)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
          {isExpanded && (
            <TableRow className="hover:bg-transparent border-b-2">
              <TableCell colSpan={99} className="pt-0 pb-3">
                <OpportunityDetailsField
                  tabTarget={oppTabTarget}
                  opportunityId={opp.id}
                  nextStepDate={opp.nextStepDate}
                  onNextStepDateChange={(v) => updateOpportunity(opp.id, { nextStepDate: v })}
                  lastTouchDate={opp.lastTouchDate}
                  onLastTouchDateChange={(v) => updateOpportunity(opp.id, { lastTouchDate: v })}
                  notes={opp.notes}
                  onNotesChange={(v) => updateOpportunity(opp.id, { notes: v })}
                  accountId={opp.accountId}
                  accountName={stakeholderAccountName}
                  accountWebsite={linkedAccount?.website}
                  accountIndustry={linkedAccount?.industry}
                  opportunityContext={`${opp.name} - ${opp.stage} - $${opp.arr || 0} ARR`}
                />
              </TableCell>
            </TableRow>
          )}
        </React.Fragment>
      );
    }

    // Default view (global opps tab)
    return (
      <React.Fragment key={opp.id}>
        <TableRow data-opp-id={opp.id} className={cn("group hover:bg-muted/30 cursor-pointer", localHighlight === opp.id && "ring-2 ring-primary/50 bg-primary/5 animate-pulse")} onClick={() => toggleExpand(opp.id)}>
          <TableCell className="w-8 py-3" onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={bulkSelection.isSelected(opp.id)} onCheckedChange={() => bulkSelection.toggle(opp.id)} />
          </TableCell>
          <TableCell className="w-8 py-3">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); toggleExpand(opp.id); }}>
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </Button>
          </TableCell>
          <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
            <DisplaySelectCell
              value={opp.status}
              options={STATUS_SELECT_OPTIONS}
              onChange={(v) => handleStatusChange(opp, v as OpportunityStatus)}
            />
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
            <EditableNumberCell
              value={opp.arr || 0}
              onChange={(v) => updateOpportunity(opp.id, { arr: v || undefined })}
              format="currency"
            />
          </TableCell>
          {showChurnRisk && (
            <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
              <DisplaySelectCell
                value={opp.churnRisk || 'none'}
                options={CHURN_RISK_SELECT_OPTIONS}
                onChange={(v) => updateOpportunity(opp.id, { churnRisk: (v === 'none' ? undefined : v) as ChurnRisk | undefined })}
              />
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
            <DisplaySelectCell
              value={opp.stage || 'none'}
              options={STAGE_SELECT_OPTIONS}
              onChange={(v) => updateOpportunity(opp.id, { stage: (v === 'none' ? '' : v) as OpportunityStage })}
            />
          </TableCell>
          <NextStepTextCell opp={opp} />
            {summaryCustomFields.map(field => (
              <TableCell key={field.id} className="align-top py-2" onClick={(e) => e.stopPropagation()}>
                <MetricFieldCell field={field} recordId={opp.id} />
              </TableCell>
            ))}
            <ActionsCell opp={opp} />
        </TableRow>
        {isExpanded && (
          <TableRow className="hover:bg-transparent border-b-2">
            <TableCell colSpan={99} className="pt-0 pb-3">
              <OpportunityDetailsField
                tabTarget={oppTabTarget}
                opportunityId={opp.id}
                nextStepDate={opp.nextStepDate}
                onNextStepDateChange={(v) => updateOpportunity(opp.id, { nextStepDate: v })}
                lastTouchDate={opp.lastTouchDate}
                onLastTouchDateChange={(v) => updateOpportunity(opp.id, { lastTouchDate: v })}
                notes={opp.notes}
                onNotesChange={(v) => updateOpportunity(opp.id, { notes: v })}
                accountId={opp.accountId}
                accountName={stakeholderAccountName}
                accountWebsite={linkedAccount?.website}
                accountIndustry={linkedAccount?.industry}
                opportunityContext={`${opp.name} - ${opp.stage} - $${opp.arr || 0} ARR`}
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
    const groupArr = opps.reduce((sum, o) => sum + (o.arr || 0), 0);

    return (
      <React.Fragment key={status}>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={99} className="py-2">
            <div className="flex items-center gap-2">
              <Badge className={cn("text-xs", STATUS_COLORS[status])}>
                {statusLabel}
              </Badge>
              <span className="text-xs text-muted-foreground">
                ({opps.length})
              </span>
              {groupArr > 0 && (
                <span className="text-xs font-mono text-muted-foreground ml-1">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(groupArr)}
                </span>
              )}
            </div>
          </TableCell>
        </TableRow>
        {opps.map(renderOpportunityRow)}
      </React.Fragment>
    );
  };

  const totalCols = (renewalsOnly ? (showChurnRisk ? 14 : 13) : columnOrder === 'outreach' ? 10 : (showChurnRisk ? 11 : 10)) + summaryCustomFields.length;

  return (
    <div className="space-y-4">
      {/* Stage filter indicator */}
      {stageFilter !== undefined && stageFilter !== null && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-sm">
          <Filter className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">Filtered to stage:</span>
          <Badge className="text-xs">{STAGE_LABELS[stageFilter] || stageFilter || 'No Stage'}</Badge>
          <button onClick={onClearStageFilter} className="text-xs text-primary hover:text-primary/80 underline ml-1">Clear</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-0">
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
        <ManageColumnsPopover
          tabTarget={oppTabTarget}
          viewKey={`opportunities-${renewalsOnly ? 'renewals' : excludeRenewals ? 'newlogo' : 'global'}-${savedView}`}
          builtInColumns={[
            { key: 'status', label: 'Status' },
            { key: 'stage', label: 'Stage' },
            { key: 'arr', label: 'ARR' },
            { key: 'churnRisk', label: 'Churn Risk' },
            { key: 'closeDate', label: 'Close Date' },
            { key: 'nextStep', label: 'Next Step' },
          ]}
        />
        <Button onClick={() => setShowAddRow(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Opportunity
        </Button>
        <div className="flex items-center border rounded-md">
          <Button
            variant={viewMode === 'table' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 rounded-r-none"
            onClick={() => setViewMode('table')}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 rounded-l-none"
            onClick={() => setViewMode('kanban')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filtered count + staleness */}
      {filteredOpportunities.length !== opportunities.length && (
        <div className="text-xs text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{filteredOpportunities.length}</span> of {opportunities.length} opportunities
        </div>
      )}
      {(() => {
        const staleOpps = filteredOpportunities.filter(o => {
          if (o.status !== 'active') return false;
          if (!o.lastTouchDate) return true;
          return Math.floor((Date.now() - new Date(o.lastTouchDate).getTime()) / 86400000) > 14;
        });
        const noNextStep = filteredOpportunities.filter(o => o.status === 'active' && !o.nextStep).length;
        if (staleOpps.length === 0 && noNextStep === 0) return null;
        return (
          <div className="flex flex-wrap gap-3">
            {staleOpps.length > 0 && (
              <div className="flex items-center gap-2 text-xs bg-status-red/10 border border-status-red/20 rounded-lg px-3 py-2">
                <span className="text-status-red font-medium">{staleOpps.length} opps</span>
                <span className="text-muted-foreground">untouched 14+ days</span>
              </div>
            )}
            {noNextStep > 0 && (
              <div className="flex items-center gap-2 text-xs bg-status-yellow/10 border border-status-yellow/20 rounded-lg px-3 py-2">
                <span className="text-status-yellow font-medium">{noNextStep} active opps</span>
                <span className="text-muted-foreground">missing next step</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Bulk Actions Bar */}
      <BulkActionsBar
        selectedCount={bulkSelection.selectedCount}
        onClear={bulkSelection.clear}
        selectedIds={bulkSelection.selectedIds}
        actions={[
          {
            id: 'change-stage',
            label: 'Change Stage',
            options: STAGE_SELECT_OPTIONS.map(o => ({ value: o.value, label: o.label })),
            onExecute: (ids, value) => {
              ids.forEach(id => updateOpportunity(id, { stage: (value === 'none' ? '' : value) as OpportunityStage }));
              bulkSelection.clear();
            },
          },
          {
            id: 'change-status',
            label: 'Change Status',
            options: STATUS_SELECT_OPTIONS.map(o => ({ value: o.value, label: o.label })),
            onExecute: (ids, value) => {
              ids.forEach(id => updateOpportunity(id, { status: value as OpportunityStatus }));
              bulkSelection.clear();
            },
          },
          {
            id: 'delete',
            label: 'Delete',
            variant: 'destructive' as const,
            onExecute: (ids) => {
              ids.forEach(id => deleteOpportunity(id));
              bulkSelection.clear();
            },
          },
        ]}
      />

      {/* Kanban View */}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          opportunities={filteredOpportunities}
          onStageChange={(id, newStage) => updateOpportunity(id, { stage: newStage })}
          onSelect={(id) => {
            const opp = filteredOpportunities.find(o => o.id === id);
            if (opp) onOpenDrawer(opp);
          }}
        />
      ) : (
        <div className="metric-card overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columnOrder === 'outreach' ? (
                <>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={bulkSelection.isAllSelected(filteredOpportunities)}
                      onCheckedChange={() => bulkSelection.toggleAll(filteredOpportunities)}
                    />
                  </TableHead>
                  <TableHead className="w-8"></TableHead>
                  <SortableHeader sortKey="name" currentSort={sortConfig} onSort={handleSort} className="w-[20%]">Opportunity</SortableHeader>
                  <SortableHeader sortKey="status" currentSort={sortConfig} onSort={handleSort} className="w-[10%]">Status</SortableHeader>
                  <SortableHeader sortKey="stage" currentSort={sortConfig} onSort={handleSort} className="w-[10%]">Stage</SortableHeader>
                  <SortableHeader sortKey="arr" currentSort={sortConfig} onSort={handleSort} className="w-[9%]">ARR</SortableHeader>
                  <SortableHeader sortKey="closeDate" currentSort={sortConfig} onSort={handleSort} className="w-[10%]">Close Date</SortableHeader>
                  <TableHead className="w-[7%] text-xs">Last Touch</TableHead>
                  <SortableHeader sortKey="nextStep" currentSort={sortConfig} onSort={handleSort} className="w-[18%]">Next Step</SortableHeader>
                  {summaryCustomFields.map(field => (
                    <SortableHeader key={field.id} sortKey={`custom:${field.id}`} currentSort={sortConfig} onSort={handleSort}>{field.name}</SortableHeader>
                  ))}
                  <TableHead className="w-[6%]"></TableHead>
                </>
              ) : renewalsOnly ? (
                <>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={bulkSelection.isAllSelected(filteredOpportunities)}
                      onCheckedChange={() => bulkSelection.toggleAll(filteredOpportunities)}
                    />
                  </TableHead>
                  <TableHead className="w-8"></TableHead>
                  <SortableHeader sortKey="status" currentSort={sortConfig} onSort={handleSort} className="w-[10%]">Status</SortableHeader>
                  <SortableHeader sortKey="name" currentSort={sortConfig} onSort={handleSort} className="w-[16%]">Opportunity</SortableHeader>
                  {showChurnRisk && <SortableHeader sortKey="churnRisk" currentSort={sortConfig} onSort={handleSort} className="w-[8%]">Churn Risk</SortableHeader>}
                  <SortableHeader sortKey="closeDate" currentSort={sortConfig} onSort={handleSort} className="w-[10%]">Close Date</SortableHeader>
                  <SortableHeader sortKey="stage" currentSort={sortConfig} onSort={handleSort} className="w-[10%]">Stage</SortableHeader>
                  <SortableHeader sortKey="priorContractArr" currentSort={sortConfig} onSort={handleSort} className="w-[8%]">Prior Contract</SortableHeader>
                  <SortableHeader sortKey="renewalArr" currentSort={sortConfig} onSort={handleSort} className="w-[8%]">Renewal ARR</SortableHeader>
                  <SortableHeader sortKey="oneTimeAmount" currentSort={sortConfig} onSort={handleSort} className="w-[7%]">One-Time</SortableHeader>
                  <TableHead className="w-[7%] text-xs">Expansion</TableHead>
                  <TableHead className="w-[7%] text-xs">Total Value</TableHead>
                  {summaryCustomFields.map(field => (
                    <SortableHeader key={field.id} sortKey={`custom:${field.id}`} currentSort={sortConfig} onSort={handleSort}>{field.name}</SortableHeader>
                  ))}
                  <TableHead className="w-[4%]"></TableHead>
                </>
              ) : (
                <>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={bulkSelection.isAllSelected(filteredOpportunities)}
                      onCheckedChange={() => bulkSelection.toggleAll(filteredOpportunities)}
                    />
                  </TableHead>
                  <TableHead className="w-8"></TableHead>
                  <SortableHeader sortKey="status" currentSort={sortConfig} onSort={handleSort} className="w-[110px]">Status</SortableHeader>
                  <SortableHeader sortKey="name" currentSort={sortConfig} onSort={handleSort} className="w-[180px]">Opportunity</SortableHeader>
                  <SortableHeader sortKey="arr" currentSort={sortConfig} onSort={handleSort} className="w-[90px]">ARR</SortableHeader>
                  {showChurnRisk && <SortableHeader sortKey="churnRisk" currentSort={sortConfig} onSort={handleSort} className="w-[90px]">Churn Risk</SortableHeader>}
                  <SortableHeader sortKey="closeDate" currentSort={sortConfig} onSort={handleSort} className="w-[110px]">Close Date</SortableHeader>
                  <SortableHeader sortKey="stage" currentSort={sortConfig} onSort={handleSort} className="w-[90px]">Stage</SortableHeader>
                  <SortableHeader sortKey="nextStep" currentSort={sortConfig} onSort={handleSort} className="w-[150px]">Next Step</SortableHeader>
                  {summaryCustomFields.map(field => (
                    <SortableHeader key={field.id} sortKey={`custom:${field.id}`} currentSort={sortConfig} onSort={handleSort}>{field.name}</SortableHeader>
                  ))}
                  <TableHead className="w-[40px]"></TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {showAddRow && (
              <TableRow>
                <TableCell colSpan={totalCols}>
                   <div className="flex items-center gap-2 flex-wrap">
                    {renewalsOnly && (
                      <Select 
                        value={selectedRenewalId} 
                        onValueChange={(id) => {
                          setSelectedRenewalId(id);
                          const renewal = renewals.find(r => r.id === id);
                          if (renewal) {
                            setNewOppName(`${renewal.accountName} Renewal`);
                          }
                        }}
                      >
                        <SelectTrigger className="w-56">
                          <SelectValue placeholder="Select renewal account..." />
                        </SelectTrigger>
                        <SelectContent>
                          {renewals.length === 0 ? (
                            <SelectItem value="__none" disabled>No renewal accounts found</SelectItem>
                          ) : (
                            renewals.map(renewal => (
                              <SelectItem key={renewal.id} value={renewal.id}>
                                {renewal.accountName} {renewal.linkedOpportunityId ? '(has opp)' : ''}
                              </SelectItem>
                            ))
                          )}
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
                <TableCell colSpan={totalCols} className="text-center py-8 text-muted-foreground">
                  Loading opportunities...
                </TableCell>
              </TableRow>
            ) : filteredOpportunities.length === 0 && !showAddRow ? (
              <TableRow>
                <TableCell colSpan={totalCols} className="text-center py-8 text-muted-foreground">
                  {opportunities.length === 0
                    ? "No opportunities yet. Add your first opportunity to get started!"
                    : "No opportunities match your filters."}
                </TableCell>
              </TableRow>
            ) : isUserSorted ? (
              // Flat sorted list when user clicks a column header
              sortedOpportunities.map(renderOpportunityRow)
            ) : (
              // Default: grouped by status
              STATUS_ORDER.map(status => renderStatusGroup(status, groupedOpportunities[status]))
            )}
          </TableBody>
        </Table>
      </div>
      )}
      
      {/* Closed Won Modal */}
      {closedWonOpportunity && (
        <ClosedWonModal
          open={closedWonModalOpen}
          onOpenChange={setClosedWonModalOpen}
          opportunity={closedWonOpportunity}
          onSave={handleClosedWonSave}
        />
      )}

      {/* Delete Opportunity Confirmation */}
      {deleteDialogOpp && (
        <DeleteOpportunityDialog
          open={!!deleteDialogOpp}
          onOpenChange={(open) => { if (!open) setDeleteDialogOpp(null); }}
          opportunityName={deleteDialogOpp.name}
          affectsQuota={deleteDialogOpp.status === 'closed-won'}
          onConfirm={() => {
            deleteOpportunity(deleteDialogOpp.id);
            setDeleteDialogOpp(null);
          }}
        />
      )}
    </div>
  );
}
