import { supabase } from '@/integrations/supabase/client';

interface ContactForInference {
  id: string;
  name: string;
  title: string | null;
  department: string | null;
  seniority: string | null;
  reporting_to: string | null;
  buyer_role: string | null;
  influence_level: string | null;
}

export function inferSeniorityTier(title: string | null, seniority: string | null): number {
  const seniorityOrder: Record<string, number> = { 'c-suite': 0, 'vp': 1, 'director': 2, 'manager': 3, 'senior': 3, 'individual': 4 };
  if (seniority && seniorityOrder[seniority] !== undefined) {
    return seniorityOrder[seniority];
  }
  const t = (title || '').toLowerCase();
  if (/\b(ceo|cfo|cmo|cro|cto|coo|chief|c-suite|president)\b/.test(t)) return 0;
  if (/\b(svp|senior vice president|evp|executive vice president)\b/.test(t)) return 0.5;
  if (/\b(vp|vice president)\b/.test(t)) return 1;
  if (/\b(senior director)\b/.test(t)) return 1.5;
  if (/\b(director)\b/.test(t)) return 2;
  if (/\b(senior manager|head of)\b/.test(t)) return 2.5;
  if (/\b(manager|lead)\b/.test(t)) return 3;
  if (/\b(senior|specialist|coordinator|analyst)\b/.test(t)) return 3.5;
  return 4;
}

export function inferDepartment(title: string | null): string | null {
  const t = (title || '').toLowerCase();
  if (/\b(marketing|brand|demand gen|growth|content|campaign|media)\b/.test(t)) return 'Marketing';
  if (/\b(digital|ecommerce|e-commerce|online|web|seo|email|sms)\b/.test(t)) return 'Digital';
  if (/\b(crm|lifecycle|retention|engagement|loyalty|customer journey|automation)\b/.test(t)) return 'CRM / Lifecycle';
  if (/\b(sales|revenue|business development|partnerships|account)\b/.test(t)) return 'Sales';
  if (/\b(customer experience|customer success|cx|support|service)\b/.test(t)) return 'Customer Experience';
  if (/\b(it|information technology|systems|engineering|data|analytics|platform)\b/.test(t)) return 'IT / Engineering';
  if (/\b(operations|ops)\b/.test(t)) return 'Operations';
  if (/\b(finance|accounting|cfo)\b/.test(t)) return 'Finance';
  if (/\b(hr|human resources|people|talent)\b/.test(t)) return 'HR';
  if (/\b(legal|compliance|counsel)\b/.test(t)) return 'Legal';
  return null;
}

export function inferBuyerRole(title: string | null, tier: number): string {
  if (tier <= 0.5) return 'economic_buyer';
  if (tier <= 1) return 'champion';
  if (tier <= 2) return 'influencer';
  if (tier <= 3) return 'user_buyer';
  return 'unknown';
}

export function inferInfluenceLevel(tier: number): string {
  if (tier <= 1) return 'high';
  if (tier <= 2.5) return 'medium';
  return 'low';
}

const TIER_TO_SENIORITY: Record<number, string> = {
  0: 'c-suite', 0.5: 'c-suite', 1: 'vp', 1.5: 'director', 2: 'director',
  2.5: 'manager', 3: 'manager', 3.5: 'individual', 4: 'individual',
};

/**
 * Auto-infer hierarchy for all contacts of an account.
 * Only runs when no explicit reporting_to relationships exist.
 * Updates reporting_to, department, seniority, buyer_role, and influence_level.
 */
export async function autoInferHierarchy(accountId: string): Promise<number> {
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, name, title, department, seniority, reporting_to, buyer_role, influence_level')
    .eq('account_id', accountId)
    .order('created_at');

  if (error || !contacts || contacts.length < 2) return 0;

  // Only auto-infer when NO explicit relationships exist
  const hasAnyExplicit = contacts.some(c => c.reporting_to);
  if (hasAnyExplicit) return 0;

  const tiered = contacts.map(c => ({
    contact: c as ContactForInference,
    tier: inferSeniorityTier(c.title, c.seniority),
    inferredDept: c.department || inferDepartment(c.title),
  }));
  tiered.sort((a, b) => a.tier - b.tier);

  // Group by tier
  const tierGroups = new Map<number, typeof tiered>();
  for (const item of tiered) {
    if (!tierGroups.has(item.tier)) tierGroups.set(item.tier, []);
    tierGroups.get(item.tier)!.push(item);
  }

  const tierLevels = Array.from(tierGroups.keys()).sort((a, b) => a - b);
  if (tierLevels.length <= 1) return 0;

  let updates = 0;

  // Assign children to parents tier-by-tier
  for (let i = 1; i < tierLevels.length; i++) {
    const parentTier = tierGroups.get(tierLevels[i - 1])!;
    const childTier = tierGroups.get(tierLevels[i])!;

    for (const child of childTier) {
      const bestParent = parentTier.find(p =>
        p.inferredDept && child.inferredDept &&
        p.inferredDept.toLowerCase() === child.inferredDept.toLowerCase()
      ) || parentTier[0];

      const updateFields: Record<string, any> = {
        reporting_to: bestParent.contact.name,
      };

      if (!child.contact.department && child.inferredDept) {
        updateFields.department = child.inferredDept;
      }
      if (!child.contact.seniority) {
        updateFields.seniority = TIER_TO_SENIORITY[child.tier] || 'individual';
      }
      if (child.contact.buyer_role === 'unknown' || !child.contact.buyer_role) {
        updateFields.buyer_role = inferBuyerRole(child.contact.title, child.tier);
      }
      if (!child.contact.influence_level || child.contact.influence_level === 'medium') {
        updateFields.influence_level = inferInfluenceLevel(child.tier);
      }

      await supabase.from('contacts').update(updateFields).eq('id', child.contact.id);
      updates++;
    }
  }

  // Update root-level contacts with inferred fields
  const rootTier = tierGroups.get(tierLevels[0])!;
  for (const root of rootTier) {
    const updateFields: Record<string, any> = {};
    if (!root.contact.department && root.inferredDept) updateFields.department = root.inferredDept;
    if (!root.contact.seniority) updateFields.seniority = TIER_TO_SENIORITY[root.tier] || 'individual';
    if (root.contact.buyer_role === 'unknown' || !root.contact.buyer_role) {
      updateFields.buyer_role = inferBuyerRole(root.contact.title, root.tier);
    }
    if (!root.contact.influence_level || root.contact.influence_level === 'medium') {
      updateFields.influence_level = inferInfluenceLevel(root.tier);
    }
    if (Object.keys(updateFields).length > 0) {
      await supabase.from('contacts').update(updateFields).eq('id', root.contact.id);
      updates++;
    }
  }

  return updates;
}
