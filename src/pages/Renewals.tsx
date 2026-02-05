import { useState } from 'react';
import { 
  Plus, 
  Phone, 
  Mail, 
  MessageSquare,
  MoreHorizontal,
  Search,
  ExternalLink,
  AlertTriangle,
  Calendar,
  DollarSign
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
import { Switch } from '@/components/ui/switch';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Renewal, HealthStatus } from '@/types';

const HEALTH_COLORS: Record<HealthStatus, string> = {
  green: 'bg-status-green/20 text-status-green border-status-green/30',
  yellow: 'bg-status-yellow/20 text-status-yellow border-status-yellow/30',
  red: 'bg-status-red/20 text-status-red border-status-red/30',
};

const VIEWS = [
  { value: 'all', label: 'All Renewals' },
  { value: '0-30', label: '0-30 Days' },
  { value: '31-60', label: '31-60 Days' },
  { value: '61-90', label: '61-90 Days' },
  { value: '91-180', label: '91-180 Days' },
  { value: 'at-risk', label: 'At Risk' },
  { value: 'auto-renew', label: 'Auto-Renew' },
  { value: 'no-next-step', label: 'No Next Step' },
];

export default function Renewals() {
  const { renewals, addRenewal, updateRenewal, deleteRenewal, logCall, logManualEmail, logMeetingHeld } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentView, setCurrentView] = useState('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newRenewal, setNewRenewal] = useState<Partial<Renewal>>({
    healthStatus: 'green',
    autoRenew: false,
    owner: 'Corey Hartin',
  });

  const filteredRenewals = renewals.filter(renewal => {
    const matchesSearch = renewal.accountName.toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesView = true;
    switch (currentView) {
      case '0-30':
        matchesView = renewal.daysToRenewal >= 0 && renewal.daysToRenewal <= 30;
        break;
      case '31-60':
        matchesView = renewal.daysToRenewal >= 31 && renewal.daysToRenewal <= 60;
        break;
      case '61-90':
        matchesView = renewal.daysToRenewal >= 61 && renewal.daysToRenewal <= 90;
        break;
      case '91-180':
        matchesView = renewal.daysToRenewal >= 91 && renewal.daysToRenewal <= 180;
        break;
      case 'at-risk':
        matchesView = renewal.healthStatus === 'red' || renewal.healthStatus === 'yellow';
        break;
      case 'auto-renew':
        matchesView = renewal.autoRenew;
        break;
      case 'no-next-step':
        matchesView = !renewal.nextStep;
        break;
    }
    
    return matchesSearch && matchesView;
  }).sort((a, b) => a.daysToRenewal - b.daysToRenewal);

  // Group by quarter
  const groupedRenewals = filteredRenewals.reduce((acc, renewal) => {
    const quarter = renewal.renewalQuarter;
    if (!acc[quarter]) acc[quarter] = [];
    acc[quarter].push(renewal);
    return acc;
  }, {} as Record<string, typeof filteredRenewals>);

  const handleAddRenewal = () => {
    if (!newRenewal.accountName || !newRenewal.renewalDue || !newRenewal.arr) {
      toast.error('Account name, ARR, and renewal date are required');
      return;
    }
    addRenewal(newRenewal as Omit<Renewal, 'id' | 'createdAt' | 'updatedAt' | 'daysToRenewal' | 'renewalQuarter'>);
    setShowAddDialog(false);
    setNewRenewal({
      healthStatus: 'green',
      autoRenew: false,
      owner: 'Corey Hartin',
    });
    toast.success('Renewal added!');
  };

  const handleQuickAction = (action: 'call' | 'email' | 'meeting', renewalId: string) => {
    switch (action) {
      case 'call':
        logCall(true);
        toast.success('Call logged!');
        break;
      case 'email':
        logManualEmail();
        toast.success('Email logged!');
        break;
      case 'meeting':
        logMeetingHeld();
        toast.success('Meeting/QBR logged!');
        break;
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <Layout>
      <div className="p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Renewals</h1>
            <p className="text-sm text-muted-foreground">
              {renewals.length} renewals • {formatCurrency(renewals.reduce((sum, r) => sum + r.arr, 0))} ARR
            </p>
          </div>
          
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Renewal
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add Renewal</DialogTitle>
                <DialogDescription>
                  Add a new renewal to track.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Account Name *</Label>
                    <Input
                      value={newRenewal.accountName || ''}
                      onChange={(e) => setNewRenewal({ ...newRenewal, accountName: e.target.value })}
                      placeholder="Acme Corp"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>CSM</Label>
                    <Input
                      value={newRenewal.csm || ''}
                      onChange={(e) => setNewRenewal({ ...newRenewal, csm: e.target.value })}
                      placeholder="John Doe"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>ARR *</Label>
                    <Input
                      type="number"
                      value={newRenewal.arr || ''}
                      onChange={(e) => setNewRenewal({ ...newRenewal, arr: Number(e.target.value) })}
                      placeholder="50000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Renewal Due *</Label>
                    <Input
                      type="date"
                      value={newRenewal.renewalDue || ''}
                      onChange={(e) => setNewRenewal({ ...newRenewal, renewalDue: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Health Status</Label>
                    <Select
                      value={newRenewal.healthStatus}
                      onValueChange={(v) => setNewRenewal({ ...newRenewal, healthStatus: v as HealthStatus })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="green">Green</SelectItem>
                        <SelectItem value="yellow">Yellow</SelectItem>
                        <SelectItem value="red">Red</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Product</Label>
                    <Input
                      value={newRenewal.product || ''}
                      onChange={(e) => setNewRenewal({ ...newRenewal, product: e.target.value })}
                      placeholder="Enterprise"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={newRenewal.autoRenew}
                      onCheckedChange={(checked) => setNewRenewal({ ...newRenewal, autoRenew: checked })}
                    />
                    <Label>Auto-Renew</Label>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Planhat Link</Label>
                  <Input
                    value={newRenewal.planhatLink || ''}
                    onChange={(e) => setNewRenewal({ ...newRenewal, planhatLink: e.target.value })}
                    placeholder="https://planhat.com/..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Next Step</Label>
                  <Textarea
                    value={newRenewal.nextStep || ''}
                    onChange={(e) => setNewRenewal({ ...newRenewal, nextStep: e.target.value })}
                    placeholder="Schedule QBR..."
                    rows={2}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                <Button onClick={handleAddRenewal}>Add Renewal</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search renewals..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={currentView} onValueChange={setCurrentView}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="View" />
            </SelectTrigger>
            <SelectContent>
              {VIEWS.map((view) => (
                <SelectItem key={view.value} value={view.value}>{view.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Renewals Table - Grouped by Quarter */}
        {Object.entries(groupedRenewals).length === 0 ? (
          <div className="metric-card text-center py-12">
            <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {renewals.length === 0 
                ? "No renewals yet. Add your first renewal to get started!"
                : "No renewals match your filters."}
            </p>
          </div>
        ) : (
          Object.entries(groupedRenewals).map(([quarter, quarterRenewals]) => (
            <div key={quarter} className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="font-display text-lg font-semibold">{quarter}</h2>
                <Badge variant="outline" className="text-xs">
                  {quarterRenewals.length} renewals
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {formatCurrency(quarterRenewals.reduce((sum, r) => sum + r.arr, 0))}
                </span>
              </div>
              
              <div className="metric-card overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[180px]">Account</TableHead>
                      <TableHead className="w-[80px]">CSM</TableHead>
                      <TableHead className="w-[100px] text-right">ARR</TableHead>
                      <TableHead className="w-[100px]">Due Date</TableHead>
                      <TableHead className="w-[80px] text-center">Days</TableHead>
                      <TableHead className="w-[80px]">Health</TableHead>
                      <TableHead className="w-[60px] text-center">Auto</TableHead>
                      <TableHead>Next Step</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quarterRenewals.map((renewal) => (
                      <TableRow key={renewal.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{renewal.accountName}</span>
                            {renewal.planhatLink && (
                              <a 
                                href={renewal.planhatLink} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-primary"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">{renewal.csm || '—'}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(renewal.arr)}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs">{renewal.renewalDue}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={cn(
                            "font-mono text-sm font-medium",
                            renewal.daysToRenewal <= 30 && "text-status-red",
                            renewal.daysToRenewal > 30 && renewal.daysToRenewal <= 60 && "text-status-yellow",
                            renewal.daysToRenewal > 60 && "text-muted-foreground"
                          )}>
                            {renewal.daysToRenewal}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={cn('text-xs border', HEALTH_COLORS[renewal.healthStatus])}>
                            {renewal.healthStatus === 'red' && <AlertTriangle className="h-3 w-3 mr-1" />}
                            {renewal.healthStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {renewal.autoRenew ? (
                            <Badge variant="outline" className="text-xs">Yes</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground line-clamp-1">
                            {renewal.nextStep || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-7 w-7"
                              onClick={() => handleQuickAction('call', renewal.id)}
                            >
                              <Phone className="h-3 w-3" />
                            </Button>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-7 w-7"
                              onClick={() => handleQuickAction('email', renewal.id)}
                            >
                              <Mail className="h-3 w-3" />
                            </Button>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-7 w-7"
                              onClick={() => handleQuickAction('meeting', renewal.id)}
                            >
                              <MessageSquare className="h-3 w-3" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-7 w-7">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem>Edit Renewal</DropdownMenuItem>
                                <DropdownMenuItem>View Details</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  className="text-destructive"
                                  onClick={() => deleteRenewal(renewal.id)}
                                >
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}
