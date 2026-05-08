import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateWarRoom } from '@/hooks/useWarRooms';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export function CreateWarRoomDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { mutateAsync: create, isPending } = useCreateWarRoom();
  const [company, setCompany] = useState('');
  const [accountId, setAccountId] = useState<string | undefined>();
  const [roleTitle, setRoleTitle] = useState('');
  const [workModel, setWorkModel] = useState('');

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-list-simple'],
    enabled: !!user && open,
    queryFn: async () => {
      const { data } = await supabase.from('accounts').select('id, name').eq('deleted_at', '').or('deleted_at.is.null').order('name');
      // The above filter is tricky; let's just get all and filter
      const { data: all } = await supabase.from('accounts').select('id, name, deleted_at').order('name');
      return (all ?? []).filter(a => !a.deleted_at);
    },
  });

  const handleCreate = async () => {
    if (!company.trim() && !accountId) return;
    let aid = accountId;
    if (!aid && company.trim()) {
      // Create new account
      const { data, error } = await supabase.from('accounts').insert({ name: company.trim(), user_id: user!.id } as any).select('id').single();
      if (error) return;
      aid = data.id;
    }
    const result = await create({ name: roleTitle || company || accounts.find(a => a.id === aid)?.name || 'New Opportunity', account_id: aid, role_title: roleTitle || undefined, work_model: workModel || undefined });
    onOpenChange(false);
    if (result?.id) navigate(`/warrooms/${result.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New War Room</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Company</label>
            <Select value={accountId ?? '__new__'} onValueChange={(v) => { if (v === '__new__') { setAccountId(undefined); } else { setAccountId(v); setCompany(accounts.find(a => a.id === v)?.name ?? ''); } }}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select or type new..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">+ New company</SelectItem>
                {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {!accountId && (
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company name" className="mt-2 h-8 text-sm" />
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Role Title</label>
            <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="e.g. Enterprise AE" className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Work Model</label>
            <Select value={workModel} onValueChange={setWorkModel}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Remote">Remote</SelectItem>
                <SelectItem value="Hybrid">Hybrid</SelectItem>
                <SelectItem value="Onsite">Onsite</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={isPending || (!company.trim() && !accountId)}>
            {isPending ? 'Creating...' : 'Create War Room'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
