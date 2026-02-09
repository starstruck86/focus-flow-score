// Shared contact row component with side-by-side layout, SFDC link, and display-first behavior
import { useState } from 'react';
import { Plus, Trash2, ExternalLink, Link } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EditableTextCell, EditableTextareaCell } from '@/components/table/EditableCell';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';

export interface AccountContact {
  id: string;
  name: string;
  title: string;
  notes: string;
  salesforceLink?: string;
}

export function generateContactId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/** Contact name with SFDC link: clickable if link exists, click-to-add if missing */
export function ContactNameWithSfdc({
  contact,
  onSalesforceLinkChange,
}: {
  contact: AccountContact;
  onSalesforceLinkChange: (link: string) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editLink, setEditLink] = useState(contact.salesforceLink || '');

  const handleSaveLink = () => {
    const normalized = editLink.trim()
      ? editLink.startsWith('http') ? editLink : `https://${editLink}`
      : '';
    onSalesforceLinkChange(normalized);
    toast.success('Saved', { duration: 1500 });
    setPopoverOpen(false);
  };

  const keyHandler = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveLink();
    if (e.key === 'Escape') setPopoverOpen(false);
  };

  const linkPopover = (
    <PopoverContent className="w-72 p-3" align="start" onClick={(e) => e.stopPropagation()}>
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          {contact.salesforceLink ? 'Salesforce Link' : <><Plus className="h-3 w-3" /> Add Salesforce Link</>}
        </label>
        <Input
          value={editLink}
          onChange={(e) => setEditLink(e.target.value)}
          onKeyDown={keyHandler}
          placeholder="https://salesforce.com/..."
          autoFocus
          className="h-8 text-sm"
        />
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSaveLink}>Save</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPopoverOpen(false)}>Cancel</Button>
        </div>
      </div>
    </PopoverContent>
  );

  if (contact.salesforceLink) {
    const href = contact.salesforceLink.startsWith('http') ? contact.salesforceLink : `https://${contact.salesforceLink}`;
    return (
      <div className="flex items-center gap-1 group/name min-w-0">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium hover:underline underline-offset-2 decoration-primary/50 truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {contact.name}
        </a>
        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover/name:opacity-70 transition-opacity shrink-0" />
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover/name:opacity-70 hover:!opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()} title="Edit Salesforce Link">
              <Link className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          {linkPopover}
        </Popover>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group/name min-w-0">
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            className="text-sm font-medium text-left hover:text-primary transition-colors truncate"
            onClick={(e) => { e.stopPropagation(); setPopoverOpen(true); }}
          >
            {contact.name}
          </button>
        </PopoverTrigger>
        {linkPopover}
      </Popover>
      <Plus className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
    </div>
  );
}

/** Display-first contact row: Name | Title | Notes side-by-side */
export function ContactDisplayRow({
  contact,
  onContactChange,
  onRemove,
}: {
  contact: AccountContact;
  onContactChange: (field: keyof AccountContact, value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="group grid grid-cols-[1fr_1fr_1.5fr_auto] md:grid-cols-[1fr_1fr_1.5fr_auto] gap-2 items-start py-1.5 px-2 -mx-2 rounded hover:bg-muted/30 transition-colors">
      {/* Name with SFDC link */}
      <div className="min-w-0">
        <ContactNameWithSfdc
          contact={contact}
          onSalesforceLinkChange={(link) => onContactChange('salesforceLink', link)}
        />
      </div>

      {/* Title */}
      <div className="min-w-0">
        <EditableTextCell
          value={contact.title}
          onChange={(v) => onContactChange('title', v)}
          emptyText="Title"
          className="text-muted-foreground text-xs"
        />
      </div>

      {/* Notes - single line display, full-width edit */}
      <div className="min-w-0">
        <EditableTextCell
          value={contact.notes}
          onChange={(v) => onContactChange('notes', v)}
          emptyText="Notes"
          className="text-muted-foreground text-xs"
        />
      </div>

      {/* Delete */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        onClick={onRemove}
      >
        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
      </Button>
    </div>
  );
}

/** Inline Add Contact row: 3 side-by-side inputs + Save/Cancel */
export function AddContactInlineRow({
  onAdd,
  onCancel,
}: {
  onAdd: (contact: Omit<AccountContact, 'id'>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), title, notes });
    setName('');
    setTitle('');
    setNotes('');
  };

  return (
    <div className="space-y-2 py-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Contact name *"
          autoFocus
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title / Role"
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes about this contact..."
          className="h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
            if (e.key === 'Escape') onCancel();
          }}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={!name.trim()}>
          Save
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
