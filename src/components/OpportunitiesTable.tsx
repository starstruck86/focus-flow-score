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
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import { EditableDatePicker } from '@/components/EditableDatePicker';
import { OpportunityDetailsField } from '@/components/OpportunityDetailsField';
import { ClosedWonModal } from '@/components/quota/ClosedWonModal';
import type { Opportunity, OpportunityStatus, OpportunityStage, ChurnRisk } from '@/types';
import { format, parseISO, isToday, isPast, isThisQuarter } from 'date-fns';

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

interface OpportunitiesTableProps {
  onOpenDrawer: (opportunity: Opportunity) => void;
  renewalsOnly?: boolean;
  showChurnRisk?: boolean;
  columnOrder?: 'default' | 'outreach';
}

export function OpportunitiesTable({ onOpenDrawer, renewalsOnly = false, showChurnRisk = true, columnOrder = 'default' }: OpportunitiesTableProps) {
  const { opportunities, renewals, updateOpportunity, deleteOpportunity, addOpportunity } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [savedView, setSavedView] = useState<SavedView>('all');
  const [showAddRow, setShowAddRow] = useState(false);
  const [newOppName, setNewOppName] = useState('');
  const [closedWonModalOpen, setClosedWonModalOpen] = useState(false);
  const [closedWonOpportunity, setClosedWonOpportunity] = useState<Opportunity | null>(null);

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
  }, [opportunities, searchQuery, savedView]);

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

  const handleAddOpportunity = () => {
    if (!newOppName.trim()) return;
    addOpportunity({
      name: newOppName.trim(),
      status: 'active',
      stage: '',
      linkedContactIds: [],
    });
    setNewOppName('');
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
      <button
        onClick={() => onOpenDrawer(opp)}
        className="font-medium text-primary hover:underline text-left"
      >
        {opp.name}
      </button>
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

  const renderOpportunityRow = (opp: Opportunity) => {
    if (renewalsOnly) {
      // Renewals view: use expandable details row
      return (
        <React.Fragment key={opp.id}>
          <TableRow className="group hover:bg-muted/30">
            <TableCell className="align-top py-3">
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
              <button
                onClick={() => onOpenDrawer(opp)}
                className="font-medium text-primary hover:underline text-left"
              >
                {opp.name}
              </button>
            </TableCell>
            <TableCell className="align-top py-3">
              <ArrInput opp={opp} />
            </TableCell>
            {showChurnRisk && (
              <TableCell className="align-top py-3">
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
            <TableCell className="align-top py-3">
              <EditableDatePicker
                value={opp.closeDate}
                onChange={(v) => updateOpportunity(opp.id, { closeDate: v })}
                placeholder="—"
                compact
                className="w-28"
              />
            </TableCell>
            <TableCell className="align-top py-3">
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
            <TableCell className="align-top py-3">
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
          <TableRow className="hover:bg-transparent border-b-2">
            <TableCell colSpan={showChurnRisk ? 7 : 6} className="pt-0 pb-3">
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
        </React.Fragment>
      );
    }

    // Weekly Outreach view: use expandable details row
    if (columnOrder === 'outreach') {
      return (
        <React.Fragment key={opp.id}>
          <TableRow className="group hover:bg-muted/30">
            <TableCell className="align-top py-3">
              <button
                onClick={() => onOpenDrawer(opp)}
                className="font-medium text-primary hover:underline text-left"
              >
                {opp.name}
              </button>
            </TableCell>
            <TableCell className="align-top py-3">
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
            <TableCell className="align-top py-3">
              <ArrInput opp={opp} />
            </TableCell>
            <TableCell className="align-top py-3">
              <EditableDatePicker
                value={opp.closeDate}
                onChange={(v) => updateOpportunity(opp.id, { closeDate: v })}
                placeholder="—"
                compact
                className="w-28"
              />
            </TableCell>
            <TableCell className="align-top py-3">
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
          <TableRow className="hover:bg-transparent border-b-2">
            <TableCell colSpan={6} className="pt-0 pb-3">
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
        </React.Fragment>
      );
    }

    return (
      <TableRow key={opp.id} className="group">
        <StatusCell opp={opp} />
        <NameCell opp={opp} />
        <ArrCell opp={opp} />
        {showChurnRisk && <ChurnRiskCell opp={opp} />}
        <CloseDateCell opp={opp} />
        <NextStepCell opp={opp} />
        <StageCell opp={opp} />
        <LastTouchCell opp={opp} />
        <NotesCell opp={opp} />
        <ActionsCell opp={opp} />
      </TableRow>
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
                // Weekly Outreach headers: details in expandable row
                <>
                  <TableHead className="w-[25%]">Opportunity</TableHead>
                  <TableHead className="w-[15%]">Status</TableHead>
                  <TableHead className="w-[12%]">Stage</TableHead>
                  <TableHead className="w-[12%]">ARR</TableHead>
                  <TableHead className="w-[15%]">Close Date</TableHead>
                  <TableHead className="w-[6%]"></TableHead>
                </>
              ) : renewalsOnly ? (
                // Renewals-only headers: details in expandable row
                <>
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
                  <TableHead className="w-[130px]">Status</TableHead>
                  <TableHead className="w-[200px]">Opportunity</TableHead>
                  <TableHead className="w-[100px]">ARR</TableHead>
                  {showChurnRisk && <TableHead className="w-[100px]">Churn Risk</TableHead>}
                  <TableHead className="w-[130px]">Close Date</TableHead>
                  <TableHead className="w-[130px]">Next Step</TableHead>
                  <TableHead className="w-[100px]">Stage</TableHead>
                  <TableHead className="w-[100px]">Last Touch</TableHead>
                  <TableHead className="min-w-[200px]">Notes</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {showAddRow && (
              <TableRow>
                <TableCell colSpan={9}>
                  <div className="flex items-center gap-2">
                    <Input
                      value={newOppName}
                      onChange={(e) => setNewOppName(e.target.value)}
                      placeholder="Opportunity name..."
                      className="max-w-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddOpportunity();
                        if (e.key === 'Escape') {
                          setShowAddRow(false);
                          setNewOppName('');
                        }
                      }}
                    />
                    <Button size="sm" onClick={handleAddOpportunity}>Add</Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      setShowAddRow(false);
                      setNewOppName('');
                    }}>Cancel</Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {filteredOpportunities.length === 0 && !showAddRow ? (
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
