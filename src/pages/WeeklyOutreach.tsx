import { useState } from 'react';
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
  Building2
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
import type { Account, Motion, OutreachStatus } from '@/types';

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

export default function WeeklyOutreach() {
  const { accounts, addAccount, updateAccount, deleteAccount, logCall, logManualEmail, logAutomatedEmail, logMeetingHeld } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterMotion, setFilterMotion] = useState<string>('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newAccount, setNewAccount] = useState<Partial<Account>>({
    priority: 'medium',
    motion: 'new-logo',
    outreachStatus: 'not-started',
    techStack: [],
    tags: [],
    techFitFlag: 'good',
  });

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
                    <Label>Priority</Label>
                    <Select
                      value={newAccount.priority}
                      onValueChange={(v) => setNewAccount({ ...newAccount, priority: v as 'high' | 'medium' | 'low' })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Motion</Label>
                    <Select
                      value={newAccount.motion as string}
                      onValueChange={(v) => setNewAccount({ ...newAccount, motion: v as Motion | 'both' })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new-logo">New Logo</SelectItem>
                        <SelectItem value="expansion">Expansion</SelectItem>
                        <SelectItem value="both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Industry</Label>
                  <Input
                    value={newAccount.industry || ''}
                    onChange={(e) => setNewAccount({ ...newAccount, industry: e.target.value })}
                    placeholder="Technology"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={newAccount.notes || ''}
                    onChange={(e) => setNewAccount({ ...newAccount, notes: e.target.value })}
                    placeholder="Any initial notes..."
                    rows={2}
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
                <TableHead className="w-[200px]">Account</TableHead>
                <TableHead className="w-[80px]">Priority</TableHead>
                <TableHead className="w-[100px]">Motion</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[100px]">Last Touch</TableHead>
                <TableHead className="w-[60px] text-center">Touches</TableHead>
                <TableHead>Next Step</TableHead>
                <TableHead className="w-[140px]">Quick Actions</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {accounts.length === 0 
                      ? "No accounts yet. Add your first account to get started!"
                      : "No accounts match your filters."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAccounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <div className="font-medium">{account.name}</div>
                          {account.website && (
                            <a 
                              href={account.website} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                            >
                              <Globe className="h-3 w-3" />
                              {new URL(account.website).hostname}
                            </a>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="outline" 
                        className={cn(
                          account.priority === 'high' && 'border-status-red text-status-red',
                          account.priority === 'medium' && 'border-status-yellow text-status-yellow',
                          account.priority === 'low' && 'border-status-green text-status-green',
                        )}
                      >
                        {account.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs capitalize">{account.motion.replace('-', ' ')}</span>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn('text-xs', STATUS_COLORS[account.outreachStatus])}>
                        {account.outreachStatus.replace(/-/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {account.lastTouchDate || '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-mono">{account.touchesThisWeek}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {account.nextStep || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7"
                          onClick={() => handleQuickAction('call', account.id)}
                        >
                          <Phone className="h-3 w-3" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7"
                          onClick={() => handleQuickAction('manual-email', account.id)}
                        >
                          <Mail className="h-3 w-3" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7"
                          onClick={() => handleQuickAction('auto-email', account.id)}
                        >
                          <MailCheck className="h-3 w-3" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7"
                          onClick={() => handleQuickAction('meeting', account.id)}
                        >
                          <MessageSquare className="h-3 w-3" />
                        </Button>
                      </div>
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
                          <DropdownMenuItem>Add Note</DropdownMenuItem>
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
