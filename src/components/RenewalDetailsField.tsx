import { useState } from 'react';
import { Plus, Trash2, ExternalLink, Link } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EditableTextCell, EditableTextareaCell } from '@/components/table/EditableCell';
import { EditableLinkCell } from '@/components/table/EditableLinkCell';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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

function generateContactId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// Contact name with SFDC link support
function RenewalContactName({ contact, onSalesforceLinkChange }: { contact: AccountContact; onSalesforceLinkChange: (link: string) => void }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editLink, setEditLink] = useState(contact.salesforceLink || '');

  const handleSaveLink = () => {
    const normalized = editLink.trim() ? (editLink.startsWith('http') ? editLink : `https://${editLink}`) : '';
    onSalesforceLinkChange(normalized);
    toast.success('Saved', { duration: 1500 });
    setPopoverOpen(false);
  };

  if (contact.salesforceLink) {
    const href = contact.salesforceLink.startsWith('http') ? contact.salesforceLink : `https://${contact.salesforceLink}`;
    return (
      <div className="flex items-center gap-1 group/name">
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline underline-offset-2 decoration-primary/50" onClick={(e) => e.stopPropagation()}>
          {contact.name}
        </a>
        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover/name:opacity-70 transition-opacity shrink-0" />
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover/name:opacity-70 hover:!opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()} title="Edit Salesforce Link">
              <Link className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start" onClick={(e) => e.stopPropagation()}>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Salesforce Link</label>
              <Input value={editLink} onChange={(e) => setEditLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveLink(); if (e.key === 'Escape') setPopoverOpen(false); }} placeholder="https://salesforce.com/..." autoFocus className="h-8 text-sm" />
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSaveLink}>Save</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPopoverOpen(false)}>Cancel</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group/name">
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button className="text-sm font-medium text-left hover:text-primary transition-colors" onClick={(e) => { e.stopPropagation(); setPopoverOpen(true); }}>
            {contact.name}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="start" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Plus className="h-3 w-3" />
              Add Salesforce Link
            </label>
            <Input value={editLink} onChange={(e) => setEditLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveLink(); if (e.key === 'Escape') setPopoverOpen(false); }} placeholder="https://salesforce.com/..." autoFocus className="h-8 text-sm" />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSaveLink}>Save</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPopoverOpen(false)}>Cancel</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Plus className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
    </div>
  );
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
  const [showAddModal, setShowAddModal] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', title: '', notes: '', salesforceLink: '' });

  const realContacts = contacts.filter(c => c.name.trim());

  const handleContactChange = (id: string, field: keyof AccountContact, value: string) => {
    const updated = contacts.map(c => c.id === id ? { ...c, [field]: value } : c);
    onChange(updated.filter(c => c.name.trim() || c.title.trim() || c.notes.trim()));
  };

  const handleRemoveContact = (id: string) => {
    onChange(contacts.filter(c => c.id !== id));
  };

  const handleAddContact = () => {
    if (!newContact.name.trim()) return;
    const normalized = newContact.salesforceLink.trim() ? (newContact.salesforceLink.startsWith('http') ? newContact.salesforceLink : `https://${newContact.salesforceLink}`) : '';
    onChange([...contacts, { ...newContact, salesforceLink: normalized || undefined, id: generateContactId() }]);
    setNewContact({ name: '', title: '', notes: '', salesforceLink: '' });
    setShowAddModal(false);
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
      
      {/* Contacts - display-first with SFDC link */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground block">
          Contacts {realContacts.length > 0 && `(${realContacts.length})`}
        </label>
        {realContacts.length === 0 ? (
          <div className="text-xs text-muted-foreground/60 py-1">No contacts added yet.</div>
        ) : (
          realContacts.map((contact) => (
            <div
              key={contact.id}
              className="group flex items-start gap-3 py-1.5 px-2 -mx-2 rounded hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <RenewalContactName
                    contact={contact}
                    onSalesforceLinkChange={(link) => handleContactChange(contact.id, 'salesforceLink', link)}
                  />
                  {contact.title && (
                    <>
                      <span className="text-xs text-muted-foreground">•</span>
                      <EditableTextCell
                        value={contact.title}
                        onChange={(v) => handleContactChange(contact.id, 'title', v)}
                        emptyText="Title"
                        className="text-muted-foreground"
                      />
                    </>
                  )}
                  {!contact.title && (
                    <EditableTextCell
                      value=""
                      onChange={(v) => handleContactChange(contact.id, 'title', v)}
                      emptyText="Title"
                      className="text-muted-foreground"
                    />
                  )}
                </div>
                {contact.notes && (
                  <EditableTextCell
                    value={contact.notes}
                    onChange={(v) => handleContactChange(contact.id, 'notes', v)}
                    emptyText="Notes"
                    className="text-muted-foreground text-xs mt-0.5"
                  />
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={() => handleRemoveContact(contact.id)}
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setShowAddModal(true)}
      >
        <Plus className="h-3 w-3 mr-1" />
        Add contact
      </Button>

      {/* Add Contact Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Add Contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input
                value={newContact.name}
                onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                placeholder="Contact name"
                autoFocus
                className="h-8 text-sm mt-1"
                onKeyDown={(e) => e.key === 'Enter' && handleAddContact()}
              />
            </div>
            <div>
              <Label className="text-xs">Title / Role</Label>
              <Input
                value={newContact.title}
                onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                placeholder="VP of Marketing"
                className="h-8 text-sm mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Salesforce Contact URL</Label>
              <Input
                value={newContact.salesforceLink}
                onChange={(e) => setNewContact({ ...newContact, salesforceLink: e.target.value })}
                placeholder="https://salesforce.com/..."
                className="h-8 text-sm mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input
                value={newContact.notes}
                onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                placeholder="Optional notes..."
                className="h-8 text-sm mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAddContact} disabled={!newContact.name.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
