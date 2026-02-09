// Comprehensive Import Wizard - Multi-step combined file import
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { 
  Upload, FileSpreadsheet, Download, AlertTriangle, Check, X, Info, 
  ChevronRight, Settings2, Link2, HelpCircle, Filter, Save,
  ArrowLeft, ArrowRight, Loader2, Eye, EyeOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { 
  EnhancedHeaderMapping, 
  ParsedImportRow, 
  ImportState,
  ImportTargetObject,
  DataTransform,
  PendingValueMapping,
  UnrecognizedLink,
  NeedsReviewRow,
} from '@/lib/importTypes';
import { 
  ACCOUNT_FIELDS, 
  OPPORTUNITY_FIELDS, 
  RENEWAL_FIELDS, 
  CONTACT_FIELDS,
  PICKLIST_VALUES,
} from '@/lib/importTypes';
import {
  parseCSV,
  autoMapHeaders,
  detectMotion,
  applyTransform,
  buildAccountLookup,
  findMatchingAccount,
  findFuzzyMatches,
  calculateSummary,
  extractSalesforceId,
  normalizeUrl,
  detectLinkType,
} from '@/lib/importParser';
import { 
  useHeaderMappings, 
  useSaveHeaderMapping, 
  useDeleteHeaderMapping,
  useValueMappings,
  useSaveValueMapping,
  useAccountAliases,
  useSaveAccountAlias,
} from '@/hooks/useImportMappings';
import { 
  useDbAccounts, 
  useUpsertAccount, 
  useDbOpportunities,
  useUpsertOpportunity,
  useDbRenewals,
  useUpsertRenewal,
} from '@/hooks/useAccountsData';
import { useAuth } from '@/contexts/AuthContext';

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type WizardStep = 'upload' | 'auto-map' | 'action-required' | 'preview' | 'importing' | 'complete';

const STEP_ORDER: WizardStep[] = ['upload', 'auto-map', 'action-required', 'preview', 'importing', 'complete'];

export function ImportWizard({ open, onOpenChange }: ImportWizardProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Wizard state
  const [step, setStep] = useState<WizardStep>('upload');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  
  // Mappings
  const [headerMappings, setHeaderMappings] = useState<EnhancedHeaderMapping[]>([]);
  const [pendingValueMappings, setPendingValueMappings] = useState<PendingValueMapping[]>([]);
  const [unrecognizedLinks, setUnrecognizedLinks] = useState<UnrecognizedLink[]>([]);
  const [needsReviewRows, setNeedsReviewRows] = useState<NeedsReviewRow[]>([]);
  
  // Parsed data
  const [parsedRows, setParsedRows] = useState<ParsedImportRow[]>([]);
  
  // Acknowledgement
  const [ignoredAcknowledged, setIgnoredAcknowledged] = useState(false);
  
  // Preview filters
  const [previewFilter, setPreviewFilter] = useState<'all' | 'new-logo' | 'renewal' | 'needs-review' | 'ignored'>('all');
  
  // Import progress
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState({
    accountsCreated: 0, accountsUpdated: 0,
    opportunitiesCreated: 0, opportunitiesUpdated: 0,
    renewalsCreated: 0, renewalsUpdated: 0,
    errors: 0,
  });
  
  // Data hooks
  const { data: existingAccounts = [] } = useDbAccounts();
  const { data: existingOpportunities = [] } = useDbOpportunities();
  const { data: existingRenewals = [] } = useDbRenewals();
  const { data: savedHeaderMappings = [] } = useHeaderMappings();
  const { data: savedValueMappings = [] } = useValueMappings();
  const { data: savedAliases = [] } = useAccountAliases();
  
  // Mutations
  const upsertAccount = useUpsertAccount();
  const upsertOpportunity = useUpsertOpportunity();
  const upsertRenewal = useUpsertRenewal();
  const saveHeaderMapping = useSaveHeaderMapping();
  const saveValueMapping = useSaveValueMapping();
  const saveAccountAlias = useSaveAccountAlias();
  
  // Reset state when modal closes
  const handleClose = () => {
    setStep('upload');
    setCsvHeaders([]);
    setCsvRows([]);
    setHeaderMappings([]);
    setPendingValueMappings([]);
    setUnrecognizedLinks([]);
    setNeedsReviewRows([]);
    setParsedRows([]);
    setIgnoredAcknowledged(false);
    setPreviewFilter('all');
    setImportProgress(0);
    setImportResults({
      accountsCreated: 0, accountsUpdated: 0,
      opportunitiesCreated: 0, opportunitiesUpdated: 0,
      renewalsCreated: 0, renewalsUpdated: 0,
      errors: 0,
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
    onOpenChange(false);
  };
  
  // Handle file upload
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = parseCSV(text);
        
        if (parsed.headers.length === 0 || parsed.rows.length === 0) {
          toast.error('CSV must have headers and at least one data row');
          return;
        }
        
        setCsvHeaders(parsed.headers);
        setCsvRows(parsed.rows);
        
        // Auto-map headers
        const mappings = autoMapHeaders(parsed.headers, savedHeaderMappings, parsed.rows);
        setHeaderMappings(mappings);
        
        // Move to auto-map review step
        setStep('auto-map');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to parse CSV');
      }
    };
    reader.readAsText(file);
  }, [savedHeaderMappings]);
  
  // Compute unmapped columns
  const unmappedColumns = useMemo(() => 
    headerMappings.filter(m => !m.isMapped),
    [headerMappings]
  );
  
  // Check if we can proceed from auto-map
  const hasAccountNameMapping = useMemo(() =>
    headerMappings.some(m => m.targetObject === 'account' && m.targetField === 'name'),
    [headerMappings]
  );
  
  // Process rows and detect issues
  const processRows = useCallback(() => {
    if (!csvRows.length || !headerMappings.length) return;
    
    const accountLookup = buildAccountLookup(existingAccounts, savedAliases);
    const pendingValues: PendingValueMapping[] = [];
    const unrecLinks: UnrecognizedLink[] = [];
    const reviewRows: NeedsReviewRow[] = [];
    const rows: ParsedImportRow[] = [];
    
    csvRows.forEach((row, rowIndex) => {
      // Extract account data
      const accountData: Record<string, any> = {};
      const oppData: Record<string, any> = {};
      const renewalData: Record<string, any> = {};
      const contactData: Record<string, any> = {};
      const warnings: string[] = [];
      const errors: string[] = [];
      
      headerMappings.forEach(mapping => {
        if (!mapping.isMapped || mapping.targetObject === 'ignore') return;
        
        const rawValue = row[mapping.colIndex]?.trim();
        if (!rawValue) return;
        
        const value = applyTransform(rawValue, mapping.dataTransform);
        
        // Check for unrecognized URLs
        if (mapping.dataTransform === 'url' && mapping.confidence === 'low') {
          const linkType = detectLinkType(rawValue);
          if (linkType === 'unknown' && !unrecLinks.some(l => l.url === rawValue)) {
            unrecLinks.push({ rowIndex, colIndex: mapping.colIndex, url: rawValue, detectedType: 'unknown' });
          }
        }
        
        // Check for picklist values that need mapping
        if (mapping.dataTransform === 'picklist' && mapping.targetField) {
          const fieldName = mapping.targetField;
          const knownValues = PICKLIST_VALUES[fieldName as keyof typeof PICKLIST_VALUES] as readonly string[] | undefined;
          const normalizedValue = rawValue.toLowerCase().replace(/\s+/g, '-');
          
          if (knownValues && !knownValues.includes(normalizedValue) && !knownValues.includes(rawValue.toLowerCase())) {
            const savedMap = savedValueMappings.find(vm =>
              vm.field_name === fieldName && vm.csv_value.toLowerCase() === rawValue.toLowerCase()
            );
            if (!savedMap && !pendingValues.some(pv => pv.fieldName === fieldName && pv.csvValue === rawValue)) {
              pendingValues.push({
                fieldName,
                csvValue: rawValue,
                suggestedAppValue: knownValues[0],
                saveForFuture: true,
              });
            }
          }
        }
        
        // Assign to appropriate object
        switch (mapping.targetObject) {
          case 'account':
            if (mapping.targetField === 'salesforce_link') {
              accountData.salesforce_link = value;
              accountData.salesforce_id = extractSalesforceId(rawValue);
            } else if (mapping.targetField) {
              accountData[mapping.targetField] = value;
            }
            break;
          case 'opportunity':
            if (mapping.targetField === 'salesforce_link') {
              oppData.salesforce_link = value;
              oppData.salesforce_id = extractSalesforceId(rawValue);
            } else if (mapping.targetField) {
              oppData[mapping.targetField] = value;
            }
            break;
          case 'renewal':
            if (mapping.targetField) {
              renewalData[mapping.targetField] = value;
            }
            break;
          case 'contact':
            if (mapping.targetField) {
              contactData[mapping.targetField] = value;
            }
            break;
        }
      });
      
      // Skip rows without account name
      if (!accountData.name) {
        if (Object.keys(accountData).length > 0 || Object.keys(oppData).length > 0) {
          errors.push('Missing account name');
        }
        return;
      }
      
      // Detect motion
      const motion = detectMotion(row, headerMappings, savedValueMappings);
      
      // Find matching account
      const matchedAccount = findMatchingAccount(
        accountData.name,
        accountData.website,
        accountData.salesforce_id,
        accountLookup
      );
      
      let needsReview = false;
      if (!matchedAccount) {
        // Check for fuzzy matches
        const fuzzyMatches = findFuzzyMatches(accountData.name, existingAccounts);
        if (fuzzyMatches.length > 0 && fuzzyMatches[0].score < 100) {
          needsReview = true;
          reviewRows.push({
            rowIndex,
            accountName: accountData.name,
            accountDomain: accountData.website,
            suggestedMatches: fuzzyMatches,
            createNew: false,
            ignored: false,
            saveAliasForFuture: true,
          });
        }
      }
      
      // Determine row type
      let rowType: 'account-only' | 'opportunity' | 'renewal' | 'mixed' = 'account-only';
      if (Object.keys(oppData).length > 0 && Object.keys(renewalData).length > 0) {
        rowType = 'mixed';
      } else if (Object.keys(oppData).length > 0) {
        rowType = 'opportunity';
      } else if (Object.keys(renewalData).length > 0) {
        rowType = 'renewal';
      }
      
      // Build parsed row
      rows.push({
        rowIndex,
        rowType,
        motion,
        accountData,
        accountId: matchedAccount?.id,
        accountMatched: !!matchedAccount,
        accountAction: matchedAccount ? 'update' : 'create',
        opportunityData: Object.keys(oppData).length > 0 ? oppData : undefined,
        opportunityMatched: false,
        opportunityAction: Object.keys(oppData).length > 0 ? 'create' : undefined,
        renewalData: Object.keys(renewalData).length > 0 ? renewalData : undefined,
        renewalMatched: false,
        renewalAction: Object.keys(renewalData).length > 0 ? 'create' : undefined,
        contactData: Object.keys(contactData).length > 0 ? contactData : undefined,
        needsReview,
        ignored: false,
        warnings,
        errors,
      });
    });
    
    setPendingValueMappings(pendingValues);
    setUnrecognizedLinks(unrecLinks);
    setNeedsReviewRows(reviewRows);
    setParsedRows(rows);
  }, [csvRows, headerMappings, existingAccounts, savedAliases, savedValueMappings]);
  
  // Process when moving to action-required step
  useEffect(() => {
    if (step === 'action-required' && csvRows.length > 0) {
      processRows();
    }
  }, [step, processRows]);
  
  // Calculate summary
  const summary = useMemo(() => calculateSummary(parsedRows), [parsedRows]);
  
  // Check if action required step has issues
  const hasActionRequired = unmappedColumns.length > 0 || 
    pendingValueMappings.length > 0 || 
    unrecognizedLinks.length > 0 || 
    needsReviewRows.length > 0;
  
  // Count ignored items
  const ignoredCount = unmappedColumns.filter(m => m.targetObject === 'ignore').length +
    pendingValueMappings.filter(pv => !pv.appValue).length +
    needsReviewRows.filter(nr => nr.ignored).length;
  
  // Update header mapping
  const updateHeaderMapping = (colIndex: number, updates: Partial<EnhancedHeaderMapping>) => {
    setHeaderMappings(prev => prev.map(m => 
      m.colIndex === colIndex ? { ...m, ...updates, isMapped: updates.targetObject !== 'ignore' } : m
    ));
  };
  
  // Update value mapping
  const updateValueMapping = (index: number, appValue: string) => {
    setPendingValueMappings(prev => prev.map((pv, i) => 
      i === index ? { ...pv, appValue } : pv
    ));
  };
  
  // Update needs review row
  const updateNeedsReviewRow = (rowIndex: number, updates: Partial<NeedsReviewRow>) => {
    setNeedsReviewRows(prev => prev.map(nr => 
      nr.rowIndex === rowIndex ? { ...nr, ...updates } : nr
    ));
    
    // Also update parsed rows
    setParsedRows(prev => prev.map(pr => {
      if (pr.rowIndex === rowIndex) {
        if (updates.ignored) return { ...pr, ignored: true, needsReview: false };
        if (updates.selectedAccountId) {
          return { 
            ...pr, 
            accountId: updates.selectedAccountId, 
            accountMatched: true, 
            accountAction: 'update',
            needsReview: false,
          };
        }
        if (updates.createNew) {
          return { ...pr, accountAction: 'create', needsReview: false };
        }
      }
      return pr;
    }));
  };
  
  // Proceed from auto-map to action-required
  const proceedToActionRequired = () => {
    if (!hasAccountNameMapping) {
      toast.error('You must map an Account Name column to proceed');
      return;
    }
    setStep('action-required');
  };
  
  // Proceed from action-required to preview
  const proceedToPreview = () => {
    // Check if all issues are resolved or ignored
    const unresolvedMappings = unmappedColumns.filter(m => m.targetObject !== 'ignore');
    const unresolvedValues = pendingValueMappings.filter(pv => !pv.appValue);
    const unresolvedReviews = needsReviewRows.filter(nr => !nr.ignored && !nr.selectedAccountId && !nr.createNew);
    
    if (unresolvedMappings.length > 0 || unresolvedValues.length > 0 || unresolvedReviews.length > 0) {
      toast.error('Please resolve or ignore all issues before proceeding');
      return;
    }
    
    if (ignoredCount > 0 && !ignoredAcknowledged) {
      toast.error('Please acknowledge that some data will be ignored');
      return;
    }
    
    setStep('preview');
  };
  
  // Perform import
  const handleImport = async () => {
    if (!user) return;
    
    setStep('importing');
    const results = { ...importResults };
    
    // Save mappings that were marked for future use
    const mappingsToSave = headerMappings.filter(m => 
      m.isMapped && !m.isFromSavedMapping && m.targetObject !== 'ignore'
    );
    
    for (const mapping of mappingsToSave) {
      try {
        await saveHeaderMapping.mutateAsync({
          csv_header: mapping.csvHeader,
          target_object: mapping.targetObject,
          target_field: mapping.targetField,
          data_transform: mapping.dataTransform,
        });
      } catch (e) {
        console.error('Failed to save header mapping:', e);
      }
    }
    
    // Save value mappings
    for (const vm of pendingValueMappings.filter(pv => pv.appValue && pv.saveForFuture)) {
      try {
        await saveValueMapping.mutateAsync({
          field_name: vm.fieldName,
          csv_value: vm.csvValue,
          app_value: vm.appValue!,
        });
      } catch (e) {
        console.error('Failed to save value mapping:', e);
      }
    }
    
    // Import rows
    const rowsToImport = parsedRows.filter(r => !r.ignored && !r.needsReview);
    
    for (let i = 0; i < rowsToImport.length; i++) {
      const row = rowsToImport[i];
      
      try {
        // 1. Upsert Account
        let accountId = row.accountId;
        
        if (row.accountAction !== 'skip') {
          const accountResult = await upsertAccount.mutateAsync({
            name: row.accountData.name,
            website: row.accountData.website,
            salesforce_link: row.accountData.salesforce_link,
            salesforce_id: row.accountData.salesforce_id,
            planhat_link: row.accountData.planhat_link,
            current_agreement_link: row.accountData.current_agreement_link,
            priority: row.accountData.priority,
            tier: row.accountData.tier,
            motion: row.accountData.motion || row.motion,
            industry: row.accountData.industry,
            next_step: row.accountData.next_step,
            tech_stack: [],
            tags: [],
            touches_this_week: 0,
          });
          
          accountId = accountResult.data.id;
          if (accountResult.isUpdate) results.accountsUpdated++;
          else results.accountsCreated++;
        }
        
        // 2. Upsert Opportunity
        if (row.opportunityData && row.opportunityAction !== 'skip') {
          const oppResult = await upsertOpportunity.mutateAsync({
            name: row.opportunityData.name || `${row.accountData.name} - Opportunity`,
            account_id: accountId,
            salesforce_link: row.opportunityData.salesforce_link,
            salesforce_id: row.opportunityData.salesforce_id,
            stage: row.opportunityData.stage || '1 - Prospect',
            status: row.opportunityData.status || 'active',
            arr: row.opportunityData.arr,
            close_date: row.opportunityData.close_date,
            next_step: row.opportunityData.next_step,
            deal_type: row.opportunityData.deal_type || (row.motion === 'renewal' ? 'renewal' : 'new-logo'),
            churn_risk: row.opportunityData.churn_risk,
            activity_log: [],
          });
          
          if (oppResult.isUpdate) results.opportunitiesUpdated++;
          else results.opportunitiesCreated++;
        }
        
        // 3. Upsert Renewal
        if (row.renewalData && row.renewalAction !== 'skip' && accountId) {
          const renewalResult = await upsertRenewal.mutateAsync({
            account_name: row.accountData.name,
            account_id: accountId,
            renewal_due: row.renewalData.renewal_due || new Date().toISOString().split('T')[0],
            arr: row.renewalData.arr || 0,
            planhat_link: row.renewalData.planhat_link || row.accountData.planhat_link,
            current_agreement_link: row.renewalData.current_agreement_link || row.accountData.current_agreement_link,
            csm: row.renewalData.csm,
            product: row.renewalData.product,
            entitlements: row.renewalData.entitlements,
            usage: row.renewalData.usage,
            term: row.renewalData.term,
            health_status: row.renewalData.health_status || 'green',
            churn_risk: row.renewalData.churn_risk || 'low',
            auto_renew: row.renewalData.auto_renew === 'true' || row.renewalData.auto_renew === 'yes',
            cs_notes: row.renewalData.cs_notes,
            next_step: row.renewalData.next_step,
            owner: row.renewalData.owner,
          });
          
          if (renewalResult.isUpdate) results.renewalsUpdated++;
          else results.renewalsCreated++;
        }
        
        // Save account alias if needed
        const reviewRow = needsReviewRows.find(nr => nr.rowIndex === row.rowIndex);
        if (reviewRow?.saveAliasForFuture && reviewRow.selectedAccountId && accountId) {
          try {
            await saveAccountAlias.mutateAsync({
              alias_type: 'name',
              alias_value: row.accountData.name,
              account_id: accountId,
            });
          } catch (e) {
            console.error('Failed to save account alias:', e);
          }
        }
        
      } catch (error) {
        console.error('Import error for row:', row, error);
        results.errors++;
      }
      
      setImportProgress(Math.round(((i + 1) / rowsToImport.length) * 100));
      setImportResults(results);
    }
    
    setStep('complete');
  };
  
  // Download template
  const downloadTemplate = () => {
    const template = `Account Name,Website,Motion,Salesforce Account Link,Planhat Link,Current Agreement Link,Priority,Tier,Industry,Opportunity Name,Salesforce Opp Link,Stage,ARR,Close Date,Deal Type,Renewal Date,CSM,Health Status
Acme Corp,acme.com,New Logo,https://yourorg.lightning.force.com/Account/001xxx,,,,A,Technology,Acme Q1 Deal,https://yourorg.lightning.force.com/Opportunity/006xxx,2 - Discover,50000,2025-03-15,new-logo,,,
Global Inc,globalinc.com,Renewal,https://yourorg.lightning.force.com/Account/001yyy,https://app.planhat.com/company/xxx,https://docs.google.com/document/xxx,high,A,Manufacturing,Global Renewal 2025,,5 - Negotiate,120000,2025-02-28,renewal,2025-03-01,Jane Smith,green`;
    
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'combined_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  
  // Filtered preview rows
  const filteredPreviewRows = useMemo(() => {
    switch (previewFilter) {
      case 'new-logo': return parsedRows.filter(r => r.motion === 'new-logo' && !r.ignored);
      case 'renewal': return parsedRows.filter(r => r.motion === 'renewal' && !r.ignored);
      case 'needs-review': return parsedRows.filter(r => r.needsReview);
      case 'ignored': return parsedRows.filter(r => r.ignored);
      default: return parsedRows.filter(r => !r.ignored);
    }
  }, [parsedRows, previewFilter]);
  
  // Field options for mapping
  const getFieldOptions = (object: ImportTargetObject) => {
    switch (object) {
      case 'account': return ACCOUNT_FIELDS;
      case 'opportunity': return OPPORTUNITY_FIELDS;
      case 'renewal': return RENEWAL_FIELDS;
      case 'contact': return CONTACT_FIELDS;
      default: return [];
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => isOpen ? onOpenChange(true) : handleClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import Data
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a combined CSV with New Logo and Renewal data.'}
            {step === 'auto-map' && 'Review auto-mapped columns.'}
            {step === 'action-required' && 'Resolve any mapping issues before importing.'}
            {step === 'preview' && 'Review data before importing.'}
            {step === 'importing' && 'Importing your data...'}
            {step === 'complete' && 'Import complete!'}
          </DialogDescription>
        </DialogHeader>
        
        {/* Step Indicator */}
        <div className="flex items-center gap-2 px-2 py-3 bg-muted/30 rounded-lg">
          {['upload', 'auto-map', 'action-required', 'preview'].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                step === s ? "bg-primary text-primary-foreground" :
                STEP_ORDER.indexOf(step) > i ? "bg-primary/20 text-primary" :
                "bg-muted text-muted-foreground"
              )}>
                {STEP_ORDER.indexOf(step) > i ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={cn(
                "text-xs hidden sm:block",
                step === s ? "font-medium" : "text-muted-foreground"
              )}>
                {s === 'auto-map' ? 'Auto-Map' : s === 'action-required' ? 'Review' : s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
              {i < 3 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="flex-1 flex flex-col gap-6 overflow-auto p-1">
            <div 
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-2">Click to upload or drag and drop</p>
              <p className="text-xs text-muted-foreground">CSV files only • Supports combined New Logo + Renewal data</p>
              <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </div>
            
            <div className="bg-muted/30 rounded-lg p-4">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                What this import supports
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="font-medium text-primary mb-1">Accounts</p>
                  <p className="text-muted-foreground text-xs">Name, Website, SF Link, Planhat, Agreement, Priority, Tier, Motion</p>
                </div>
                <div>
                  <p className="font-medium text-primary mb-1">Opportunities</p>
                  <p className="text-muted-foreground text-xs">Name, SF Link, Stage, Status, ARR, Close Date, Deal Type</p>
                </div>
                <div>
                  <p className="font-medium text-primary mb-1">Renewals</p>
                  <p className="text-muted-foreground text-xs">Renewal Date, ARR, CSM, Health, Auto-Renew, Product, Term</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Auto-Map Review */}
        {step === 'auto-map' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="grid grid-cols-3 gap-3">
              <div className="metric-card p-3">
                <div className="text-xl font-bold text-status-green">
                  {headerMappings.filter(m => m.isMapped && m.confidence === 'high').length}
                </div>
                <div className="text-xs text-muted-foreground">Auto-Mapped (High)</div>
              </div>
              <div className="metric-card p-3">
                <div className="text-xl font-bold text-status-yellow">
                  {headerMappings.filter(m => m.isMapped && m.confidence === 'medium').length}
                </div>
                <div className="text-xs text-muted-foreground">Auto-Mapped (Medium)</div>
              </div>
              <div className="metric-card p-3">
                <div className="text-xl font-bold text-muted-foreground">
                  {unmappedColumns.length}
                </div>
                <div className="text-xs text-muted-foreground">Unmapped</div>
              </div>
            </div>
            
            <ScrollArea className="flex-1 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>CSV Column</TableHead>
                    <TableHead>Mapped To</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Sample Values</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {headerMappings.map((mapping) => (
                    <TableRow key={mapping.colIndex} className={cn(!mapping.isMapped && "bg-status-yellow/5")}>
                      <TableCell className="font-medium">{mapping.csvHeader}</TableCell>
                      <TableCell>
                        {mapping.isMapped ? (
                          <Badge variant="outline" className="text-xs">
                            {mapping.targetObject}.{mapping.targetField}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">Not mapped</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          mapping.confidence === 'high' ? 'default' :
                          mapping.confidence === 'medium' ? 'secondary' : 'outline'
                        } className="text-xs">
                          {mapping.isFromSavedMapping ? '★ Saved' : mapping.confidence}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {csvRows.slice(0, 3).map(row => row[mapping.colIndex]).filter(Boolean).join(', ')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            
            {!hasAccountNameMapping && (
              <div className="bg-status-red/10 border border-status-red/30 rounded-lg p-3">
                <p className="text-sm text-status-red font-medium">
                  ⚠️ No Account Name column detected. This is required to proceed.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Action Required */}
        {step === 'action-required' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <Accordion type="multiple" className="flex-1 overflow-auto" defaultValue={
              unmappedColumns.length > 0 ? ['unmapped-columns'] :
              pendingValueMappings.length > 0 ? ['unmapped-values'] :
              needsReviewRows.length > 0 ? ['needs-review'] : []
            }>
              {/* Unmapped Columns */}
              {unmappedColumns.length > 0 && (
                <AccordionItem value="unmapped-columns">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <Settings2 className="h-4 w-4 text-status-yellow" />
                      <span>Unmapped Columns ({unmappedColumns.length})</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 p-2">
                      {unmappedColumns.map((mapping) => (
                        <div key={mapping.colIndex} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                          <div className="flex-1">
                            <p className="font-medium text-sm">{mapping.csvHeader}</p>
                            <p className="text-xs text-muted-foreground">
                              Sample: {csvRows.slice(0, 2).map(row => row[mapping.colIndex]).filter(Boolean).join(', ')}
                            </p>
                          </div>
                          <Select
                            value={mapping.targetObject}
                            onValueChange={(val: ImportTargetObject) => updateHeaderMapping(mapping.colIndex, { targetObject: val })}
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue placeholder="Object" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="account">Account</SelectItem>
                              <SelectItem value="opportunity">Opportunity</SelectItem>
                              <SelectItem value="renewal">Renewal</SelectItem>
                              <SelectItem value="contact">Contact</SelectItem>
                              <SelectItem value="ignore">Ignore</SelectItem>
                            </SelectContent>
                          </Select>
                          {mapping.targetObject !== 'ignore' && (
                            <Select
                              value={mapping.targetField || ''}
                              onValueChange={(val) => updateHeaderMapping(mapping.colIndex, { targetField: val })}
                            >
                              <SelectTrigger className="w-[150px]">
                                <SelectValue placeholder="Field" />
                              </SelectTrigger>
                              <SelectContent>
                                {getFieldOptions(mapping.targetObject).map(f => (
                                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}
              
              {/* Unmapped Values */}
              {pendingValueMappings.length > 0 && (
                <AccordionItem value="unmapped-values">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <HelpCircle className="h-4 w-4 text-status-yellow" />
                      <span>Unmapped Values ({pendingValueMappings.length})</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 p-2">
                      {pendingValueMappings.map((pv, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                          <div className="flex-1">
                            <p className="font-medium text-sm">"{pv.csvValue}"</p>
                            <p className="text-xs text-muted-foreground">Field: {pv.fieldName}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          <Select
                            value={pv.appValue || ''}
                            onValueChange={(val) => updateValueMapping(idx, val)}
                          >
                            <SelectTrigger className="w-[150px]">
                              <SelectValue placeholder="Map to..." />
                            </SelectTrigger>
                            <SelectContent>
                              {(PICKLIST_VALUES[pv.fieldName as keyof typeof PICKLIST_VALUES] || []).map(v => (
                                <SelectItem key={v} value={v}>{v}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-1.5">
                            <Checkbox
                              checked={pv.saveForFuture}
                              onCheckedChange={(checked) => {
                                setPendingValueMappings(prev => prev.map((p, i) => 
                                  i === idx ? { ...p, saveForFuture: !!checked } : p
                                ));
                              }}
                            />
                            <span className="text-xs text-muted-foreground">Save</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}
              
              {/* Needs Review */}
              {needsReviewRows.length > 0 && (
                <AccordionItem value="needs-review">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-status-yellow" />
                      <span>Needs Review ({needsReviewRows.length})</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 p-2">
                      {needsReviewRows.map((nr) => (
                        <div key={nr.rowIndex} className="p-3 bg-muted/30 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium text-sm">"{nr.accountName}"</p>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant={nr.createNew ? "default" : "outline"}
                                onClick={() => updateNeedsReviewRow(nr.rowIndex, { createNew: true, selectedAccountId: undefined, ignored: false })}
                              >
                                Create New
                              </Button>
                              <Button
                                size="sm"
                                variant={nr.ignored ? "destructive" : "outline"}
                                onClick={() => updateNeedsReviewRow(nr.rowIndex, { ignored: true, createNew: false, selectedAccountId: undefined })}
                              >
                                Ignore
                              </Button>
                            </div>
                          </div>
                          {nr.suggestedMatches.length > 0 && !nr.createNew && !nr.ignored && (
                            <div className="mt-2">
                              <p className="text-xs text-muted-foreground mb-1">Similar accounts found:</p>
                              <div className="space-y-1">
                                {nr.suggestedMatches.map(match => (
                                  <button
                                    key={match.id}
                                    className={cn(
                                      "w-full text-left p-2 rounded text-sm transition-colors",
                                      nr.selectedAccountId === match.id 
                                        ? "bg-primary/20 border border-primary" 
                                        : "bg-background hover:bg-muted"
                                    )}
                                    onClick={() => updateNeedsReviewRow(nr.rowIndex, { selectedAccountId: match.id, createNew: false, ignored: false })}
                                  >
                                    <span className="font-medium">{match.name}</span>
                                    {match.website && <span className="text-muted-foreground ml-2">({match.website})</span>}
                                    <Badge variant="outline" className="ml-2 text-xs">{match.score}% match</Badge>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {nr.selectedAccountId && (
                            <div className="flex items-center gap-2 mt-2">
                              <Checkbox
                                checked={nr.saveAliasForFuture}
                                onCheckedChange={(checked) => updateNeedsReviewRow(nr.rowIndex, { saveAliasForFuture: !!checked })}
                              />
                              <span className="text-xs text-muted-foreground">Remember this match for future imports</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>
            
            {/* Ignored acknowledgement */}
            {ignoredCount > 0 && (
              <div className="bg-status-yellow/10 border border-status-yellow/30 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={ignoredAcknowledged}
                    onCheckedChange={(checked) => setIgnoredAcknowledged(!!checked)}
                  />
                  <span className="text-sm">
                    I understand that <strong>{ignoredCount}</strong> column(s)/row(s) will be ignored.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Preview */}
        {step === 'preview' && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="metric-card p-3">
                <div className="text-xl font-bold">{summary.accountsToCreate + summary.accountsToUpdate}</div>
                <div className="text-xs text-muted-foreground">Accounts ({summary.accountsToCreate} new)</div>
              </div>
              <div className="metric-card p-3">
                <div className="text-xl font-bold">{summary.opportunitiesToCreate + summary.opportunitiesToUpdate}</div>
                <div className="text-xs text-muted-foreground">Opportunities ({summary.opportunitiesToCreate} new)</div>
              </div>
              <div className="metric-card p-3">
                <div className="text-xl font-bold">{summary.renewalsToCreate + summary.renewalsToUpdate}</div>
                <div className="text-xs text-muted-foreground">Renewals ({summary.renewalsToCreate} new)</div>
              </div>
              <div className="metric-card p-3">
                <div className="flex gap-4 text-xl font-bold">
                  <span className="text-primary">{summary.newLogoRowCount}</span>
                  <span className="text-status-yellow">{summary.renewalRowCount}</span>
                </div>
                <div className="text-xs text-muted-foreground">New Logo / Renewal</div>
              </div>
            </div>
            
            {/* Filter tabs */}
            <div className="flex gap-2">
              {(['all', 'new-logo', 'renewal', 'needs-review', 'ignored'] as const).map(filter => (
                <Button
                  key={filter}
                  size="sm"
                  variant={previewFilter === filter ? 'default' : 'outline'}
                  onClick={() => setPreviewFilter(filter)}
                >
                  {filter === 'all' ? 'All' : 
                   filter === 'new-logo' ? 'New Logo' :
                   filter === 'renewal' ? 'Renewal' :
                   filter === 'needs-review' ? 'Needs Review' : 'Ignored'}
                </Button>
              ))}
            </div>
            
            {/* Preview Table */}
            <ScrollArea className="flex-1 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Motion</TableHead>
                    <TableHead>Account Action</TableHead>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Renewal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPreviewRows.slice(0, 100).map((row) => (
                    <TableRow key={row.rowIndex} className={cn(row.ignored && "opacity-50")}>
                      <TableCell className="font-medium">{row.accountData.name}</TableCell>
                      <TableCell>
                        <Badge variant={row.motion === 'new-logo' ? 'default' : 'secondary'}>
                          {row.motion}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.accountAction === 'create' ? 'outline' : 'secondary'}>
                          {row.accountAction}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.opportunityData ? (
                          <Badge variant="outline" className="text-xs">
                            {row.opportunityAction}
                          </Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {row.renewalData ? (
                          <Badge variant="outline" className="text-xs">
                            {row.renewalAction}
                          </Badge>
                        ) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filteredPreviewRows.length > 100 && (
                <div className="p-2 text-center text-xs text-muted-foreground">
                  Showing first 100 of {filteredPreviewRows.length} rows
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Importing Step */}
        {step === 'importing' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8">
            <Loader2 className="h-12 w-12 text-primary animate-spin" />
            <div className="text-center">
              <p className="font-medium">Importing data...</p>
              <p className="text-sm text-muted-foreground">{importProgress}% complete</p>
            </div>
            <Progress value={importProgress} className="w-64" />
          </div>
        )}

        {/* Complete Step */}
        {step === 'complete' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8">
            <div className="h-12 w-12 rounded-full bg-status-green/20 flex items-center justify-center">
              <Check className="h-6 w-6 text-status-green" />
            </div>
            <div className="text-center">
              <p className="font-medium text-lg">Import Complete!</p>
              <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
                <div>
                  <p className="text-2xl font-bold text-primary">{importResults.accountsCreated + importResults.accountsUpdated}</p>
                  <p className="text-muted-foreground">Accounts</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">{importResults.opportunitiesCreated + importResults.opportunitiesUpdated}</p>
                  <p className="text-muted-foreground">Opportunities</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">{importResults.renewalsCreated + importResults.renewalsUpdated}</p>
                  <p className="text-muted-foreground">Renewals</p>
                </div>
              </div>
              {importResults.errors > 0 && (
                <p className="text-status-red mt-2">{importResults.errors} errors occurred</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="flex-shrink-0 gap-2">
          {step === 'upload' && (
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          )}
          
          {step === 'auto-map' && (
            <>
              <Button variant="outline" onClick={() => setStep('upload')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={proceedToActionRequired} disabled={!hasAccountNameMapping}>
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </>
          )}
          
          {step === 'action-required' && (
            <>
              <Button variant="outline" onClick={() => setStep('auto-map')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={proceedToPreview}>
                Continue to Preview
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </>
          )}
          
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('action-required')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button onClick={handleImport}>
                Import {summary.totalRows - summary.ignoredCount} Rows
              </Button>
            </>
          )}
          
          {step === 'complete' && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
