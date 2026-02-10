import { forwardRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EditableTextareaCell } from '@/components/table/EditableCell';
import { CustomFieldRow } from '@/components/table/CustomFieldCell';
import { useCustomFields } from '@/hooks/useCustomFields';
import {
  ContactDisplayRow,
  AddContactInlineRow,
  generateContactId,
} from '@/components/contacts/ContactRow';
import type { AccountContact } from '@/components/contacts/ContactRow';

// Re-export the shared type
export type { AccountContact } from '@/components/contacts/ContactRow';

interface AccountContactsFieldProps {
  accountId?: string;
  contacts: AccountContact[];
  onChange: (contacts: AccountContact[]) => void;
  companyNotes?: string;
  onCompanyNotesChange?: (notes: string) => void;
  defaultOpen?: boolean;
}

export const AccountContactsField = forwardRef<HTMLDivElement, AccountContactsFieldProps>(function AccountContactsField({ 
  accountId,
  contacts, 
  onChange, 
  companyNotes = '', 
  onCompanyNotesChange,
}, ref) {
  const { getFieldsForTab } = useCustomFields();
  const customExpandedFields = accountId ? getFieldsForTab('accounts', 'expanded') : [];
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
    <div className="pt-3 space-y-3" ref={ref}>
      {/* Company Notes - display-first, full-width */}
      {onCompanyNotesChange && (
        <div className="pb-3 border-b border-border/50">
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

      {/* Custom Fields - right after company notes */}
      {accountId && customExpandedFields.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {customExpandedFields.map(field => (
            <CustomFieldRow key={field.id} field={field} recordId={accountId} />
          ))}
        </div>
      )}
      
      {/* Contacts header row */}
      <div className="space-y-1">
        <div className="grid grid-cols-[auto_1fr_1fr_1.5fr_auto] gap-2 px-2 -mx-2">
          <div className="w-3.5" />
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
              onReadyForOutreachChange={(checked) => {
                const updated = contacts.map(c => c.id === contact.id ? { ...c, readyForOutreach: checked } : c);
                onChange(updated);
              }}
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
});
