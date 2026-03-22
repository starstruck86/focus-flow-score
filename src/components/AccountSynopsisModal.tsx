import { useState } from 'react';
import { trackedInvoke } from '@/lib/trackedInvoke';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Sparkles, RefreshCw, Check, AlertTriangle, UserPlus, StickyNote } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Account, Contact } from '@/types';

interface AccountSynopsisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
}

interface ParsedContact {
  name: string;
  title?: string;
  department?: string;
  seniority?: string;
  email?: string;
  linkedInUrl?: string;
  buyerRole?: string;
  notes?: string;
}

interface ParsedResult {
  companyNotes: string | null;
  updates: Record<string, any>;
  contacts: ParsedContact[];
  summary: string;
}

const UPDATE_LABELS: Record<string, string> = {
  nextStep: 'Next Step',
  lastTouchDate: 'Last Touch Date',
  lastTouchType: 'Last Touch Type',
  industry: 'Industry',
  accountStatus: 'Account Status',
};

export function AccountSynopsisModal({ open, onOpenChange, account }: AccountSynopsisModalProps) {
  const { updateAccount, addContact, contacts } = useStore();
  const [text, setText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [selectedUpdates, setSelectedUpdates] = useState<Set<string>>(new Set());
  const [selectedContacts, setSelectedContacts] = useState<Set<number>>(new Set());
  const [includeNotes, setIncludeNotes] = useState(true);

  const existingContacts = contacts.filter(c => c.accountId === account.id);

  const handleParse = async () => {
    if (!text.trim()) return;
    setIsParsing(true);
    setParsed(null);
    try {
      const { data, error } = await trackedInvoke('parse-account-synopsis', {
        body: {
          text: text.trim(),
          accountContext: {
            name: account.name,
            accountStatus: account.accountStatus,
            industry: account.industry,
            nextStep: account.nextStep,
            existingContacts: existingContacts.map(c => ({ name: c.name, title: c.title })),
          },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setParsed(data);

      // Auto-select all non-null updates
      const fields = Object.entries(data.updates || {})
        .filter(([_, v]) => v !== null && v !== undefined)
        .map(([k]) => k);
      setSelectedUpdates(new Set(fields));

      // Auto-select new contacts (not already existing)
      const newContactIndices = (data.contacts || [])
        .map((c: ParsedContact, i: number) => {
          const norm = (s: string) => s.toLowerCase().trim();
          const exists = existingContacts.some(ec => norm(ec.name) === norm(c.name));
          return exists ? null : i;
        })
        .filter((i: number | null): i is number => i !== null);
      setSelectedContacts(new Set(newContactIndices));
      setIncludeNotes(!!data.companyNotes);
    } catch (err) {
      toast.error('Failed to parse text', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleApply = () => {
    if (!parsed) return;
    let appliedCount = 0;

    // 1. Append company notes
    if (includeNotes && parsed.companyNotes) {
      const existing = account.notes || '';
      const separator = existing ? '\n\n--- Pasted Notes ---\n' : '';
      updateAccount(account.id, { notes: existing + separator + parsed.companyNotes });
      appliedCount++;
    }

    // 2. Apply field updates
    const updates: Partial<Account> = {};
    for (const field of selectedUpdates) {
      if (parsed.updates[field] !== null && parsed.updates[field] !== undefined) {
        (updates as any)[field] = parsed.updates[field];
      }
    }
    if (Object.keys(updates).length > 0) {
      updateAccount(account.id, updates);
      appliedCount += Object.keys(updates).length;
    }

    // 3. Add new contacts
    let contactsAdded = 0;
    for (const idx of selectedContacts) {
      const c = parsed.contacts[idx];
      if (c?.name) {
        addContact({
          accountId: account.id,
          name: c.name,
          title: c.title,
          department: c.department,
          seniority: c.seniority,
          email: c.email,
          linkedInUrl: c.linkedInUrl,
          notes: c.notes,
          status: 'target',
        });
        contactsAdded++;
      }
    }

    const parts: string[] = [];
    if (includeNotes && parsed.companyNotes) parts.push('notes appended');
    if (Object.keys(updates).length > 0) parts.push(`${Object.keys(updates).length} field(s) updated`);
    if (contactsAdded > 0) parts.push(`${contactsAdded} contact(s) added`);

    toast.success('Account updated', { description: parts.join(', ') || 'No changes applied' });
    handleClose();
  };

  const handleClose = () => {
    onOpenChange(false);
    setText('');
    setParsed(null);
    setSelectedUpdates(new Set());
    setSelectedContacts(new Set());
    setIncludeNotes(true);
  };

  const toggleUpdate = (field: string) => {
    setSelectedUpdates(prev => {
      const next = new Set(prev);
      next.has(field) ? next.delete(field) : next.add(field);
      return next;
    });
  };

  const toggleContact = (idx: number) => {
    setSelectedContacts(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const updateFields = parsed
    ? Object.entries(parsed.updates).filter(([_, v]) => v !== null && v !== undefined)
    : [];

  const hasAnythingToApply = (includeNotes && parsed?.companyNotes) || 
    selectedUpdates.size > 0 || selectedContacts.size > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Paste Synopsis — {account.name}
          </DialogTitle>
          <DialogDescription>
            Paste text from Claude or meeting notes to extract notes, contacts, and field updates.
          </DialogDescription>
        </DialogHeader>

        {!parsed ? (
          <div className="space-y-3">
            <Textarea
              placeholder="Paste your Claude research, meeting notes, or account update text here..."
              value={text}
              onChange={e => setText(e.target.value)}
              rows={8}
              className="resize-none text-sm"
            />
            <Button onClick={handleParse} disabled={!text.trim() || isParsing} className="w-full gap-2">
              {isParsing ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Parsing...</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Extract Updates</>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
              <p className="text-muted-foreground italic">{parsed.summary}</p>
            </div>

            {/* Company Notes */}
            {parsed.companyNotes && (
              <div className="space-y-2">
                <label
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    includeNotes ? "bg-primary/5 border-primary/30" : "bg-muted/20 border-border/50"
                  )}
                >
                  <Checkbox
                    checked={includeNotes}
                    onCheckedChange={(v) => setIncludeNotes(!!v)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">Append to Company Notes</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground whitespace-pre-wrap line-clamp-4">
                      {parsed.companyNotes}
                    </p>
                  </div>
                </label>
              </div>
            )}

            {/* Field updates */}
            {updateFields.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Field Updates
                </Label>
                <div className="space-y-1.5">
                  {updateFields.map(([key, value]) => {
                    const currentValue = (account as any)[key];
                    return (
                      <label
                        key={key}
                        className={cn(
                          "flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors",
                          selectedUpdates.has(key) ? "bg-primary/5 border-primary/30" : "bg-muted/20 border-border/50"
                        )}
                      >
                        <Checkbox
                          checked={selectedUpdates.has(key)}
                          onCheckedChange={() => toggleUpdate(key)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium">{UPDATE_LABELS[key] || key}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            {currentValue && (
                              <span className="text-[11px] text-muted-foreground line-through">
                                {String(currentValue)}
                              </span>
                            )}
                            <span className="text-[11px]">→</span>
                            <span className="text-[11px] font-medium text-primary">
                              {String(value)}
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Contacts */}
            {parsed.contacts.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" />
                  Contacts ({selectedContacts.size}/{parsed.contacts.length})
                </Label>
                <div className="space-y-1.5">
                  {parsed.contacts.map((c, i) => {
                    const norm = (s: string) => s.toLowerCase().trim();
                    const alreadyExists = existingContacts.some(ec => norm(ec.name) === norm(c.name));
                    return (
                      <label
                        key={i}
                        className={cn(
                          "flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors",
                          alreadyExists
                            ? "bg-muted/10 border-border/30 opacity-60"
                            : selectedContacts.has(i)
                            ? "bg-primary/5 border-primary/30"
                            : "bg-muted/20 border-border/50"
                        )}
                      >
                        <Checkbox
                          checked={selectedContacts.has(i)}
                          onCheckedChange={() => toggleContact(i)}
                          disabled={alreadyExists}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{c.name}</span>
                            {alreadyExists && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0">exists</Badge>
                            )}
                            {c.buyerRole && !alreadyExists && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0">{c.buyerRole}</Badge>
                            )}
                          </div>
                          {(c.title || c.department) && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {[c.title, c.department].filter(Boolean).join(' · ')}
                            </p>
                          )}
                          {c.notes && (
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{c.notes}</p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No results */}
            {!parsed.companyNotes && updateFields.length === 0 && parsed.contacts.length === 0 && (
              <div className="text-center py-4">
                <AlertTriangle className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No extractable data found in the text.</p>
              </div>
            )}

            {/* Re-parse */}
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => setParsed(null)}>
              <RefreshCw className="h-3 w-3" /> Re-parse with different text
            </Button>
          </div>
        )}

        {parsed && hasAnythingToApply && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleApply} className="gap-1.5">
              <Check className="h-4 w-4" />
              Apply Changes
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
