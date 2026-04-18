// strategy-promote-proposal
// Phase 5 Promoter — class-aware, scope-aware, relationship-confirmed shared writes.
//
// CORE SAFETY MODEL:
//   A proposal becomes a shared row ONLY when ALL are true:
//     - status starts in one of: 'confirmed_shared_intelligence' | 'confirmed_crm_contact'
//       (legacy 'confirmed' still works but maps to 'shared_intelligence' for non-contact types only)
//     - confirmed_class explicitly set
//     - target_scope satisfies its required ids
//     - For 'crm_contact': proposal_type ∈ {contact, stakeholder, champion}
//                         AND target_account_id is set AND owned by the user
//
//   research_only NEVER promotes — it stays in proposals as the durable record.
//
// All writes carry source='strategy', source_strategy_thread_id,
// source_proposal_id, promoted_by, promoted_at, promotion scope and class.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ProposalType =
  | 'contact' | 'stakeholder' | 'champion'
  | 'account_note' | 'account_intelligence'
  | 'opportunity_note' | 'opportunity_intelligence'
  | 'risk' | 'blocker'
  | 'transcript'
  | 'resource_promotion' | 'artifact_promotion';

type Scope = 'account' | 'opportunity' | 'both';
type PromotionClass = 'research_only' | 'shared_intelligence' | 'crm_contact';

interface Proposal {
  id: string;
  user_id: string;
  thread_id: string;
  source_message_id: string | null;
  source_artifact_id: string | null;
  proposal_type: ProposalType;
  target_table: string | null;
  target_scope: Scope;
  target_account_id: string | null;
  target_opportunity_id: string | null;
  payload_json: Record<string, unknown>;
  status: string;
  confirmed_class: PromotionClass | null;
  promoted_record_id: string | null;
}

const PERSON_TYPES: ProposalType[] = ['contact', 'stakeholder', 'champion'];

