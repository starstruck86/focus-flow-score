// Main import modal with header-based auto-mapping
import { useState, useRef, useMemo, useCallback } from 'react';
import { Upload, FileSpreadsheet, Download, AlertTriangle, Check, X, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  parseCSV,
  mapHeaderToField,
  normalizeUrl,
  detectLinkType,
  extractSalesforceId,
  parseCurrency,
  parseDate,
  isUrlColumn,
  type ImportRow,
  type ImportPreview,
} from '@/lib/importUtils';
import { useDbAccounts, useUpsertAccount, type DbAccount } from '@/hooks/useAccountsData';
import { useAuth } from '@/contexts/AuthContext';

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importType?: 'accounts' | 'renewals' | 'all';
}

type ImportStep = 'upload' | 'preview' | 'importing' | 'complete';

export function ImportModal({ open, onOpenChange, importType = 'all' }: ImportModalProps) {
  const [step, setStep] = useState<ImportStep>('upload');
  const [csvData, setCsvData] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [headerMappings, setHeaderMappings] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{ created: number; updated: number; errors: number }>({ created: 0, updated: 0, errors: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { data: existingAccounts = [] } = useDbAccounts();
  const upsertAccount = useUpsertAccount();
  const { user } = useAuth();

  // Reset state when modal closes
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setStep('upload');
      setCsvData(null);
      setHeaderMappings({});
      setPreview(null);
      setImportProgress(0);
      setImportResults({ created: 0, updated: 0, errors: 0 });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
    onOpenChange(isOpen);
  };

  // Process CSV and auto-map headers
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
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
        
        setCsvData(parsed);
        
        // Auto-map headers
        const autoMappings: Record<number, string> = {};
        const unmappedHeaders: string[] = [];
        
        parsed.headers.forEach((header, idx) => {
          const field = mapHeaderToField(header);
          if (field) {
            autoMappings[idx] = field;
          } else {
            // Check if column contains URLs for auto-detection
            const columnValues = parsed.rows.map(row => row[idx] || '');
            if (isUrlColumn(columnValues)) {
              // Try to detect URL type from first valid URL
              const firstUrl = columnValues.find(v => v && v.length > 5);
              if (firstUrl) {
                const linkType = detectLinkType(firstUrl);
                switch (linkType) {
                  case 'salesforce_account':
                    autoMappings[idx] = 'salesforce_account_link';
                    break;
                  case 'salesforce_opportunity':
                    autoMappings[idx] = 'salesforce_opp_link';
                    break;
                  case 'salesforce_contact':
                    autoMappings[idx] = 'salesforce_contact_link';
                    break;
                  case 'planhat':
                    autoMappings[idx] = 'planhat_link';
                    break;
                  case 'agreement':
                    autoMappings[idx] = 'current_agreement_link';
                    break;
                  case 'linkedin':
                    autoMappings[idx] = 'linkedin_url';
                    break;
                }
              }
            }
            if (!autoMappings[idx]) {
              unmappedHeaders.push(header);
            }
          }
        });
        
        setHeaderMappings(autoMappings);
        
        // Check if we have enough mapped fields to skip mapping step
        const hasAccountName = Object.values(autoMappings).includes('account_name');
        
        if (hasAccountName) {
          // Auto-generate preview
          generatePreview(parsed, autoMappings);
          setStep('preview');
        } else {
          toast.error('Could not detect Account Name column. Please check your CSV headers.');
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to parse CSV');
      }
    };
    reader.readAsText(file);
  };

  // Generate import preview
  const generatePreview = useCallback((data: { headers: string[]; rows: string[][] }, mappings: Record<number, string>) => {
    const rows: ImportRow[] = [];
    let matchedAccounts = 0;
    let missingSfAccount = 0;
    let missingPlanhat = 0;
    let missingAgreement = 0;
    
    // Build a lookup for existing accounts
    const accountLookup = new Map<string, DbAccount>();
    existingAccounts.forEach(acc => {
      accountLookup.set(acc.name.toLowerCase().trim(), acc);
      if (acc.salesforce_id) {
        accountLookup.set(acc.salesforce_id, acc);
      }
      if (acc.website) {
        try {
          const domain = new URL(acc.website.startsWith('http') ? acc.website : `https://${acc.website}`).hostname.replace(/^www\./, '');
          accountLookup.set(domain, acc);
        } catch {}
      }
    });
    
    data.rows.forEach((row, rowIndex) => {
      const rowData: Record<string, any> = {};
      const warnings: string[] = [];
      const fieldsToUpdate: string[] = [];
      
      // Extract data based on mappings
      Object.entries(mappings).forEach(([colIdx, field]) => {
        const value = row[parseInt(colIdx)];
        if (!value) return;
        
        switch (field) {
          case 'account_name':
            rowData.name = value.trim();
            break;
          case 'website':
            rowData.website = normalizeUrl(value);
            break;
          case 'salesforce_account_link':
            rowData.salesforce_link = normalizeUrl(value);
            rowData.salesforce_id = extractSalesforceId(value) || undefined;
            break;
          case 'planhat_link':
            rowData.planhat_link = normalizeUrl(value);
            break;
          case 'current_agreement_link':
            rowData.current_agreement_link = normalizeUrl(value);
            break;
          case 'priority':
            const prio = value.toLowerCase();
            if (['high', 'medium', 'low'].includes(prio)) {
              rowData.priority = prio;
            }
            break;
          case 'tier':
            const tier = value.toUpperCase();
            if (['A', 'B', 'C'].includes(tier)) {
              rowData.tier = tier;
            }
            break;
          case 'motion':
            const motion = value.toLowerCase().replace(/\s+/g, '-');
            if (['new-logo', 'renewal', 'general', 'both'].includes(motion)) {
              rowData.motion = motion;
            }
            break;
          case 'industry':
            rowData.industry = value;
            break;
          case 'arr':
            const arr = parseCurrency(value);
            if (arr !== null) rowData.arr = arr;
            break;
          case 'next_step':
            rowData.next_step = value;
            break;
          case 'cs_notes':
          case 'notes':
            rowData.notes = value;
            break;
        }
      });
      
      // Skip rows without account name
      if (!rowData.name) return;
      
      // Try to match existing account
      let matchedAccount: DbAccount | undefined;
      
      if (rowData.salesforce_id && accountLookup.has(rowData.salesforce_id)) {
        matchedAccount = accountLookup.get(rowData.salesforce_id);
      } else if (rowData.website) {
        try {
          const domain = new URL(rowData.website).hostname.replace(/^www\./, '');
          matchedAccount = accountLookup.get(domain);
        } catch {}
      }
      
      if (!matchedAccount) {
        matchedAccount = accountLookup.get(rowData.name.toLowerCase().trim());
      }
      
      // Determine which fields will be updated
      if (matchedAccount) {
        matchedAccounts++;
        Object.keys(rowData).forEach(key => {
          if (key !== 'name' && rowData[key] !== (matchedAccount as any)[key]) {
            fieldsToUpdate.push(key);
          }
        });
      } else {
        fieldsToUpdate.push('(new account)');
      }
      
      // Check for missing links
      if (!rowData.salesforce_link && !matchedAccount?.salesforce_link) {
        warnings.push('Missing Salesforce Account link');
        missingSfAccount++;
      }
      if (!rowData.planhat_link && !matchedAccount?.planhat_link) {
        warnings.push('Missing Planhat link');
        missingPlanhat++;
      }
      if (!rowData.current_agreement_link && !matchedAccount?.current_agreement_link) {
        warnings.push('Missing Agreement link');
        missingAgreement++;
      }
      
      rows.push({
        rowIndex,
        accountName: rowData.name,
        accountMatched: !!matchedAccount,
        accountId: matchedAccount?.id,
        fieldsToUpdate,
        warnings,
        data: rowData,
      });
    });
    
    // Build unmapped headers list
    const mappedIndices = new Set(Object.keys(mappings).map(Number));
    const unmappedHeaders = data.headers.filter((_, idx) => !mappedIndices.has(idx));
    
    setPreview({
      totalRows: rows.length,
      matchedAccounts,
      newAccounts: rows.length - matchedAccounts,
      headerMappings: Object.fromEntries(
        Object.entries(mappings).map(([idx, field]) => [data.headers[parseInt(idx)], field])
      ),
      unmappedHeaders,
      rows,
      warnings: {
        missingSalesforceAccount: missingSfAccount,
        missingPlanhat: missingPlanhat,
        missingAgreement: missingAgreement,
      },
    });
  }, [existingAccounts]);

  // Perform the import
  const handleImport = async () => {
    if (!preview || !user) return;
    
    setStep('importing');
    let created = 0;
    let updated = 0;
    let errors = 0;
    
    for (let i = 0; i < preview.rows.length; i++) {
      const row = preview.rows[i];
      
      try {
        const result = await upsertAccount.mutateAsync({
          name: row.data.name,
          website: row.data.website,
          salesforce_link: row.data.salesforce_link,
          salesforce_id: row.data.salesforce_id,
          planhat_link: row.data.planhat_link,
          current_agreement_link: row.data.current_agreement_link,
          priority: row.data.priority,
          tier: row.data.tier,
          motion: row.data.motion,
          industry: row.data.industry,
          next_step: row.data.next_step,
          notes: row.data.notes,
          tech_stack: [],
          tags: [],
          touches_this_week: 0,
        });
        
        if (result.isUpdate) {
          updated++;
        } else {
          created++;
        }
      } catch (error) {
        console.error('Import error for row:', row, error);
        errors++;
      }
      
      setImportProgress(Math.round(((i + 1) / preview.rows.length) * 100));
    }
    
    setImportResults({ created, updated, errors });
    setStep('complete');
  };

  // Download template
  const downloadTemplate = () => {
    const template = `Account Name,Website,Salesforce Account Link,Planhat Link,Current Agreement Link,Priority,Tier,Motion,Industry,Next Step,Notes
Acme Corp,acme.com,https://yourorg.lightning.force.com/lightning/r/Account/001xxx,https://app.planhat.com/company/xxx,https://docs.google.com/document/xxx,high,A,new-logo,Technology,Schedule demo,Key target account
Global Inc,globalinc.com,,,,,B,renewal,Manufacturing,,Existing customer`;
    
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Data</DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a CSV file to import accounts, opportunities, and contacts.'}
            {step === 'preview' && 'Review the data before importing.'}
            {step === 'importing' && 'Importing your data...'}
            {step === 'complete' && 'Import complete!'}
          </DialogDescription>
        </DialogHeader>

        {/* Upload Step */}
        {step === 'upload' && (
          <div className="flex-1 flex flex-col gap-6">
            <div 
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-2">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-muted-foreground">
                CSV files only
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
            
            <div className="bg-muted/30 rounded-lg p-4">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                Auto-Mapped Headers
              </h4>
              <p className="text-sm text-muted-foreground mb-3">
                Use these column headers in your CSV for automatic mapping:
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <div><Badge variant="outline">Account Name</Badge></div>
                <div><Badge variant="outline">Website</Badge></div>
                <div><Badge variant="outline">Salesforce Account Link</Badge></div>
                <div><Badge variant="outline">Planhat Link</Badge></div>
                <div><Badge variant="outline">Current Agreement Link</Badge></div>
                <div><Badge variant="outline">Priority</Badge></div>
                <div><Badge variant="outline">Tier</Badge></div>
                <div><Badge variant="outline">Motion</Badge></div>
              </div>
            </div>
          </div>
        )}

        {/* Preview Step */}
        {step === 'preview' && preview && (
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="metric-card p-3">
                <div className="text-2xl font-bold">{preview.totalRows}</div>
                <div className="text-xs text-muted-foreground">Total Rows</div>
              </div>
              <div className="metric-card p-3">
                <div className="text-2xl font-bold text-status-green">{preview.matchedAccounts}</div>
                <div className="text-xs text-muted-foreground">Existing (Update)</div>
              </div>
              <div className="metric-card p-3">
                <div className="text-2xl font-bold text-primary">{preview.newAccounts}</div>
                <div className="text-xs text-muted-foreground">New Accounts</div>
              </div>
            </div>
            
            {/* Warnings Summary */}
            {(preview.warnings.missingSalesforceAccount > 0 || preview.warnings.missingPlanhat > 0 || preview.warnings.missingAgreement > 0) && (
              <div className="bg-status-yellow/10 border border-status-yellow/30 rounded-lg p-3">
                <div className="flex items-center gap-2 text-status-yellow text-sm font-medium mb-2">
                  <AlertTriangle className="h-4 w-4" />
                  Data Quality Warnings
                </div>
                <div className="flex gap-4 text-xs">
                  {preview.warnings.missingSalesforceAccount > 0 && (
                    <span>{preview.warnings.missingSalesforceAccount} missing SFDC link</span>
                  )}
                  {preview.warnings.missingPlanhat > 0 && (
                    <span>{preview.warnings.missingPlanhat} missing Planhat</span>
                  )}
                  {preview.warnings.missingAgreement > 0 && (
                    <span>{preview.warnings.missingAgreement} missing Agreement</span>
                  )}
                </div>
              </div>
            )}
            
            {/* Mapped Headers */}
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="text-sm font-medium mb-2">Mapped Fields</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(preview.headerMappings).map(([header, field]) => (
                  <Badge key={header} variant="secondary" className="text-xs">
                    {header} → {field.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
              {preview.unmappedHeaders.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Ignored: {preview.unmappedHeaders.join(', ')}
                </div>
              )}
            </div>
            
            {/* Preview Table */}
            <ScrollArea className="flex-1 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Account</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead>Fields to Update</TableHead>
                    <TableHead>Warnings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.slice(0, 50).map((row) => (
                    <TableRow key={row.rowIndex}>
                      <TableCell className="font-medium">{row.accountName}</TableCell>
                      <TableCell>
                        {row.accountMatched ? (
                          <Badge variant="outline" className="text-status-green border-status-green/50">
                            Update
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-primary border-primary/50">
                            New
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.fieldsToUpdate.join(', ') || '-'}
                      </TableCell>
                      <TableCell>
                        {row.warnings.length > 0 ? (
                          <div className="flex gap-1">
                            {row.warnings.map((w, i) => (
                              <Badge key={i} variant="outline" className="text-xs text-status-yellow border-status-yellow/50">
                                {w.replace('Missing ', '⚠ ')}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <Check className="h-4 w-4 text-status-green" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {preview.rows.length > 50 && (
                <div className="p-2 text-center text-xs text-muted-foreground">
                  Showing first 50 of {preview.rows.length} rows
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Importing Step */}
        {step === 'importing' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8">
            <FileSpreadsheet className="h-12 w-12 text-primary animate-pulse" />
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
              <div className="flex gap-4 mt-2 text-sm">
                <span className="text-status-green">{importResults.created} created</span>
                <span className="text-primary">{importResults.updated} updated</span>
                {importResults.errors > 0 && (
                  <span className="text-status-red">{importResults.errors} errors</span>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex-shrink-0">
          {step === 'upload' && (
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('upload')}>
                Back
              </Button>
              <Button onClick={handleImport}>
                Import {preview?.totalRows} Rows
              </Button>
            </>
          )}
          {step === 'complete' && (
            <Button onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
