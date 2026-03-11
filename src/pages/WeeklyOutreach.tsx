import React, { useState, useRef, useMemo, useCallback } from 'react';
import { 
  ExternalLink, 
  Plus, 
  MoreHorizontal,
  Search,
  Upload,
  FileSpreadsheet,
  Download,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Filter,
  Trash2,
  ExternalLink as LinkIcon,
  Users,
  Sparkles,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { StreakChip } from '@/components/StreakChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { OpportunitiesTable } from '@/components/OpportunitiesTable';
import { OpportunityDrawer } from '@/components/OpportunityDrawer';
import { AccountContactsField, type AccountContact } from '@/components/AccountContactsField';
import { ManageColumnsPopover } from '@/components/table/ManageColumnsPopover';
import { CustomFieldCell, CustomFieldRow } from '@/components/table/CustomFieldCell';
import { MetricFieldCell } from '@/components/table/MetricFieldCell';
import { useCustomFields } from '@/hooks/useCustomFields';
import { ImportModal } from '@/components/import';
import { EditableTextCell, EditableTextareaCell, DisplaySelectCell, WebsiteLinkCell, AccountNameCell } from '@/components/table';
import { SortableHeader, useTableSort } from '@/components/table/SortableHeader';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { BulkActionsBar } from '@/components/BulkActionsBar';
import { Checkbox } from '@/components/ui/checkbox';
import { RowHoverActions } from '@/components/table/RowHoverActions';
import { EmptyState } from '@/components/table/EmptyState';
import { FilterChips, type ActiveFilter } from '@/components/table/FilterChips';
import { useUndoDelete } from '@/hooks/useUndoDelete';
import { emitSaveStatus } from '@/components/SaveIndicator';
import { TouchLogButtons } from '@/components/TouchLogButtons';
import { LifecycleTierBadge, IcpScorePill, TriggeredBadge, EnrichButton, SignalDetailPanel } from '@/components/LifecycleIntelligence';
import { useAccountEnrichment } from '@/hooks/useAccountEnrichment';
import { 
  sortAccountsDefault, 
  applySortWithFallback,
  ACCOUNT_STATUS_SORT_RANK,
  ACCOUNT_STATUS_DISPLAY_LABELS,
  TIER_SORT_RANK,
  CONTACT_STATUS_SORT_RANK,
  CONTACT_STATUS_DISPLAY_LABELS,
} from '@/lib/sortUtils';
import type { Account, AccountTier, AccountStatus, Opportunity, OpportunityStage } from '@/types';

// Quick Links
const QUICK_LINKS = {
  leadsContacts: [
    { label: 'My Leads', url: 'https://acoustic.lightning.force.com/lightning/o/Lead/list?filterName=Copy_of_My_Leads1' },
    { label: 'Converted Leads', url: 'https://acoustic.lightning.force.com/lightning/o/Contact/list?filterName=Converted_Leads' },
    { label: 'Marketing Interactions', url: 'https://acoustic.lightning.force.com/lightning/o/Contact/list?filterName=Marketing_Interactions' },
    { label: 'Past Connects', url: 'https://acoustic.lightning.force.com/lightning/r/Report/00Oa6000001kRz7EAE/view' },
    { label: 'Previous Users', url: 'https://acoustic.lightning.force.com/lightning/o/Contact/list?filterName=Previous_Users' },
  ],
  accounts: [
    { label: 'Sourced', url: 'https://acoustic.lightning.force.com/lightning/o/Account/list?filterName=Sourced_Accounts2' },
    { label: 'Churned', url: 'https://acoustic.lightning.force.com/lightning/o/Account/list?filterName=Churned_Customers' },
    { label: 'Past Opps', url: 'https://acoustic.lightning.force.com/lightning/r/Report/00Oa6000001k68HEAQ/view?queryScope=userFolders' },
    { label: 'Past Meetings', url: 'https://acoustic.lightning.force.com/lightning/r/Report/00Oa6000001k653EAA/view?queryScope=userFolders' },
  ],
};

const ACCOUNT_STATUS_COLORS: Record<AccountStatus, string> = {
  'researching': 'bg-blue-500/20 text-blue-400',
  'prepped': 'bg-cyan-500/20 text-cyan-400',
  'active': 'bg-status-green/20 text-status-green',
  'inactive': 'bg-muted text-muted-foreground',
  'disqualified': 'bg-status-red/20 text-status-red',
  'meeting-booked': 'bg-primary/20 text-primary',
};

const TIER_COLORS: Record<AccountTier, string> = {
  'A': 'border-status-green text-status-green',
  'B': 'border-status-yellow text-status-yellow',
  'C': 'border-muted-foreground text-muted-foreground',
};

const STAGE_COLORS: Record<string, string> = {
  '': 'border-muted-foreground',
  'Prospect': 'border-blue-400',
  'Discover': 'border-cyan-400',
  'Demo': 'border-status-yellow',
  'Proposal': 'border-orange-400',
  'Negotiate': 'border-purple-400',
  'Closed Won': 'border-status-green',
  'Closed Lost': 'border-status-red',
};

const STAGE_TEXT_COLORS: Record<string, string> = {
  '': 'text-muted-foreground',
  'Prospect': 'text-blue-400',
  'Discover': 'text-cyan-400',
  'Demo': 'text-status-yellow',
  'Proposal': 'text-orange-400',
  'Negotiate': 'text-purple-400',
  'Closed Won': 'text-status-green',
  'Closed Lost': 'text-status-red',
};

const STAGE_LABELS: Record<string, string> = {
  '': 'No Stage',
  'Prospect': '1 - Prospect',
  'Discover': '2 - Discover',
  'Demo': '3 - Demo',
  'Proposal': '4 - Proposal',
  'Negotiate': '5 - Negotiate',
  'Closed Won': '6 - Closed Won',
  'Closed Lost': '7 - Closed Lost',
};

// Status options for select dropdown with numbered labels
const STATUS_OPTIONS = [
  { value: 'researching', label: '1 - Researching', className: 'bg-blue-500/20 text-blue-400' },
  { value: 'prepped', label: '2 - Prepped', className: 'bg-cyan-500/20 text-cyan-400' },
  { value: 'active', label: '3 - Active', className: 'bg-status-green/20 text-status-green' },
  { value: 'inactive', label: '4 - Inactive', className: 'bg-muted text-muted-foreground' },
  { value: 'disqualified', label: '5 - Disqualified', className: 'bg-status-red/20 text-status-red' },
  { value: 'meeting-booked', label: '6 - Meeting Booked', className: 'bg-primary/20 text-primary' },
];

// Tier options for select dropdown  
const TIER_OPTIONS = [
  { value: 'A', label: 'A', className: 'border-status-green text-status-green bg-transparent' },
  { value: 'B', label: 'B', className: 'border-status-yellow text-status-yellow bg-transparent' },
  { value: 'C', label: 'C', className: 'border-muted-foreground text-muted-foreground bg-transparent' },
];

// Contact Status options
const CONTACT_STATUS_OPTIONS = [
  { value: 'ready', label: 'Ready', className: 'bg-status-green/20 text-status-green' },
  { value: 'in-progress', label: 'In-Progress', className: 'bg-status-yellow/20 text-status-yellow' },
  { value: 'not-started', label: 'Not Started', className: 'bg-muted text-muted-foreground' },
];

// ===== FUNNEL CONFIGURATION =====
interface FunnelGroup {
  status: AccountStatus;
  label: string;
  hint: string;
  color: string;
  borderColor: string;
  defaultCollapsed: boolean;
  section: 'primary' | 'outcome' | 'holding';
}

const FUNNEL_GROUPS: FunnelGroup[] = [
  { status: 'researching', label: '1 - Researching', hint: 'Identify fit + gather basics', color: 'text-blue-400', borderColor: 'border-blue-500/50', defaultCollapsed: false, section: 'primary' },
  { status: 'prepped', label: '2 - Prepped', hint: 'Ready for cadence / first touches', color: 'text-cyan-400', borderColor: 'border-cyan-500/50', defaultCollapsed: false, section: 'primary' },
  { status: 'active', label: '3 - Active', hint: 'In cadence / active outreach', color: 'text-status-green', borderColor: 'border-status-green/50', defaultCollapsed: false, section: 'primary' },
  { status: 'meeting-booked', label: '5 - Meeting Booked', hint: 'Meeting scheduled', color: 'text-primary', borderColor: 'border-primary/50', defaultCollapsed: true, section: 'outcome' },
  { status: 'disqualified', label: '6 - Disqualified', hint: 'Not a fit', color: 'text-status-red', borderColor: 'border-status-red/50', defaultCollapsed: true, section: 'outcome' },
  { status: 'inactive', label: '4 - Inactive', hint: 'Holding bucket', color: 'text-muted-foreground', borderColor: 'border-border', defaultCollapsed: false, section: 'holding' },
];

const DEFAULT_TARGETS: Record<string, number> = {
  researching: 25,
  prepped: 20,
  active: 30,
};

// Sort within funnel group: Tier → Last Updated desc → Name A-Z
function sortFunnelGroup(accounts: Account[]): Account[] {
  return [...accounts].sort((a, b) => {
    // 1) Tier
    const tierA = TIER_SORT_RANK[a.tier as keyof typeof TIER_SORT_RANK] ?? 99;
    const tierB = TIER_SORT_RANK[b.tier as keyof typeof TIER_SORT_RANK] ?? 99;
    if (tierA !== tierB) return tierA - tierB;
    // 2) Last Updated desc
    if (a.updatedAt !== b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
    // 3) Name A-Z
    return a.name.localeCompare(b.name);
  });
}

// ===== STALENESS ALERT =====
function StalenessAlert({ accounts }: { accounts: Account[] }) {
  const staleCount = accounts.filter(a => {
    if (a.accountStatus === 'disqualified' || a.accountStatus === 'inactive') return false;
    if (!a.lastTouchDate) return true;
    const days = Math.floor((Date.now() - new Date(a.lastTouchDate).getTime()) / 86400000);
    return days > 7;
  }).length;

  const noNextStep = accounts.filter(a => 
    (a.accountStatus === 'active' || a.accountStatus === 'prepped') && !a.nextStep
  ).length;

  const noCadence = accounts.filter(a => 
    a.accountStatus === 'active' && !a.cadenceName
  ).length;

  if (staleCount === 0 && noNextStep === 0 && noCadence === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {staleCount > 0 && (
        <div className="flex items-center gap-2 text-xs bg-status-red/10 border border-status-red/20 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-status-red shrink-0" />
          <span className="text-status-red font-medium">{staleCount} accounts</span>
          <span className="text-muted-foreground">untouched 7+ days</span>
        </div>
      )}
      {noNextStep > 0 && (
        <div className="flex items-center gap-2 text-xs bg-status-yellow/10 border border-status-yellow/20 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-status-yellow shrink-0" />
          <span className="text-status-yellow font-medium">{noNextStep} active accounts</span>
          <span className="text-muted-foreground">missing next step</span>
        </div>
      )}
      {noCadence > 0 && (
        <div className="flex items-center gap-2 text-xs bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-primary font-medium">{noCadence} active accounts</span>
          <span className="text-muted-foreground">not in cadence</span>
        </div>
      )}
    </div>
  );
}

// Stage Summary Component for Opportunities
function OpportunitiesStageSummary() {
  const { opportunities } = useStore();
  
  const stageSummary = useMemo(() => {
    const stages: OpportunityStage[] = ['', 'Prospect', 'Discover', 'Demo', 'Proposal', 'Negotiate', 'Closed Won', 'Closed Lost'];
    const summary: Record<string, { count: number; arr: number }> = {};
    
    stages.forEach(stage => {
      summary[stage] = { count: 0, arr: 0 };
    });
    
    opportunities
      .filter(o => o.status === 'active')
      .forEach(o => {
        const stage = o.stage || '';
        if (summary[stage]) {
          summary[stage].count++;
          summary[stage].arr += o.arr || 0;
        } else {
          summary[''].count++;
          summary[''].arr += o.arr || 0;
        }
      });
    
    return summary;
  }, [opportunities]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const totalARR = Object.values(stageSummary).reduce((sum, s) => sum + s.arr, 0);
  const totalCount = Object.values(stageSummary).reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="text-sm text-muted-foreground">
          Active Pipeline: <span className="font-semibold text-foreground">{totalCount} opps</span> • <span className="font-mono font-semibold text-foreground">{formatCurrency(totalARR)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {(['', 'Prospect', 'Discover', 'Demo', 'Proposal', 'Negotiate', 'Closed Won', 'Closed Lost'] as OpportunityStage[]).map(stage => (
          <div 
            key={stage || 'no-stage'} 
            className={cn("metric-card p-3 border-l-4", STAGE_COLORS[stage])}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={cn("text-xs font-medium", STAGE_TEXT_COLORS[stage])}>
                {STAGE_LABELS[stage] || stage || 'No Stage'}
              </span>
              <Badge variant="outline" className="text-xs h-5 px-1.5">
                {stageSummary[stage].count}
              </Badge>
            </div>
            <div className="text-lg font-bold font-mono">
              {formatCurrency(stageSummary[stage].arr)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== FUNNEL HEALTH BAR =====
function FunnelHealthBar({ accounts }: { accounts: Account[] }) {
  const counts: Record<string, number> = { researching: 0, prepped: 0, active: 0 };
  accounts.forEach(a => {
    if (counts[a.accountStatus] !== undefined) counts[a.accountStatus]++;
  });

  const stages = [
    { key: 'researching', label: '1 - Researching', count: counts.researching, target: DEFAULT_TARGETS.researching, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { key: 'prepped', label: '2 - Prepped', count: counts.prepped, target: DEFAULT_TARGETS.prepped, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    { key: 'active', label: '3 - Active', count: counts.active, target: DEFAULT_TARGETS.active, color: 'text-status-green', bg: 'bg-status-green/10' },
  ];

  const warnings = stages.filter(s => s.count < s.target);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {stages.map(s => {
          const belowTarget = s.count < s.target;
          return (
            <div key={s.key} className={cn("metric-card p-3 flex flex-col", s.bg)}>
              <div className="flex items-center justify-between">
                <span className={cn("text-xs font-medium", s.color)}>{s.label}</span>
                <span className={cn("text-xl font-bold font-mono", belowTarget ? "text-status-yellow" : "text-foreground")}>
                  {s.count}
                  <span className="text-xs text-muted-foreground font-normal"> / {s.target}</span>
                </span>
              </div>
              {belowTarget && (
                <div className="flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-3 w-3 text-status-yellow" />
                  <span className="text-[10px] text-status-yellow">Below target by {s.target - s.count}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== FUNNEL GROUP SECTION =====
function FunnelGroupSection({
  group,
  accounts,
  expandedAccountId,
  setExpandedAccountId,
  updateAccount,
  deleteAccount,
  isCollapsed,
  onToggleCollapse,
  isSelected,
  onToggleSelect,
}: {
  group: FunnelGroup;
  accounts: Account[];
  expandedAccountId: string | null;
  setExpandedAccountId: (id: string | null) => void;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  deleteAccount: (id: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isSelected: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { fields, getFieldValue } = useCustomFields();
  const summaryCustomFields = fields.filter(
    f => f.tabTarget === 'accounts' && (f.placement === 'summary' || f.placement === 'both')
  );
  if (accounts.length === 0 && isCollapsed) return null;

  return (
    <Collapsible open={!isCollapsed} onOpenChange={() => onToggleCollapse()}>
      <CollapsibleTrigger asChild>
        <button className={cn(
          "w-full flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors",
          "hover:bg-muted/50 text-left border",
          group.borderColor
        )}>
          {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <Badge className={cn("text-xs shrink-0", ACCOUNT_STATUS_COLORS[group.status])}>
            {group.label}
          </Badge>
          <span className="text-xs text-muted-foreground">{group.hint}</span>
          <span className="ml-auto text-sm font-mono font-semibold">{accounts.length}</span>
          {group.section === 'primary' && accounts.some(a => a.cadenceName) && (
            <span className="text-[10px] text-muted-foreground">
              {accounts.filter(a => a.cadenceName).length} in cadence
            </span>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {accounts.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground italic">No accounts in this stage.</div>
        ) : (
          <div className="metric-card overflow-x-auto p-0 mt-1 mb-3">
            <Table className="min-w-[1200px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[3%]">
                        <Checkbox
                          checked={accounts.every(a => isSelected(a.id)) && accounts.length > 0}
                          onCheckedChange={() => accounts.forEach(a => onToggleSelect(a.id))}
                          aria-label="Select all in group"
                        />
                      </TableHead>
                      <TableHead className="w-[3%]"></TableHead>
                      <TableHead className="w-[17%]">Account</TableHead>
                  <TableHead className="w-[12%]">Website</TableHead>
                  <TableHead className="w-[10%]">Account Status</TableHead>
                  <TableHead className="w-[5%]">ICP</TableHead>
                  <TableHead className="w-[5%]">Tier</TableHead>
                  <TableHead className="w-[8%]">Contact Status</TableHead>
                  <TableHead className="w-[5%]">Tier</TableHead>
                  {(group.status === 'prepped' || group.status === 'active') && (
                    <TableHead className="w-[8%]">Cadence</TableHead>
                  )}
                  <TableHead className="w-[12%]">MarTech</TableHead>
                    <TableHead className="w-[12%]">Ecommerce</TableHead>
                    {summaryCustomFields.map(field => (
                      <TableHead key={field.id} className="w-[8%]">{field.name}</TableHead>
                    ))}
                    <TableHead className="w-[4%]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <React.Fragment key={account.id}>
                    <TableRow 
                      className={cn(
                        "hover:bg-muted/30",
                        expandedAccountId === account.id && "bg-muted/20"
                      )}
                    >
                      <TableCell className="align-top py-3">
                        <Checkbox
                          checked={isSelected(account.id)}
                          onCheckedChange={() => onToggleSelect(account.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${account.name}`}
                        />
                      </TableCell>
                      <TableCell className="align-top py-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setExpandedAccountId(expandedAccountId === account.id ? null : account.id)}
                        >
                          {expandedAccountId === account.id ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <AccountNameCell 
                            name={account.name} 
                            salesforceLink={account.salesforceLink}
                            onNameChange={(name) => updateAccount(account.id, { name })}
                            onSalesforceLinkChange={(link) => updateAccount(account.id, { salesforceLink: link })}
                            className="text-sm break-words"
                          />
                          <div className="opacity-0 group-hover/row:opacity-100 transition-opacity">
                            <TouchLogButtons accountId={account.id} compact />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top py-3 group" onClick={(e) => e.stopPropagation()}>
                        <WebsiteLinkCell
                          value={account.website || ''}
                          onChange={(value) => updateAccount(account.id, { website: value })}
                        />
                      </TableCell>
                      <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                        <DisplaySelectCell
                          value={account.accountStatus || 'inactive'}
                          options={STATUS_OPTIONS}
                          onChange={(v) => updateAccount(account.id, { accountStatus: v as AccountStatus })}
                        />
                      </TableCell>
                      <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                        <DisplaySelectCell
                          value={account.contactStatus || 'not-started'}
                          options={CONTACT_STATUS_OPTIONS}
                          onChange={(v) => updateAccount(account.id, { contactStatus: v as any })}
                        />
                      </TableCell>
                      <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                        <DisplaySelectCell
                          value={account.tier || 'B'}
                          options={TIER_OPTIONS}
                          onChange={(v) => updateAccount(account.id, { tier: v as AccountTier })}
                          badgeClassName="border"
                        />
                      </TableCell>
                      {(group.status === 'prepped' || group.status === 'active') && (
                        <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                          {account.cadenceName ? (
                            <Badge className="bg-status-green/15 text-status-green text-[10px]">In Cadence</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">Not in Cadence</Badge>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                        <EditableTextareaCell
                          value={account.marTech || ''}
                          onChange={(v) => updateAccount(account.id, { marTech: v })}
                          placeholder="Add MarTech"
                          emptyText="Add"
                        />
                      </TableCell>
                      <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                        <EditableTextareaCell
                          value={account.ecommerce || ''}
                          onChange={(v) => updateAccount(account.id, { ecommerce: v })}
                          placeholder="Add Ecommerce"
                          emptyText="Add"
                        />
                      </TableCell>
                      {summaryCustomFields.map(field => (
                        <TableCell key={field.id} className="align-top py-2" onClick={(e) => e.stopPropagation()}>
                          <MetricFieldCell field={field} recordId={account.id} />
                        </TableCell>
                      ))}
                      <TableCell className="align-top py-3 relative" onClick={(e) => e.stopPropagation()}>
                        <RowHoverActions
                          actions={[
                            {
                              icon: ExternalLink,
                              label: 'Open in Salesforce',
                              onClick: () => account.salesforceLink && window.open(account.salesforceLink, '_blank'),
                            },
                            {
                              icon: Trash2,
                              label: 'Delete',
                              variant: 'destructive',
                              onClick: () => deleteAccount(account.id),
                            },
                          ]}
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>Edit Account</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => deleteAccount(account.id)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {expandedAccountId === account.id && (
                      <TableRow className="hover:bg-transparent border-b-2 bg-muted/10">
                        <TableCell colSpan={10 + summaryCustomFields.length} className="pt-0 pb-3">
                          <AccountContactsField
                            accountId={account.id}
                            contacts={account.accountContacts || []}
                            onChange={(contacts) => updateAccount(account.id, { accountContacts: contacts })}
                            companyNotes={account.notes || ''}
                            onCompanyNotesChange={(notes) => updateAccount(account.id, { notes })}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function WeeklyOutreach() {
  const { accounts, addAccount, updateAccount: rawUpdateAccount, deleteAccount } = useStore();
  const bulkSelection = useBulkSelection<Account>();
  
  // Wrap update with save indicator
  const updateAccount = useCallback((id: string, updates: Partial<Account>) => {
    emitSaveStatus('saving');
    rawUpdateAccount(id, updates);
    setTimeout(() => emitSaveStatus('saved'), 300);
  }, [rawUpdateAccount]);
  
  // Undo delete for accounts
  const { deleteWithUndo } = useUndoDelete<Account>({
    onDelete: (id) => deleteAccount(id),
    onRestore: (item) => addAccount(item),
    itemLabel: 'Account',
  });
  
  const [activeTab, setActiveTab] = useState<'accounts' | 'opportunities'>('accounts');
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTier, setFilterTier] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBulkImportDialog, setShowBulkImportDialog] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<Partial<Account>[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  
  // Quick filter toggles
  const [filterTierAB, setFilterTierAB] = useState(false);
  const [filterMissingCadence, setFilterMissingCadence] = useState(false);
  const [filterStale, setFilterStale] = useState(false);
  
  // Active filter chips
  const activeFilters = useMemo(() => {
    const filters: ActiveFilter[] = [];
    if (searchQuery) filters.push({ key: 'search', label: 'Search', value: searchQuery, onRemove: () => setSearchQuery('') });
    if (filterTier !== 'all') filters.push({ key: 'tier', label: 'Tier', value: filterTier, onRemove: () => setFilterTier('all') });
    if (filterTierAB) filters.push({ key: 'tierAB', label: 'Tier', value: 'A & B only', onRemove: () => setFilterTierAB(false) });
    if (filterMissingCadence) filters.push({ key: 'cadence', label: 'Cadence', value: 'Missing', onRemove: () => setFilterMissingCadence(false) });
    if (filterStale) filters.push({ key: 'stale', label: 'Stale', value: '7+ days', onRemove: () => setFilterStale(false) });
    return filters;
  }, [searchQuery, filterTier, filterTierAB, filterMissingCadence, filterStale]);

  // Collapsed groups - outcomes collapsed by default
  const [collapsedGroups, setCollapsedGroups] = useState<Set<AccountStatus>>(
    new Set(['meeting-booked', 'disqualified'])
  );

  const toggleGroupCollapse = (status: AccountStatus) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };
  
  const [newAccount, setNewAccount] = useState<Partial<Account>>({
    priority: 'medium',
    tier: 'B',
    accountStatus: 'researching',
    motion: 'new-logo',
    outreachStatus: 'not-started',
    techStack: [],
    tags: [],
    techFitFlag: 'good',
  });

  const parseCSV = (text: string): Partial<Account>[] => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have a header row and at least one data row');
    }
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const accountsList: Partial<Account>[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const account: Partial<Account> = {
        priority: 'medium',
        tier: 'B',
        accountStatus: 'inactive',
        motion: 'new-logo',
        outreachStatus: 'not-started',
        techStack: [],
        tags: [],
        techFitFlag: 'good',
        touchesThisWeek: 0,
      };
      
      headers.forEach((header, idx) => {
        const value = values[idx];
        if (!value) return;
        
        switch (header) {
          case 'name':
          case 'account':
          case 'account name':
          case 'company':
            account.name = value;
            break;
          case 'website':
          case 'url':
            account.website = value.startsWith('http') ? value : `https://${value}`;
            break;
          case 'tier':
            if (['a', 'b', 'c'].includes(value.toLowerCase())) {
              account.tier = value.toUpperCase() as AccountTier;
            }
            break;
          case 'status':
          case 'account status':
          case 'accountstatus':
            const statusMap: Record<string, AccountStatus> = {
              'inactive': 'inactive',
              'researched': 'researching',
              'researching': 'researching',
              'prepped': 'prepped',
              'active': 'active',
              'meeting booked': 'meeting-booked',
              'meeting-booked': 'meeting-booked',
              'disqualified': 'disqualified',
            };
            const normalizedStatus = value.toLowerCase();
            if (statusMap[normalizedStatus]) {
              account.accountStatus = statusMap[normalizedStatus];
            }
            break;
          case 'martech':
          case 'mar tech':
          case 'marketing tech':
            account.marTech = value;
            break;
          case 'ecommerce':
          case 'e-commerce':
          case 'commerce':
            account.ecommerce = value;
            break;
          case 'notes':
          case 'note':
          case 'comments':
            account.notes = value;
            break;
        }
      });
      
      if (account.name) {
        accountsList.push(account);
      }
    }
    
    return accountsList;
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setImportError(null);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsedAccounts = parseCSV(text);
        
        if (parsedAccounts.length === 0) {
          setImportError('No valid accounts found in the CSV. Make sure you have a "name" or "account" column.');
          return;
        }
        
        setImportPreview(parsedAccounts);
      } catch (error) {
        setImportError(error instanceof Error ? error.message : 'Failed to parse CSV');
      }
    };
    reader.readAsText(file);
  };

  const handleBulkImport = () => {
    let createdCount = 0;
    let updatedCount = 0;
    
    importPreview.forEach(importAccount => {
      if (importAccount.name) {
        const existingAccount = accounts.find(
          a => a.name.toLowerCase().trim() === importAccount.name!.toLowerCase().trim()
        );
        
        if (existingAccount) {
          const updates: Partial<Account> = {};
          if (importAccount.website) updates.website = importAccount.website;
          if (importAccount.tier) updates.tier = importAccount.tier;
          if (importAccount.accountStatus) updates.accountStatus = importAccount.accountStatus;
          if (importAccount.marTech) updates.marTech = importAccount.marTech;
          if (importAccount.ecommerce) updates.ecommerce = importAccount.ecommerce;
          if (importAccount.notes) updates.notes = importAccount.notes;
          
          if (Object.keys(updates).length > 0) {
            updateAccount(existingAccount.id, updates);
            updatedCount++;
          }
        } else {
          addAccount(importAccount as Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'touchesThisWeek'>);
          createdCount++;
        }
      }
    });
    
    const messages = [];
    if (createdCount > 0) messages.push(`${createdCount} created`);
    if (updatedCount > 0) messages.push(`${updatedCount} updated`);
    toast.success(`Accounts: ${messages.join(', ')}!`);
    
    setShowBulkImportDialog(false);
    setImportPreview([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const downloadTemplate = () => {
    const template = 'Name,Website,Tier,Status,MarTech,Ecommerce,Notes\nAcme Corp,https://acme.com,A,inactive,Marketo,Shopify,Initial outreach target\nGlobal Inc,https://global.com,B,researched,HubSpot,Magento,Previous customer';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'account_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Apply search + quick filters
  const filteredAccounts = useMemo(() => {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const staleDate = fourteenDaysAgo.toISOString();

    return accounts.filter(account => {
      const matchesSearch = !searchQuery || account.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTier = filterTier === 'all' || account.tier === filterTier;
      const matchesTierAB = !filterTierAB || account.tier === 'A' || account.tier === 'B';
      const matchesCadence = !filterMissingCadence || !account.cadenceName;
      const matchesStale = !filterStale || !account.lastTouchDate || account.lastTouchDate < staleDate;
      return matchesSearch && matchesTier && matchesTierAB && matchesCadence && matchesStale;
    });
  }, [accounts, searchQuery, filterTier, filterTierAB, filterMissingCadence, filterStale]);

  // Group & sort accounts by funnel status
  const groupedAccounts = useMemo(() => {
    const groups: Record<AccountStatus, Account[]> = {
      'researching': [],
      'prepped': [],
      'active': [],
      'inactive': [],
      'disqualified': [],
      'meeting-booked': [],
    };
    
    filteredAccounts.forEach(a => {
      const status = a.accountStatus || 'inactive';
      if (groups[status]) groups[status].push(a);
      else groups['inactive'].push(a);
    });
    
    // Sort each group
    Object.keys(groups).forEach(key => {
      groups[key as AccountStatus] = sortFunnelGroup(groups[key as AccountStatus]);
    });
    
    return groups;
  }, [filteredAccounts]);

  const handleAddAccount = () => {
    if (!newAccount.name) {
      toast.error('Account name is required');
      return;
    }
    addAccount(newAccount as Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'touchesThisWeek'>);
    setShowAddDialog(false);
    setNewAccount({
      priority: 'medium',
      tier: 'B',
      accountStatus: 'researching',
      motion: 'new-logo',
      outreachStatus: 'not-started',
      techStack: [],
      tags: [],
      techFitFlag: 'good',
    });
    toast.success('Account added!');
  };

  return (
    <Layout>
      <div className="p-6 lg:p-8">
        {/* Quick Links Bar */}
        <div className="mb-6 space-y-3">
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-2 self-center">
              Leads & Contacts:
            </span>
            {QUICK_LINKS.leadsContacts.map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="quick-action text-xs py-1 px-2"
              >
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-2 self-center">
              Accounts:
            </span>
            {QUICK_LINKS.accounts.map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="quick-action text-xs py-1 px-2"
              >
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        </div>

        {/* Header + Staleness Alert */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-display text-2xl font-bold">Weekly Outreach</h1>
            <p className="text-sm text-muted-foreground">Pipeline & Account Execution</p>
          </div>
          <StreakChip variant="full" />
        </div>
        
        {/* Staleness & Urgency Summary */}
        <StalenessAlert accounts={accounts} />

        {/* Stage Summary - Visible on both tabs */}
        <OpportunitiesStageSummary />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'accounts' | 'opportunities')} className="space-y-4">
          <TabsList className="grid w-full max-w-xs grid-cols-2">
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          </TabsList>

          {/* Accounts Tab - Funnel View */}
          <TabsContent value="accounts" className="space-y-4">
            {/* Funnel Health Bar */}
            <FunnelHealthBar accounts={accounts} />
            
            {/* Actions Bar */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {/* Search + Quick Filters */}
              <div className="flex items-center gap-2 flex-wrap flex-1">
                <div className="relative max-w-sm min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search accounts..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={filterTier} onValueChange={setFilterTier}>
                  <SelectTrigger className="w-24">
                    <SelectValue placeholder="Tier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tiers</SelectItem>
                    <SelectItem value="A">Tier A</SelectItem>
                    <SelectItem value="B">Tier B</SelectItem>
                    <SelectItem value="C">Tier C</SelectItem>
                  </SelectContent>
                </Select>
                {/* Quick filter toggles */}
                <div className="flex items-center gap-1.5">
                  <Button
                    variant={filterTierAB ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setFilterTierAB(!filterTierAB)}
                  >
                    Tier A/B
                  </Button>
                  <Button
                    variant={filterMissingCadence ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setFilterMissingCadence(!filterMissingCadence)}
                  >
                    No Cadence
                  </Button>
                  <Button
                    variant={filterStale ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setFilterStale(!filterStale)}
                  >
                    Stale 14d+
                  </Button>
                </div>
              </div>

              {/* Import + Add */}
              <div className="flex items-center gap-2">
                <ManageColumnsPopover
                  tabTarget="accounts"
                  viewKey="accounts-newlogo-funnel"
                  builtInColumns={[
                    { key: 'website', label: 'Website' },
                    { key: 'status', label: 'Account Status' },
                    { key: 'contactStatus', label: 'Contact Status' },
                    { key: 'tier', label: 'Tier' },
                    { key: 'cadence', label: 'Cadence' },
                    { key: 'martech', label: 'MarTech' },
                    { key: 'ecommerce', label: 'Ecommerce' },
                  ]}
                />
                <Button variant="outline" onClick={() => setShowImportModal(true)}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Import
                </Button>
                
                <Dialog open={showBulkImportDialog} onOpenChange={(open) => {
                  setShowBulkImportDialog(open);
                  if (!open) {
                    setImportPreview([]);
                    setImportError(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }
                }}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-muted-foreground">
                      <Upload className="h-4 w-4 mr-2" />
                      Quick Import (Local)
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Bulk Import Accounts</DialogTitle>
                      <DialogDescription>
                        Upload a CSV file to import multiple accounts at once.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Need a template?</p>
                            <p className="text-xs text-muted-foreground">Download our CSV template with example data</p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={downloadTemplate}>
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Upload CSV File</Label>
                        <Input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv"
                          onChange={handleFileUpload}
                          className="cursor-pointer"
                        />
                        <p className="text-xs text-muted-foreground">
                          Supported columns: Name, Website, Tier, Status, MarTech, Ecommerce, Notes
                        </p>
                      </div>
                      
                      {importError && (
                        <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                          {importError}
                        </div>
                      )}
                      
                      {importPreview.length > 0 && (
                        <div className="space-y-2">
                          <Label>Preview ({importPreview.length} accounts)</Label>
                          <div className="max-h-60 overflow-auto border rounded-lg">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Name</TableHead>
                                  <TableHead>Tier</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead>Website</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {importPreview.slice(0, 10).map((account, idx) => (
                                  <TableRow key={idx}>
                                    <TableCell className="font-medium">{account.name}</TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className={cn(TIER_COLORS[account.tier || 'B'])}>
                                        {account.tier || 'B'}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs capitalize">
                                      {(account.accountStatus || 'inactive').replace('-', ' ')}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {account.website || '—'}
                                    </TableCell>
                                  </TableRow>
                                ))}
                                {importPreview.length > 10 && (
                                  <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground text-sm">
                                      ... and {importPreview.length - 10} more accounts
                                    </TableCell>
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowBulkImportDialog(false)}>
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleBulkImport} 
                        disabled={importPreview.length === 0}
                      >
                        Import {importPreview.length} Accounts
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                
                {/* Add Single Account */}
                <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Account
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add New Account</DialogTitle>
                      <DialogDescription>
                        Add a new account to your weekly outreach list.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Account Name *</Label>
                        <Input
                          value={newAccount.name || ''}
                          onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                          placeholder="Acme Corp"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Tier</Label>
                          <Select
                            value={newAccount.tier || 'B'}
                            onValueChange={(v) => setNewAccount({ ...newAccount, tier: v as AccountTier })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="A">A</SelectItem>
                              <SelectItem value="B">B</SelectItem>
                              <SelectItem value="C">C</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Account Status</Label>
                          <Select
                            value={newAccount.accountStatus || 'researching'}
                            onValueChange={(v) => setNewAccount({ ...newAccount, accountStatus: v as AccountStatus })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="researching">1 - Researching</SelectItem>
                              <SelectItem value="prepped">2 - Prepped</SelectItem>
                              <SelectItem value="active">3 - Active</SelectItem>
                              <SelectItem value="inactive">4 - Inactive</SelectItem>
                              <SelectItem value="disqualified">5 - Disqualified</SelectItem>
                              <SelectItem value="meeting-booked">6 - Meeting Booked</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Website</Label>
                        <Input
                          value={newAccount.website || ''}
                          onChange={(e) => setNewAccount({ ...newAccount, website: e.target.value })}
                          placeholder="https://acme.com"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>MarTech</Label>
                          <Input
                            value={newAccount.marTech || ''}
                            onChange={(e) => setNewAccount({ ...newAccount, marTech: e.target.value })}
                            placeholder="e.g., Marketo, HubSpot"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Ecommerce</Label>
                          <Input
                            value={newAccount.ecommerce || ''}
                            onChange={(e) => setNewAccount({ ...newAccount, ecommerce: e.target.value })}
                            placeholder="e.g., Shopify, Magento"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Notes</Label>
                        <Textarea
                          value={newAccount.notes || ''}
                          onChange={(e) => setNewAccount({ ...newAccount, notes: e.target.value })}
                          placeholder="Any initial notes or links..."
                          rows={3}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                      <Button onClick={handleAddAccount}>Add Account</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* Bulk Actions Bar */}
            <BulkActionsBar
              selectedCount={bulkSelection.selectedCount}
              onClear={bulkSelection.clear}
              selectedIds={bulkSelection.selectedIds}
              actions={[
                {
                  id: 'change-status',
                  label: 'Change Status',
                  options: [
                    { value: 'researching', label: '1 - Researching' },
                    { value: 'prepped', label: '2 - Prepped' },
                    { value: 'active', label: '3 - Active' },
                    { value: 'inactive', label: '4 - Inactive' },
                    { value: 'disqualified', label: '5 - Disqualified' },
                    { value: 'meeting-booked', label: '6 - Meeting Booked' },
                  ],
                  onExecute: (ids, value) => {
                    ids.forEach(id => updateAccount(id, { accountStatus: value as AccountStatus }));
                    bulkSelection.clear();
                  },
                },
                {
                  id: 'change-tier',
                  label: 'Change Tier',
                  options: [
                    { value: 'A', label: 'Tier A' },
                    { value: 'B', label: 'Tier B' },
                    { value: 'C', label: 'Tier C' },
                  ],
                  onExecute: (ids, value) => {
                    ids.forEach(id => updateAccount(id, { tier: value as AccountTier }));
                    bulkSelection.clear();
                  },
                },
                {
                  id: 'delete',
                  label: 'Delete',
                  icon: undefined,
                  variant: 'destructive' as const,
                  onExecute: (ids) => {
                    ids.forEach(id => deleteAccount(id));
                    bulkSelection.clear();
                  },
                },
              ]}
            />

            <FilterChips
              filters={activeFilters}
              onClearAll={() => { setSearchQuery(''); setFilterTier('all'); setFilterTierAB(false); setFilterMissingCadence(false); setFilterStale(false); }}
            />

            {/* Funnel Grouped View */}
            {accounts.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No accounts yet"
                description="Add your first account to start building your outreach pipeline."
                actionLabel="Add Account"
                onAction={() => setShowAddDialog(true)}
                secondaryActionLabel="Import CSV"
                onSecondaryAction={() => setShowImportModal(true)}
              />
            ) : filteredAccounts.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No matching accounts"
                description="Try adjusting your filters or search query."
                actionLabel="Clear Filters"
                onAction={() => { setSearchQuery(''); setFilterTier('all'); setFilterTierAB(false); setFilterMissingCadence(false); setFilterStale(false); }}
              />
            ) : (
              <div className="space-y-2">
                {/* Primary Funnel: 1-3 */}
                <div className="space-y-1">
                  {FUNNEL_GROUPS.filter(g => g.section === 'primary').map(group => (
                    <FunnelGroupSection
                      key={group.status}
                      group={group}
                      accounts={groupedAccounts[group.status]}
                      expandedAccountId={expandedAccountId}
                      setExpandedAccountId={setExpandedAccountId}
                      updateAccount={updateAccount}
                      deleteAccount={(id) => { const acct = accounts.find(a => a.id === id); if (acct) deleteWithUndo(acct); }}
                      isCollapsed={collapsedGroups.has(group.status)}
                      onToggleCollapse={() => toggleGroupCollapse(group.status)}
                      isSelected={bulkSelection.isSelected}
                      onToggleSelect={bulkSelection.toggle}
                    />
                  ))}
                </div>

                {/* Outcomes: Meeting Booked + Disqualified */}
                <div className="pt-3 border-t border-border/50">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 px-1">Outcomes</p>
                  <div className="space-y-1">
                    {FUNNEL_GROUPS.filter(g => g.section === 'outcome').map(group => (
                      <FunnelGroupSection
                        key={group.status}
                        group={group}
                        accounts={groupedAccounts[group.status]}
                        expandedAccountId={expandedAccountId}
                        setExpandedAccountId={setExpandedAccountId}
                        updateAccount={updateAccount}
                        deleteAccount={(id) => { const acct = accounts.find(a => a.id === id); if (acct) deleteWithUndo(acct); }}
                        isCollapsed={collapsedGroups.has(group.status)}
                        onToggleCollapse={() => toggleGroupCollapse(group.status)}
                        isSelected={bulkSelection.isSelected}
                        onToggleSelect={bulkSelection.toggle}
                      />
                    ))}
                  </div>
                </div>

                {/* Holding: Inactive */}
                <div className="pt-3 border-t border-border/50">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 px-1">Holding</p>
                  <div className="space-y-1">
                    {FUNNEL_GROUPS.filter(g => g.section === 'holding').map(group => (
                      <FunnelGroupSection
                        key={group.status}
                        group={group}
                        accounts={groupedAccounts[group.status]}
                        expandedAccountId={expandedAccountId}
                        setExpandedAccountId={setExpandedAccountId}
                        updateAccount={updateAccount}
                        deleteAccount={(id) => { const acct = accounts.find(a => a.id === id); if (acct) deleteWithUndo(acct); }}
                        isCollapsed={collapsedGroups.has(group.status)}
                        onToggleCollapse={() => toggleGroupCollapse(group.status)}
                        isSelected={bulkSelection.isSelected}
                        onToggleSelect={bulkSelection.toggle}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Opportunities Tab */}
          <TabsContent value="opportunities" className="space-y-4">
            <OpportunitiesTable onOpenDrawer={setSelectedOpportunity} showChurnRisk={false} columnOrder="outreach" excludeRenewals />
          </TabsContent>
        </Tabs>

        {/* Opportunity Drawer */}
        <OpportunityDrawer
          opportunity={selectedOpportunity}
          onClose={() => setSelectedOpportunity(null)}
        />
        
        {/* Import Modal */}
        <ImportModal open={showImportModal} onOpenChange={setShowImportModal} />
      </div>
    </Layout>
  );
}
