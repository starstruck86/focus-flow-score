/**
 * Unified Prep Context Builder.
 *
 * Assembles all relevant deal context for a given account in one call:
 * account info, martech stack, contacts, latest transcript, and notes.
 * Eliminates manual stitching — the system "just knows."
 */

import { supabase } from '@/integrations/supabase/client';

export interface PrepContext {
  account: {
    id: string;
    name: string;
    industry: string | null;
    website: string | null;
    techStack: string[];
    ecommerce: string | null;
    directEcommerce: boolean;
    emailSmsCapture: boolean;
    loyaltyMembership: boolean;
    mobileApp: boolean;
    marTech: string | null;
    marketingPlatformDetected: string | null;
    notes: string | null;
  } | null;
  contacts: Array<{
    name: string;
    title: string | null;
    buyerRole: string | null;
    seniority: string | null;
    department: string | null;
    influenceLevel: string | null;
  }>;
  latestTranscript: {
    title: string;
    callDate: string;
    summary: string | null;
    content: string;
    callType: string | null;
    participants: string | null;
  } | null;
  /** Compact text block ready for prompt injection */
  contextBlock: string;
  /** What signals were detected (for the confirmation panel) */
  signals: PrepSignal[];
}

export interface PrepSignal {
  label: string;
  category: 'stack' | 'contact' | 'transcript' | 'note' | 'industry';
  present: boolean;
}

/**
 * Build full prep context for an account.
 * Fetches account, contacts, and latest transcript in parallel.
 */
export async function buildPrepContext(
  accountId: string,
  userId: string,
): Promise<PrepContext> {
  if (!accountId) {
    return { account: null, contacts: [], latestTranscript: null, contextBlock: '', signals: [] };
  }

  const [accountRes, contactsRes, transcriptRes] = await Promise.all([
    supabase
      .from('accounts')
      .select('id, name, industry, website, tech_stack, ecommerce, direct_ecommerce, email_sms_capture, loyalty_membership, mobile_app, mar_tech, marketing_platform_detected, notes')
      .eq('id', accountId)
      .single(),

    supabase
      .from('contacts')
      .select('name, title, buyer_role, seniority, department, influence_level')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .order('influence_level', { ascending: false })
      .limit(10),

    supabase
      .from('call_transcripts')
      .select('title, call_date, summary, content, call_type, participants')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .order('call_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const acct = accountRes.data;
  const contacts = (contactsRes.data || []).map(c => ({
    name: c.name,
    title: c.title,
    buyerRole: c.buyer_role,
    seniority: c.seniority,
    department: c.department,
    influenceLevel: c.influence_level,
  }));
  const transcript = transcriptRes.data
    ? {
        title: transcriptRes.data.title,
        callDate: transcriptRes.data.call_date,
        summary: transcriptRes.data.summary,
        content: transcriptRes.data.content,
        callType: transcriptRes.data.call_type,
        participants: transcriptRes.data.participants,
      }
    : null;

  const account = acct
    ? {
        id: acct.id,
        name: acct.name,
        industry: acct.industry,
        website: acct.website,
        techStack: acct.tech_stack || [],
        ecommerce: acct.ecommerce,
        directEcommerce: !!acct.direct_ecommerce,
        emailSmsCapture: !!acct.email_sms_capture,
        loyaltyMembership: !!acct.loyalty_membership,
        mobileApp: !!acct.mobile_app,
        marTech: acct.mar_tech,
        marketingPlatformDetected: acct.marketing_platform_detected,
        notes: acct.notes,
      }
    : null;

  // Build signals for confirmation panel
  const signals: PrepSignal[] = [];
  if (account) {
    if (account.industry) signals.push({ label: account.industry, category: 'industry', present: true });
    for (const tech of account.techStack) {
      signals.push({ label: tech, category: 'stack', present: true });
    }
    if (account.marTech) signals.push({ label: account.marTech, category: 'stack', present: true });
    if (account.marketingPlatformDetected) {
      signals.push({ label: account.marketingPlatformDetected, category: 'stack', present: true });
    }
    if (account.ecommerce) signals.push({ label: account.ecommerce, category: 'stack', present: true });
    if (account.notes) signals.push({ label: 'Account notes', category: 'note', present: true });
  }
  for (const c of contacts.slice(0, 5)) {
    const role = c.title || c.buyerRole || c.seniority || 'Contact';
    signals.push({ label: `${c.name} — ${role}`, category: 'contact', present: true });
  }
  if (transcript) {
    signals.push({ label: `Transcript: ${transcript.title}`, category: 'transcript', present: true });
  }

  // Build contextBlock for prompt injection
  const contextBlock = buildContextBlock(account, contacts, transcript);

  return { account, contacts, latestTranscript: transcript, contextBlock, signals };
}

function buildContextBlock(
  account: PrepContext['account'],
  contacts: PrepContext['contacts'],
  transcript: PrepContext['latestTranscript'],
): string {
  const parts: string[] = [];

  if (account) {
    const info: string[] = [`Account: ${account.name}`];
    if (account.industry) info.push(`Industry: ${account.industry}`);
    if (account.website) info.push(`Website: ${account.website}`);
    if (account.techStack.length) info.push(`Tech Stack: ${account.techStack.join(', ')}`);
    if (account.marTech) info.push(`MarTech: ${account.marTech}`);
    if (account.marketingPlatformDetected) info.push(`Marketing Platform: ${account.marketingPlatformDetected}`);
    if (account.ecommerce) info.push(`Ecommerce: ${account.ecommerce}`);

    const capabilities: string[] = [];
    if (account.directEcommerce) capabilities.push('Direct Ecommerce');
    if (account.emailSmsCapture) capabilities.push('Email/SMS Capture');
    if (account.loyaltyMembership) capabilities.push('Loyalty Program');
    if (account.mobileApp) capabilities.push('Mobile App');
    if (capabilities.length) info.push(`Capabilities: ${capabilities.join(', ')}`);

    parts.push(info.join('\n'));
    if (account.notes) parts.push(`Account Notes:\n${account.notes}`);
  }

  if (contacts.length) {
    const contactLines = contacts.map(c => {
      const details = [c.title, c.buyerRole, c.department].filter(Boolean).join(' · ');
      return `- ${c.name}${details ? ` (${details})` : ''}`;
    });
    parts.push(`Key Contacts:\n${contactLines.join('\n')}`);
  }

  if (transcript) {
    const transcriptParts = [`Latest Call: ${transcript.title} (${transcript.callDate})`];
    if (transcript.callType) transcriptParts.push(`Type: ${transcript.callType}`);
    if (transcript.participants) transcriptParts.push(`Participants: ${transcript.participants}`);
    if (transcript.summary) {
      transcriptParts.push(`Summary: ${transcript.summary}`);
    }
    // Include content but cap at ~2000 chars to avoid prompt bloat
    const contentPreview = transcript.content.length > 2000
      ? transcript.content.slice(0, 2000) + '\n[...transcript truncated]'
      : transcript.content;
    transcriptParts.push(`Transcript:\n${contentPreview}`);
    parts.push(transcriptParts.join('\n'));
  }

  return parts.join('\n\n');
}
