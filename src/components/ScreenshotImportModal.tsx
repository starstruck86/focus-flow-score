import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Camera, X, CheckCircle2, Loader2, AlertTriangle, Edit2, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { maybePromoteToResearching } from '@/lib/accountAutoStatus';
import { cn } from '@/lib/utils';
import type { Account } from '@/types';

// Title seniority tiers for org chart hierarchy inference
const SENIORITY_TIERS: { patterns: RegExp[]; level: number; influence: string; buyerRole: string }[] = [
  { patterns: [/\bc[eoi]o\b/i, /\bchief\b/i, /\bfounder\b/i, /\bco-founder\b/i, /\bpresident\b/i, /\bowner\b/i, /\bgeneral\s*manager\b/i], level: 1, influence: 'high', buyerRole: 'decision-maker' },
  { patterns: [/\bsvp\b/i, /\bsenior\s+vice\s+president\b/i, /\bevp\b/i, /\bexecutive\s+vice\s+president\b/i], level: 2, influence: 'high', buyerRole: 'decision-maker' },
  { patterns: [/\bvp\b/i, /\bvice\s+president\b/i], level: 3, influence: 'high', buyerRole: 'decision-maker' },
  { patterns: [/\bsenior\s+director\b/i], level: 4, influence: 'high', buyerRole: 'champion' },
  { patterns: [/\bdirector\b/i, /\bhead\s+of\b/i], level: 5, influence: 'high', buyerRole: 'champion' },
  { patterns: [/\bsenior\s+manager\b/i], level: 6, influence: 'medium', buyerRole: 'champion' },
  { patterns: [/\bmanager\b/i], level: 7, influence: 'medium', buyerRole: 'influencer' },
  { patterns: [/\blead\b/i, /\bprincipal\b/i], level: 8, influence: 'medium', buyerRole: 'influencer' },
  { patterns: [/\bsenior\b/i], level: 8, influence: 'medium', buyerRole: 'influencer' },
  { patterns: [/\banalyst\b/i, /\bcoordinator\b/i, /\bspecialist\b/i, /\bassociate\b/i], level: 9, influence: 'low', buyerRole: 'end-user' },
];

function getTitleLevel(title: string | undefined): { level: number; influence: string; buyerRole: string } {
  if (!title) return { level: 99, influence: 'medium', buyerRole: 'unknown' };
  for (const tier of SENIORITY_TIERS) {
    if (tier.patterns.some(p => p.test(title))) return { level: tier.level, influence: tier.influence, buyerRole: tier.buyerRole };
  }
  return { level: 10, influence: 'medium', buyerRole: 'unknown' };
}

function getDepartment(title: string | undefined): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  // "Account" in titles like "Account Executive" or "Account Manager" = sales, not finance
  const depts: [RegExp, string][] = [
    [/account\s*(exec|manag|rep)/i, 'sales'],
    [/market/i, 'marketing'], [/\bsale/i, 'sales'], [/revenue/i, 'revenue'],
    [/product/i, 'product'], [/engineer|tech|it\b|dev/i, 'engineering'],
    [/financ|cfo\b/i, 'finance'], [/operat/i, 'operations'],
    [/customer|success|cx\b|support/i, 'customer'], [/digital/i, 'digital'],
    [/ecommerce|e-commerce/i, 'ecommerce'], [/data/i, 'data'],
    [/brand/i, 'brand'], [/growth/i, 'growth'], [/loyalty/i, 'loyalty'],
  ];
  for (const [pat, dept] of depts) {
    if (pat.test(t)) return dept;
  }
  return null;
}

interface ContactWithHierarchy {
  name: string;
  title?: string;
  email?: string;
  inferredReportingTo: string | null;
  inferredInfluence: string;
  inferredBuyerRole: string;
}

