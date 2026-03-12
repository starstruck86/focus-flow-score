import { useState, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, ImagePlus, X, CheckCircle2, AlertCircle, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Account } from '@/types';

interface ScreenshotEnrichModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: Account;
}

type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

interface FileEntry {
  file: File;
  preview: string;
  status: UploadStatus;
}

export function ScreenshotEnrichModal({ open, onOpenChange, account: preselectedAccount }: ScreenshotEnrichModalProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(preselectedAccount?.id || '');
  const [accountSearch, setAccountSearch] = useState('');
  const updateAccount = useStore((s) => s.updateAccount);
  const accounts = useStore((s) => s.accounts);
  const renewals = useStore((s) => s.renewals);

  // Merge accounts + renewal-only accounts (same pattern as task selectors)
  const allAccounts = useMemo(() => {
    const accountIds = new Set(accounts.map(a => a.id));
    const renewalOnlyAccounts = renewals
      .filter(r => !r.accountId || !accountIds.has(r.accountId))
      .map(r => ({ id: r.id, name: r.accountName, isRenewal: true, ecommerce: '' }));
    const baseAccounts = accounts.map(a => ({ id: a.id, name: a.name, isRenewal: false, ecommerce: a.ecommerce || '' }));
    const seen = new Set<string>();
    return [...baseAccounts, ...renewalOnlyAccounts].filter(a => {
      const key = a.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts, renewals]);

  // Resolve the active account — check main accounts first, then build a stub from renewal
  const account = preselectedAccount || accounts.find(a => a.id === selectedAccountId) || (() => {
    const renewal = renewals.find(r => r.id === selectedAccountId);
    if (!renewal) return undefined;
    return { id: renewal.id, name: renewal.accountName } as Account;
  })();

  // Filtered accounts for selector
  const filteredAccounts = useMemo(() => {
    if (!accountSearch) return allAccounts.slice(0, 50);
    const q = accountSearch.toLowerCase();
    return allAccounts.filter(a => a.name.toLowerCase().includes(q)).slice(0, 50);
  }, [allAccounts, accountSearch]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const entries = Array.from(newFiles)
      .filter(f => f.type.startsWith('image/'))
      .slice(0, 10) // max 10 files
      .map(file => ({
        file,
        preview: URL.createObjectURL(file),
        status: 'pending' as UploadStatus,
      }));
    setFiles(prev => [...prev, ...entries].slice(0, 10));
  }, []);

  const removeFile = (index: number) => {
    setFiles(prev => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) addFiles(imageFiles);
  }, [addFiles]);

  const processScreenshots = async () => {
    if (files.length === 0 || !account) return;
    setProcessing(true);
    setResult(null);

    try {
      // Get user session for upload path
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please sign in first');
        setProcessing(false);
        return;
      }

      // Upload all files to storage
      const uploadedUrls: string[] = [];
      const updatedFiles = [...files];

      for (let i = 0; i < updatedFiles.length; i++) {
        updatedFiles[i].status = 'uploading';
        setFiles([...updatedFiles]);

        const ext = updatedFiles[i].file.name.split('.').pop() || 'png';
        const path = `${session.user.id}/${account.id}/${Date.now()}-${i}.${ext}`;

        const { data, error } = await supabase.storage
          .from('enrichment-screenshots')
          .upload(path, updatedFiles[i].file, { upsert: true });

        if (error) {
          console.error('Upload error:', error);
          updatedFiles[i].status = 'error';
          setFiles([...updatedFiles]);
          continue;
        }

        // Get signed URL for the AI to read
        const { data: signedData } = await supabase.storage
          .from('enrichment-screenshots')
          .createSignedUrl(path, 3600); // 1 hour

        if (signedData?.signedUrl) {
          uploadedUrls.push(signedData.signedUrl);
          updatedFiles[i].status = 'done';
        } else {
          updatedFiles[i].status = 'error';
        }
        setFiles([...updatedFiles]);
      }

      if (uploadedUrls.length === 0) {
        toast.error('Failed to upload any screenshots');
        setProcessing(false);
        return;
      }

      toast.info(`Analyzing ${uploadedUrls.length} screenshot(s)...`);

      // Call edge function to parse with AI vision
      const { data: parseResult, error: parseError } = await supabase.functions.invoke('parse-screenshot', {
        body: {
          imageUrls: uploadedUrls,
          accountId: account.id,
          accountName: account.name,
        },
      });

      if (parseError) throw new Error(parseError.message);
      if (!parseResult?.success) throw new Error(parseResult?.error || 'Parsing failed');

      setResult(parseResult);

      // Update local store
      const extracted = parseResult.extracted;
      const updates: Partial<Account> = {
        marTech: parseResult.marTech || account.marTech,
        ecommerce: parseResult.ecommerce || account.ecommerce,
        lastEnrichedAt: new Date().toISOString(),
      };
      if (extracted.direct_ecommerce !== undefined) updates.directEcommerce = extracted.direct_ecommerce;
      if (extracted.esp_platform || extracted.sms_platform) updates.emailSmsCapture = true;
      if (extracted.loyalty_membership !== undefined) updates.loyaltyMembership = extracted.loyalty_membership;
      if (extracted.mobile_app !== undefined) updates.mobileApp = extracted.mobile_app;
      if (extracted.esp_platform) {
        updates.marketingPlatformDetected = extracted.esp_platform;
      }

      updateAccount(account.id, updates);
      toast.success(`Updated ${account.name} from screenshots`, {
        description: parseResult.marTech || 'Data extracted successfully',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Processing failed';
      toast.error('Screenshot parsing failed', { description: msg });
    } finally {
      setProcessing(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      files.forEach(f => URL.revokeObjectURL(f.preview));
      setFiles([]);
      setResult(null);
      setProcessing(false);
      if (!preselectedAccount) setSelectedAccountId('');
      setAccountSearch('');
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onPaste={handlePaste}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5 text-primary" />
            Screenshot Enrichment{account ? ` — ${account.name}` : ''}
          </DialogTitle>
          <DialogDescription>
            Upload screenshots from eTailInsights, BuiltWith, or similar tools. AI will extract MarTech and ecommerce data.
          </DialogDescription>
        </DialogHeader>

        {/* Account selector (when no account pre-selected) */}
        {!preselectedAccount && !result && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Account</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search accounts..."
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            {(accountSearch || !selectedAccountId) && (
              <div className="max-h-40 overflow-y-auto border border-border rounded-md">
                {filteredAccounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3 text-center">No accounts found</p>
                ) : (
                  filteredAccounts.map(a => (
                    <button
                      key={a.id}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors",
                        selectedAccountId === a.id && "bg-primary/10 font-medium"
                      )}
                      onClick={() => {
                        setSelectedAccountId(a.id);
                        setAccountSearch(a.name);
                      }}
                    >
                      <span>{a.name}{a.isRenewal ? ' (Renewal)' : ''}</span>
                      {a.ecommerce && (
                        <span className="ml-2 text-xs text-muted-foreground">{a.ecommerce}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
            {selectedAccountId && account && !accountSearch && (
              <div className="flex items-center gap-2 text-sm bg-primary/5 rounded-md px-3 py-2">
                <span className="font-medium">{account.name}</span>
                <button 
                  className="text-xs text-muted-foreground hover:text-foreground ml-auto"
                  onClick={() => { setSelectedAccountId(''); setAccountSearch(''); }}
                >
                  Change
                </button>
              </div>
            )}
          </div>
        )}

        {/* Drop zone */}
        {!result && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer",
              "hover:border-primary/50 hover:bg-primary/5",
              files.length > 0 ? "border-primary/30" : "border-border"
            )}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.multiple = true;
              input.onchange = (e) => {
                const target = e.target as HTMLInputElement;
                if (target.files) addFiles(target.files);
              };
              input.click();
            }}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">Drop screenshots here, click to browse, or paste from clipboard</p>
            <p className="text-xs text-muted-foreground mt-1">Up to 10 images • PNG, JPG, WebP</p>
          </div>
        )}

        {/* File previews */}
        {files.length > 0 && !result && (
          <div className="grid grid-cols-3 gap-2">
            {files.map((entry, i) => (
              <div key={i} className="relative group rounded-md overflow-hidden border border-border">
                <img src={entry.preview} alt={`Screenshot ${i + 1}`} className="w-full h-24 object-cover" />
                <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                  {entry.status === 'pending' && (
                    <span className="text-xs font-medium text-muted-foreground">Ready</span>
                  )}
                  {entry.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  {entry.status === 'done' && <CheckCircle2 className="h-4 w-4 text-status-green" />}
                  {entry.status === 'error' && <AlertCircle className="h-4 w-4 text-destructive" />}
                </div>
                {!processing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Result display */}
        {result && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-status-green font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Data extracted successfully
            </div>

            {/* Key business metrics */}
            {(result.extracted?.estimated_product_count || result.extracted?.estimated_aov || result.extracted?.estimated_online_sales) && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                <p className="text-xs font-semibold text-primary mb-2">Business Metrics</p>
                <div className="grid grid-cols-3 gap-2">
                  {result.extracted?.estimated_product_count && (
                    <Field label="ePC" value={result.extracted.estimated_product_count} />
                  )}
                  {result.extracted?.estimated_aov && (
                    <Field label="eAOV" value={result.extracted.estimated_aov} />
                  )}
                  {result.extracted?.estimated_online_sales && (
                    <Field label="Est. Sales" value={result.extracted.estimated_online_sales} />
                  )}
                  {result.extracted?.estimated_orders_per_day && (
                    <Field label="Orders/Day" value={result.extracted.estimated_orders_per_day} />
                  )}
                  {result.extracted?.employee_count && (
                    <Field label="Employees" value={result.extracted.employee_count} />
                  )}
                  {result.extracted?.annual_email_frequency && (
                    <Field label="Emails/Year" value={result.extracted.annual_email_frequency} />
                  )}
                </div>
              </div>
            )}

            {/* Core tech stack */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Tech Stack</p>
              <div className="grid grid-cols-2 gap-2">
                {result.extracted?.ecommerce_platform && (
                  <Field label="Commerce" value={result.extracted.ecommerce_platform} />
                )}
                {result.extracted?.esp_platform && (
                  <Field label="Email (ESP)" value={result.extracted.esp_platform} />
                )}
                {result.extracted?.sms_platform && (
                  <Field label="SMS / Chat" value={result.extracted.sms_platform} />
                )}
                {result.extracted?.loyalty_platform && (
                  <Field label="Loyalty" value={result.extracted.loyalty_platform} />
                )}
                {result.extracted?.reviews_platform && (
                  <Field label="Reviews" value={result.extracted.reviews_platform} />
                )}
                {result.extracted?.advertising_platforms && (
                  <Field label="Advertising" value={result.extracted.advertising_platforms} />
                )}
                {result.extracted?.payment_platforms && (
                  <Field label="Payments" value={result.extracted.payment_platforms} />
                )}
                {result.extracted?.analytics_tools && (
                  <Field label="Analytics" value={result.extracted.analytics_tools} />
                )}
                {result.extracted?.search_platform && (
                  <Field label="Search" value={result.extracted.search_platform} />
                )}
                {result.extracted?.mobile_app_platform && (
                  <Field label="Mobile App" value={result.extracted.mobile_app_platform} />
                )}
              </div>
            </div>

            {result.extracted?.summary && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">{result.extracted.summary}</p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          {result ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <Button
              onClick={processScreenshots}
              disabled={files.length === 0 || processing || !account}
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Processing...
                </>
              ) : (
                <>
                  <ImagePlus className="h-4 w-4 mr-1" />
                  Extract Data ({files.length} {files.length === 1 ? 'file' : 'files'})
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded p-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="font-medium text-xs truncate">{value}</p>
    </div>
  );
}
