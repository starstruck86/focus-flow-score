import { useState, useRef } from 'react';
import { 
  ExternalLink, 
  Plus, 
  Phone, 
  Mail, 
  MailCheck,
  MessageSquare,
  MoreHorizontal,
  Filter,
  Search,
  ChevronDown,
  Globe,
  Building2,
  Upload,
  FileSpreadsheet,
  Download
} from 'lucide-react';
import { Layout } from '@/components/Layout';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Account, Motion, OutreachStatus, AccountTier, AccountStatus } from '@/types';

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

const STATUS_COLORS: Record<OutreachStatus, string> = {
  'not-started': 'bg-muted text-muted-foreground',
  'in-progress': 'bg-blue-500/20 text-blue-400',
  'working': 'bg-primary/20 text-primary',
  'nurture': 'bg-purple-500/20 text-purple-400',
  'meeting-set': 'bg-status-green/20 text-status-green',
  'opp-open': 'bg-status-yellow/20 text-status-yellow',
  'closed-won': 'bg-green-600/20 text-green-400',
  'closed-lost': 'bg-status-red/20 text-status-red',
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

export default function WeeklyOutreach() {
  const { accounts, addAccount, updateAccount, deleteAccount, logCall, logManualEmail, logAutomatedEmail, logMeetingHeld } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterMotion, setFilterMotion] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBulkImportDialog, setShowBulkImportDialog] = useState(false);
  const [importPreview, setImportPreview] = useState<Partial<Account>[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const parseCSV = (text: string): Partial<Account>[] => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have a header row and at least one data row');
    }
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const accounts: Partial<Account>[] = [];
    
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
          case 'priority':
            if (['high', 'medium', 'low'].includes(value.toLowerCase())) {
              account.priority = value.toLowerCase() as 'high' | 'medium' | 'low';
            }
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
          case 'motion':
          case 'type':
            if (value.toLowerCase().includes('new') || value.toLowerCase().includes('logo')) {
              account.motion = 'new-logo';
            } else if (value.toLowerCase().includes('exp')) {
              account.motion = 'expansion';
            } else if (value.toLowerCase().includes('both')) {
              account.motion = 'both';
            }
            break;
          case 'industry':
          case 'vertical':
            account.industry = value;
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
          case 'next step':
          case 'nextstep':
          case 'next_step':
            account.nextStep = value;
            break;
        }
      });
      
      if (account.name) {
        accounts.push(account);
      }
    }
    
    return accounts;
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
    let successCount = 0;
    
    importPreview.forEach(account => {
      if (account.name) {
        addAccount(account as Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'touchesThisWeek'>);
        successCount++;
      }
    });
    
    toast.success(`Imported ${successCount} accounts!`);
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
    const matchesPriority = filterPriority === 'all' || account.priority === filterPriority;
    const matchesMotion = filterMotion === 'all' || account.motion === filterMotion || account.motion === 'both';
    return matchesSearch && matchesPriority && matchesMotion;
  });

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

  const handleQuickAction = (action: 'call' | 'manual-email' | 'auto-email' | 'meeting', accountId: string) => {
    switch (action) {
      case 'call':
        logCall(true);
        updateAccount(accountId, { 
          lastTouchDate: new Date().toISOString().split('T')[0],
          lastTouchType: 'call',
          touchesThisWeek: (accounts.find(a => a.id === accountId)?.touchesThisWeek || 0) + 1
        });
        toast.success('Call logged!');
        break;
      case 'manual-email':
        logManualEmail();
        updateAccount(accountId, { 
          lastTouchDate: new Date().toISOString().split('T')[0],
          lastTouchType: 'manual-email',
          touchesThisWeek: (accounts.find(a => a.id === accountId)?.touchesThisWeek || 0) + 1
        });
        toast.success('Manual email logged!');
        break;
      case 'auto-email':
        logAutomatedEmail();
        updateAccount(accountId, { 
          lastTouchDate: new Date().toISOString().split('T')[0],
          lastTouchType: 'automated-email',
          touchesThisWeek: (accounts.find(a => a.id === accountId)?.touchesThisWeek || 0) + 1
        });
        toast.success('Automated email logged!');
        break;
      case 'meeting':
        logMeetingHeld();
        updateAccount(accountId, { 
          lastTouchDate: new Date().toISOString().split('T')[0],
          lastTouchType: 'meeting',
          touchesThisWeek: (accounts.find(a => a.id === accountId)?.touchesThisWeek || 0) + 1
        });
        toast.success('Meeting logged!');
        break;
    }
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
            <p className="text-sm text-muted-foreground">New Logo + Expansion Accounts</p>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Bulk Import Button */}
            <Dialog open={showBulkImportDialog} onOpenChange={(open) => {
              setShowBulkImportDialog(open);
              if (!open) {
                setImportPreview([]);
                setImportError(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }
            }}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Upload className="h-4 w-4 mr-2" />
                  Bulk Import
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
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search accounts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterMotion} onValueChange={setFilterMotion}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Motion" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Motion</SelectItem>
              <SelectItem value="new-logo">New Logo</SelectItem>
              <SelectItem value="expansion">Expansion</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Accounts Table */}
        <div className="metric-card overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[180px]">Account</TableHead>
                <TableHead className="w-[70px]">Tier</TableHead>
                <TableHead className="w-[140px]">Status</TableHead>
                <TableHead className="w-[120px]">Website</TableHead>
                <TableHead className="w-[120px]">MarTech</TableHead>
                <TableHead className="w-[120px]">Ecommerce</TableHead>
                <TableHead className="min-w-[200px]">Notes</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {accounts.length === 0 
                      ? "No accounts yet. Add your first account to get started!"
                      : "No accounts match your filters."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAccounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="font-medium">{account.name}</div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={account.tier || 'B'}
                        onValueChange={(v) => updateAccount(account.id, { tier: v as AccountTier })}
                      >
                        <SelectTrigger className="h-7 w-14 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="A">A</SelectItem>
                          <SelectItem value="B">B</SelectItem>
                          <SelectItem value="C">C</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={account.accountStatus || 'inactive'}
                        onValueChange={(v) => updateAccount(account.id, { accountStatus: v as AccountStatus })}
                      >
                        <SelectTrigger className="h-7 w-full text-xs">
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
                    </TableCell>
                    <TableCell>
                      {account.website ? (
                        <a 
                          href={account.website} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                        >
                          <Globe className="h-3 w-3" />
                          {(() => {
                            try {
                              return new URL(account.website).hostname;
                            } catch {
                              return account.website;
                            }
                          })()}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={account.marTech || ''}
                        onChange={(e) => updateAccount(account.id, { marTech: e.target.value })}
                        placeholder="—"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={account.ecommerce || ''}
                        onChange={(e) => updateAccount(account.id, { ecommerce: e.target.value })}
                        placeholder="—"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        value={account.notes || ''}
                        onChange={(e) => updateAccount(account.id, { notes: e.target.value })}
                        placeholder="Add notes or links..."
                        className="min-h-[32px] h-8 text-xs resize-none py-1"
                        rows={1}
                      />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>Edit Account</DropdownMenuItem>
                          <DropdownMenuItem>View Contacts</DropdownMenuItem>
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
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </Layout>
  );
}
