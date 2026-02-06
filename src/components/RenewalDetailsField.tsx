import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, ExternalLink, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export interface AccountContact {
  id: string;
  name: string;
  title: string;
  notes: string;
}

interface RenewalDetailsFieldProps {
  contacts: AccountContact[];
  onChange: (contacts: AccountContact[]) => void;
  companyNotes?: string;
  onCompanyNotesChange?: (notes: string) => void;
  // Renewal-specific fields
  entitlements?: string;
  onEntitlementsChange?: (value: string) => void;
  usage?: string;
  onUsageChange?: (value: string) => void;
  term?: string;
  onTermChange?: (value: string) => void;
  planhatLink?: string;
  onPlanhatLinkChange?: (value: string) => void;
  currentAgreementLink?: string;
  onCurrentAgreementLinkChange?: (value: string) => void;
  product?: string;
  onProductChange?: (value: string) => void;
  csNotes?: string;
  onCsNotesChange?: (value: string) => void;
  autoRenew?: boolean;
  onAutoRenewChange?: (value: boolean) => void;
}

function generateContactId(): string {
  return Math.random().toString(36).substring(2, 9);
}

const DEFAULT_CONTACTS_COUNT = 3;

export function RenewalDetailsField({ 
  contacts, 
  onChange, 
  companyNotes = '', 
  onCompanyNotesChange,
  entitlements = '',
  onEntitlementsChange,
  usage = '',
  onUsageChange,
  term = '',
  onTermChange,
  planhatLink = '',
  onPlanhatLinkChange,
  currentAgreementLink = '',
  onCurrentAgreementLinkChange,
  product = '',
  onProductChange,
  csNotes = '',
  onCsNotesChange,
  autoRenew = false,
  onAutoRenewChange,
}: RenewalDetailsFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingPlanhat, setEditingPlanhat] = useState(false);
  const [editingAgreement, setEditingAgreement] = useState(false);

  // Ensure we always have at least DEFAULT_CONTACTS_COUNT contacts
  const displayContacts = contacts.length >= DEFAULT_CONTACTS_COUNT 
    ? contacts 
    : [
        ...contacts,
        ...Array.from({ length: DEFAULT_CONTACTS_COUNT - contacts.length }, () => ({
          id: generateContactId(),
          name: '',
          title: '',
          notes: '',
        })),
      ];

  const filledContactsCount = contacts.filter(c => c.name.trim()).length;
  const hasDetails = filledContactsCount > 0 || companyNotes || entitlements || usage || term || product || csNotes || planhatLink;

  const handleContactChange = (index: number, field: keyof AccountContact, value: string) => {
    const newContacts = [...displayContacts];
    newContacts[index] = { ...newContacts[index], [field]: value };
    // Only save contacts that have at least a name
    onChange(newContacts.filter(c => c.name.trim() || c.title.trim() || c.notes.trim()));
  };

  const handleAddContact = () => {
    onChange([
      ...displayContacts,
      { id: generateContactId(), name: '', title: '', notes: '' },
    ]);
  };

  const handleRemoveContact = (index: number) => {
    const newContacts = displayContacts.filter((_, i) => i !== index);
    onChange(newContacts.filter(c => c.name.trim() || c.title.trim() || c.notes.trim()));
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start text-xs px-2 hover:bg-muted/50"
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3 mr-1 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 mr-1 shrink-0" />
          )}
          <span className={cn(
            hasDetails ? 'text-foreground' : 'text-muted-foreground'
          )}>
            {hasDetails 
              ? `Details${filledContactsCount > 0 ? ` • ${filledContactsCount} contact${filledContactsCount !== 1 ? 's' : ''}` : ''}`
              : 'Add details & contacts'}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-4">
        {/* Row 1: Company Notes */}
        {onCompanyNotesChange && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Company Notes
            </label>
            <Textarea
              value={companyNotes}
              onChange={(e) => onCompanyNotesChange(e.target.value)}
              placeholder="General account notes, context, history..."
              className="min-h-[80px] text-sm resize-none py-2 px-3 field-sizing-content"
              rows={3}
            />
          </div>
        )}
        
        {/* Row 2: Entitlements, Usage, Term, Auto-Renew */}
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Entitlements
            </label>
            <Textarea
              value={entitlements}
              onChange={(e) => onEntitlementsChange?.(e.target.value)}
              placeholder="Contract entitlements..."
              className="min-h-[80px] text-sm resize-none py-2 px-3 field-sizing-content"
              rows={3}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Usage
            </label>
            <Textarea
              value={usage}
              onChange={(e) => onUsageChange?.(e.target.value)}
              placeholder="Current usage metrics..."
              className="min-h-[80px] text-sm resize-none py-2 px-3 field-sizing-content"
              rows={3}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Term
            </label>
            <Textarea
              value={term}
              onChange={(e) => onTermChange?.(e.target.value)}
              placeholder="Contract term..."
              className="min-h-[80px] text-sm resize-none py-2 px-3 field-sizing-content"
              rows={3}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Auto-Renew
            </label>
            <div className="flex items-center gap-2 h-9">
              <Switch
                checked={autoRenew}
                onCheckedChange={(checked) => onAutoRenewChange?.(checked)}
              />
              <Label className="text-sm text-muted-foreground">
                {autoRenew ? 'Yes' : 'No'}
              </Label>
            </div>
          </div>
        </div>
        
        {/* Row 3: Links Section */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Planhat Link
            </label>
            {editingPlanhat || !planhatLink ? (
              <Input
                value={planhatLink}
                onChange={(e) => onPlanhatLinkChange?.(e.target.value)}
                onBlur={() => planhatLink && setEditingPlanhat(false)}
                placeholder="https://planhat.com/..."
                className="h-9 text-sm"
                autoFocus={editingPlanhat}
              />
            ) : (
              <div className="flex items-center gap-2">
                <a 
                  href={planhatLink} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm font-medium"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Planhat
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setEditingPlanhat(true)}
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Current Agreement
            </label>
            {editingAgreement || !currentAgreementLink ? (
              <Input
                value={currentAgreementLink}
                onChange={(e) => onCurrentAgreementLinkChange?.(e.target.value)}
                onBlur={() => currentAgreementLink && setEditingAgreement(false)}
                placeholder="https://..."
                className="h-9 text-sm"
                autoFocus={editingAgreement}
              />
            ) : (
              <div className="flex items-center gap-2">
                <a 
                  href={currentAgreementLink} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm font-medium"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open Agreement
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setEditingAgreement(true)}
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Row 3: Product, CS Notes */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Product
            </label>
            <Textarea
              value={product}
              onChange={(e) => onProductChange?.(e.target.value)}
              placeholder="Product details, tier, features..."
              className="min-h-[80px] text-sm resize-none py-2 px-3 field-sizing-content"
              rows={3}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              CS Notes
            </label>
            <Textarea
              value={csNotes}
              onChange={(e) => onCsNotesChange?.(e.target.value)}
              placeholder="Customer success notes, health indicators..."
              className="min-h-[80px] text-sm resize-none py-2 px-3 field-sizing-content"
              rows={3}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border/50 pt-3" />
        
        {/* Contacts */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground block">
            Contacts
          </label>
          {displayContacts.map((contact, index) => (
            <div
              key={contact.id}
              className="flex items-start gap-2 group"
            >
              <Textarea
                value={contact.name}
                onChange={(e) => handleContactChange(index, 'name', e.target.value)}
                placeholder="Contact name"
                className="min-h-[44px] text-sm resize-none py-2 px-3 w-[25%] shrink-0 field-sizing-content"
                rows={1}
              />
              <Textarea
                value={contact.title}
                onChange={(e) => handleContactChange(index, 'title', e.target.value)}
                placeholder="Title / Role"
                className="min-h-[44px] text-sm resize-none py-2 px-3 w-[25%] shrink-0 field-sizing-content"
                rows={1}
              />
              <Textarea
                value={contact.notes}
                onChange={(e) => handleContactChange(index, 'notes', e.target.value)}
                placeholder="Notes about this contact..."
                className="min-h-[44px] text-sm resize-none py-2 px-3 flex-1 field-sizing-content"
                rows={1}
              />
              {displayContacts.length > DEFAULT_CONTACTS_COUNT && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1"
                  onClick={() => handleRemoveContact(index)}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs w-full text-muted-foreground hover:text-foreground"
          onClick={handleAddContact}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add contact
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
