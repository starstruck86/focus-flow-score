// strategy-detect-conflicts
// Phase 1 — Entity Conflict Safety Layer
//
// Scans a Strategy thread for entity mismatches between:
//   - linked_account_id (the chip the rep sees)
//   - linked_opportunity_id (and its account_id)
//   - thread title
//   - all message content
//   - uploads (file names + parsed text)
//   - artifacts (titles + rendered text)
//
// Detected conflict kinds:
//   content_vs_account       — thread content names a different company than linked
//   opp_account_mismatch     — linked opp belongs to a different account than linked_account
//   relink_target_mismatch   — caller passes a candidate target that conflicts with content
//   freeform_strong_signal   — freeform thread but content has high-confidence company signal
//
// Persists every conflict into strategy_thread_conflicts (idempotent: clears prior
// unresolved conflicts of the same kind for this thread before inserting).
//
// Updates strategy_threads.trust_state via compute_thread_trust_state RPC.
//
// Body: { thread_id: string, candidate_account_id?: string|null }
// Returns: { trust_state, conflicts: [...], entity_signals: { companies, people } }

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

// Tokens that look like a company name when followed by a corp suffix or mentioned alongside one.
const COMPANY_SUFFIXES = [
  'inc', 'inc.', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'capital', 'financial', 'group', 'holdings',
  'partners', 'industries', 'technologies', 'tech', 'systems',
  'solutions', 'labs', 'media', 'studios', 'bank', 'foundation',
];

// Conservative company-name extractor: captures sequences of 1-4 capitalized words
// optionally followed by a corp suffix. Filters obvious noise.
function extractCompanies(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  // Pattern: 1-4 Capitalized words, optionally followed by suffix
  const re = /\b([A-Z][a-zA-Z0-9&]+(?:\s+[A-Z][a-zA-Z0-9&]+){0,3})(?:\s+(Inc|Inc\.|LLC|Ltd|Limited|Corp|Corporation|Co|Company|Capital|Financial|Group|Holdings|Partners|Industries|Technologies|Tech|Systems|Solutions|Labs|Media|Studios|Bank|Foundation))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const base = m[1].trim();
    const suffix = m[2];
    if (!base) continue;
    // Skip obvious non-company tokens (single common words, prompts)
    const lower = base.toLowerCase();
    if (lower.length < 3) continue;
    if (NOISE_TOKENS.has(lower)) continue;
    const full = suffix ? `${base} ${suffix}` : base;
    // Require either a suffix or a multi-word capitalized phrase to count as company
    if (suffix || base.split(/\s+/).length >= 2) {
      found.add(full);
    }
  }
  return Array.from(found);
}

const NOISE_TOKENS = new Set([
  'i', 'me', 'my', 'we', 'us', 'our', 'they', 'them', 'this', 'that',
  'the', 'and', 'or', 'but', 'with', 'from', 'about', 'help', 'tell',
  'what', 'when', 'where', 'why', 'how', 'who', 'which',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
  'discovery', 'strategy', 'standard', 'fast', 'deep', 'note', 'notes',
  'transcript', 'attached', 'meeting', 'call', 'email', 'salesforce',
  'q1', 'q2', 'q3', 'q4', 'arr', 'crm', 'icp', 'roi', 'pov', 'rfp',
  'mode', 'depth', 'chat', 'thread', 'untitled', 'new', 'follow', 'up',
]);

