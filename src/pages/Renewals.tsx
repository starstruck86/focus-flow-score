import { useState, useRef, useMemo } from 'react';
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
  DollarSign,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { OpportunitiesTable } from '@/components/OpportunitiesTable';
import { OpportunityDrawer } from '@/components/OpportunityDrawer';
import type { Renewal, HealthStatus, Opportunity, ChurnRisk } from '@/types';

const HEALTH_COLORS: Record<HealthStatus, string> = {
  green: 'bg-status-green/20 text-status-green border-status-green/30',
  yellow: 'bg-status-yellow/20 text-status-yellow border-status-yellow/30',
  red: 'bg-status-red/20 text-status-red border-status-red/30',
};

const CHURN_RISK_COLORS: Record<ChurnRisk, string> = {
  certain: 'bg-green-600/20 text-green-400 border-green-600/30',
  low: 'bg-status-green/20 text-status-green border-status-green/30',
  medium: 'bg-status-yellow/20 text-status-yellow border-status-yellow/30',
  high: 'bg-status-red/20 text-status-red border-status-red/30',
};

const CHURN_RISK_LABELS: Record<ChurnRisk, string> = {
  certain: 'Certain',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
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
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentView, setCurrentView] = useState('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBulkImportDialog, setShowBulkImportDialog] = useState(false);
  const [importPreview, setImportPreview] = useState<Partial<Renewal>[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newRenewal, setNewRenewal] = useState<Partial<Renewal>>({
    healthStatus: 'green',
    autoRenew: false,
    owner: 'Corey Hartin',
  });

  const parseCSV = (text: string): Partial<Renewal>[] => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have a header row and at least one data row');
    }
    
    // Handle CSV with quoted fields containing commas
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim().replace(/^"|"$/g, ''));
      return result;
    };
    
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const parsedRenewals: Partial<Renewal>[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      
      // Skip rows without an account name (sub-line items)
      const accountNameIdx = headers.findIndex(h => 
        h === 'account name' || h === 'account' || h === 'name' || h === 'company' || h === 'accountname'
      );
      const accountNameValue = accountNameIdx >= 0 ? values[accountNameIdx]?.trim() : '';
      if (!accountNameValue) continue;
      
      const renewal: Partial<Renewal> = {
        healthStatus: 'green',
        autoRenew: false,
        owner: 'Corey Hartin',
      };
      
      headers.forEach((header, idx) => {
        const value = values[idx]?.trim();
        if (!value) return;
        
        switch (header) {
          case '':
            // First empty column might be quarter - skip, we calculate this
            break;
          case 'account':
          case 'account name':
          case 'accountname':
          case 'name':
          case 'company':
            renewal.accountName = value;
            break;
          case 'csm':
          case 'customer success':
          case 'cs manager':
            renewal.csm = value;
            break;
          case 'arr':
          case 'revenue':
          case 'value':
            // Handle "USD 120,043" format and "$161,124" format
            renewal.arr = Number(value.replace(/[$,\s]|USD/gi, '')) || 0;
            break;
          case 'renewal date':
          case 'renewaldate':
          case 'renewal due':
          case 'renewaldue':
          case 'due date':
          case 'duedate':
          case 'date':
            // Handle M/D/YY format like "2/1/26"
            const parts = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
            if (parts) {
              const month = parts[1].padStart(2, '0');
              const day = parts[2].padStart(2, '0');
              let year = parts[3];
              if (year.length === 2) {
                year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
              }
              renewal.renewalDue = `${year}-${month}-${day}`;
            } else {
              // Try standard date parsing
              const dateVal = new Date(value);
              if (!isNaN(dateVal.getTime())) {
                renewal.renewalDue = dateVal.toISOString().split('T')[0];
              }
            }
            break;
          case 'health':
          case 'health status':
          case 'healthstatus':
          case 'status':
            const healthLower = value.toLowerCase();
            if (['green', 'yellow', 'red'].includes(healthLower)) {
              renewal.healthStatus = healthLower as HealthStatus;
            }
            break;
          case 'auto renew':
          case 'autorenew':
          case 'auto-renew':
          case 'auto':
            renewal.autoRenew = ['yes', 'true', '1', 'y'].includes(value.toLowerCase());
            break;
          case 'product':
          case 'plan':
            renewal.product = value;
            break;
          case 'owner':
            renewal.owner = value;
            break;
          case 'next step':
          case 'nextstep':
          case 'next_step':
            renewal.nextStep = value;
            break;
          case 'planhat':
          case 'planhat link':
          case 'planhatlink':
            renewal.planhatLink = value === 'Link' ? '' : value;
            break;
          case 'cs notes':
          case 'csnotes':
          case 'notes':
            renewal.csNotes = value;
            break;
          case 'entitlements':
            renewal.entitlements = value;
            break;
          case 'usage':
            renewal.usage = value;
            break;
          case 'term':
            renewal.term = value;
            break;
          case 'entitlements - usage - term':
            // Combined field like "2025 - 86.6M - 1yr" or "Agreement - 1YR" or "Agreement - 3YR"
            // Try to split into parts if possible
            const entParts = value.split(' - ').map(p => p.trim());
            if (entParts.length >= 3) {
              // Format: "2025 - 86.6M - 1yr"
              renewal.entitlements = entParts[0];
              renewal.usage = entParts[1];
              renewal.term = entParts.slice(2).join(' - ');
            } else if (entParts.length === 2) {
              // Format: "Agreement - 1YR"
              renewal.entitlements = entParts[0];
              renewal.term = entParts[1];
            } else {
              renewal.entitlements = value;
            }
            break;
        }
      });
      
      // Only add if we have account name and renewal date (ARR can be 0 for some rows)
      if (renewal.accountName && renewal.renewalDue) {
        parsedRenewals.push(renewal);
      }
    }
    
    return parsedRenewals;
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setImportError(null);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsedRenewals = parseCSV(text);
        
        if (parsedRenewals.length === 0) {
          setImportError('No valid renewals found. Make sure you have Account, ARR, and Renewal Date columns.');
          return;
        }
        
        setImportPreview(parsedRenewals);
      } catch (error) {
        setImportError(error instanceof Error ? error.message : 'Failed to parse CSV');
      }
    };
    reader.readAsText(file);
  };

  const handleBulkImport = () => {
    let createdCount = 0;
    let updatedCount = 0;
    
    importPreview.forEach(importRenewal => {
      if (importRenewal.accountName && importRenewal.arr && importRenewal.renewalDue) {
        // Check if renewal with same account name already exists
        const existingRenewal = renewals.find(
          r => r.accountName.toLowerCase().trim() === importRenewal.accountName!.toLowerCase().trim()
        );
        
        if (existingRenewal) {
          // Update existing renewal
          const updates: Partial<Renewal> = {};
          if (importRenewal.arr) updates.arr = importRenewal.arr;
          if (importRenewal.renewalDue) updates.renewalDue = importRenewal.renewalDue;
          if (importRenewal.csm) updates.csm = importRenewal.csm;
          if (importRenewal.healthStatus) updates.healthStatus = importRenewal.healthStatus;
          if (importRenewal.product) updates.product = importRenewal.product;
          if (importRenewal.autoRenew !== undefined) updates.autoRenew = importRenewal.autoRenew;
          if (importRenewal.nextStep) updates.nextStep = importRenewal.nextStep;
          if (importRenewal.csNotes) updates.csNotes = importRenewal.csNotes;
          
          if (Object.keys(updates).length > 0) {
            updateRenewal(existingRenewal.id, updates);
            updatedCount++;
          }
        } else {
          addRenewal(importRenewal as Omit<Renewal, 'id' | 'createdAt' | 'updatedAt' | 'daysToRenewal' | 'renewalQuarter'>);
          createdCount++;
        }
      }
    });
    
    const messages = [];
    if (createdCount > 0) messages.push(`${createdCount} created`);
    if (updatedCount > 0) messages.push(`${updatedCount} updated`);
    toast.success(`Renewals: ${messages.join(', ')}!`);
    
    setShowBulkImportDialog(false);
    setImportPreview([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const downloadTemplate = () => {
    const template = 'Account Name,ARR,Renewal Date,CSM,Health,Auto Renew,Product,Next Step,Notes\nAcme Corp,50000,2026-06-30,Jane Doe,green,no,Enterprise,Schedule QBR,Key account\nGlobal Inc,25000,2026-09-15,John Smith,yellow,yes,Pro,Check usage,At risk';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'renewal_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

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

  // Calculate churn risk summary
  const churnRiskSummary = useMemo(() => {
    const summary: Record<ChurnRisk, { count: number; arr: number }> = {
      certain: { count: 0, arr: 0 },
      low: { count: 0, arr: 0 },
      medium: { count: 0, arr: 0 },
      high: { count: 0, arr: 0 },
    };
    
    renewals.forEach(r => {
      const risk = r.churnRisk || 'low';
      summary[risk].count++;
      summary[risk].arr += r.arr;
    });
    
    return summary;
  }, [renewals]);

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
        </div>
        
        {/* Churn Risk Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {(['certain', 'low', 'medium', 'high'] as ChurnRisk[]).map(risk => (
            <div 
              key={risk} 
              className={cn(
                "metric-card p-4 border-l-4",
                risk === 'certain' && "border-l-green-500",
                risk === 'low' && "border-l-status-green",
                risk === 'medium' && "border-l-status-yellow",
                risk === 'high' && "border-l-status-red",
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={cn("text-sm font-medium", CHURN_RISK_COLORS[risk].split(' ')[1])}>
                  {CHURN_RISK_LABELS[risk]} Risk
                </span>
                <Badge variant="outline" className={cn("text-xs", CHURN_RISK_COLORS[risk])}>
                  {churnRiskSummary[risk].count}
                </Badge>
              </div>
              <div className="text-xl font-bold font-mono">
                {formatCurrency(churnRiskSummary[risk].arr)}
              </div>
            </div>
          ))}
        </div>
        
        <Tabs defaultValue="renewals" className="space-y-4">
          <TabsList>
            <TabsTrigger value="renewals">Renewals</TabsTrigger>
            <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          </TabsList>
          
          <TabsContent value="renewals">
          <div className="flex items-center gap-2 mb-4">
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
                  <DialogTitle>Bulk Import Renewals</DialogTitle>
                  <DialogDescription>
                    Upload a CSV file to import multiple renewals at once.
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
                    />
                    <p className="text-xs text-muted-foreground">
                      Required columns: Account Name, ARR, Renewal Date
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
                      <Label>Preview ({importPreview.length} renewals)</Label>
                      <div className="max-h-60 overflow-auto border rounded-lg">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Account</TableHead>
                              <TableHead>ARR</TableHead>
                              <TableHead>Due Date</TableHead>
                              <TableHead>Health</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {importPreview.slice(0, 10).map((renewal, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="text-xs">{renewal.accountName}</TableCell>
                                <TableCell className="text-xs font-mono">${renewal.arr?.toLocaleString()}</TableCell>
                                <TableCell className="text-xs">{renewal.renewalDue}</TableCell>
                                <TableCell className="text-xs">{renewal.healthStatus}</TableCell>
                              </TableRow>
                            ))}
                            {importPreview.length > 10 && (
                              <TableRow>
                                <TableCell colSpan={4} className="text-center text-xs text-muted-foreground">
                                  ...and {importPreview.length - 10} more
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
                  <Button variant="outline" onClick={() => setShowBulkImportDialog(false)}>Cancel</Button>
                  <Button onClick={handleBulkImport} disabled={importPreview.length === 0}>
                    Import {importPreview.length > 0 && `(${importPreview.length})`}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

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
              
              <div className="metric-card overflow-x-auto p-0">
                <Table className="min-w-[1400px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="min-w-[180px]">Account Name</TableHead>
                      <TableHead className="min-w-[100px]">CSM</TableHead>
                      <TableHead className="min-w-[100px] text-right">ARR</TableHead>
                      <TableHead className="min-w-[100px]">Churn Risk</TableHead>
                      <TableHead className="min-w-[100px]">Renewal Due</TableHead>
                      <TableHead className="min-w-[100px]">Entitlements</TableHead>
                      <TableHead className="min-w-[80px]">Usage</TableHead>
                      <TableHead className="min-w-[80px]">Term</TableHead>
                      <TableHead className="min-w-[80px]">Planhat</TableHead>
                      <TableHead className="min-w-[90px] text-center">Auto-Renew</TableHead>
                      <TableHead className="min-w-[150px]">Product</TableHead>
                      <TableHead className="min-w-[200px]">CS Notes</TableHead>
                      <TableHead className="min-w-[200px]">Next Step</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quarterRenewals.map((renewal) => (
                      <TableRow key={renewal.id}>
                        <TableCell>
                          <span className="font-medium text-sm">{renewal.accountName}</span>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={renewal.csm || ''}
                            onChange={(e) => updateRenewal(renewal.id, { csm: e.target.value })}
                            placeholder="—"
                            className="h-7 text-xs"
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(renewal.arr)}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={renewal.churnRisk || 'low'}
                            onValueChange={(v) => updateRenewal(renewal.id, { churnRisk: v as ChurnRisk })}
                          >
                            <SelectTrigger className={cn("h-7 w-24 text-xs", CHURN_RISK_COLORS[renewal.churnRisk || 'low'])}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="certain">Certain</SelectItem>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <span className={cn(
                            "text-xs",
                            renewal.daysToRenewal <= 30 && "text-status-red font-medium",
                            renewal.daysToRenewal > 30 && renewal.daysToRenewal <= 60 && "text-status-yellow",
                          )}>
                            {renewal.renewalDue}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={renewal.entitlements || ''}
                            onChange={(e) => updateRenewal(renewal.id, { entitlements: e.target.value })}
                            placeholder="—"
                            className="h-7 text-xs min-w-[90px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={renewal.usage || ''}
                            onChange={(e) => updateRenewal(renewal.id, { usage: e.target.value })}
                            placeholder="—"
                            className="h-7 text-xs min-w-[70px]"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={renewal.term || ''}
                            onChange={(e) => updateRenewal(renewal.id, { term: e.target.value })}
                            placeholder="—"
                            className="h-7 text-xs min-w-[70px]"
                          />
                        </TableCell>
                        <TableCell>
                          {renewal.planhatLink ? (
                            <a 
                              href={renewal.planhatLink} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-primary hover:underline text-xs"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {renewal.autoRenew ? (
                            <Badge variant="outline" className="text-xs">Yes</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">No</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            value={renewal.product || ''}
                            onChange={(e) => updateRenewal(renewal.id, { product: e.target.value })}
                            placeholder="—"
                            className="h-7 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            value={renewal.csNotes || ''}
                            onChange={(e) => updateRenewal(renewal.id, { csNotes: e.target.value })}
                            placeholder="CS notes..."
                            className="min-h-[32px] h-8 text-xs resize-none py-1"
                            rows={1}
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            value={renewal.nextStep || ''}
                            onChange={(e) => updateRenewal(renewal.id, { nextStep: e.target.value })}
                            placeholder="Next step..."
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
                              <DropdownMenuItem>Edit Renewal</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => deleteRenewal(renewal.id)}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))
        )}
          </TabsContent>
          
          <TabsContent value="opportunities">
            <OpportunitiesTable onOpenDrawer={setSelectedOpportunity} />
          </TabsContent>
          
          <OpportunityDrawer
            opportunity={selectedOpportunity}
            onClose={() => setSelectedOpportunity(null)}
          />
        </Tabs>
      </div>
    </Layout>
  );
}
