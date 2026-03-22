// React Query hooks for accounts, contacts, opportunities, renewals
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  getAccounts,
  findAccountBySalesforceId,
  findAccountByWebsite,
  findAccountByName,
  insertAccount,
  updateAccount as updateAccountQuery,
  deleteAccount as deleteAccountQuery,
  type AccountRow,
  type AccountUpdate,
} from '@/data/accounts';
import {
  getOpportunities,
  findOpportunityBySalesforceId,
  insertOpportunity,
  updateOpportunity as updateOpportunityQuery,
  deleteOpportunity as deleteOpportunityQuery,
  type OpportunityRow,
  type OpportunityUpdate,
} from '@/data/opportunities';
import {
  getRenewals,
  findRenewalByAccountName,
  insertRenewal,
  updateRenewal as updateRenewalQuery,
  type RenewalRow,
  type RenewalUpdate,
} from '@/data/renewals';
import {
  getContacts,
  findContactBySalesforceId,
  findContactByEmail,
  insertContact,
  updateContact as updateContactQuery,
  type ContactRow,
} from '@/data/contacts';

// Re-export DB types for backward compat
export type DbAccount = AccountRow;
export type DbContact = ContactRow;
export type DbOpportunity = OpportunityRow;
export type DbRenewal = RenewalRow;

// Accounts hooks
export function useDbAccounts() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['db-accounts', user?.id],
    queryFn: getAccounts,
    enabled: !!user?.id,
  });
}

export function useUpsertAccount() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (account: Partial<AccountRow> & { name: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      let existingId: string | undefined;
      
      if (account.salesforce_id) {
        const found = await findAccountBySalesforceId(account.salesforce_id);
        existingId = found?.id;
      }
      
      if (!existingId && account.website) {
        const domain = extractDomain(account.website);
        if (domain) {
          const found = await findAccountByWebsite(domain);
          existingId = found?.id;
        }
      }
      
      if (!existingId) {
        const found = await findAccountByName(account.name);
        existingId = found?.id;
      }
      
      const payload = { ...account, user_id: user.id };
      
      if (existingId) {
        const data = await updateAccountQuery(existingId, payload);
        return { data, isUpdate: true };
      } else {
        const data = await insertAccount(payload);
        return { data, isUpdate: false };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-accounts'] });
    },
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: AccountUpdate }) => {
      return updateAccountQuery(id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-accounts'] });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: deleteAccountQuery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-accounts'] });
    },
  });
}

// Contacts hooks
export function useDbContacts() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['db-contacts', user?.id],
    queryFn: getContacts,
    enabled: !!user?.id,
  });
}

export function useUpsertContact() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (contact: Partial<ContactRow> & { name: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      let existingId: string | undefined;
      
      if (contact.salesforce_id) {
        const found = await findContactBySalesforceId(contact.salesforce_id);
        existingId = found?.id;
      }
      
      if (!existingId && contact.email) {
        const found = await findContactByEmail(contact.email);
        existingId = found?.id;
      }
      
      const payload = { ...contact, user_id: user.id };
      
      if (existingId) {
        const data = await updateContactQuery(existingId, payload);
        return { data, isUpdate: true };
      } else {
        const data = await insertContact(payload);
        return { data, isUpdate: false };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-contacts'] });
    },
  });
}

// Opportunities hooks
export function useDbOpportunities() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['db-opportunities', user?.id],
    queryFn: getOpportunities,
    enabled: !!user?.id,
  });
}

export function useUpsertOpportunity() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (opp: Partial<OpportunityRow> & { name: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      let existingId: string | undefined;
      
      if (opp.salesforce_id) {
        const found = await findOpportunityBySalesforceId(opp.salesforce_id);
        existingId = found?.id;
      }
      
      const payload = { ...opp, user_id: user.id };
      
      if (existingId) {
        const data = await updateOpportunityQuery(existingId, payload);
        return { data, isUpdate: true };
      } else {
        const data = await insertOpportunity(payload);
        return { data, isUpdate: false };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-opportunities'] });
    },
  });
}

export function useUpdateOpportunity() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: OpportunityUpdate }) => {
      return updateOpportunityQuery(id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-opportunities'] });
    },
  });
}

export function useDeleteOpportunity() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: deleteOpportunityQuery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['db-renewals'] });
      toast.success('Opportunity deleted');
    },
    onError: (error) => {
      console.error('Delete opportunity error:', error);
      toast.error('Failed to delete opportunity: ' + (error as Error).message);
    },
  });
}

export function useAddOpportunity() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (opp: Partial<OpportunityRow> & { name: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      return insertOpportunity({ ...opp, user_id: user.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-opportunities'] });
    },
  });
}

export function useUpdateRenewal() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: RenewalUpdate }) => {
      return updateRenewalQuery(id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-renewals'] });
    },
  });
}


// Renewals hooks
export function useDbRenewals() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['db-renewals', user?.id],
    queryFn: getRenewals,
    enabled: !!user?.id,
  });
}

export function useUpsertRenewal() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  return useMutation({
    mutationFn: async (renewal: Partial<RenewalRow> & { account_name: string; renewal_due: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      
      const existing = await findRenewalByAccountName(renewal.account_name);
      const payload = { ...renewal, user_id: user.id };
      
      if (existing?.id) {
        const data = await updateRenewalQuery(existing.id, payload);
        return { data, isUpdate: true };
      } else {
        const data = await insertRenewal(payload);
        return { data, isUpdate: false };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['db-renewals'] });
    },
  });
}

// Helper to extract domain from URL
function extractDomain(url: string): string | null {
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const parsed = new URL(normalized);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
