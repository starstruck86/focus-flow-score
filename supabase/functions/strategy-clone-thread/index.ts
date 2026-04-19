// strategy-clone-thread
// Phase 2 — Safe Relink / Clone flow primitive.
//
// Creates a NEW thread that inherits the source thread's messages (shell-clone)
// and re-links the clone to the user-chosen account/opportunity. The original
// thread is left untouched — its trust_state, conflicts, and content are preserved
// so the rep can audit what happened.
//
// HONEST SCOPE (declared up-front so the UI can be truthful):
//   ✅ messages          — copied (so the cloned thread reads as a continuation)
//   ✅ title             — copied + suffixed "(clone for <new entity>)"
//   ✅ lane              — copied
//   ✅ trust_state       — RESET to 'safe' on the clone; detector must re-run
//   ❌ uploads           — NOT copied (storage refs would be ambiguous across entities)
//   ❌ artifacts         — NOT copied (they were generated for the original entity)
//   ❌ outputs           — NOT copied (workflow runs are bound to the source thread)
//   ❌ proposals         — NOT copied (each thread proposes against its own entity)
//   ❌ memory            — NOT copied (account memory belongs to its account)
//
// The clone records `cloned_from_thread_id = <source>` for full provenance.
//
// Body: { source_thread_id: string, target_account_id?: string|null,
//          target_opportunity_id?: string|null, new_title?: string }
// Returns: { thread_id, title, message_count, cloned_from_thread_id, trust_state }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ok = (p: Record<string, unknown>) =>
  new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const err = (s: number, m: string, x: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ error: m, ...x }), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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

  let body: {
    source_thread_id?: string;
    target_account_id?: string | null;
    target_opportunity_id?: string | null;
    new_title?: string;
  };
  try { body = await req.json(); } catch { return err(400, 'Invalid JSON body'); }

  const sourceId = String(body.source_thread_id ?? '');
  if (!sourceId) return err(400, 'source_thread_id required');

  // Load source thread and verify ownership
  const { data: source, error: sErr } = await svc
    .from('strategy_threads')
    .select('id, user_id, title, lane, linked_account_id, linked_opportunity_id, linked_territory_id')
    .eq('id', sourceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (sErr || !source) return err(404, 'Source thread not found', { detail: sErr?.message });

  // Resolve new entity name for the clone title (best-effort)
  let newEntityName: string | null = null;
  if (body.target_account_id) {
    const { data: a } = await svc.from('accounts').select('name').eq('id', body.target_account_id).eq('user_id', user.id).maybeSingle();
    newEntityName = a?.name ?? null;
  } else if (body.target_opportunity_id) {
    const { data: o } = await svc.from('opportunities').select('name').eq('id', body.target_opportunity_id).eq('user_id', user.id).maybeSingle();
    newEntityName = o?.name ?? null;
  }

  const newType = body.target_account_id ? 'account_linked'
    : body.target_opportunity_id ? 'opportunity_linked'
    : 'freeform';

  const baseTitle = body.new_title?.trim()
    || (newEntityName ? `${source.title} (clone → ${newEntityName})` : `${source.title} (clone)`);

  // Insert the clone
  const { data: clone, error: cErr } = await svc
    .from('strategy_threads')
    .insert({
      user_id: user.id,
      title: baseTitle.slice(0, 200),
      lane: source.lane,
      thread_type: newType,
      linked_account_id: body.target_account_id ?? null,
      linked_opportunity_id: body.target_opportunity_id ?? null,
      cloned_from_thread_id: sourceId,
      trust_state: 'safe',
      trust_state_reason: null,
    } as any)
    .select('id, title, trust_state')
    .single();
  if (cErr || !clone) return err(500, 'Failed to create clone', { detail: cErr?.message });

  // Copy messages (shell-clone). Drop the citation/audit metadata since the
  // grounding was specific to the prior entity context.
  const { data: msgs } = await svc
    .from('strategy_messages')
    .select('role, message_type, content_json, created_at')
    .eq('thread_id', sourceId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  let messageCount = 0;
  if (msgs && msgs.length > 0) {
    // Prepend a system message naming the provenance
    const provenanceMsg = {
      thread_id: clone.id,
      user_id: user.id,
      role: 'system',
      message_type: 'system',
      content_json: {
        text: `Cloned from a prior thread${newEntityName ? ` and re-linked to ${newEntityName}` : ''}. The original thread is preserved with its own trust state. Verify any inherited content against the new entity before promoting.`,
      },
    };
    const carriedRows = msgs.map(m => ({
      thread_id: clone.id,
      user_id: user.id,
      role: m.role,
      message_type: m.message_type,
      content_json: m.content_json,
    }));
    const { error: mErr } = await svc.from('strategy_messages').insert([provenanceMsg, ...carriedRows]);
    if (!mErr) messageCount = carriedRows.length;
  }

  return ok({
    thread_id: clone.id,
    title: clone.title,
    cloned_from_thread_id: sourceId,
    trust_state: clone.trust_state,
    message_count: messageCount,
    new_entity_name: newEntityName,
    scope_notice: 'Messages copied. Uploads, artifacts, outputs, proposals, and memory were NOT carried over by design.',
  });
});
