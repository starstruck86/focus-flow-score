import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EditableTextCell, EditableTextareaCell } from '@/components/table/EditableCell';
import { EditableLinkCell } from '@/components/table/EditableLinkCell';
import {
  ContactDisplayRow,
  AddContactInlineRow,
  generateContactId,
} from '@/components/contacts/ContactRow';
import type { AccountContact } from '@/components/contacts/ContactRow';

// Re-export the shared type
export type { AccountContact } from '@/components/contacts/ContactRow';

interface RenewalDetailsFieldProps {
  contacts: AccountContact[];
  onChange: (contacts: AccountContact[]) => void;
  companyNotes?: string;
  onCompanyNotesChange?: (notes: string) => void;
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
  const [showAddRow, setShowAddRow] = useState(false);

  const realContacts = contacts.filter(c => c.name.trim());

  const handleContactChange = (id: string, field: keyof AccountContact, value: string) => {
    const updated = contacts.map(c => c.id === id ? { ...c, [field]: value } : c);
    onChange(updated.filter(c => c.name.trim() || c.title.trim() || c.notes.trim()));
  };

  const handleRemoveContact = (id: string) => {
    onChange(contacts.filter(c => c.id !== id));
  };

  const handleAddContact = (contact: Omit<AccountContact, 'id'>) => {
    onChange([...contacts, { ...contact, id: generateContactId() }]);
    setShowAddRow(false);
  };

  return (
    <div className="pt-3 space-y-4">
      {/* Company Notes - full-width */}
      {onCompanyNotesChange && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Company Notes
          </label>
          <EditableTextareaCell
            value={companyNotes}
            onChange={onCompanyNotesChange}
            placeholder="Add company notes..."
            emptyText="Add Notes"
          />
        </div>
      )}
      
      {/* Entitlements, Usage, Term, Auto-Renew */}
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Entitlements</label>
          <EditableTextareaCell
            value={entitlements}
            onChange={(v) => onEntitlementsChange?.(v)}
            placeholder="Add entitlements..."
            emptyText="Add"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Usage</label>
          <EditableTextareaCell
            value={usage}
            onChange={(v) => onUsageChange?.(v)}
            placeholder="Add usage..."
            emptyText="Add"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Term</label>
          <EditableTextCell
            value={term}
            onChange={(v) => onTermChange?.(v)}
            placeholder="Add term..."
            emptyText="Add"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Auto-Renew</label>
          <div className="flex items-center gap-2 h-7">
            <Switch checked={autoRenew} onCheckedChange={(checked) => onAutoRenewChange?.(checked)} />
            <Label className="text-sm text-muted-foreground">{autoRenew ? 'Yes' : 'No'}</Label>
          </div>
        </div>
      </div>
      
      {/* Links */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Planhat</label>
          <EditableLinkCell
            value={planhatLink}
            onChange={(v) => onPlanhatLinkChange?.(v)}
            label="Planhat"
            addLabel="Planhat"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Agreement</label>
          <EditableLinkCell
            value={currentAgreementLink}
            onChange={(v) => onCurrentAgreementLinkChange?.(v)}
            label="Agreement"
            addLabel="Agreement"
          />
        </div>
      </div>

      {/* Product, CS Notes */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Product</label>
          <EditableTextCell
            value={product}
            onChange={(v) => onProductChange?.(v)}
            placeholder="Add product..."
            emptyText="Add"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">CS Notes</label>
          <EditableTextareaCell
            value={csNotes}
            onChange={(v) => onCsNotesChange?.(v)}
            placeholder="Add CS notes..."
            emptyText="Add Notes"
          />
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border/50 pt-3" />
      
      {/* Contacts - side-by-side layout with header row */}
      <div className="space-y-1">
        <div className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 px-2 -mx-2">
          <label className="text-xs font-medium text-muted-foreground">
            Name {realContacts.length > 0 && `(${realContacts.length})`}
          </label>
          <label className="text-xs font-medium text-muted-foreground">Title / Role</label>
          <label className="text-xs font-medium text-muted-foreground">Notes</label>
          <div className="w-6" />
        </div>

        {realContacts.length === 0 && !showAddRow ? (
          <div className="text-xs text-muted-foreground/60 py-1 px-2">No contacts added yet.</div>
        ) : (
          realContacts.map((contact) => (
            <ContactDisplayRow
              key={contact.id}
              contact={contact}
              onContactChange={(field, value) => handleContactChange(contact.id, field, value)}
              onRemove={() => handleRemoveContact(contact.id)}
            />
          ))
        )}

        {showAddRow && (
          <AddContactInlineRow
            onAdd={handleAddContact}
            onCancel={() => setShowAddRow(false)}
          />
        )}
      </div>

      {!showAddRow && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowAddRow(true)}
        >
          <Plus className="h-3 w-3 mr-1" />
          Add contact
        </Button>
      )}
    </div>
  );
}
