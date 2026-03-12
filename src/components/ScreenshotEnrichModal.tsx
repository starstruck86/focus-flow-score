import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Upload, ImagePlus, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Account } from '@/types';

interface ScreenshotEnrichModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
}

type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

interface FileEntry {
  file: File;
  preview: string;
  status: UploadStatus;
}

export function ScreenshotEnrichModal({ open, onOpenChange, account }: ScreenshotEnrichModalProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const updateAccount = useStore((s) => s.updateAccount);

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
    if (files.length === 0) return;
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
      if (extracted.email_sms_capture !== undefined) updates.emailSmsCapture = extracted.email_sms_capture;
      if (extracted.loyalty_membership !== undefined) updates.loyaltyMembership = extracted.loyalty_membership;
      if (extracted.mobile_app !== undefined) updates.mobileApp = extracted.mobile_app;
      if (extracted.esp_platform || extracted.marketing_automation) {
        updates.marketingPlatformDetected = extracted.esp_platform || extracted.marketing_automation;
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
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onPaste={handlePaste}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5 text-primary" />
            Screenshot Enrichment — {account.name}
          </DialogTitle>
          <DialogDescription>
            Upload screenshots from eTailInsights, BuiltWith, or similar tools. AI will extract MarTech and ecommerce data.
          </DialogDescription>
        </DialogHeader>

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
            <div className="grid grid-cols-2 gap-2">
              {result.extracted?.esp_platform && (
                <Field label="ESP" value={result.extracted.esp_platform} />
              )}
              {result.extracted?.sms_platform && (
                <Field label="SMS" value={result.extracted.sms_platform} />
              )}
              {result.extracted?.ecommerce_platform && (
                <Field label="Ecommerce" value={result.extracted.ecommerce_platform} />
              )}
              {result.extracted?.cdp_platform && (
                <Field label="CDP" value={result.extracted.cdp_platform} />
              )}
              {result.extracted?.personalization_platform && (
                <Field label="Personalization" value={result.extracted.personalization_platform} />
              )}
              {result.extracted?.reviews_platform && (
                <Field label="Reviews" value={result.extracted.reviews_platform} />
              )}
              {result.extracted?.loyalty_program && (
                <Field label="Loyalty" value={result.extracted.loyalty_program} />
              )}
              {result.extracted?.analytics_tools && (
                <Field label="Analytics" value={result.extracted.analytics_tools} />
              )}
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
              disabled={files.length === 0 || processing}
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
