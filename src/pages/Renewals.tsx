import React, { useState, useRef, useMemo, useCallback, memo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  Download,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { StreakChip } from '@/components/StreakChip';
import { LifecycleTierBadge, IcpScorePill, EnrichButton, SignalDetailPanel } from '@/components/LifecycleIntelligence';
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
import { EditableDatePicker } from '@/components/EditableDatePicker';
import { RenewalDetailsField } from '@/components/RenewalDetailsField';
import { EditableTextCell, EditableNumberCell, DisplaySelectCell, PlanhatLinkCell, AgreementLinkCell, AccountNameCell } from '@/components/table';
import { ManageColumnsPopover } from '@/components/table/ManageColumnsPopover';
import { CustomFieldCell, CustomFieldRow } from '@/components/table/CustomFieldCell';
import { MetricFieldCell } from '@/components/table/MetricFieldCell';
import { useCustomFields } from '@/hooks/useCustomFields';
import { SortableHeader, useTableSort } from '@/components/table/SortableHeader';
import { sortRenewalsDefault, applySortWithFallback, CHURN_RISK_SORT_RANK, CHURN_RISK_DISPLAY_LABELS } from '@/lib/sortUtils';
import type { Renewal, HealthStatus, Opportunity, ChurnRisk } from '@/types';
import { computeRenewalRiskScore } from '@/hooks/useTimeAllocation';

// ===== RENEWAL URGENCY HEADER =====
function RenewalUrgencyHeader({ renewals, formatCurrency }: { renewals: Renewal[]; formatCurrency: (v: number) => string }) {
  // Exclude churning/churned renewals from urgency alerts
  const activeRenewals = renewals.filter(r => r.churnRisk !== 'certain');
  
  const nearest = activeRenewals.filter(r => r.daysToRenewal > 0).sort((a, b) => a.daysToRenewal - b.daysToRenewal)[0];
  const atRiskArr = activeRenewals
    .filter(r => r.churnRisk === 'high' || r.healthStatus === 'red')
    .reduce((sum, r) => sum + r.arr, 0);
  const next30Arr = activeRenewals
    .filter(r => r.daysToRenewal >= 0 && r.daysToRenewal <= 30)
    .reduce((sum, r) => sum + r.arr, 0);
  const missingNextStep = activeRenewals.filter(r => r.daysToRenewal <= 90 && !r.nextStep).length;

  if (!nearest && atRiskArr === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {nearest && (
        <div className={cn(
          "flex items-center gap-2 text-xs rounded-lg px-3 py-2 border",
          nearest.daysToRenewal <= 14 ? "bg-status-red/10 border-status-red/20" :
          nearest.daysToRenewal <= 30 ? "bg-status-yellow/10 border-status-yellow/20" :
          "bg-primary/10 border-primary/20"
        )}>
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">Next renewal:</span>
          <span className="font-bold">{nearest.accountName}</span>
          <span>in</span>
          <span className={cn(
            "font-mono font-bold",
            nearest.daysToRenewal <= 14 ? "text-status-red" :
            nearest.daysToRenewal <= 30 ? "text-status-yellow" : "text-primary"
          )}>
            {nearest.daysToRenewal}d
          </span>
          <span className="text-muted-foreground">({formatCurrency(nearest.arr)})</span>
        </div>
      )}
      {next30Arr > 0 && (
        <div className="flex items-center gap-2 text-xs bg-status-yellow/10 border border-status-yellow/20 rounded-lg px-3 py-2">
          <DollarSign className="h-3.5 w-3.5 text-status-yellow shrink-0" />
          <span className="font-mono font-bold text-status-yellow">{formatCurrency(next30Arr)}</span>
          <span className="text-muted-foreground">due in 30 days</span>
        </div>
      )}
      {atRiskArr > 0 && (
        <div className="flex items-center gap-2 text-xs bg-status-red/10 border border-status-red/20 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-status-red shrink-0" />
          <span className="font-mono font-bold text-status-red">{formatCurrency(atRiskArr)}</span>
          <span className="text-muted-foreground">ARR at risk</span>
        </div>
      )}
      {missingNextStep > 0 && (
        <div className="flex items-center gap-2 text-xs bg-status-yellow/10 border border-status-yellow/20 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-status-yellow shrink-0" />
          <span className="text-status-yellow font-medium">{missingNextStep} renewals</span>
          <span className="text-muted-foreground">in 90d window missing next step</span>
        </div>
      )}
    </div>
  );
}

const HEALTH_COLORS: Record<HealthStatus, string> = {
  green: 'bg-status-green/20 text-status-green border-status-green/30',
  yellow: 'bg-status-yellow/20 text-status-yellow border-status-yellow/30',
  red: 'bg-status-red/20 text-status-red border-status-red/30',
};

const CHURN_RISK_COLORS: Record<ChurnRisk, string> = {
  low: 'bg-status-green/20 text-status-green border-status-green/30',
  medium: 'bg-status-yellow/20 text-status-yellow border-status-yellow/30',
  high: 'bg-status-red/20 text-status-red border-status-red/30',
  certain: 'bg-purple-600/20 text-purple-400 border-purple-600/30', // OOB / Churning
};

// Churn Risk options with numbered labels for sorting clarity
const CHURN_RISK_OPTIONS = [
  { value: 'low', label: '1 - Low Risk', className: 'bg-status-green/20 text-status-green' },
  { value: 'medium', label: '2 - Medium Risk', className: 'bg-status-yellow/20 text-status-yellow' },
  { value: 'high', label: '3 - High Risk', className: 'bg-status-red/20 text-status-red' },
  { value: 'certain', label: '4 - OOB / Churning', className: 'bg-purple-600/20 text-purple-400' },
];

const VIEWS = [
  { value: 'all', label: 'All Renewals' },
  { value: '0-30', label: '0-30 Days' },
  { value: '31-60', label: '31-60 Days' },
  { value: '61-90', label: '61-90 Days' },
  { value: '91-180', label: '91-180 Days' },
  { value: 'at-risk', label: 'At Risk' },
  { value: 'tier-1', label: 'Tier 1 (High Fit)' },
  { value: 'tier-2', label: 'Tier 2' },
  { value: 'unenriched', label: 'Not Enriched' },
  { value: 'auto-renew', label: 'Auto-Renew' },
  { value: 'no-next-step', label: 'No Next Step' },
  { value: 'missing-planhat', label: 'Missing Planhat' },
  { value: 'missing-agreement', label: 'Missing Agreement' },
  { value: 'churning', label: 'Churning / OOB' },
];


export default function Renewals() {
  const { renewals, accounts, addRenewal, updateRenewal, deleteRenewal, createMissingRenewalOpportunities, logCall, logManualEmail, logMeetingHeld } = useStore();
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentView, setCurrentView] = useState('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBulkImportDialog, setShowBulkImportDialog] = useState(false);
  const [importPreview, setImportPreview] = useState<Partial<Renewal>[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Sort hook for renewals table
  const { sortConfig: renewalSortConfig, handleSort: handleRenewalSort } = useTableSort();
  
  // Account lookup map for ICP intelligence
  const accountMap = useMemo(() => {
    const map = new Map<string, typeof accounts[number]>();
    accounts.forEach(a => map.set(a.id, a));
    return map;
  }, [accounts]);
  const getAccountForRenewal = useCallback((renewal: Renewal) => {
    if (renewal.accountId) return accountMap.get(renewal.accountId);
    // Fallback: match by name
    return accounts.find(a => a.name.toLowerCase() === renewal.accountName.toLowerCase());
  }, [accountMap, accounts]);
  
  // Custom fields for summary table
  const { getFieldsForTab } = useCustomFields();
  const summaryCustomFields = useMemo(() => 
    getFieldsForTab('renewals', 'summary').concat(getFieldsForTab('renewals', 'both')).filter((f, i, arr) => arr.findIndex(x => x.id === f.id) === i),
    [getFieldsForTab]
  );
  
  // Track which renewal is expanded to show details
  const [expandedRenewalId, setExpandedRenewalId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('renewals');
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link highlight from Work Queue
  const highlightTargetRef = useRef<string | null>(null);
  const scrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 1: Capture the highlight ID from URL params (runs once on navigation)
  useEffect(() => {
    const id = searchParams.get('highlight');
    const tab = searchParams.get('tab');
    if (id) {
      highlightTargetRef.current = id;
      setHighlightId(id);
      // Clean up URL params
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('highlight');
      newParams.delete('tab');
      setSearchParams(newParams, { replace: true });
    } else if (tab) {
      setActiveTab(tab);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('tab');
      setSearchParams(newParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2: Once renewals are available, scroll to the target
  useEffect(() => {
    const id = highlightTargetRef.current;
    if (!id || renewals.length === 0) return;
    highlightTargetRef.current = null; // consume

    // Clear any prior scroll attempts
    if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);

    const isRenewal = renewals.some(r => r.id === id);
    if (isRenewal) {
      setActiveTab('renewals');
      setExpandedRenewalId(id);
    } else {
      setActiveTab('opportunities');
    }

    // Retry scroll until element appears (max 3s)
    let attempts = 0;
    const selector = isRenewal ? `[data-renewal-id="${id}"]` : `[data-opp-id="${id}"]`;
    scrollIntervalRef.current = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
      }
      if (++attempts > 30 && scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
    }, 100);

    highlightTimerRef.current = setTimeout(() => setHighlightId(null), 4000);
  }, [renewals]);
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
          case 'agreement':
          case 'agreement link':
          case 'agreementlink':
          case 'current agreement':
          case 'currentagreement':
          case 'current agreement link':
            renewal.currentAgreementLink = value;
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
      case 'tier-1': {
        const acct = getAccountForRenewal(renewal);
        const tier = acct?.tierOverride || acct?.lifecycleTier;
        matchesView = tier === '1';
        break;
      }
      case 'tier-2': {
        const acct = getAccountForRenewal(renewal);
        const tier = acct?.tierOverride || acct?.lifecycleTier;
        matchesView = tier === '2';
        break;
      }
      case 'unenriched': {
        const acct = getAccountForRenewal(renewal);
        matchesView = !acct?.lastEnrichedAt && !!acct?.website;
        break;
      }
      case 'churning':
        matchesView = renewal.churnRisk === 'certain';
        break;
      case 'auto-renew':
        matchesView = renewal.autoRenew;
        break;
      case 'no-next-step':
        matchesView = !renewal.nextStep;
        break;
      case 'missing-planhat':
        matchesView = !renewal.planhatLink;
        break;
      case 'missing-agreement':
        matchesView = !renewal.currentAgreementLink;
        break;
    }
    
    return matchesSearch && matchesView;
  });

  // Sort renewals: default is Renewal Date → Churn Risk → ARR desc → Name
  // Also supports sorting by custom field values
  const { getFieldValue } = useCustomFields();
  const sortedRenewals = useMemo(() => {
    const sortKeyMap = {
      renewalDue: { key: 'renewalDue' as keyof Renewal },
      churnRisk: { key: 'churnRisk' as keyof Renewal, customRank: CHURN_RISK_SORT_RANK },
      arr: { key: 'arr' as keyof Renewal },
      accountName: { key: 'accountName' as keyof Renewal },
      csm: { key: 'csm' as keyof Renewal },
    };
    
    // Check if sorting by a custom field
    if (renewalSortConfig?.key.startsWith('custom:')) {
      const fieldId = renewalSortConfig.key.slice(7);
      const direction = renewalSortConfig.direction!;
      return [...filteredRenewals].sort((a, b) => {
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
    
    return applySortWithFallback(filteredRenewals, renewalSortConfig, sortRenewalsDefault, sortKeyMap);
  }, [filteredRenewals, renewalSortConfig, getFieldValue]);

  // Group by quarter for display
  const groupedRenewals = sortedRenewals.reduce((acc, renewal) => {
    const quarter = renewal.renewalQuarter;
    if (!acc[quarter]) acc[quarter] = [];
    acc[quarter].push(renewal);
    return acc;
  }, {} as Record<string, typeof sortedRenewals>);

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
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-display text-2xl font-bold">Renewals</h1>
            <p className="text-sm text-muted-foreground">
              {renewals.length} renewals • {formatCurrency(renewals.reduce((sum, r) => sum + r.arr, 0))} ARR
            </p>
          </div>
          <StreakChip variant="full" />
        </div>

        {/* Nearest Renewal Countdown + ARR at Risk */}
        <RenewalUrgencyHeader renewals={renewals} formatCurrency={formatCurrency} />
        
        {/* Churn Risk Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {(['low', 'medium', 'high', 'certain'] as ChurnRisk[]).map(risk => {
            const option = CHURN_RISK_OPTIONS.find(o => o.value === risk);
            return (
              <div 
                key={risk} 
                className={cn(
                  "metric-card p-3 sm:p-4 border-l-4",
                  risk === 'low' && "border-l-status-green",
                  risk === 'medium' && "border-l-status-yellow",
                  risk === 'high' && "border-l-status-red",
                  risk === 'certain' && "border-l-purple-500",
                )}
              >
                <div className="flex items-center justify-between mb-1 sm:mb-2">
                  <span className={cn("text-xs sm:text-sm font-medium", CHURN_RISK_COLORS[risk].split(' ')[1])}>
                    {option?.label || risk}
                  </span>
                  <Badge variant="outline" className={cn("text-xs", CHURN_RISK_COLORS[risk])}>
                    {churnRiskSummary[risk].count}
                  </Badge>
                </div>
                <div className="text-lg sm:text-xl font-bold font-mono">
                  {formatCurrency(churnRiskSummary[risk].arr)}
                </div>
              </div>
            );
          })}
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="renewals">Renewals</TabsTrigger>
            <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          </TabsList>
          
          <TabsContent value="renewals">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
            {/* Manage Columns */}
            <ManageColumnsPopover
              tabTarget="renewals"
              viewKey={`renewals-accounts-${currentView}`}
              builtInColumns={[
                { key: 'renewalDue', label: 'Renewal Date' },
                { key: 'churnRisk', label: 'Churn Risk' },
                { key: 'arr', label: 'ARR' },
                { key: 'icpScore', label: 'ICP Score' },
                { key: 'icpTier', label: 'ICP Tier' },
                { key: 'csm', label: 'CSM' },
                { key: 'planhat', label: 'Planhat' },
                { key: 'agreement', label: 'Agreement' },
                { key: 'nextStep', label: 'Next Step' },
              ]}
            />
            
            {/* Create Missing Opportunities Button */}
            <Button
              variant="outline"
              onClick={() => {
                const count = createMissingRenewalOpportunities();
                if (count > 0) {
                  toast.success(`Created ${count} renewal ${count === 1 ? 'opportunity' : 'opportunities'}`);
                } else {
                  toast.info('All renewals already have linked opportunities');
                }
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Renewal Opps
            </Button>
            
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
                    <EditableDatePicker
                      value={newRenewal.renewalDue}
                      onChange={(v) => setNewRenewal({ ...newRenewal, renewalDue: v || '' })}
                      placeholder="Select renewal date"
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Planhat Link</Label>
                    <Input
                      value={newRenewal.planhatLink || ''}
                      onChange={(e) => setNewRenewal({ ...newRenewal, planhatLink: e.target.value })}
                      placeholder="https://planhat.com/..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Current Agreement Link</Label>
                    <Input
                      value={newRenewal.currentAgreementLink || ''}
                      onChange={(e) => setNewRenewal({ ...newRenewal, currentAgreementLink: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
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
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4 mb-4">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search renewals..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={currentView} onValueChange={setCurrentView}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="View" />
            </SelectTrigger>
            <SelectContent>
              {VIEWS.map((view) => (
                <SelectItem key={view.value} value={view.value}>{view.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Filtered count */}
        {filteredRenewals.length !== renewals.length && (
          <div className="text-xs text-muted-foreground mb-3">
            Showing <span className="font-semibold text-foreground">{filteredRenewals.length}</span> of {renewals.length} renewals
          </div>
        )}

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
                <Table className="min-w-[1600px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[3%]"></TableHead>
                      <SortableHeader 
                        sortKey="accountName" 
                        currentSort={renewalSortConfig} 
                        onSort={handleRenewalSort}
                        className="w-[13%]"
                      >
                        Account Name
                      </SortableHeader>
                      <SortableHeader 
                        sortKey="renewalDue" 
                        currentSort={renewalSortConfig} 
                        onSort={handleRenewalSort}
                        className="w-[10%]"
                      >
                        Renewal Date
                      </SortableHeader>
                      <SortableHeader 
                        sortKey="churnRisk" 
                        currentSort={renewalSortConfig} 
                        onSort={handleRenewalSort}
                        className="w-[12%]"
                      >
                        Churn Risk
                      </SortableHeader>
                      <SortableHeader 
                        sortKey="arr" 
                        currentSort={renewalSortConfig} 
                        onSort={handleRenewalSort}
                        className="w-[8%] text-right"
                      >
                        ARR
                      </SortableHeader>
                      <TableHead className="w-[6%]">ICP Score</TableHead>
                      <TableHead className="w-[5%]">Tier</TableHead>
                      <SortableHeader 
                        sortKey="csm" 
                        currentSort={renewalSortConfig} 
                        onSort={handleRenewalSort}
                        className="w-[8%]"
                      >
                        CSM
                      </SortableHeader>
                      <TableHead className="w-[10%]">Planhat</TableHead>
                      <TableHead className="w-[10%]">Agreement</TableHead>
                      <TableHead className="w-[20%]">Next Step</TableHead>
                      {/* Custom field column headers - sortable */}
                      {summaryCustomFields.map(field => (
                        <SortableHeader
                          key={field.id}
                          sortKey={`custom:${field.id}`}
                          currentSort={renewalSortConfig}
                          onSort={handleRenewalSort}
                          className="text-xs"
                        >
                          {field.name}
                        </SortableHeader>
                      ))}
                      <TableHead className="w-[4%]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quarterRenewals.map((renewal) => (
                      <React.Fragment key={renewal.id}>
                        <TableRow 
                          data-renewal-id={renewal.id}
                          className={cn(
                          "hover:bg-muted/30",
                          expandedRenewalId === renewal.id && "bg-muted/20",
                          highlightId === renewal.id && "ring-2 ring-primary/50 bg-primary/5 animate-pulse"
                        )}>
                          <TableCell className="align-top py-3">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => setExpandedRenewalId(expandedRenewalId === renewal.id ? null : renewal.id)}
                            >
                              {expandedRenewalId === renewal.id ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="align-top py-3">
                            <AccountNameCell 
                              name={renewal.accountName} 
                              salesforceLink={renewal.salesforceLink}
                              onNameChange={(name) => updateRenewal(renewal.id, { accountName: name })}
                              onSalesforceLinkChange={(link) => updateRenewal(renewal.id, { salesforceLink: link })}
                              className="text-sm"
                            />
                          </TableCell>
                          <TableCell className="align-top py-3">
                            <EditableDatePicker
                              value={renewal.renewalDue}
                              onChange={(v) => updateRenewal(renewal.id, { renewalDue: v || renewal.renewalDue })}
                              placeholder="—"
                              compact
                              className={cn(
                                "w-28",
                                renewal.daysToRenewal <= 30 && "[&_button]:text-status-red [&_button]:font-medium",
                                renewal.daysToRenewal > 30 && renewal.daysToRenewal <= 60 && "[&_button]:text-status-yellow"
                              )}
                            />
                          </TableCell>
                          <TableCell className="align-top py-3">
                            <DisplaySelectCell
                              value={renewal.churnRisk || 'low'}
                              options={CHURN_RISK_OPTIONS}
                              onChange={(v) => updateRenewal(renewal.id, { churnRisk: v as ChurnRisk })}
                            />
                          </TableCell>
                          <TableCell className="align-top py-3">
                            <EditableNumberCell
                              value={renewal.arr}
                              onChange={(v) => updateRenewal(renewal.id, { arr: v })}
                              format="currency"
                            />
                          </TableCell>
                          {/* ICP Score + Tier from linked account */}
                          {(() => {
                            const acct = getAccountForRenewal(renewal);
                            return (
                              <>
                                <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                                  {acct ? (
                                    <div className="flex items-center gap-1">
                                      <IcpScorePill account={acct} />
                                      <EnrichButton account={acct} />
                                    </div>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="align-top py-3" onClick={(e) => e.stopPropagation()}>
                                  {acct ? <LifecycleTierBadge account={acct} /> : <span className="text-xs text-muted-foreground">—</span>}
                                </TableCell>
                              </>
                            );
                          })()}
                          <TableCell className="align-top py-3">
                            <EditableTextCell
                              value={renewal.csm || ''}
                              onChange={(v) => updateRenewal(renewal.id, { csm: v })}
                              placeholder="Add CSM"
                              emptyText="Add"
                            />
                          </TableCell>
                          <TableCell className="align-top py-3 group">
                            <PlanhatLinkCell
                              value={renewal.planhatLink || ''}
                              onChange={(v) => updateRenewal(renewal.id, { planhatLink: v })}
                            />
                          </TableCell>
                          <TableCell className="align-top py-3 group">
                            <AgreementLinkCell
                              value={renewal.currentAgreementLink || ''}
                              onChange={(v) => updateRenewal(renewal.id, { currentAgreementLink: v })}
                            />
                          </TableCell>
                          <TableCell className="align-top py-3">
                            <EditableTextCell
                              value={renewal.nextStep || ''}
                              onChange={(v) => updateRenewal(renewal.id, { nextStep: v })}
                              placeholder="Add next step"
                              emptyText="Add"
                            />
                          </TableCell>
                          {/* Custom field cells */}
                          {summaryCustomFields.map(field => (
                            <TableCell key={field.id} className="align-top py-2" onClick={(e) => e.stopPropagation()}>
                              <MetricFieldCell field={field} recordId={renewal.id} />
                            </TableCell>
                          ))}
                          <TableCell className="align-top py-3">
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
                        {/* Details row - only visible when renewal is expanded */}
                        {expandedRenewalId === renewal.id && (
                          <TableRow className="hover:bg-transparent border-b-2 bg-muted/10">
                            <TableCell colSpan={99} className="pt-0 pb-3">
                              <div className="space-y-3">
                                {/* ICP Intelligence Panel */}
                                {(() => {
                                  const acct = getAccountForRenewal(renewal);
                                  return acct ? <SignalDetailPanel account={acct} /> : null;
                                })()}
                                <RenewalDetailsField
                                  renewalId={renewal.id}
                                  contacts={renewal.accountContacts || []}
                                  onChange={(contacts) => updateRenewal(renewal.id, { accountContacts: contacts })}
                                  companyNotes={renewal.notes || ''}
                                  onCompanyNotesChange={(notes) => updateRenewal(renewal.id, { notes })}
                                  entitlements={renewal.entitlements || ''}
                                  onEntitlementsChange={(v) => updateRenewal(renewal.id, { entitlements: v })}
                                  usage={renewal.usage || ''}
                                  onUsageChange={(v) => updateRenewal(renewal.id, { usage: v })}
                                  term={renewal.term || ''}
                                  onTermChange={(v) => updateRenewal(renewal.id, { term: v })}
                                  planhatLink={renewal.planhatLink || ''}
                                  onPlanhatLinkChange={(v) => updateRenewal(renewal.id, { planhatLink: v })}
                                  currentAgreementLink={renewal.currentAgreementLink || ''}
                                  onCurrentAgreementLinkChange={(v) => updateRenewal(renewal.id, { currentAgreementLink: v })}
                                  product={renewal.product || ''}
                                  onProductChange={(v) => updateRenewal(renewal.id, { product: v })}
                                  csNotes={renewal.csNotes || ''}
                                  onCsNotesChange={(v) => updateRenewal(renewal.id, { csNotes: v })}
                                  autoRenew={renewal.autoRenew}
                                  onAutoRenewChange={(v) => updateRenewal(renewal.id, { autoRenew: v })}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))
        )}
          </TabsContent>
          
          <TabsContent value="opportunities">
            <OpportunitiesTable onOpenDrawer={setSelectedOpportunity} renewalsOnly highlightId={highlightId} />
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