function inferContactHierarchy(contacts: { name: string; title?: string; email?: string }[]): ContactWithHierarchy[] {
  if (contacts.length === 0) return [];

  const scored = contacts.map(c => ({
    ...c,
    ...getTitleLevel(c.title),
    dept: getDepartment(c.title),
  }));
  // Sort most senior first
  scored.sort((a, b) => a.level - b.level);

  const result: ContactWithHierarchy[] = [];
  for (const contact of scored) {
    let reportingTo: string | null = null;

    // Find closest superior: prefer same department, fall back to C-suite
    if (contact.level > 1) {
      // 1) Same department superior
      if (contact.dept) {
        const deptSuperior = scored
          .filter(s => s.name !== contact.name && s.level < contact.level && s.dept === contact.dept)
          .sort((a, b) => b.level - a.level)[0]; // closest rank above
        if (deptSuperior) reportingTo = deptSuperior.name;
      }
      // 2) Fall back to any C-suite / top-level person
      if (!reportingTo) {
        const anySuperior = scored
          .filter(s => s.name !== contact.name && s.level < contact.level)
          .sort((a, b) => b.level - a.level)[0];
        if (anySuperior) reportingTo = anySuperior.name;
      }
    }

    result.push({
      name: contact.name, title: contact.title, email: contact.email,
      inferredReportingTo: reportingTo,
      inferredInfluence: contact.influence,
      inferredBuyerRole: contact.buyerRole,
    });
  }
  return result;
}

interface ScreenshotImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ExtractedAccount {
  name: string;
  website?: string | null;
  industry?: string | null;
  motion?: string | null;
  tier?: string | null;
  ecommerce?: string | null;
  mar_tech?: string | null;
  salesforce_id?: string | null;
  salesforce_link?: string | null;
  planhat_link?: string | null;
  notes?: string | null;
  arr?: number | null;
  renewal_due?: string | null;
  contacts?: { name: string; title?: string; email?: string }[];
  // UI state
  selected: boolean;
  editing: boolean;
  matchedExistingId?: string;
}

type Step = 'upload' | 'review' | 'done';

