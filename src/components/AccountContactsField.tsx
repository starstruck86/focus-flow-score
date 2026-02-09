import { forwardRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface AccountContact {
  id: string;
  name: string;
  title: string;
  notes: string;
}

interface AccountContactsFieldProps {
  contacts: AccountContact[];
  onChange: (contacts: AccountContact[]) => void;
  companyNotes?: string;
  onCompanyNotesChange?: (notes: string) => void;
  defaultOpen?: boolean;
}

function generateContactId(): string {
  return Math.random().toString(36).substring(2, 9);
}

const DEFAULT_CONTACTS_COUNT = 3;

export const AccountContactsField = forwardRef<HTMLDivElement, AccountContactsFieldProps>(function AccountContactsField({ 
  contacts, 
  onChange, 
  companyNotes = '', 
  onCompanyNotesChange,
  defaultOpen = false,
}, ref) {
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

  const handleContactChange = (index: number, field: keyof AccountContact, value: string) => {
    const newContacts = [...displayContacts];
    newContacts[index] = { ...newContacts[index], [field]: value };
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
    <div className="pt-3 space-y-3">
      {/* Company Notes */}
      {onCompanyNotesChange && (
        <div className="pb-3 border-b border-border/50">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Company Notes
          </label>
          <Textarea
            value={companyNotes}
            onChange={(e) => onCompanyNotesChange(e.target.value)}
            placeholder="General account notes, context, history..."
            className="min-h-[60px] text-sm resize-none py-2 px-3 field-sizing-content"
            rows={2}
          />
        </div>
      )}
      
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
    </div>
  );
});
