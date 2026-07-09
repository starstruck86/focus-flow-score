import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface TerritoryProfile {
  id: string;
  name: string | null;
  role: string | null;
  company: string | null;
  start_date: string | null;
  quota_amount: number | null;
  quota_currency: string | null;
  quota_type: string | null;
  fiscal_year_start: string | null;
  fiscal_year_end: string | null;
  motion: string | null;
  territory_description: string | null;
  company_context: string | null;
  ki_library_summary: string | null;
  se_name: string | null;
  csm_name: string | null;
  manager_name: string | null;
  custom_notes: string | null;
}

function buildContextString(p: TerritoryProfile | null): string {
  if (!p) return '';
  const lines: string[] = ['## Territory Context (always apply to responses)'];
  if (p.name && p.role && p.company) lines.push(`You are assisting ${p.name}, ${p.role} at ${p.company}.`);
  if (p.start_date) lines.push(`Start date: ${p.start_date}.`);
  if (p.quota_amount && p.quota_type) {
    const q = new Intl.NumberFormat('en-US', { style: 'currency', currency: p.quota_currency || 'USD', minimumFractionDigits: 0 }).format(p.quota_amount);
    lines.push(`Quota: ${q} ${p.quota_type} quota. FY: ${p.fiscal_year_start} to ${p.fiscal_year_end}.`);
  }
  if (p.motion) lines.push(`Territory focus: ${p.motion}`);
  if (p.territory_description) lines.push(`Territory: ${p.territory_description}`);
  if (p.company_context) lines.push(`Company context: ${p.company_context}`);
  if (p.ki_library_summary) lines.push(`KI Library: ${p.ki_library_summary}`);
  if (p.se_name) lines.push(`SE: ${p.se_name}`);
  if (p.csm_name) lines.push(`CSM: ${p.csm_name}`);
  if (p.manager_name) lines.push(`Manager: ${p.manager_name}`);
  if (p.custom_notes) lines.push(`Notes: ${p.custom_notes}`);
  return lines.join('\n');
}

export function useTerritoryProfile() {
  const { user } = useAuth();

  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ['territory-profile', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await (supabase as any)
        .from('territory_profile')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data as TerritoryProfile | null;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const updateProfile = async (updates: Partial<TerritoryProfile>) => {
    if (!user) return;
    await (supabase as any)
      .from('territory_profile')
      .upsert({ ...updates, user_id: user.id }, { onConflict: 'user_id' });
    refetch();
  };

  return {
    profile: profile ?? null,
    isLoading,
    updateProfile,
    buildContextString: () => buildContextString(profile ?? null),
  };
}