export function ScreenshotImportModal({ open, onOpenChange }: ScreenshotImportModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [files, setFiles] = useState<{ file: File; preview: string }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [extractedAccounts, setExtractedAccounts] = useState<ExtractedAccount[]>([]);
  const [importContext, setImportContext] = useState('');
  const [importedCount, setImportedCount] = useState(0);

  const { user } = useAuth();
  const addAccount = useStore(s => s.addAccount);
  const addRenewal = useStore(s => s.addRenewal);
  const accounts = useStore(s => s.accounts);
  const updateAccount = useStore(s => s.updateAccount);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB per file
    const entries = Array.from(newFiles)
      .filter(f => {
        if (!f.type.startsWith('image/')) return false;
        if (f.size > MAX_SIZE) {
          toast.error(`${f.name} is too large (max 10MB)`);
          return false;
        }
        return true;
      })
      .slice(0, 10)
      .map(file => ({ file, preview: URL.createObjectURL(file) }));
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

  // Match extracted accounts against existing
  const matchExisting = (extracted: ExtractedAccount[]): ExtractedAccount[] => {
    return extracted.map(acc => {
      const nameLC = acc.name.toLowerCase().trim();
      const match = accounts.find(a => {
        if (a.name.toLowerCase().trim() === nameLC) return true;
        if (acc.website && a.website) {
          const extractedDomain = acc.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
          const existingDomain = a.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
          if (extractedDomain === existingDomain) return true;
        }
        if (acc.salesforce_id && a.salesforceId && acc.salesforce_id === a.salesforceId) return true;
        return false;
      });
      return { ...acc, matchedExistingId: match?.id, selected: true };
    });
  };

  const extractFromScreenshots = async () => {
    if (files.length === 0) return;
    setProcessing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error('Please sign in first'); return; }

      // Upload files to storage
      const uploadedUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const ext = files[i].file.name.split('.').pop() || 'png';
        const path = `${session.user.id}/imports/${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage
          .from('enrichment-screenshots')
          .upload(path, files[i].file, { upsert: true });
        if (error) { console.error('Upload error:', error); continue; }
        const { data: signedData } = await supabase.storage
          .from('enrichment-screenshots')
          .createSignedUrl(path, 3600);
        if (signedData?.signedUrl) uploadedUrls.push(signedData.signedUrl);
      }

      if (uploadedUrls.length === 0) {
        toast.error('Failed to upload screenshots');
        return;
      }

      toast.info(`Analyzing ${uploadedUrls.length} screenshot(s)...`);

      const { data, error } = await supabase.functions.invoke('parse-account-screenshot', {
        body: { imageUrls: uploadedUrls, context: importContext },
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Extraction failed');

      const rawAccounts = (data.accounts || []).map((a: any) => ({
        ...a,
        selected: true,
        editing: false,
      }));

      const matched = matchExisting(rawAccounts);
      setExtractedAccounts(matched);
      setStep('review');

      toast.success(`Found ${matched.length} account(s)`, {
        description: data.raw_text_summary,
      });
    } catch (err) {
      toast.error('Extraction failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setProcessing(false);
    }
  };

  const updateField = (index: number, field: string, value: any) => {
    setExtractedAccounts(prev => prev.map((a, i) =>
      i === index ? { ...a, [field]: value } : a
    ));
  };

  const importAccounts = async () => {
    if (!user) return;
    const toImport = extractedAccounts.filter(a => a.selected);
    let imported = 0;

    for (const acc of toImport) {
      try {
        let accountId: string | undefined;

        // If matched to an existing account, merge new data into it
        if (acc.matchedExistingId) {
          accountId = acc.matchedExistingId;
          const mergeUpdates: Record<string, any> = {};
          if (acc.website) mergeUpdates.website = acc.website;
          if (acc.industry) mergeUpdates.industry = acc.industry;
          if (acc.ecommerce) mergeUpdates.ecommerce = acc.ecommerce;
          if (acc.mar_tech) mergeUpdates.mar_tech = acc.mar_tech;
          if (acc.salesforce_id) mergeUpdates.salesforce_id = acc.salesforce_id;
          if (acc.salesforce_link) mergeUpdates.salesforce_link = acc.salesforce_link;
          if (acc.planhat_link) mergeUpdates.planhat_link = acc.planhat_link;
          if (acc.notes) {
            const existing = accounts.find(a => a.id === accountId);
            mergeUpdates.notes = existing?.notes
              ? `${existing.notes}\n\n**Imported:** ${acc.notes}`
              : acc.notes;
          }

          // Only update fields that have values (smart-merge: don't overwrite with empty)
          if (Object.keys(mergeUpdates).length > 0) {
            const localUpdates: Partial<Account> = {};
            if (mergeUpdates.website) localUpdates.website = mergeUpdates.website;
            if (mergeUpdates.industry) localUpdates.industry = mergeUpdates.industry;
            if (mergeUpdates.ecommerce) localUpdates.ecommerce = mergeUpdates.ecommerce;
            if (mergeUpdates.mar_tech) localUpdates.marTech = mergeUpdates.mar_tech;
            if (mergeUpdates.salesforce_id) localUpdates.salesforceId = mergeUpdates.salesforce_id;
            if (mergeUpdates.salesforce_link) localUpdates.salesforceLink = mergeUpdates.salesforce_link;
            if (mergeUpdates.planhat_link) localUpdates.planhatLink = mergeUpdates.planhat_link;
            if (mergeUpdates.notes) localUpdates.notes = mergeUpdates.notes;
            updateAccount(accountId, localUpdates);
          }
        } else if (acc.motion === 'renewal' && acc.renewal_due) {
          await addRenewal({
            accountName: acc.name,
            arr: acc.arr || 0,
            renewalDue: acc.renewal_due,
            notes: acc.notes || undefined,
            product: undefined,
            autoRenew: false,
            healthStatus: 'green' as const,
            churnRisk: 'low' as const,
            owner: '',
          });
        } else {
          await addAccount({
            name: acc.name,
            website: acc.website || undefined,
            industry: acc.industry || undefined,
            motion: (acc.motion as 'new-logo' | 'renewal') || 'new-logo',
            tier: (acc.tier as 'A' | 'B' | 'C') || 'B',
            ecommerce: acc.ecommerce || undefined,
            marTech: acc.mar_tech || undefined,
            salesforceId: acc.salesforce_id || undefined,
            salesforceLink: acc.salesforce_link || undefined,
            planhatLink: acc.planhat_link || undefined,
            notes: acc.notes || undefined,
            accountStatus: 'inactive' as const,
            priority: 'medium' as const,
            techStack: [],
            techFitFlag: 'good' as const,
            outreachStatus: 'not-started' as const,
            tags: [],
          });
        }

        // Save extracted contacts to the contacts table (powers Org Chart)
        // with auto-inferred hierarchy based on title seniority
        if (acc.contacts && acc.contacts.length > 0 && user) {
          const targetAccountId = acc.matchedExistingId || accountId;

          // Infer hierarchy from titles
          const withHierarchy = inferContactHierarchy(acc.contacts);

          for (const contact of withHierarchy) {
            try {
              const { data: existing } = await supabase
                .from('contacts')
                .select('id')
                .eq('account_id', targetAccountId)
                .ilike('name', contact.name)
                .maybeSingle();

              if (!existing) {
                await supabase.from('contacts').insert({
                  user_id: user.id,
                  account_id: targetAccountId || null,
                  name: contact.name,
                  title: contact.title || null,
                  email: contact.email || null,
                  status: 'target',
                  buyer_role: contact.inferredBuyerRole || 'unknown',
                  influence_level: contact.inferredInfluence || 'medium',
                  reporting_to: contact.inferredReportingTo || null,
                  discovery_source: 'screenshot-import',
                });
              }
            } catch {
              // Non-critical — continue
            }
          }
        }

        imported++;
      } catch (err) {
        console.error(`Failed to import ${acc.name}:`, err);
      }
    }

    setImportedCount(imported);
    setStep('done');
    toast.success(`Imported ${imported} account(s)`);
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      files.forEach(f => URL.revokeObjectURL(f.preview));
      setFiles([]);
      setExtractedAccounts([]);
      setStep('upload');
      setProcessing(false);
      setImportContext('');
      setImportedCount(0);
    }
    onOpenChange(open);
  };

  const selectedCount = extractedAccounts.filter(a => a.selected).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" onPaste={handlePaste}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            Screenshot Import
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Take a screenshot of accounts from any source — CRM, spreadsheet, email, website. AI will extract the data.'}
            {step === 'review' && `Review ${extractedAccounts.length} extracted account(s). Edit fields and select which to import.`}
            {step === 'done' && `Successfully imported ${importedCount} account(s).`}
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Context (optional)</label>
              <Input
                placeholder="e.g. 'These are new logo prospects from LinkedIn' or 'Renewal list from Q2'"
                value={importContext}
                onChange={e => setImportContext(e.target.value)}
              />
            </div>

            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
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
              <p className="text-sm font-medium">Drop screenshots, click to browse, or paste</p>
              <p className="text-xs text-muted-foreground mt-1">Up to 10 images • PNG, JPG, WebP</p>
            </div>

            {files.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {files.map((entry, i) => (
                  <div key={i} className="relative group rounded-md overflow-hidden border border-border">
                    <img src={entry.preview} alt={`Screenshot ${i + 1}`} className="w-full h-20 object-cover" />
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Supports CRM screenshots, LinkedIn, spreadsheets, emails
              </p>
              <Button onClick={extractFromScreenshots} disabled={files.length === 0 || processing}>
                {processing ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Extracting...</>
                ) : (
                  <><Camera className="h-4 w-4 mr-1" /> Extract Accounts ({files.length})</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: Review */}
        {step === 'review' && (
          <div className="space-y-3">
            {extractedAccounts.map((acc, i) => (
              <div
                key={i}
                className={cn(
                  "border rounded-lg p-3 space-y-2 transition-colors",
                  acc.matchedExistingId && "border-status-yellow/50 bg-status-yellow/5",
                  acc.selected && !acc.matchedExistingId && "border-primary/30 bg-primary/5",
                  !acc.selected && "opacity-60"
                )}
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={acc.selected}
                    onCheckedChange={(checked) => updateField(i, 'selected', !!checked)}
                  />
                  <span className="font-semibold text-sm flex-1">{acc.name}</span>
                  {acc.matchedExistingId && (
                    <Badge variant="outline" className={cn("text-[10px]", acc.selected ? "text-primary border-primary/30" : "text-status-yellow border-status-yellow/30")}>
                      {acc.selected ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
                      {acc.selected ? 'Will merge' : 'Already exists'}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {acc.motion === 'renewal' ? 'Renewal' : 'New Logo'}
                  </Badge>
                  <Button
                    variant="ghost" size="sm" className="h-6 w-6 p-0"
                    onClick={() => updateField(i, 'editing', !acc.editing)}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>

                {/* Summary row */}
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {acc.website && <span>🌐 {acc.website}</span>}
                  {acc.industry && <span>🏢 {acc.industry}</span>}
                  {acc.ecommerce && <span>🛒 {acc.ecommerce}</span>}
                  {acc.arr && <span>💰 ${acc.arr.toLocaleString()}</span>}
                  {acc.renewal_due && <span>📅 {acc.renewal_due}</span>}
                  {acc.contacts && acc.contacts.length > 0 && (
                    <span>👤 {acc.contacts.length} contact(s)</span>
                  )}
                </div>

                {/* Editable fields */}
                {acc.editing && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Name</label>
                      <Input
                        value={acc.name}
                        onChange={e => updateField(i, 'name', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Website</label>
                      <Input
                        value={acc.website || ''}
                        onChange={e => updateField(i, 'website', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Industry</label>
                      <Input
                        value={acc.industry || ''}
                        onChange={e => updateField(i, 'industry', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Motion</label>
                      <Select value={acc.motion || 'new-logo'} onValueChange={v => updateField(i, 'motion', v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new-logo">New Logo</SelectItem>
                          <SelectItem value="renewal">Renewal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Tier</label>
                      <Select value={acc.tier || 'B'} onValueChange={v => updateField(i, 'tier', v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="A">Tier A</SelectItem>
                          <SelectItem value="B">Tier B</SelectItem>
                          <SelectItem value="C">Tier C</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Ecommerce Platform</label>
                      <Input
                        value={acc.ecommerce || ''}
                        onChange={e => updateField(i, 'ecommerce', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                    {acc.motion === 'renewal' && (
                      <>
                        <div>
                          <label className="text-[10px] text-muted-foreground">ARR</label>
                          <Input
                            type="number"
                            value={acc.arr || ''}
                            onChange={e => updateField(i, 'arr', e.target.value ? Number(e.target.value) : null)}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">Renewal Due</label>
                          <Input
                            type="date"
                            value={acc.renewal_due || ''}
                            onChange={e => updateField(i, 'renewal_due', e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      </>
                    )}
                    {acc.notes && (
                      <div className="col-span-2">
                        <label className="text-[10px] text-muted-foreground">Notes</label>
                        <Input
                          value={acc.notes}
                          onChange={e => updateField(i, 'notes', e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" size="sm" onClick={() => { setStep('upload'); setExtractedAccounts([]); }}>
                ← Back
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
                <Button onClick={importAccounts} disabled={selectedCount === 0}>
                  <Plus className="h-4 w-4 mr-1" /> Import {selectedCount} Account(s)
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Done */}
        {step === 'done' && (
          <div className="text-center py-6 space-y-3">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <p className="font-semibold">Imported {importedCount} account(s)</p>
            <p className="text-sm text-muted-foreground">They're now in your workspace ready to work.</p>
            <Button onClick={() => handleClose(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