function err(status: number, message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function ok(payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err(405, 'Method not allowed');

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return err(401, 'Missing Authorization');

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userResp } = await userClient.auth.getUser();
  const user = userResp?.user;
  if (!user) return err(401, 'Invalid token');

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { proposal_id?: string; mark_reusable?: boolean; resource_type_override?: string };
  try { body = await req.json(); } catch { return err(400, 'Invalid JSON body'); }
  if (!body.proposal_id) return err(400, 'proposal_id required');

  const { data: proposal, error: pErr } = await svc
    .from('strategy_promotion_proposals')
    .select('*')
    .eq('id', body.proposal_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (pErr || !proposal) return err(404, 'Proposal not found', { detail: pErr?.message });

  const p = proposal as Proposal;

  // Idempotency
  if (p.status === 'promoted' && p.promoted_record_id) {
    return ok({ already_promoted: true, promoted_record_id: p.promoted_record_id, proposal: p });
  }

  // ============ CLASS GATE ============
  // Determine effective class. Reject anything that hasn't been class-confirmed.
  let effectiveClass: PromotionClass | null = p.confirmed_class;

  if (!effectiveClass) {
    // Legacy fallback: a 'confirmed' (no class) proposal is treated as shared_intelligence
    // ONLY for non-person types. Person types REQUIRE explicit crm_contact class.
    if (p.status === 'confirmed' && !PERSON_TYPES.includes(p.proposal_type)) {
      effectiveClass = 'shared_intelligence';
    } else {
      return err(409, 'Proposal must be class-confirmed before promotion', {
        hint: 'Set confirmed_class to research_only, shared_intelligence, or crm_contact',
        current_status: p.status,
        proposal_type: p.proposal_type,
      });
    }
  }

  // Status must be one of the confirmed states
  const validConfirmedStates = new Set([
    'confirmed', 'confirmed_research_only',
    'confirmed_shared_intelligence', 'confirmed_crm_contact',
  ]);
  if (!validConfirmedStates.has(p.status)) {
    return err(409, `Proposal status='${p.status}' is not promotable`);
  }

  // research_only NEVER promotes — that is the entire point of the class.
  if (effectiveClass === 'research_only') {
    return err(409, 'research_only proposals are not promoted to shared tables', {
      hint: 'They live as durable Strategy proposals only. Re-classify as shared_intelligence or crm_contact to promote.',
    });
  }

  // crm_contact gate: only person-types, must have account
  if (effectiveClass === 'crm_contact') {
    if (!PERSON_TYPES.includes(p.proposal_type)) {
      return err(422, `crm_contact class requires proposal_type ∈ {contact, stakeholder, champion} (got ${p.proposal_type})`);
    }
    if (!p.target_account_id) {
      return err(422, 'crm_contact promotion requires target_account_id (relationship-confirmed account)');
    }
  }

  // ============ SCOPE GATE ============
  const scope = p.target_scope;
  const needsAccount = scope === 'account' || scope === 'both';
  const needsOpp = scope === 'opportunity' || scope === 'both';
  if (needsAccount && !p.target_account_id) return err(422, 'target_account_id required for account-scope promotion');
  if (needsOpp && !p.target_opportunity_id) return err(422, 'target_opportunity_id required for opportunity-scope promotion');

  // Ownership defense in depth
  if (p.target_account_id) {
    const { data: a } = await svc.from('accounts').select('id').eq('id', p.target_account_id).eq('user_id', user.id).maybeSingle();
    if (!a) return err(403, 'target_account_id does not belong to user');
  }
  if (p.target_opportunity_id) {
    const { data: o } = await svc.from('opportunities').select('id, account_id').eq('id', p.target_opportunity_id).eq('user_id', user.id).maybeSingle();
    if (!o) return err(403, 'target_opportunity_id does not belong to user');
    // Coherence: opp.account_id must match the target_account_id when both are set.
    // Prevents cross-account opp drift even if both ids are owned by the same user.
    if (p.target_account_id && o.account_id && o.account_id !== p.target_account_id) {
      return err(409, 'Opportunity belongs to a different account than the proposal target_account_id', {
        code: 'opp_account_mismatch',
        opportunity_id: p.target_opportunity_id,
        opp_account_id: o.account_id,
        target_account_id: p.target_account_id,
      });
    }
  }

  // ============ TRUST GATE (Phase 3) ============
  // Block promotion when the source thread has unresolved blocking conflicts.
  // The detector persists conflicts; we read them here so this check is durable
  // even if a client tries to bypass the UI.
  const { data: trustRow } = await svc
    .rpc('compute_thread_trust_state', { p_thread_id: p.thread_id });
  const trustState = (typeof trustRow === 'string' ? trustRow : 'safe') as 'safe' | 'warning' | 'blocked';
  if (trustState === 'blocked') {
    const { data: blockingConflicts } = await svc
      .from('strategy_thread_conflicts')
      .select('conflict_kind, reason, detected_account_name, linked_account_name')
      .eq('thread_id', p.thread_id)
      .eq('user_id', user.id)
      .eq('severity', 'blocking')
      .is('resolved_at', null)
      .limit(3);
    return err(409, 'Thread has unresolved entity conflicts; shared promotion is blocked', {
      code: 'thread_trust_blocked',
      trust_state: trustState,
      conflicts: blockingConflicts ?? [],
      hint: 'Resolve via clone, unlink, or detector re-clear before promoting.',
    });
  }

  const provenance = {
    source: 'strategy',
    source_strategy_thread_id: p.thread_id,
    source_proposal_id: p.id,
    promoted_at: new Date().toISOString(),
    promoted_by: user.id,
  };

  try {
    let promotedId: string | null = null;
    let promotedTable: string;
    const payload = p.payload_json ?? {};

    // ============ ROUTING ============
    // Person-type proposals split by class:
    //   crm_contact → contacts + account_contacts
    //   shared_intelligence → account_strategy_memory (as a "person of interest" intel note)
    if (PERSON_TYPES.includes(p.proposal_type)) {
      const name = String(payload.name ?? '').trim();
      if (!name) throw new Error('payload.name is required for person promotion');

      if (effectiveClass === 'shared_intelligence') {
        // Save as account intelligence note, NOT as a CRM contact.
        if (!p.target_account_id) throw new Error('shared_intelligence for a person requires target_account_id');
        promotedTable = 'account_strategy_memory';
        const role = p.proposal_type === 'champion' ? 'potential champion'
                  : p.proposal_type === 'stakeholder' ? 'potential stakeholder'
                  : 'person of interest';
        const noteParts = [`${role}: ${name}`];
        if (payload.title) noteParts.push(`(${payload.title})`);
        if (payload.notes) noteParts.push(`— ${payload.notes}`);
        const { data: created, error } = await svc.from('account_strategy_memory').insert({
          user_id: user.id,
          account_id: p.target_account_id,
          memory_type: 'stakeholder_note',
          content: noteParts.join(' '),
          confidence: payload.confidence ?? null,
          source_thread_id: p.thread_id,
          source_message_id: p.source_message_id,
          source_proposal_id: p.id,
        }).select('id').single();
        if (error) throw error;
        promotedId = created.id;
      } else {
        // crm_contact — write real contact + account link
        promotedTable = 'contacts';
        const email = payload.email ? String(payload.email).trim().toLowerCase() : null;

        // Dedupe by email (per user, scoped to account)
        if (email) {
          const { data: existing } = await svc
            .from('contacts').select('id, account_id')
            .eq('user_id', user.id).ilike('email', email).maybeSingle();
          if (existing) {
            if (existing.account_id !== p.target_account_id) {
              await svc.from('contacts').update({ account_id: p.target_account_id, ...provenance })
                .eq('id', existing.id).eq('user_id', user.id);
            }
            promotedId = existing.id;
          }
        }
        if (!promotedId) {
          // dedupe by (account_id, lower(name))
          const { data: existingByName } = await svc
            .from('contacts').select('id').eq('user_id', user.id)
            .eq('account_id', p.target_account_id).ilike('name', name).maybeSingle();
          if (existingByName) promotedId = existingByName.id;
        }

        if (!promotedId) {
          const insert = {
            user_id: user.id,
            account_id: p.target_account_id,
            name,
            email,
            title: payload.title ?? null,
            department: payload.department ?? null,
            seniority: payload.seniority ?? null,
            influence_level: payload.influence_level ?? 'medium',
            buyer_role: p.proposal_type === 'champion' ? 'champion'
              : p.proposal_type === 'stakeholder' ? (payload.buyer_role ?? 'stakeholder')
              : payload.buyer_role ?? null,
            notes: payload.notes ?? null,
            linkedin_url: payload.linkedin_url ?? null,
            ai_discovered: true,
            discovery_source: 'strategy',
            status: 'target',
            ...provenance,
          };
          const { data: created, error } = await svc.from('contacts').insert(insert).select('id').single();
          if (error) throw error;
          promotedId = created.id;
        }

        // Mirror into account_contacts only if not already linked.
        // Dedupe on (account_id, lower(name)) — same dedupe key the contacts table uses.
        const { data: existingLink } = await svc.from('account_contacts').select('id')
          .eq('user_id', user.id).eq('account_id', p.target_account_id)
          .ilike('name', name).maybeSingle();
        if (!existingLink) {
          await svc.from('account_contacts').insert({
            user_id: user.id,
            account_id: p.target_account_id,
            name,
            title: payload.title ?? null,
            notes: payload.notes ?? null,
            source_proposal_id: p.id,
            source: 'strategy',
            source_strategy_thread_id: p.thread_id,
            promoted_by: user.id,
            promoted_at: new Date().toISOString(),
          });
        }
      }
    } else {
      // Non-person types: use type-driven routing (all are shared_intelligence-class)
      switch (p.proposal_type) {
        case 'transcript': {
          promotedTable = 'call_transcripts';
          const content = String(payload.content ?? payload.text ?? '').trim();
          if (!content) throw new Error('payload.content is required for transcript promotion');
          const { data: created, error } = await svc.from('call_transcripts').insert({
            user_id: user.id,
            account_id: p.target_account_id,
            opportunity_id: p.target_opportunity_id,
            title: String(payload.title ?? 'Strategy-promoted context'),
            content,
            summary: payload.summary ?? null,
            call_date: payload.call_date ?? new Date().toISOString().slice(0, 10),
            call_type: payload.call_type ?? 'Strategy Context',
            participants: payload.participants ?? null,
            tags: Array.isArray(payload.tags) ? payload.tags : ['strategy'],
            ...provenance,
          }).select('id').single();
          if (error) throw error;
          promotedId = created.id;
          break;
        }

        case 'account_note':
        case 'account_intelligence': {
          promotedTable = 'account_strategy_memory';
          if (!p.target_account_id) throw new Error('account scope required');
          const content = String(payload.content ?? payload.text ?? '').trim();
          if (!content) throw new Error('payload.content required');
          const { data: created, error } = await svc.from('account_strategy_memory').insert({
            user_id: user.id,
            account_id: p.target_account_id,
            memory_type: payload.memory_type ?? 'fact',
            content,
            confidence: payload.confidence ?? null,
            source_thread_id: p.thread_id,
            source_message_id: p.source_message_id,
            source_proposal_id: p.id,
          }).select('id').single();
          if (error) throw error;
          promotedId = created.id;
          break;
        }

        case 'opportunity_note':
        case 'opportunity_intelligence':
        case 'risk':
        case 'blocker': {
          const content = String(payload.content ?? payload.text ?? '').trim();
          if (!content) throw new Error('payload.content required');
          const memoryType = (p.proposal_type === 'risk' || p.proposal_type === 'blocker')
            ? 'risk' : (payload.memory_type ?? 'fact');

          if (p.target_scope === 'opportunity' || p.target_scope === 'both') {
            if (!p.target_opportunity_id) throw new Error('target_opportunity_id required for opportunity-scope risk/blocker');
            promotedTable = 'opportunity_strategy_memory';
            const { data: created, error } = await svc.from('opportunity_strategy_memory').insert({
              user_id: user.id,
              opportunity_id: p.target_opportunity_id,
              memory_type: memoryType,
              content,
              confidence: payload.confidence ?? null,
              source_thread_id: p.thread_id,
              source_message_id: p.source_message_id,
              source_proposal_id: p.id,
            }).select('id').single();
            if (error) throw error;
            promotedId = created.id;
          } else {
            if (!p.target_account_id) throw new Error('target_account_id required for account-scope risk/blocker');
            promotedTable = 'account_strategy_memory';
            const { data: created, error } = await svc.from('account_strategy_memory').insert({
              user_id: user.id,
              account_id: p.target_account_id,
              memory_type: memoryType,
              content,
              confidence: payload.confidence ?? null,
              source_thread_id: p.thread_id,
              source_message_id: p.source_message_id,
              source_proposal_id: p.id,
            }).select('id').single();
            if (error) throw error;
            promotedId = created.id;
          }
          break;
        }

        case 'resource_promotion':
        case 'artifact_promotion': {
          promotedTable = 'resources';
          const title = String(payload.title ?? 'Strategy-promoted artifact').trim();
          const content = String(payload.content ?? '').trim();
          const resourceType = body.resource_type_override ?? payload.resource_type ?? 'document';
          const isReusableTemplate = body.mark_reusable === true || payload.is_template === true;

          const { data: created, error } = await svc.from('resources').insert({
            user_id: user.id,
            title,
            description: payload.description ?? null,
            resource_type: resourceType,
            content,
            content_status: content ? 'content' : 'enriched',
            account_id: needsAccount ? p.target_account_id : null,
            opportunity_id: needsOpp ? p.target_opportunity_id : null,
            tags: Array.isArray(payload.tags) ? payload.tags : ['strategy'],
            is_template: isReusableTemplate,
            template_category: isReusableTemplate ? (payload.template_category ?? 'strategy') : null,
            source_strategy_artifact_id: p.source_artifact_id,
            promotion_scope: scope,
            ...provenance,
          }).select('id').single();
          if (error) throw error;
          promotedId = created.id;
          break;
        }

        default:
          throw new Error(`Unsupported proposal_type: ${p.proposal_type}`);
      }
    }

    await svc.from('strategy_promotion_proposals').update({
      status: 'promoted',
      promoted_record_id: promotedId,
      promoted_at: new Date().toISOString(),
      promotion_error: null,
    }).eq('id', p.id).eq('user_id', user.id);

    return ok({
      success: true,
      proposal_id: p.id,
      promoted_table: promotedTable!,
      promoted_record_id: promotedId,
      scope,
      promotion_class: effectiveClass,
    });
  } catch (e: any) {
    console.error('[promoter] failed', { proposal_id: p.id, type: p.proposal_type, class: effectiveClass, error: e?.message });
    await svc.from('strategy_promotion_proposals').update({
      status: 'failed',
      promotion_error: String(e?.message ?? e).slice(0, 1000),
    }).eq('id', p.id).eq('user_id', user.id);
    return err(500, 'Promotion failed', { detail: String(e?.message ?? e) });
  }
});
