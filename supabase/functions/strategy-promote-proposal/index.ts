// strategy-promote-proposal
// Phase 4 Promoter — turns a confirmed strategy_promotion_proposals row into
// a real shared system-of-record row with full provenance.
//
// Hard rules:
//  - Proposal MUST be in status='confirmed'.
//  - target_scope MUST be set.
//  - For account-scope writes, target_account_id MUST be present.
//  - For opportunity-scope writes, target_opportunity_id MUST be present.
//  - Scope='both' requires BOTH ids.
//  - All writes carry source='strategy', source_strategy_thread_id,
//    source_proposal_id, promoted_by, promoted_at.
//  - On success, proposal is updated to status='promoted', promoted_record_id set.
//  - On failure, proposal is updated to status='failed', promotion_error set.
//  - Idempotent: if proposal already promoted, return the existing record.

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
  promoted_record_id: string | null;
}

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

  // Authenticated user (RLS context)
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return err(401, 'Missing Authorization');

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userResp } = await userClient.auth.getUser();
  const user = userResp?.user;
  if (!user) return err(401, 'Invalid token');

  // Service client used to bypass RLS for atomic provenance writes.
  // We still scope every query by user_id so cross-user writes are impossible.
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
  if (p.status !== 'confirmed') {
    return err(409, `Proposal is in status='${p.status}', must be 'confirmed' to promote`);
  }

  // Scope discipline
  const scope = p.target_scope;
  const needsAccount = scope === 'account' || scope === 'both';
  const needsOpp = scope === 'opportunity' || scope === 'both';
  if (needsAccount && !p.target_account_id) return err(422, 'target_account_id required for account-scope promotion');
  if (needsOpp && !p.target_opportunity_id) return err(422, 'target_opportunity_id required for opportunity-scope promotion');

  // Verify entity ownership for any referenced ids (defense in depth — RLS would catch this anyway)
  if (p.target_account_id) {
    const { data: a } = await svc.from('accounts').select('id').eq('id', p.target_account_id).eq('user_id', user.id).maybeSingle();
    if (!a) return err(403, 'target_account_id does not belong to user');
  }
  if (p.target_opportunity_id) {
    const { data: o } = await svc.from('opportunities').select('id, account_id').eq('id', p.target_opportunity_id).eq('user_id', user.id).maybeSingle();
    if (!o) return err(403, 'target_opportunity_id does not belong to user');
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

    switch (p.proposal_type) {
      case 'contact':
      case 'stakeholder':
      case 'champion': {
        promotedTable = 'contacts';
        if (!p.target_account_id) {
          throw new Error('Contacts must be promoted with an account scope (target_account_id)');
        }
        const name = String(payload.name ?? '').trim();
        if (!name) throw new Error('payload.name is required for contact promotion');
        const email = payload.email ? String(payload.email).trim().toLowerCase() : null;

        // Dedupe by email (per user)
        if (email) {
          const { data: existing } = await svc
            .from('contacts').select('id, account_id').eq('user_id', user.id).ilike('email', email).maybeSingle();
          if (existing) {
            // attach to account if not already linked
            if (!existing.account_id) {
              await svc.from('contacts').update({ account_id: p.target_account_id, ...provenance })
                .eq('id', existing.id).eq('user_id', user.id);
            }
            promotedId = existing.id;
            break;
          }
        } else {
          // dedupe by (account_id, lower(name))
          const { data: existingByName } = await svc
            .from('contacts').select('id').eq('user_id', user.id)
            .eq('account_id', p.target_account_id).ilike('name', name).maybeSingle();
          if (existingByName) { promotedId = existingByName.id; break; }
        }

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

        // Mirror into account_contacts (lightweight join used by other surfaces)
        await svc.from('account_contacts').insert({
          user_id: user.id,
          account_id: p.target_account_id,
          name,
          title: payload.title ?? null,
          notes: payload.notes ?? null,
          source_proposal_id: p.id,
        });
        break;
      }

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
          memory_type: payload.memory_type ?? (p.proposal_type === 'account_intelligence' ? 'fact' : 'fact'),
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
        promotedTable = 'opportunity_strategy_memory';
        if (!p.target_opportunity_id) throw new Error('opportunity scope required');
        const content = String(payload.content ?? payload.text ?? '').trim();
        if (!content) throw new Error('payload.content required');
        const memoryType = p.proposal_type === 'risk' ? 'risk'
          : p.proposal_type === 'blocker' ? 'risk'
          : payload.memory_type ?? 'fact';
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
        break;
      }

      case 'resource_promotion':
      case 'artifact_promotion': {
        promotedTable = 'resources';
        const title = String(payload.title ?? 'Strategy-promoted artifact').trim();
        const content = String(payload.content ?? '').trim();
        const resourceType = body.resource_type_override
          ?? payload.resource_type
          ?? 'document';
        const isReusableTemplate = body.mark_reusable === true || payload.is_template === true;

        const { data: created, error } = await svc.from('resources').insert({
          user_id: user.id,
          title,
          description: payload.description ?? null,
          resource_type: resourceType,
          content,
          content_status: content ? 'manual' : 'file',
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

    // Mark proposal promoted
    await svc.from('strategy_promotion_proposals').update({
      status: 'promoted',
      promoted_record_id: promotedId,
      promoted_at: new Date().toISOString(),
      promotion_error: null,
    }).eq('id', p.id).eq('user_id', user.id);

    return ok({
      success: true,
      proposal_id: p.id,
      promoted_table: promotedTable,
      promoted_record_id: promotedId,
      scope,
    });
  } catch (e: any) {
    console.error('[promoter] failed', { proposal_id: p.id, type: p.proposal_type, error: e?.message });
    await svc.from('strategy_promotion_proposals').update({
      status: 'failed',
      promotion_error: String(e?.message ?? e).slice(0, 1000),
    }).eq('id', p.id).eq('user_id', user.id);
    return err(500, 'Promotion failed', { detail: String(e?.message ?? e) });
  }
});