// Normalize a company string for comparison ("Lima One Capital" ~ "Lima One")
function normalizeCompany(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(inc\.?|llc|ltd|limited|corp|corporation|co|company|capital|financial|group|holdings|partners|industries|technologies|tech|systems|solutions|labs|media|studios|bank|foundation)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Loose match: do the two company strings share a meaningful root?
function companyMatches(a: string, b: string): boolean {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Split into tokens and require a 2-token overlap, OR 1-token if both are single-token
  const ta = na.split(' ').filter(t => t.length >= 3);
  const tb = nb.split(' ').filter(t => t.length >= 3);
  if (ta.length === 0 || tb.length === 0) return false;
  const setB = new Set(tb);
  const overlap = ta.filter(t => setB.has(t)).length;
  if (ta.length === 1 && tb.length === 1) return overlap === 1;
  return overlap >= 2 || (overlap >= 1 && (ta.length === 1 || tb.length === 1));
}

function extractPeople(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  // First-name LastName pattern (2-3 capitalized tokens, neither in noise list)
  const re = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tokens = [m[1], m[2], m[3]].filter(Boolean) as string[];
    if (tokens.some(t => NOISE_TOKENS.has(t.toLowerCase()))) continue;
    if (tokens.some(t => COMPANY_SUFFIXES.includes(t.toLowerCase()))) continue;
    found.add(tokens.join(' '));
  }
  return Array.from(found);
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

  let body: { thread_id?: string; candidate_account_id?: string | null };
  try { body = await req.json(); } catch { return err(400, 'Invalid JSON body'); }
  const threadId = String(body.thread_id ?? '');
  if (!threadId) return err(400, 'thread_id required');

  // Load thread
  const { data: thread, error: tErr } = await svc
    .from('strategy_threads')
    .select('id, user_id, title, linked_account_id, linked_opportunity_id, thread_type')
    .eq('id', threadId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (tErr || !thread) return err(404, 'Thread not found', { detail: tErr?.message });

  // Load linked account name (if any) and the candidate (for relink-time detection)
  const accountIdsToLookup = [thread.linked_account_id, body.candidate_account_id].filter(Boolean) as string[];
  const accountMap = new Map<string, string>();
  if (accountIdsToLookup.length > 0) {
    const { data: accts } = await svc
      .from('accounts')
      .select('id, name, user_id')
      .in('id', accountIdsToLookup)
      .eq('user_id', user.id);
    for (const a of accts ?? []) accountMap.set(a.id, a.name);
  }
  const linkedAccountName = thread.linked_account_id ? accountMap.get(thread.linked_account_id) ?? null : null;
  const candidateAccountName = body.candidate_account_id ? accountMap.get(body.candidate_account_id) ?? null : null;

  // Load opportunity (for opp-account mismatch check)
  let oppAccountId: string | null = null;
  let oppAccountName: string | null = null;
  if (thread.linked_opportunity_id) {
    const { data: opp } = await svc
      .from('opportunities')
      .select('id, account_id')
      .eq('id', thread.linked_opportunity_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (opp?.account_id) {
      oppAccountId = opp.account_id;
      const { data: oa } = await svc.from('accounts').select('name').eq('id', opp.account_id).maybeSingle();
      oppAccountName = oa?.name ?? null;
    }
  }

  // Gather all text-bearing content from the thread
  const [{ data: messages }, { data: uploads }, { data: artifacts }] = await Promise.all([
    svc.from('strategy_messages').select('content_json, role').eq('thread_id', threadId).eq('user_id', user.id),
    svc.from('strategy_uploaded_resources').select('file_name, parsed_text, summary').eq('thread_id', threadId).eq('user_id', user.id),
    svc.from('strategy_artifacts').select('title, rendered_text, content_json').eq('thread_id', threadId).eq('user_id', user.id),
  ]);

  const textBlobs: { source: string; text: string }[] = [];
  textBlobs.push({ source: 'title', text: thread.title ?? '' });
  for (const m of messages ?? []) {
    const c = m.content_json as Record<string, unknown> | null;
    const text = (c?.text ?? c?.content ?? '') as string;
    if (text) textBlobs.push({ source: `message:${m.role}`, text });
  }
  for (const u of uploads ?? []) {
    if (u.file_name) textBlobs.push({ source: 'upload:filename', text: u.file_name });
    if (u.parsed_text) textBlobs.push({ source: 'upload:body', text: String(u.parsed_text).slice(0, 8000) });
    if (u.summary) textBlobs.push({ source: 'upload:summary', text: u.summary });
  }
  for (const a of artifacts ?? []) {
    if (a.title) textBlobs.push({ source: 'artifact:title', text: a.title });
    if (a.rendered_text) textBlobs.push({ source: 'artifact:body', text: String(a.rendered_text).slice(0, 8000) });
  }

  // Aggregate signals
  const companyHits = new Map<string, { count: number; sources: Set<string> }>();
  const peopleHits = new Map<string, { count: number; sources: Set<string> }>();

  for (const blob of textBlobs) {
    for (const c of extractCompanies(blob.text)) {
      const key = normalizeCompany(c);
      if (!key) continue;
      const cur = companyHits.get(c) ?? { count: 0, sources: new Set() };
      cur.count += 1;
      cur.sources.add(blob.source);
      companyHits.set(c, cur);
    }
    for (const p of extractPeople(blob.text)) {
      const cur = peopleHits.get(p) ?? { count: 0, sources: new Set() };
      cur.count += 1;
      cur.sources.add(blob.source);
      peopleHits.set(p, cur);
    }
  }

  const companySignals = Array.from(companyHits.entries())
    .map(([name, v]) => ({ name, count: v.count, sources: Array.from(v.sources) }))
    .sort((a, b) => b.count - a.count);
  const peopleSignals = Array.from(peopleHits.entries())
    .map(([name, v]) => ({ name, count: v.count, sources: Array.from(v.sources) }))
    .sort((a, b) => b.count - a.count);

  const entitySignals = { companies: companySignals.slice(0, 10), people: peopleSignals.slice(0, 10) };

  // ============ CONFLICT EVALUATION ============
  type Conflict = {
    kind: string;
    severity: 'warning' | 'blocking';
    reason: string;
    evidence: Record<string, unknown>;
    detected_account_name: string | null;
  };
  const conflicts: Conflict[] = [];

  // 1. content_vs_account — linked account doesn't match top company in content
  if (thread.linked_account_id && linkedAccountName && companySignals.length > 0) {
    // Find top company that does NOT match the linked account
    const mismatched = companySignals.find(c => !companyMatches(c.name, linkedAccountName) && c.count >= 2);
    if (mismatched) {
      // Verify the linked account is itself underrepresented
      const linkedHit = companySignals.find(c => companyMatches(c.name, linkedAccountName));
      if (!linkedHit || mismatched.count > linkedHit.count) {
        conflicts.push({
          kind: 'content_vs_account',
          severity: 'blocking',
          reason: `This thread references "${mismatched.name}" but is linked to "${linkedAccountName}". Shared promotion is blocked until you resolve this.`,
          evidence: { detected: mismatched, linked_company_signal: linkedHit ?? null, total_companies: companySignals.length },
          detected_account_name: mismatched.name,
        });
      }
    }
  }

  // 2. opp_account_mismatch — opp belongs to different account than linked
  if (thread.linked_account_id && oppAccountId && oppAccountId !== thread.linked_account_id) {
    conflicts.push({
      kind: 'opp_account_mismatch',
      severity: 'blocking',
      reason: `Linked opportunity belongs to "${oppAccountName ?? 'another account'}" but this thread is linked to "${linkedAccountName ?? 'a different account'}".`,
      evidence: { opp_account_id: oppAccountId, linked_account_id: thread.linked_account_id },
      detected_account_name: oppAccountName,
    });
  }

  // 3. relink_target_mismatch — caller is asking to retarget but content disagrees
  if (body.candidate_account_id && candidateAccountName && companySignals.length > 0) {
    const matchesCandidate = companySignals.some(c => companyMatches(c.name, candidateAccountName));
    const dominantOther = companySignals.find(c => !companyMatches(c.name, candidateAccountName) && c.count >= 2);
    if (!matchesCandidate && dominantOther) {
      conflicts.push({
        kind: 'relink_target_mismatch',
        severity: 'blocking',
        reason: `You are trying to link this thread to "${candidateAccountName}", but its content references "${dominantOther.name}". Clone the thread instead, or unlink first.`,
        evidence: { candidate: candidateAccountName, dominant_other: dominantOther },
        detected_account_name: dominantOther.name,
      });
    }
  }

  // 4. freeform_strong_signal — freeform thread but high-conf single company
  if (!thread.linked_account_id && !thread.linked_opportunity_id && companySignals.length > 0) {
    const top = companySignals[0];
    if (top.count >= 3 && top.sources.length >= 2) {
      conflicts.push({
        kind: 'freeform_strong_signal',
        severity: 'warning',
        reason: `Unconfirmed entity detected: "${top.name}". Link this thread explicitly before promoting any shared writes.`,
        evidence: { top_company: top },
        detected_account_name: top.name,
      });
    }
  }

  // ============ PERSIST ============
  // Clear prior unresolved conflicts so we don't accumulate stale entries.
  await svc.from('strategy_thread_conflicts')
    .delete()
    .eq('thread_id', threadId)
    .eq('user_id', user.id)
    .is('resolved_at', null);

  if (conflicts.length > 0) {
    const rows = conflicts.map(c => ({
      thread_id: threadId,
      user_id: user.id,
      conflict_kind: c.kind,
      severity: c.severity,
      reason: c.reason,
      evidence_json: c.evidence,
      detected_account_name: c.detected_account_name,
      linked_account_id: thread.linked_account_id,
      linked_account_name: linkedAccountName,
    }));
    const { error: insErr } = await svc.from('strategy_thread_conflicts').insert(rows);
    if (insErr) return err(500, 'Failed to persist conflicts', { detail: insErr.message });
  }

  // Compute trust state via DB helper so UI and promoter agree on the answer.
  const { data: tsRow } = await svc.rpc('compute_thread_trust_state', { p_thread_id: threadId });
  const trustState = (typeof tsRow === 'string' ? tsRow : 'safe') as 'safe' | 'warning' | 'blocked';

  // Worst-severity conflict reason for UI shorthand
  const blockingReason = conflicts.find(c => c.severity === 'blocking')?.reason
    ?? conflicts.find(c => c.severity === 'warning')?.reason
    ?? null;

  await svc.from('strategy_threads').update({
    trust_state: trustState,
    trust_state_reason: blockingReason,
    entity_signals: entitySignals,
    trust_checked_at: new Date().toISOString(),
  }).eq('id', threadId).eq('user_id', user.id);

  return ok({
    trust_state: trustState,
    trust_state_reason: blockingReason,
    conflicts,
    entity_signals: entitySignals,
  });
});
