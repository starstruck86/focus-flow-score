import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface WarRoomRow {
  id: string;
  name: string;
  account_id: string | null;
  role_title: string | null;
  process_stage: string | null;
  verdict: string | null;
  work_model: string | null;
  comp_json: Record<string, any>;
  next_interview_json: Record<string, any>;
  jd_url: string | null;
  company_url: string | null;
  recruiter_name: string | null;
  hiring_manager_name: string | null;
  open_questions: string[];
  intelligence_notes: string | null;
  logistics_notes: string | null;
  office_location: string | null;
  primary_strategy_thread_id: string | null;
  notes: string | null;
  stage: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
  // joined
  account_name?: string;
}

export function useWarRooms() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['war-rooms'],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*, accounts!opportunities_account_id_fkey(name)')
        .eq('user_id', user!.id)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        comp_json: r.comp_json ?? {},
        next_interview_json: r.next_interview_json ?? {},
        open_questions: r.open_questions ?? [],
        account_name: r.accounts?.name ?? null,
      })) as WarRoomRow[];
    },
  });
}

export function useWarRoom(id: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['war-room', id],
    enabled: !!user && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*, accounts!opportunities_account_id_fkey(name)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return {
        ...data,
        comp_json: data.comp_json ?? {},
        next_interview_json: data.next_interview_json ?? {},
        open_questions: data.open_questions ?? [],
        account_name: (data as any).accounts?.name ?? null,
      } as WarRoomRow;
    },
  });
}

export function useUpdateWarRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase
        .from('opportunities')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['war-room', vars.id] });
      qc.invalidateQueries({ queryKey: ['war-rooms'] });
    },
    onError: (e) => toast.error('Failed to update War Room: ' + (e as Error).message),
  });
}

export function useCreateWarRoom() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; account_id?: string; role_title?: string; work_model?: string }) => {
      const { data, error } = await supabase
        .from('opportunities')
        .insert({
          user_id: user!.id,
          name: input.name,
          account_id: input.account_id ?? null,
          role_title: input.role_title ?? null,
          work_model: input.work_model ?? null,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['war-rooms'] });
      toast.success('War Room created');
    },
    onError: (e) => toast.error('Failed to create War Room: ' + (e as Error).message),
  });
}
