import React, { useState, useRef, useMemo } from 'react';
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
  Pencil,
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
import { ImportModal } from '@/components/import';
import { EditableTextCell, EditableTextareaCell, DisplaySelectCell, WebsiteLinkCell, AccountNameCell } from '@/components/table';
import { SortableHeader, useTableSort } from '@/components/table/SortableHeader';
import { 
  sortAccountsDefault, 
  applySortWithFallback,
  ACCOUNT_STATUS_SORT_RANK,
  ACCOUNT_STATUS_DISPLAY_LABELS,
  TIER_SORT_RANK,
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
  'inactive': 'bg-muted text-muted-foreground',
  'researched': 'bg-blue-500/20 text-blue-400',
  'active': 'bg-status-green/20 text-status-green',
  'meeting-booked': 'bg-primary/20 text-primary',
  'disqualified': 'bg-status-red/20 text-status-red',
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

// WebsiteCell replaced by WebsiteLinkCell from table components

// Status Summary Component for Accounts
function AccountsStatusSummary() {
  const { accounts } = useStore();
  
  const statusSummary = useMemo(() => {
    const statuses: AccountStatus[] = ['inactive', 'researched', 'active', 'meeting-booked', 'disqualified'];
    const summary: Record<AccountStatus, number> = {
      'inactive': 0,
      'researched': 0,
      'active': 0,
      'meeting-booked': 0,
      'disqualified': 0,
    };
    
    accounts.forEach(a => {
      summary[a.accountStatus]++;
    });
    
    return summary;
  }, [accounts]);

  const statusLabels: Record<AccountStatus, string> = {
    'inactive': 'Inactive',
    'researched': 'Researched',
    'active': 'Active',
    'meeting-booked': 'Meeting Booked',
    'disqualified': 'Disqualified',
  };

  const totalCount = Object.values(statusSummary).reduce((sum, c) => sum + c, 0);

  return (
    <div className="space-y-4">
      {/* Total Summary */}
      <div className="flex items-center gap-4">
        <div className="text-sm text-muted-foreground">
          Total Accounts: <span className="font-semibold text-foreground">{totalCount}</span>
        </div>
      </div>
      
      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {(['inactive', 'researched', 'active', 'meeting-booked', 'disqualified'] as AccountStatus[]).map(status => (
          <div 
            key={status} 
            className={cn(
              "metric-card p-3 flex items-center justify-between"
            )}
          >
            <Badge className={cn("text-xs", ACCOUNT_STATUS_COLORS[status])}>
              {statusLabels[status]}
            </Badge>
            <span className="text-lg font-bold font-mono">
              {statusSummary[status]}
            </span>
          </div>
        ))}
      </div>
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
    
    // Only count active opportunities
    opportunities
      .filter(o => o.status === 'active')
      .forEach(o => {
        const stage = o.stage || '';
        // Only count if stage exists in our summary (handles legacy stage values)
        if (summary[stage]) {
          summary[stage].count++;
          summary[stage].arr += o.arr || 0;
        } else {
          // Map legacy stages or unknown stages to "No Stage"
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
      {/* Total Summary */}
      <div className="flex items-center gap-4">
        <div className="text-sm text-muted-foreground">
          Active Pipeline: <span className="font-semibold text-foreground">{totalCount} opps</span> • <span className="font-mono font-semibold text-foreground">{formatCurrency(totalARR)}</span>
        </div>
      </div>
      
      {/* Stage Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {(['', 'Prospect', 'Discover', 'Demo', 'Proposal', 'Negotiate', 'Closed Won', 'Closed Lost'] as OpportunityStage[]).map(stage => (
          <div 
            key={stage || 'no-stage'} 
            className={cn(
              "metric-card p-3 border-l-4",
              STAGE_COLORS[stage]
            )}
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

// Status order for sorting (NEW numbered labels)
const STATUS_ORDER: AccountStatus[] = ['active', 'researched', 'inactive', 'disqualified', 'meeting-booked'];

// Status options for select dropdown with numbered labels
const STATUS_OPTIONS = [
  { value: 'active', label: '1-Active', className: 'bg-status-green/20 text-status-green' },
  { value: 'researched', label: '2-Researched', className: 'bg-blue-500/20 text-blue-400' },
  { value: 'inactive', label: '3-Inactive', className: 'bg-muted text-muted-foreground' },
  { value: 'disqualified', label: '4-Disqualified', className: 'bg-status-red/20 text-status-red' },
  { value: 'meeting-booked', label: '5-Meeting Booked', className: 'bg-primary/20 text-primary' },
];

// Tier options for select dropdown  
const TIER_OPTIONS = [
  { value: 'A', label: 'A', className: 'border-status-green text-status-green bg-transparent' },
  { value: 'B', label: 'B', className: 'border-status-yellow text-status-yellow bg-transparent' },
  { value: 'C', label: 'C', className: 'border-muted-foreground text-muted-foreground bg-transparent' },
];

export default function WeeklyOutreach() {
  const { accounts, addAccount, updateAccount, deleteAccount } = useStore();
  const [activeTab, setActiveTab] = useState<'accounts' | 'opportunities'>('accounts');
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTier, setFilterTier] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBulkImportDialog, setShowBulkImportDialog] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<Partial<Account>[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collapsedStatuses, setCollapsedStatuses] = useState<Set<AccountStatus>>(new Set());
  
  // Sort hook for accounts table
  const { sortConfig: accountSortConfig, handleSort: handleAccountSort } = useTableSort();
  
  const [newAccount, setNewAccount] = useState<Partial<Account>>({
    priority: 'medium',
    tier: 'B',
    accountStatus: 'inactive',
    motion: 'new-logo',
    outreachStatus: 'not-started',
    techStack: [],
    tags: [],
    techFitFlag: 'good',
  });

  const toggleStatusCollapse = (status: AccountStatus) => {
    setCollapsedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

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
              'researched': 'researched',
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

  const filteredAccounts = accounts.filter(account => {
    const matchesSearch = account.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTier = filterTier === 'all' || account.tier === filterTier;
    const matchesStatus = filterStatus === 'all' || account.accountStatus === filterStatus;
    return matchesSearch && matchesTier && matchesStatus;
  });

  // Sort accounts: default is Tier → Status → Name
  const sortedAccounts = useMemo(() => {
    const sortKeyMap = {
      tier: { key: 'tier' as keyof Account, customRank: TIER_SORT_RANK },
      accountStatus: { key: 'accountStatus' as keyof Account, customRank: ACCOUNT_STATUS_SORT_RANK },
      name: { key: 'name' as keyof Account },
      marTech: { key: 'marTech' as keyof Account },
      ecommerce: { key: 'ecommerce' as keyof Account },
    };
    return applySortWithFallback(filteredAccounts, accountSortConfig, sortAccountsDefault, sortKeyMap);
  }, [filteredAccounts, accountSortConfig]);

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
      accountStatus: 'inactive',
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

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Weekly Outreach</h1>
            <p className="text-sm text-muted-foreground">Pipeline & Account Execution</p>
          </div>
          <StreakChip variant="full" />
        </div>

        {/* Stage Summary - Visible on both tabs */}
        <OpportunitiesStageSummary />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'accounts' | 'opportunities')} className="space-y-4">
          <TabsList className="grid w-full max-w-xs grid-cols-2">
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          </TabsList>

          {/* Accounts Tab */}
          <TabsContent value="accounts" className="space-y-4">
            {/* Status Summary */}
            <AccountsStatusSummary />
            
            {/* Accounts Actions */}
            <div className="flex items-center justify-end gap-2">
              {/* New Import Button (uses database) */}
              <Button variant="outline" onClick={() => setShowImportModal(true)}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Import
              </Button>
              
              {/* Legacy Bulk Import Button (uses local state) */}
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
                    {/* Template Download */}
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
                    
                    {/* File Upload */}
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
                    
                    {/* Error Message */}
                    {importError && (
                      <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                        {importError}
                      </div>
                    )}
                    
                    {/* Preview Table */}
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
                        <Label>Status</Label>
                        <Select
                          value={newAccount.accountStatus || 'inactive'}
                          onValueChange={(v) => setNewAccount({ ...newAccount, accountStatus: v as AccountStatus })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inactive">Inactive</SelectItem>
                            <SelectItem value="researched">Researched</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="meeting-booked">Meeting Booked</SelectItem>
                            <SelectItem value="disqualified">Disqualified</SelectItem>
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

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 max-w-sm">
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
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="researched">Researched</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="meeting-booked">Meeting Booked</SelectItem>
                  <SelectItem value="disqualified">Disqualified</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Accounts Table - Flat sortable list */}
            {sortedAccounts.length === 0 ? (
              <div className="metric-card p-8 text-center text-muted-foreground">
                {accounts.length === 0 
                  ? "No accounts yet. Add your first account to get started!"
                  : "No accounts match your filters."}
              </div>
            ) : (
              <div className="metric-card overflow-x-auto p-0">
                <Table className="min-w-[1200px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <SortableHeader 
                        sortKey="name" 
                        currentSort={accountSortConfig} 
                        onSort={handleAccountSort}
                        className="w-[18%]"
                      >
                        Account
                      </SortableHeader>
                      <TableHead className="w-[18%]">Website</TableHead>
                      <SortableHeader 
                        sortKey="accountStatus" 
                        currentSort={accountSortConfig} 
                        onSort={handleAccountSort}
                        className="w-[14%]"
                      >
                        Status
                      </SortableHeader>
                      <SortableHeader 
                        sortKey="tier" 
                        currentSort={accountSortConfig} 
                        onSort={handleAccountSort}
                        className="w-[8%]"
                      >
                        Tier
                      </SortableHeader>
                      <SortableHeader 
                        sortKey="marTech" 
                        currentSort={accountSortConfig} 
                        onSort={handleAccountSort}
                        className="w-[18%]"
                      >
                        MarTech
                      </SortableHeader>
                      <SortableHeader 
                        sortKey="ecommerce" 
                        currentSort={accountSortConfig} 
                        onSort={handleAccountSort}
                        className="w-[18%]"
                      >
                        Ecommerce
                      </SortableHeader>
                      <TableHead className="w-[6%]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedAccounts.map((account) => (
                      <React.Fragment key={account.id}>
                        <TableRow className="hover:bg-muted/30">
                          <TableCell className="align-top py-3">
                            <AccountNameCell 
                              name={account.name} 
                              salesforceLink={account.salesforceLink}
                              onNameChange={(name) => updateAccount(account.id, { name })}
                              onSalesforceLinkChange={(link) => updateAccount(account.id, { salesforceLink: link })}
                              className="text-sm break-words"
                            />
                          </TableCell>
                          <TableCell className="align-top py-3 group">
                            <WebsiteLinkCell
                              value={account.website || ''}
                              onChange={(value) => updateAccount(account.id, { website: value })}
                            />
                          </TableCell>
                          <TableCell className="align-top py-3">
                            <DisplaySelectCell
                              value={account.accountStatus || 'inactive'}
                              options={STATUS_OPTIONS}
                              onChange={(v) => updateAccount(account.id, { accountStatus: v as AccountStatus })}
                            />
                          </TableCell>
                          <TableCell className="align-top py-3">
                            <DisplaySelectCell
                              value={account.tier || 'B'}
                              options={TIER_OPTIONS}
                              onChange={(v) => updateAccount(account.id, { tier: v as AccountTier })}
                              badgeClassName="border"
                            />
                          </TableCell>
                          <TableCell className="align-top py-3">
                            <EditableTextareaCell
                              value={account.marTech || ''}
                              onChange={(v) => updateAccount(account.id, { marTech: v })}
                              placeholder="Add MarTech"
                              emptyText="Add"
                            />
                          </TableCell>
                          <TableCell className="align-top py-3">
                            <EditableTextareaCell
                              value={account.ecommerce || ''}
                              onChange={(v) => updateAccount(account.id, { ecommerce: v })}
                              placeholder="Add Ecommerce"
                              emptyText="Add"
                            />
                          </TableCell>
                          <TableCell className="align-top py-3">
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
                        {/* Contacts row spans full width */}
                        <TableRow className="hover:bg-transparent border-b-2">
                          <TableCell colSpan={7} className="pt-0 pb-3">
                            <AccountContactsField
                              contacts={account.accountContacts || []}
                              onChange={(contacts) => updateAccount(account.id, { accountContacts: contacts })}
                              companyNotes={account.notes || ''}
                              onCompanyNotesChange={(notes) => updateAccount(account.id, { notes })}
                            />
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
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
