// strategy-stage-proposal
// Materializes a Strategy artifact OR upload as a pending promotion proposal.
//
// This is the missing bridge between Strategy's "thinking" surfaces (artifacts
// and uploads) and the existing class-aware promoter pipeline. It creates a
// proposal row that the rep then explicitly classifies + promotes via the
// normal ProposalReviewPanel decision gate.
//
// HARD CONTRACT — same Mode A rules as the rest of the pipeline:
//   - We NEVER write to shared tables here. Only to strategy_promotion_proposals.
//   - The created proposal is `pending` and `confirmed_class = null`.
//   - The rep must still classify it (research_only / shared_intelligence /
//     crm_contact) and explicitly promote via strategy-promote-proposal.
//
// Body:
//   { source_type: 'artifact' | 'upload',
//     source_id: string,
//     thread_id: string,                       // required for provenance
//     target_account_id?: string | null,
//     target_opportunity_id?: string | null,
//     target_scope?: 'account' | 'opportunity' | 'both',
//     proposal_type?: 'artifact_promotion' | 'resource_promotion' | 'transcript',
//     mark_reusable?: boolean }
//
// Returns: { proposal_id, proposal }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

  let body: any;
  try { body = await req.json(); } catch { return err(400, 'Invalid JSON body'); }

  const sourceType = body.source_type as 'artifact' | 'upload';
  const sourceId = String(body.source_id ?? '');
  const threadId = String(body.thread_id ?? '');
  if (!['artifact', 'upload'].includes(sourceType)) return err(400, 'source_type must be artifact|upload');
  if (!sourceId) return err(400, 'source_id required');
  if (!threadId) return err(400, 'thread_id required');

  const targetAccountId = body.target_account_id ?? null;
  const targetOpportunityId = body.target_opportunity_id ?? null;
  const targetScope = (body.target_scope ?? 'account') as 'account' | 'opportunity' | 'both';

  // Defense in depth: caller-provided account/opp must be owned by the user
  if (targetAccountId) {
    const { data: a } = await svc.from('accounts').select('id').eq('id', targetAccountId).eq('user_id', user.id).maybeSingle();
    if (!a) return err(403, 'target_account_id does not belong to user');
  }
  if (targetOpportunityId) {
    const { data: o } = await svc.from('opportunities').select('id').eq('id', targetOpportunityId).eq('user_id', user.id).maybeSingle();
    if (!o) return err(403, 'target_opportunity_id does not belong to user');
  }

  let proposalType: 'artifact_promotion' | 'resource_promotion' | 'transcript' =
    body.proposal_type ?? 'artifact_promotion';
  let payload: Record<string, unknown> = {};
  let dedupeKey = '';
  let sourceArtifactId: string | null = null;
  let sourceMessageId: string | null = null;
  let rationale = '';

  if (sourceType === 'artifact') {
    const { data: art, error } = await svc
      .from('strategy_artifacts')
      .select('id, title, artifact_type, content_json, rendered_text, thread_id, user_id')
      .eq('id', sourceId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error || !art) return err(404, 'Artifact not found', { detail: error?.message });
    sourceArtifactId = art.id;
    proposalType = 'artifact_promotion';

    const content = art.rendered_text
      ?? (typeof art.content_json === 'string'
          ? art.content_json
          : JSON.stringify(art.content_json ?? {}, null, 2));

    payload = {
      title: art.title,
      content,
      resource_type: 'document',
      description: `Strategy artifact: ${art.artifact_type}`,
      tags: ['strategy', art.artifact_type],
      is_template: body.mark_reusable === true,
    };
    dedupeKey = `artifact:${art.id}`;
    rationale = `Promote Strategy artifact "${art.title}" (${art.artifact_type}) to shared resources.`;
  } else {
    // upload
    const { data: up, error } = await svc
      .from('strategy_uploaded_resources')
      .select('id, file_name, file_type, parsed_text, summary, storage_path, thread_id, user_id, metadata_json')
      .eq('id', sourceId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error || !up) return err(404, 'Upload not found', { detail: error?.message });

    const ext = (up.file_name?.split('.').pop() ?? '').toLowerCase();
    const looksLikeTranscript =
      body.proposal_type === 'transcript' ||
      ext === 'vtt' || ext === 'srt' ||
      /transcript|call|meeting/i.test(up.file_name ?? '') ||
      /^(speaker|host|me:|them:)/im.test(up.parsed_text ?? '');

    proposalType = looksLikeTranscript ? 'transcript' : 'resource_promotion';

    if (proposalType === 'transcript') {
      payload = {
        title: up.file_name,
        content: up.parsed_text ?? '',
        summary: up.summary ?? null,
        call_type: 'Strategy Upload',
        tags: ['strategy', 'upload'],
        storage_path: up.storage_path,
      };
    } else {
      payload = {
        title: up.file_name,
        content: up.parsed_text ?? '',
        description: up.summary ?? null,
        resource_type: ext === 'pdf' ? 'pdf' : 'document',
        tags: ['strategy', 'upload', ext].filter(Boolean),
        is_template: body.mark_reusable === true,
        storage_path: up.storage_path,
      };
    }
    dedupeKey = `upload:${up.id}`;
    rationale = `Promote uploaded file "${up.file_name}" to shared ${proposalType === 'transcript' ? 'call transcripts' : 'resources'}.`;
  }

  // Idempotency: if a proposal with this dedupe_key already exists for this
  // thread, return it instead of creating a duplicate.
  const { data: existing } = await svc
    .from('strategy_promotion_proposals')
    .select('*')
    .eq('user_id', user.id)
    .eq('thread_id', threadId)
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();
  if (existing) {
    return ok({ proposal_id: existing.id, proposal: existing, reused: true });
  }

  const insertRow = {
    user_id: user.id,
    thread_id: threadId,
    source_message_id: sourceMessageId,
    source_artifact_id: sourceArtifactId,
    proposal_type: proposalType,
    target_table: proposalType === 'transcript' ? 'call_transcripts' : 'resources',
    target_scope: targetScope,
    target_account_id: targetAccountId,
    target_opportunity_id: targetOpportunityId,
    payload_json: payload,
    rationale,
    scope_rationale: targetScope === 'account'
      ? 'Defaulted to account scope; rep can change before promoting.'
      : `Scope: ${targetScope}.`,
    dedupe_key: dedupeKey,
    status: 'pending',
    detector_version: 'manual_stage_v1',
    detector_confidence: 1.0,
  };

  const { data: created, error: insertErr } = await svc
    .from('strategy_promotion_proposals')
    .insert(insertRow)
    .select('*')
    .single();

  if (insertErr) return err(500, 'Failed to stage proposal', { detail: insertErr.message });

  return ok({ proposal_id: created.id, proposal: created, reused: false });
});
