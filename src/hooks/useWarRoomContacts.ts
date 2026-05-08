import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface WarRoomContact {
  id: string;
  name: string;
  title: string | null;
  interview_role: string | null;
  met_on: string | null;
  impression: string | null;
  key_concerns: string | null;
  notes: string | null;
}

export function useWarRoomContacts(accountId: string | null | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['war-room-contacts', accountId],
    enabled: !!user && !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, title, interview_role, met_on, impression, key_concerns, notes')
        .eq('account_id', accountId!)
        .order('met_on', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as WarRoomContact[];
    },
  });
}

export function useAddWarRoomContact() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { account_id: string; name: string; title?: string; interview_role?: string; met_on?: string }) => {
      const { error } = await supabase
        .from('contacts')
        .insert({
          user_id: user!.id,
          account_id: input.account_id,
          name: input.name,
          title: input.title ?? null,
          interview_role: input.interview_role ?? null,
          met_on: input.met_on ?? null,
        } as any);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['war-room-contacts', vars.account_id] });
      toast.success('Contact added');
    },
    onError: (e) => toast.error('Failed: ' + (e as Error).message),
  });
}

export function useUpdateWarRoomContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates, accountId }: { id: string; updates: Record<string, any>; accountId: string }) => {
      const { error } = await supabase
        .from('contacts')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
      return accountId;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['war-room-contacts', vars.accountId] });
    },
    onError: (e) => toast.error('Failed: ' + (e as Error).message),
  });
}
