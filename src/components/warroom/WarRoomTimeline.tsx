import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, User } from 'lucide-react';
import { useWarRoomContacts, useAddWarRoomContact, useUpdateWarRoomContact } from '@/hooks/useWarRoomContacts';
import { useDebouncedCallback } from '@/hooks/useDebouncedUpdate';

/**
 * Stakeholder Map — track key contacts, their roles in the deal,
 * your impressions, and their key concerns. Core MEDDICC stakeholder intelligence.
 * Reframed from interview-era "Interview Timeline" to sales-native context.
 */

function StakeholderCard({ c, accountId }: { c: any; accountId: string }) {
  const { mutate: updateContact } = useUpdateWarRoomContact();
  const save = (field: string, value: string) => updateContact({ id: c.id, updates: { [field]: value }, accountId });
  const debouncedSave = useDebouncedCallback((field: string, value: string) => save(field, value), 800);
  const [impression, setImpression] = useState(c.impression ?? '');
  const [concerns, setConcerns] = useState(c.key_concerns ?? '');

  return (
    <div className="p-3 rounded-lg border border-border/50 bg-card/30 space-y-2">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{c.name}</span>
        {c.title && <span className="text-xs text-muted-foreground">— {c.title}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-muted-foreground">Stakeholder role: </span>{c.interview_role ?? '—'}</div>
        <div><span className="text-muted-foreground">Last met: </span>{c.met_on ?? '—'}</div>
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">Impression</label>
        <Textarea value={impression} onChange={(e) => { setImpression(e.target.value); debouncedSave('impression', e.target.value); }} className="min-h-[40px] text-xs" placeholder="Your read on this stakeholder..." />
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground">Key concerns</label>
        <Textarea value={concerns} onChange={(e) => { setConcerns(e.target.value); debouncedSave('key_concerns', e.target.value); }} className="min-h-[40px] text-xs" placeholder="Their concerns, objections, priorities..." />
      </div>
    </div>
  );
}

export function StakeholderMapPanel({ accountId }: { accountId: string | null | undefined }) {
  const { data: contacts = [] } = useWarRoomContacts(accountId);
  const { mutate: addContact } = useAddWarRoomContact();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', title: '', interview_role: '', met_on: '' });

  if (!accountId) return <p className="text-xs text-muted-foreground">Link an account to track stakeholders.</p>;

  const handleAdd = () => {
    if (!form.name.trim()) return;
    addContact({ account_id: accountId, name: form.name, title: form.title || undefined, interview_role: form.interview_role || undefined, met_on: form.met_on || undefined });
    setForm({ name: '', title: '', interview_role: '', met_on: '' });
    setShowAdd(false);
  };

  return (
    <div className="space-y-3">
      {contacts.length === 0 && <p className="text-xs text-muted-foreground">No stakeholders tracked yet.</p>}
      {contacts.map(c => <StakeholderCard key={c.id} c={c} accountId={accountId} />)}
      {showAdd ? (
        <div className="p-3 rounded-lg border border-dashed border-border space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Name *" className="h-8 text-sm" />
            <Input value={form.title} onChange={(e) => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Title" className="h-8 text-sm" />
            <Input value={form.interview_role} onChange={(e) => setForm(p => ({ ...p, interview_role: e.target.value }))} placeholder="Stakeholder role (Champion, EB...)" className="h-8 text-sm" />
            <Input type="date" value={form.met_on} onChange={(e) => setForm(p => ({ ...p, met_on: e.target.value }))} className="h-8 text-sm" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setShowAdd(true)} className="gap-1"><Plus className="h-3.5 w-3.5" /> Add stakeholder</Button>
      )}
    </div>
  );
}

// Keep backward-compatible export
export { StakeholderMapPanel as WarRoomTimeline };
