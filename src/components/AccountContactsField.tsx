import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

interface AccountContactsFieldProps {
  contacts: AccountContact[];
  onChange: (contacts: AccountContact[]) => void;
}

function generateContactId(): string {
  return Math.random().toString(36).substring(2, 9);
}

const DEFAULT_CONTACTS_COUNT = 3;

export function AccountContactsField({ contacts, onChange }: AccountContactsFieldProps) {
  const [isOpen, setIsOpen] = useState(false);

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
            filledContactsCount > 0 ? 'text-foreground' : 'text-muted-foreground'
          )}>
            {filledContactsCount > 0 
              ? `${filledContactsCount} contact${filledContactsCount !== 1 ? 's' : ''}`
              : 'Add contacts'}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-1.5">
        {displayContacts.map((contact, index) => (
          <div
            key={contact.id}
            className="flex items-center gap-2 group"
          >
            <Input
              value={contact.name}
              onChange={(e) => handleContactChange(index, 'name', e.target.value)}
              placeholder="Contact"
              className="h-6 text-xs w-[100px] shrink-0"
            />
            <Input
              value={contact.title}
              onChange={(e) => handleContactChange(index, 'title', e.target.value)}
              placeholder="Title"
              className="h-6 text-xs w-[100px] shrink-0"
            />
            <Input
              value={contact.notes}
              onChange={(e) => handleContactChange(index, 'notes', e.target.value)}
              placeholder="Notes"
              className="h-6 text-xs flex-1 min-w-[80px]"
            />
            {displayContacts.length > DEFAULT_CONTACTS_COUNT && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={() => handleRemoveContact(index)}
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </Button>
            )}
          </div>
        ))}
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
