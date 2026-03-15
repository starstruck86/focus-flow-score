import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { useStore } from '@/store/useStore';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Brain, AlertTriangle, Check, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ParsedRecord {
  type: 'account' | 'opportunity' | 'contact';
  name: string;
  matchedId?: string;
  matchedName?: string;
  isNew: boolean;
  fields: Record<string, any>;
  parentAccountName?: string;
  parentAccountId?: string;
}

interface ParseResult {
  records: ParsedRecord[];
  raw: string;
  warnings: string[];
}

interface ClaudeImportModalProps {
  open: boolean;
  onClose: () => void;
}

export function ClaudeImportModal({ open, onClose }: ClaudeImportModalProps) {
  const { user } = useAuth();
  const { accounts, opportunities, contacts, updateAccount, addAccount, updateOpportunity, addOpportunity, updateContact, addContact } = useStore();
  const [step, setStep] = useState<'paste' | 'parsing' | 'review' | 'importing' | 'done'>('paste');
  const [rawText, setRawText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<Set<number>>(new Set());

  const handleParse = async () => {
    if (!rawText.trim()) { toast.error('Paste some text first'); return; }
    setStep('parsing');

    try {
      const { data, error } = await supabase.functions.invoke('parse-claude-import', {
        body: {
          text: rawText,
          existingAccounts: accounts.map(a => ({ id: a.id, name: a.name, website: a.website, salesforceId: a.salesforceId })),
          existingOpportunities: opportunities.map(o => ({ id: o.id, name: o.name, accountId: o.accountId, accountName: o.accountName, salesforceId: o.salesforceId })),
          existingContacts: contacts.map(c => ({ id: c.id, name: c.name, accountId: c.accountId, email: c.email })),
        },
      });

      if (error) throw error;

      const result: ParseResult = data as ParseResult;
      setParseResult(result);
      // Select all by default
      setSelectedRecords(new Set(result.records.map((_, i) => i)));
      setStep('review');
    } catch (err: any) {
      console.error('Parse error:', err);
      toast.error('Failed to parse: ' + (err.message || 'Unknown error'));
      setStep('paste');
    }
  };

  const handleImport = () => {
    if (!parseResult) return;
    setStep('importing');

    let created = 0, updated = 0;

    for (const idx of selectedRecords) {
      const record = parseResult.records[idx];
      if (!record) continue;

      try {
        if (record.type === 'account') {
          if (record.matchedId) {
            // Smart merge - only update non-empty fields that are currently empty
            const existing = accounts.find(a => a.id === record.matchedId);
            if (existing) {
              const updates: Record<string, any> = {};
              for (const [key, value] of Object.entries(record.fields)) {
                if (value !== null && value !== undefined && value !== '') {
                  const existingVal = (existing as any)[key];
                  if (!existingVal || existingVal === '' || existingVal === null) {
                    updates[key] = value;
                  }
                }
              }
              if (Object.keys(updates).length > 0) {
                updateAccount(record.matchedId, updates);
                updated++;
              }
            }
          } else if (record.isNew) {
            addAccount({
              name: record.name,
              priority: 'medium',
              tier: 'B',
              accountStatus: 'researching',
              motion: 'new-logo',
              techStack: [],
              techFitFlag: 'good',
              outreachStatus: 'not-started',
              tags: [],
              ...record.fields,
            });
            created++;
          }
        } else if (record.type === 'opportunity') {
          if (record.matchedId) {
            const existing = opportunities.find(o => o.id === record.matchedId);
            if (existing) {
              const updates: Record<string, any> = {};
              for (const [key, value] of Object.entries(record.fields)) {
                if (value !== null && value !== undefined && value !== '') {
                  const existingVal = (existing as any)[key];
                  if (!existingVal || existingVal === '' || existingVal === null) {
                    updates[key] = value;
                  }
                }
              }
              // Notes are special - append rather than overwrite
              if (record.fields.notes && existing.notes) {
                updates.notes = existing.notes + '\n\n--- Imported ---\n' + record.fields.notes;
              }
              if (Object.keys(updates).length > 0) {
                updateOpportunity(record.matchedId, updates);
                updated++;
              }
            }
          } else if (record.isNew && record.parentAccountId) {
            addOpportunity({
              name: record.name,
              accountId: record.parentAccountId,
              accountName: record.parentAccountName,
              status: 'active',
              stage: '',
              linkedContactIds: [],
              ...record.fields,
            });
            created++;
          }
        } else if (record.type === 'contact') {
          if (record.matchedId) {
            const existing = contacts.find(c => c.id === record.matchedId);
            if (existing) {
              const updates: Record<string, any> = {};
              for (const [key, value] of Object.entries(record.fields)) {
                if (value !== null && value !== undefined && value !== '') {
                  const existingVal = (existing as any)[key];
                  if (!existingVal || existingVal === '' || existingVal === null) {
                    updates[key] = value;
                  }
                }
              }
              if (Object.keys(updates).length > 0) {
                updateContact(record.matchedId, updates);
                updated++;
              }
            }
          } else if (record.isNew && record.parentAccountId) {
            addContact({
              name: record.name,
              accountId: record.parentAccountId,
              status: 'target',
              ...record.fields,
            });
            created++;
          }
        }
      } catch (err) {
        console.error('Import error for record:', record.name, err);
      }
    }

    toast.success(`Import complete: ${created} created, ${updated} updated`);
    setStep('done');
  };

  const handleClose = () => {
    setStep('paste');
    setRawText('');
    setParseResult(null);
    setSelectedRecords(new Set());
    onClose();
  };

  const toggleRecord = (idx: number) => {
    setSelectedRecords(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Import from Claude
          </DialogTitle>
          <DialogDescription>
            Paste text from your Claude conversations. AI will parse accounts, opportunities, contacts and smart-merge into existing records.
          </DialogDescription>
        </DialogHeader>

        {step === 'paste' && (
          <div className="space-y-3 flex-1">
            <Label className="text-xs text-muted-foreground">
              Paste your Claude output — account details, opportunity updates, contact info, next steps, etc.
            </Label>
            <Textarea 
              value={rawText} 
              onChange={e => setRawText(e.target.value)}
              placeholder={`Example:\n\nAccount: Acme Corp\nWebsite: acme.com\nOpportunity: Acme - Enterprise Deal\nStage: Proposal\nARR: $150,000\nClose Date: 2026-04-15\nNext Step: Send final pricing by Friday\nContact: Jane Smith, VP Marketing, jane@acme.com\n\nOr paste any freeform notes from Claude...`}
              className="min-h-[300px] font-mono text-sm"
            />
          </div>
        )}

        {step === 'parsing' && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">AI is parsing your data...</p>
          </div>
        )}

        {step === 'review' && parseResult && (
          <ScrollArea className="flex-1 max-h-[50vh]">
            <div className="space-y-3">
              {parseResult.warnings.length > 0 && (
                <div className="flex items-start gap-2 p-2 rounded-lg bg-status-yellow/10 border border-status-yellow/20">
                  <AlertTriangle className="h-4 w-4 text-status-yellow mt-0.5" />
                  <div className="text-xs text-status-yellow space-y-1">
                    {parseResult.warnings.map((w, i) => <p key={i}>{w}</p>)}
                  </div>
                </div>
              )}

              {parseResult.records.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No recognizable records found. Try pasting more structured data.
                </p>
              )}

              {parseResult.records.map((record, idx) => (
                <div key={idx} className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                  selectedRecords.has(idx) ? 'border-primary/30 bg-primary/5' : 'border-border/50 opacity-50'
                )}>
                  <Checkbox 
                    checked={selectedRecords.has(idx)} 
                    onCheckedChange={() => toggleRecord(idx)} 
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">{record.type}</Badge>
                      <span className="text-sm font-medium">{record.name}</span>
                      {record.matchedId ? (
                        <Badge className="text-[10px] bg-status-green/20 text-status-green">
                          <ArrowRight className="h-3 w-3 mr-1" />Update: {record.matchedName}
                        </Badge>
                      ) : record.isNew ? (
                        <Badge className="text-[10px] bg-primary/20 text-primary">New</Badge>
                      ) : null}
                    </div>
                    {record.parentAccountName && (
                      <p className="text-xs text-muted-foreground mt-0.5">→ {record.parentAccountName}</p>
                    )}
                    {Object.keys(record.fields).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(record.fields).slice(0, 6).map(([key, value]) => (
                          <span key={key} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {key}: {String(value).substring(0, 30)}
                          </span>
                        ))}
                        {Object.keys(record.fields).length > 6 && (
                          <span className="text-[10px] text-muted-foreground">+{Object.keys(record.fields).length - 6} more</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Importing records...</p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Check className="h-10 w-10 text-status-green" />
            <p className="text-sm font-medium">Import complete!</p>
          </div>
        )}

        <DialogFooter>
          {step === 'paste' && (
            <Button onClick={handleParse} disabled={!rawText.trim()}>
              <Brain className="h-4 w-4 mr-2" />Parse with AI
            </Button>
          )}
          {step === 'review' && (
            <>
              <Button variant="outline" onClick={() => setStep('paste')}>Back</Button>
              <Button onClick={handleImport} disabled={selectedRecords.size === 0}>
                Import {selectedRecords.size} Record{selectedRecords.size !== 1 ? 's' : ''}
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
